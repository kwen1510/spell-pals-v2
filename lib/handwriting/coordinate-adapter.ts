import type { Stroke } from "./types";

export type RecognizerStrokeInput = number[][][];

const SIMPLIFY_TOLERANCE = 2.25;
const MAX_POINTS_PER_STROKE = 96;

function pointSegmentDistance(point: number[], start: number[], end: number[]) {
  const dx = end[0] - start[0];
  const dy = end[1] - start[1];
  if (dx === 0 && dy === 0) return Math.hypot(point[0] - start[0], point[1] - start[1]);
  const position = Math.max(0, Math.min(1, ((point[0] - start[0]) * dx + (point[1] - start[1]) * dy) / (dx * dx + dy * dy)));
  return Math.hypot(point[0] - (start[0] + position * dx), point[1] - (start[1] + position * dy));
}

export function simplifyRecognizerPoints(points: number[][], tolerance = SIMPLIFY_TOLERANCE): number[][] {
  if (points.length <= 2) return points.map((point) => [...point]);
  let farthestDistance = 0;
  let farthestIndex = 0;
  for (let index = 1; index < points.length - 1; index += 1) {
    const distance = pointSegmentDistance(points[index], points[0], points[points.length - 1]);
    if (distance > farthestDistance) {
      farthestDistance = distance;
      farthestIndex = index;
    }
  }
  if (farthestDistance <= tolerance) return [[...points[0]], [...points[points.length - 1]]];
  const left = simplifyRecognizerPoints(points.slice(0, farthestIndex + 1), tolerance);
  const right = simplifyRecognizerPoints(points.slice(farthestIndex), tolerance);
  return [...left.slice(0, -1), ...right];
}

function capPointCount(points: number[][], maximum = MAX_POINTS_PER_STROKE) {
  if (points.length <= maximum) return points;
  return Array.from({ length: maximum }, (_, index) => points[Math.round((index / (maximum - 1)) * (points.length - 1))]);
}

export function convertStrokesForRecognizer(strokes: Stroke[]): RecognizerStrokeInput {
  const usable = strokes
    .map((stroke) => ({ ...stroke, points: stroke.points.filter((point) => Number.isFinite(point.x) && Number.isFinite(point.y)) }))
    .filter((stroke) => stroke.points.length > 0);
  if (!usable.length) return [];

  const points = usable.flatMap((stroke) => stroke.points);
  const minX = Math.min(...points.map((point) => point.x));
  const maxX = Math.max(...points.map((point) => point.x));
  const minY = Math.min(...points.map((point) => point.y));
  const maxY = Math.max(...points.map((point) => point.y));
  const span = Math.max(maxX - minX, maxY - minY, 1);
  const offsetX = (256 - ((maxX - minX) / span) * 220) / 2;
  const offsetY = (256 - ((maxY - minY) / span) * 220) / 2;

  return usable.map((stroke) => {
    const converted = stroke.points.map((point) => [
      offsetX + ((point.x - minX) / span) * 220,
      offsetY + ((point.y - minY) / span) * 220,
    ]);
    // hanzi_lookup's pivot analysis assumes at least two distinct points.
    // A stylus tap is still a valid captured stroke, so give it a tiny tail.
    if (converted.length === 1) {
      converted.push([
        Math.min(255, converted[0][0] + 0.75),
        Math.min(255, converted[0][1] + 0.75),
      ]);
    } else if (converted.every((point) => point[0] === converted[0][0] && point[1] === converted[0][1])) {
      converted[converted.length - 1] = [
        Math.min(255, converted[0][0] + 0.75),
        Math.min(255, converted[0][1] + 0.75),
      ];
    }
    const deduplicated = converted.filter((point, index) => index === 0 || Math.hypot(point[0] - converted[index - 1][0], point[1] - converted[index - 1][1]) >= 0.6);
    const simplified = capPointCount(simplifyRecognizerPoints(capPointCount(deduplicated, 512)));
    if (simplified.length === 1) simplified.push([Math.min(255, simplified[0][0] + 0.75), Math.min(255, simplified[0][1] + 0.75)]);
    return simplified;
  });
}
