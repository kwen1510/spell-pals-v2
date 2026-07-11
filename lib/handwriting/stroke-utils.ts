import type { Stroke, StrokePoint } from "./types";

export function addPoint(stroke: Stroke, point: StrokePoint, minimumDistance = 0.35): Stroke {
  const last = stroke.points.at(-1);
  if (last && Math.hypot(last.x - point.x, last.y - point.y) < minimumDistance) return stroke;
  return { ...stroke, points: [...stroke.points, point] };
}

export function cloneStrokes(strokes: Stroke[]): Stroke[] {
  return strokes.map((stroke) => ({ ...stroke, points: stroke.points.map((point) => ({ ...point })) }));
}

export function undoStroke(strokes: Stroke[]): Stroke[] {
  return strokes.slice(0, -1);
}

export function strokeBounds(stroke: Stroke) {
  const xs = stroke.points.map((point) => point.x);
  const ys = stroke.points.map((point) => point.y);
  return {
    left: Math.min(...xs),
    right: Math.max(...xs),
    top: Math.min(...ys),
    bottom: Math.max(...ys),
  };
}
