"use client";

import Link from "next/link";
import { useEffect, useMemo, useRef, useState, type PointerEvent as ReactPointerEvent } from "react";
import { DEFAULT_FRAME_MS, HEADER_FRAME_SPEEDS, MAX_HEADER_FRAMES, MAX_HEADER_FRAMES_HYPE } from "@/lib/plus-style";
import { floodFillHeaderColors } from "@/lib/profile-header-paint";
import {
  colorsToPixelHeaderArt,
  pixelHeaderArtToColors,
  PROFILE_HEADER_ART_COLORS,
  PROFILE_HEADER_ART_HEIGHT,
  PROFILE_HEADER_ART_WIDTH,
  type PixelHeaderArt,
} from "@/lib/profile-header-art";

const BRUSH_SIZES = [1, 2, 3, 4] as const;
const GRID_PATH = [
  ...Array.from({ length: PROFILE_HEADER_ART_WIDTH - 1 }, (_, i) => `M${i + 1} 0V${PROFILE_HEADER_ART_HEIGHT}`),
  ...Array.from({ length: PROFILE_HEADER_ART_HEIGHT - 1 }, (_, i) => `M0 ${i + 1}H${PROFILE_HEADER_ART_WIDTH}`),
].join(" ");

export function PixelHeaderEditor({
  art,
  onChange,
  onActivate,
  animated = false,
  maxFrames = MAX_HEADER_FRAMES,
  frameCount = 1,
  frameIndex = 0,
  frameMs = DEFAULT_FRAME_MS,
  onSelectFrame,
  onAddFrame,
  onRemoveFrame,
  onFrameMs,
  canUndo = false,
  canRedo = false,
  onUndo,
  onRedo,
  onEditStart,
  onEditEnd,
  context = "profile",
}: {
  art: PixelHeaderArt;
  onChange: (art: PixelHeaderArt) => void;
  onActivate: () => void;
  /* Анимация шапки открыта (тариф HYPE). */
  animated?: boolean;
  /* Сколько кадров разрешает тариф: без HYPE — одна картинка, с HYPE — 8. */
  maxFrames?: number;
  frameCount?: number;
  frameIndex?: number;
  frameMs?: number;
  onSelectFrame?: (index: number) => void;
  onAddFrame?: () => void;
  onRemoveFrame?: () => void;
  onFrameMs?: (ms: number) => void;
  canUndo?: boolean;
  canRedo?: boolean;
  onUndo?: () => void;
  onRedo?: () => void;
  onEditStart?: () => void;
  onEditEnd?: () => void;
  context?: "profile" | "article";
}) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const drawingPointerRef = useRef<number | null>(null);
  const colors = useMemo(() => pixelHeaderArtToColors(art), [art]);
  const colorsRef = useRef(colors);
  const [brushSize, setBrushSize] = useState<(typeof BRUSH_SIZES)[number]>(1);
  const [color, setColor] = useState<string>(PROFILE_HEADER_ART_COLORS[0]);
  const [tool, setTool] = useState<"brush" | "eraser" | "fill">("brush");
  const [showGrid, setShowGrid] = useState(true);
  /* Редактор можно развернуть поверх страницы — рисовать на большом холсте
     удобнее (просьба владельца, 2026-10-03). Esc сворачивает. */
  const [expanded, setExpanded] = useState(false);

  useEffect(() => { colorsRef.current = colors; }, [colors]);

  useEffect(() => {
    if (!expanded) return;
    const previousOverflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    const collapse = (event: KeyboardEvent) => { if (event.key === "Escape") setExpanded(false); };
    window.addEventListener("keydown", collapse);
    return () => {
      document.body.style.overflow = previousOverflow;
      window.removeEventListener("keydown", collapse);
    };
  }, [expanded]);

  useEffect(() => {
    const canvas = canvasRef.current;
    const context = canvas?.getContext("2d");
    if (!canvas || !context) return;
    context.clearRect(0, 0, PROFILE_HEADER_ART_WIDTH, PROFILE_HEADER_ART_HEIGHT);
    colors.forEach((pixelColor, index) => {
      if (!pixelColor) return;
      context.fillStyle = pixelColor;
      context.fillRect(index % PROFILE_HEADER_ART_WIDTH, Math.floor(index / PROFILE_HEADER_ART_WIDTH), 1, 1);
    });
  }, [colors]);

  function paint(event: ReactPointerEvent<HTMLCanvasElement>) {
    const canvas = event.currentTarget;
    const rect = canvas.getBoundingClientRect();
    const x = Math.floor((event.clientX - rect.left) / rect.width * PROFILE_HEADER_ART_WIDTH);
    const y = Math.floor((event.clientY - rect.top) / rect.height * PROFILE_HEADER_ART_HEIGHT);
    if (x < 0 || y < 0 || x >= PROFILE_HEADER_ART_WIDTH || y >= PROFILE_HEADER_ART_HEIGHT) return;
    if (tool === "fill") {
      const nextColors = floodFillHeaderColors(colorsRef.current, x, y, color);
      if (nextColors === colorsRef.current) return;
      colorsRef.current = nextColors;
      onChange(colorsToPixelHeaderArt(nextColors));
      onActivate();
      return;
    }
    const nextColors = [...colorsRef.current];
    const startOffset = Math.floor((brushSize - 1) / 2);
    for (let brushY = y - startOffset; brushY < y - startOffset + brushSize; brushY += 1) {
      for (let brushX = x - startOffset; brushX < x - startOffset + brushSize; brushX += 1) {
        if (brushX < 0 || brushY < 0 || brushX >= PROFILE_HEADER_ART_WIDTH || brushY >= PROFILE_HEADER_ART_HEIGHT) continue;
        nextColors[brushY * PROFILE_HEADER_ART_WIDTH + brushX] = tool === "eraser" ? null : color;
      }
    }
    if (nextColors.every((value, index) => value === colorsRef.current[index])) return;
    colorsRef.current = nextColors;
    onChange(colorsToPixelHeaderArt(nextColors));
    onActivate();
  }

  function finishStroke() {
    const pointer = drawingPointerRef.current;
    if (pointer === null) return;
    drawingPointerRef.current = null;
    onEditEnd?.();
    if (canvasRef.current?.hasPointerCapture(pointer)) canvasRef.current.releasePointerCapture(pointer);
  }

  function stepHistory(direction: "undo" | "redo") {
    finishStroke();
    if (direction === "undo" && canUndo) onUndo?.();
    if (direction === "redo" && canRedo) onRedo?.();
  }

  return (
    <fieldset className={expanded ? "pixel-header-editor is-expanded" : "pixel-header-editor"} onKeyDown={(event) => {
      if (!(event.ctrlKey || event.metaKey) || event.altKey) return;
      if ((event.target as HTMLElement).closest("input, textarea, select, [contenteditable='true']")) return;
      const undo = event.code === "KeyZ" && !event.shiftKey;
      const redo = (event.code === "KeyZ" && event.shiftKey) || (event.code === "KeyY" && !event.shiftKey);
      if (!undo && !redo) return;
      event.preventDefault();
      stepHistory(undo ? "undo" : "redo");
    }}>
      <legend>PIXEL_HEADER_EDITOR.EXE</legend>
      <p>{context === "article" ? "Нарисуйте шапку статьи. Она появится в списке статей и над текстом." : "Нарисуй собственную шапку. Рисунок автоматически включится при первом штрихе."}</p>
      {/* Анимация — возможность HYPE: кадры идут по кругу. */}
      {context === "profile" ? <div className="pixel-header-frames">
        <small>КАДРЫ{animated ? <span className="plus-tag is-hype">HYPE</span> : null}</small>
        <div className="pixel-frame-list" role="group" aria-label="Кадры анимации шапки">
          {Array.from({ length: frameCount }, (_, index) => (
            <button className={index === frameIndex ? "active" : ""} type="button" key={index} onClick={() => onSelectFrame?.(index)}>{index + 1}</button>
          ))}
          {animated && frameCount < maxFrames ? <button type="button" onClick={onAddFrame}>+ КАДР</button> : null}
          {animated && frameCount > 1 ? <button className="pixel-frame-remove" type="button" onClick={onRemoveFrame}>× КАДР {frameIndex + 1}</button> : null}
        </div>
        {animated ? (
          frameCount > 1 ? (
            <label className="pixel-frame-speed">СКОРОСТЬ
              <select value={String(frameMs)} onChange={(event) => onFrameMs?.(Number(event.target.value))}>
                {HEADER_FRAME_SPEEDS.map((speed) => <option value={String(speed.ms)} key={speed.ms}>{speed.label}</option>)}
              </select>
            </label>
          ) : <small>Добавьте кадр — шапка оживёт.</small>
        ) : (
          <small>Анимированная шапка (до {MAX_HEADER_FRAMES_HYPE} кадров) — в тарифе <Link href="/donation?plan=hype">POPPERS HYPE</Link>.</small>
        )}
      </div> : null}
      <div className="pixel-editor-history" role="group" aria-label="История рисунка">
        <button type="button" disabled={!canUndo} onClick={() => stepHistory("undo")} title="Отменить последнее изменение (Ctrl/Cmd+Z)">↶ ШАГ НАЗАД</button>
        <button type="button" disabled={!canRedo} onClick={() => stepHistory("redo")} title="Вернуть отменённое изменение (Ctrl/Cmd+Shift+Z, Ctrl+Y)">↷ ШАГ ВПЕРЁД</button>
        <button className="pixel-editor-expand" type="button" aria-pressed={expanded} onClick={() => setExpanded((value) => !value)} title={expanded ? "Свернуть редактор (Esc)" : "Развернуть редактор поверх страницы"}>
          {expanded ? "⤡ СВЕРНУТЬ" : "⤢ РАЗВЕРНУТЬ"}
        </button>
      </div>
      <div className="pixel-header-canvas-wrap">
        <canvas
        ref={canvasRef}
        width={PROFILE_HEADER_ART_WIDTH}
        height={PROFILE_HEADER_ART_HEIGHT}
        tabIndex={0}
        onPointerDown={(event) => {
          if (!event.isPrimary || event.button !== 0 || drawingPointerRef.current !== null) return;
          event.preventDefault();
          event.currentTarget.focus({ preventScroll: true });
          // A bucket click fills exactly one region, never every region crossed by a drag.
          if (tool !== "fill") {
            drawingPointerRef.current = event.pointerId;
            event.currentTarget.setPointerCapture(event.pointerId);
            onEditStart?.();
          }
          paint(event);
        }}
        onPointerMove={(event) => { if (drawingPointerRef.current === event.pointerId && tool !== "fill") paint(event); }}
        onPointerUp={(event) => {
          if (drawingPointerRef.current !== event.pointerId) return;
          finishStroke();
        }}
        onPointerCancel={finishStroke}
        onLostPointerCapture={finishStroke}
        onContextMenu={(event) => event.preventDefault()}
        aria-label={context === "article" ? "Холст пиксельного редактора шапки статьи" : "Холст пиксельного редактора шапки профиля"}
        />
        {showGrid ? (
          <svg className="pixel-header-grid" viewBox={`0 0 ${PROFILE_HEADER_ART_WIDTH} ${PROFILE_HEADER_ART_HEIGHT}`} preserveAspectRatio="none" aria-hidden="true" focusable="false">
            <path className="pixel-header-grid-light" d={GRID_PATH} vectorEffect="non-scaling-stroke" />
            <path className="pixel-header-grid-dark" d={GRID_PATH} vectorEffect="non-scaling-stroke" />
          </svg>
        ) : null}
      </div>
      <div className="pixel-editor-tools">
        <div className="pixel-brush-sizes" aria-label="Размер кисти">
          <small>КИСТЬ</small>
          {BRUSH_SIZES.map((size) => <button className={tool === "brush" && brushSize === size ? "active" : ""} aria-pressed={tool === "brush" && brushSize === size} type="button" onClick={() => { setBrushSize(size); setTool("brush"); }} key={size}>{size}×{size}</button>)}
        </div>
        <div className="pixel-editor-actions">
          <button className={tool === "fill" ? "active" : ""} aria-pressed={tool === "fill"} title="Залить область выбранным цветом" type="button" onClick={() => setTool((value) => value === "fill" ? "brush" : "fill")}>ЗАЛИВКА</button>
          <button className={tool === "eraser" ? "active" : ""} aria-pressed={tool === "eraser"} type="button" onClick={() => setTool((value) => value === "eraser" ? "brush" : "eraser")}>ЛАСТИК</button>
          <button className={showGrid ? "active" : ""} aria-pressed={showGrid} title="Показать или скрыть пиксельную сетку" type="button" onClick={() => setShowGrid((value) => !value)}>СЕТКА</button>
          <button type="button" onClick={() => { if (window.confirm("Очистить весь рисунок шапки?")) { colorsRef.current = pixelHeaderArtToColors(null); onChange(colorsToPixelHeaderArt([])); onActivate(); } }}>ОЧИСТИТЬ</button>
          {context === "profile" ? <button type="button" onClick={onActivate}>ИСПОЛЬЗОВАТЬ РИСУНОК</button> : null}
        </div>
      </div>
      <p className="pixel-header-tool-hint">Заливка закрашивает соседние пиксели одного цвета. Сетка видна только в редакторе.</p>
      <div className="pixel-color-palette" aria-label="Палитра цветов">
        <small>ПАЛИТРА</small>
        {PROFILE_HEADER_ART_COLORS.map((paletteColor) => (
          <button
            className={tool !== "eraser" && color === paletteColor ? "active" : ""}
            type="button"
            style={{ backgroundColor: paletteColor }}
            onClick={() => { setColor(paletteColor); setTool((value) => value === "eraser" ? "brush" : value); }}
            aria-label={`Выбрать цвет ${paletteColor}`}
            key={paletteColor}
          />
        ))}
        <label>СВОЙ ЦВЕТ<input type="color" value={color} onChange={(event) => { setColor(event.target.value); setTool((value) => value === "eraser" ? "brush" : value); }} /></label>
      </div>
    </fieldset>
  );
}
