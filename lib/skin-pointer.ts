import { MOUSE, TOUCH } from 'three';
import type { OrbitControls } from 'three/addons/controls/OrbitControls.js';

export function configureSkinControls(controls: Pick<OrbitControls, 'mouseButtons' | 'touches'>) {
  controls.mouseButtons = { LEFT: null, MIDDLE: MOUSE.DOLLY, RIGHT: MOUSE.ROTATE };
  controls.touches = { ONE: null, TWO: TOUCH.DOLLY_ROTATE };
}

// OrbitControls owns right-drag / two-finger gestures; only primary strokes paint.
export function bindSkinPainting(canvas: HTMLCanvasElement, point: (event: PointerEvent) => void, end: () => void) {
  const touches = new Set<number>();
  let stroke: number | null = null, pending: PointerEvent | null = null;
  let timer: ReturnType<typeof setTimeout> | undefined;
  let multiTouch = false;
  const clearPending = () => { clearTimeout(timer); pending = null; };
  const finish = () => { clearPending(); if (stroke !== null) end(); stroke = null; };
  const flush = () => { if (pending && !multiTouch) point(pending); clearPending(); };
  const down = (event: PointerEvent) => {
    if (event.pointerType === 'touch') {
      touches.add(event.pointerId);
      if (touches.size > 1) { multiTouch = true; finish(); return; }
      if (multiTouch) return;
    } else if (event.button !== 0 || event.buttons !== 1) { finish(); return; }
    if (stroke !== null) return;
    stroke = event.pointerId;
    canvas.setPointerCapture(event.pointerId);
    if (event.pointerType === 'touch') { pending = event; timer = setTimeout(flush, 120); }
    else point(event);
  };
  const move = (event: PointerEvent) => {
    if (stroke !== event.pointerId || multiTouch) return;
    if (event.pointerType !== 'touch' && event.buttons !== 1) { finish(); return; }
    if (pending) { pending = event; return; }
    point(event);
  };
  const up = (event: PointerEvent) => {
    if (stroke === event.pointerId) { flush(); finish(); }
    touches.delete(event.pointerId);
    if (!touches.size) multiTouch = false;
  };
  const cancel = (event: PointerEvent) => {
    if (stroke === event.pointerId) finish();
    touches.delete(event.pointerId);
    if (!touches.size) multiTouch = false;
  };
  const blur = () => { finish(); touches.clear(); multiTouch = false; };
  const context = (event: Event) => event.preventDefault();
  canvas.addEventListener('pointerdown', down, true);
  canvas.addEventListener('pointermove', move);
  canvas.addEventListener('pointerup', up);
  canvas.addEventListener('pointercancel', cancel);
  canvas.addEventListener('lostpointercapture', cancel);
  canvas.addEventListener('contextmenu', context);
  window.addEventListener('blur', blur);
  return () => {
    finish();
    canvas.removeEventListener('pointerdown', down, {capture: true});
    canvas.removeEventListener('pointermove', move);
    canvas.removeEventListener('pointerup', up);
    canvas.removeEventListener('pointercancel', cancel);
    canvas.removeEventListener('lostpointercapture', cancel);
    canvas.removeEventListener('contextmenu', context);
    window.removeEventListener('blur', blur);
  };
}
