import type { PixelHeaderArt } from "./profile-header-art";

export const HEADER_HISTORY_LIMIT = 100;
export type HeaderSnapshot = { frames: PixelHeaderArt[]; frameIndex: number; frameMs: number };
export type HeaderHistory = {
  present: HeaderSnapshot;
  past: HeaderSnapshot[];
  future: HeaderSnapshot[];
  strokeStart: HeaderSnapshot | null;
};
export type HeaderHistoryAction =
  | { type: "begin" | "end" | "undo" | "redo" }
  | { type: "paint"; art: PixelHeaderArt }
  | { type: "select"; index: number }
  | { type: "add"; maxFrames: number }
  | { type: "remove" }
  | { type: "speed"; ms: number };

export function createHeaderHistory(present: HeaderSnapshot): HeaderHistory {
  return { present, past: [], future: [], strokeStart: null };
}

function sameDrawing(a: HeaderSnapshot, b: HeaderSnapshot) {
  return a.frameMs === b.frameMs && JSON.stringify(a.frames) === JSON.stringify(b.frames);
}

export function canUndoHeader(history: HeaderHistory) {
  return history.past.length > 0 || (history.strokeStart !== null && !sameDrawing(history.strokeStart, history.present));
}

function checkpoint(history: HeaderHistory, present: HeaderSnapshot): HeaderHistory {
  if (sameDrawing(history.present, present)) return history;
  return { present, past: [...history.past, history.present].slice(-HEADER_HISTORY_LIMIT), future: [], strokeStart: null };
}

function finishStroke(history: HeaderHistory): HeaderHistory {
  if (!history.strokeStart) return history;
  const before = { ...history, present: history.strokeStart, strokeStart: null };
  return checkpoint(before, history.present);
}

// Store whole documents so removing a frame is reversible and undo always selects
// the frame it restores. Merely selecting a frame/tool never consumes a step.
export function headerHistoryReducer(history: HeaderHistory, action: HeaderHistoryAction): HeaderHistory {
  if (action.type === "paint") {
    const present = { ...history.present, frames: history.present.frames.map((frame, index) => index === history.present.frameIndex ? action.art : frame) };
    if (sameDrawing(history.present, present)) return history;
    return history.strokeStart ? { ...history, present, future: [] } : checkpoint(history, present);
  }
  const settled = finishStroke(history);
  const { present, past, future } = settled;
  switch (action.type) {
    case "begin": return { ...settled, strokeStart: present };
    case "end": return settled;
    case "undo": return past.length ? { present: past[past.length - 1], past: past.slice(0, -1), future: [present, ...future], strokeStart: null } : settled;
    case "redo": return future.length ? { present: future[0], past: [...past, present].slice(-HEADER_HISTORY_LIMIT), future: future.slice(1), strokeStart: null } : settled;
    case "select": return Number.isInteger(action.index) && action.index >= 0 && action.index < present.frames.length ? { ...settled, present: { ...present, frameIndex: action.index } } : settled;
    case "add": return present.frames.length < action.maxFrames ? checkpoint(settled, { ...present, frames: [...present.frames, present.frames[present.frameIndex]], frameIndex: present.frames.length }) : settled;
    case "remove": return present.frames.length > 1 ? checkpoint(settled, { ...present, frames: present.frames.filter((_, index) => index !== present.frameIndex), frameIndex: Math.max(0, present.frameIndex - 1) }) : settled;
    case "speed": return checkpoint(settled, { ...present, frameMs: action.ms });
  }
}
