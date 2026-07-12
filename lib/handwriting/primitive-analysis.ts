import type { NormalizedBounds } from "./character-template";

export interface PrimitivePoint { x: number; y: number }

export type PrimitiveType =
  | "horizontal"
  | "vertical"
  | "left_falling"
  | "right_falling"
  | "dot"
  | "hook"
  | "curve"
  | "turn"
  | "enclosure_edge"
  | "unknown";

export interface VisualPrimitive {
  id: string;
  sourceMovementIds: string[];
  typeProbabilities: Partial<Record<PrimitiveType, number>>;
  points: PrimitivePoint[];
  bounds: NormalizedBounds;
  centre: PrimitivePoint;
  length: number;
  directDistance: number;
  angle: number;
  curvature: number;
  startPoint: PrimitivePoint;
  endPoint: PrimitivePoint;
  intersections: string[];
}

export interface PrimitiveMovement {
  id: string;
  points: PrimitivePoint[];
}

const distance = (a: PrimitivePoint, b: PrimitivePoint) => Math.hypot(b.x - a.x, b.y - a.y);

function cleanPoints(points: readonly PrimitivePoint[]): PrimitivePoint[] {
  const result: PrimitivePoint[] = [];
  for (const point of points) {
    if (!Number.isFinite(point.x) || !Number.isFinite(point.y)) continue;
    if (!result.length || distance(result.at(-1)!, point) >= 0.002) result.push({ x: point.x, y: point.y });
  }
  return result;
}

function pathLength(points: readonly PrimitivePoint[]): number {
  return points.slice(1).reduce((sum, point, index) => sum + distance(points[index], point), 0);
}

function turnDegrees(a: PrimitivePoint, b: PrimitivePoint, c: PrimitivePoint): number {
  const first = Math.atan2(b.y - a.y, b.x - a.x);
  const second = Math.atan2(c.y - b.y, c.x - b.x);
  let delta = Math.abs(second - first) * 180 / Math.PI;
  if (delta > 180) delta = 360 - delta;
  return delta;
}

/** Split only visually strong corners; ordinary curved handwriting remains intact. */
function splitAtCorners(points: PrimitivePoint[]): PrimitivePoint[][] {
  if (points.length < 3) return points.length ? [points] : [];
  const total = pathLength(points);
  const boundaries = [0];
  let accumulated = 0;
  for (let index = 1; index < points.length - 1; index += 1) {
    accumulated += distance(points[index - 1], points[index]);
    const remaining = total - accumulated;
    const turn = turnDegrees(points[index - 1], points[index], points[index + 1]);
    if (turn >= 62 && accumulated >= 0.035 && remaining >= 0.035) boundaries.push(index);
  }
  boundaries.push(points.length - 1);
  return boundaries.slice(0, -1).map((start, index) => points.slice(start, boundaries[index + 1] + 1));
}

function boundsFor(points: readonly PrimitivePoint[]): NormalizedBounds {
  return {
    xMin: Math.min(...points.map((point) => point.x)),
    yMin: Math.min(...points.map((point) => point.y)),
    xMax: Math.max(...points.map((point) => point.x)),
    yMax: Math.max(...points.map((point) => point.y)),
  };
}

function classify(points: PrimitivePoint[]): Partial<Record<PrimitiveType, number>> {
  const start = points[0];
  const end = points.at(-1)!;
  const length = pathLength(points);
  const direct = distance(start, end);
  const probabilities: Partial<Record<PrimitiveType, number>> = {};
  if (length <= 0.065 && direct <= 0.05) return { dot: 0.92, unknown: 0.08 };
  const angle = Math.atan2(end.y - start.y, end.x - start.x) * 180 / Math.PI;
  const axialAngle = Math.abs(((angle % 180) + 180) % 180);
  const horizontalDistance = Math.min(axialAngle, 180 - axialAngle);
  const verticalDistance = Math.abs(90 - axialAngle);
  const curvature = direct > 0.001 ? length / direct - 1 : 1;
  const maximumTurn = points.length >= 3
    ? Math.max(...points.slice(1, -1).map((_, index) => turnDegrees(points[index], points[index + 1], points[index + 2])))
    : 0;
  if (maximumTurn >= 48 && curvature >= 0.08) probabilities.hook = 0.78;
  if (curvature >= 0.13) probabilities.curve = Math.max(probabilities.curve ?? 0, 0.72);
  if (maximumTurn >= 38) probabilities.turn = Math.max(probabilities.turn ?? 0, 0.62);
  if (horizontalDistance <= 24) probabilities.horizontal = 0.88;
  else if (verticalDistance <= 24) probabilities.vertical = 0.88;
  else if ((end.x - start.x) * (end.y - start.y) < 0) probabilities.left_falling = 0.82;
  else probabilities.right_falling = 0.82;
  if (!Object.keys(probabilities).length) probabilities.unknown = 1;
  return probabilities;
}

function orientation(a: PrimitivePoint, b: PrimitivePoint, c: PrimitivePoint): number {
  return (b.y - a.y) * (c.x - b.x) - (b.x - a.x) * (c.y - b.y);
}

function segmentIntersects(a: PrimitivePoint, b: PrimitivePoint, c: PrimitivePoint, d: PrimitivePoint): boolean {
  const o1 = orientation(a, b, c);
  const o2 = orientation(a, b, d);
  const o3 = orientation(c, d, a);
  const o4 = orientation(c, d, b);
  return o1 * o2 < 0 && o3 * o4 < 0;
}

function primitivesIntersect(left: VisualPrimitive, right: VisualPrimitive): boolean {
  for (let leftIndex = 1; leftIndex < left.points.length; leftIndex += 1) {
    for (let rightIndex = 1; rightIndex < right.points.length; rightIndex += 1) {
      if (segmentIntersects(
        left.points[leftIndex - 1], left.points[leftIndex],
        right.points[rightIndex - 1], right.points[rightIndex],
      )) return true;
    }
  }
  return false;
}

/**
 * Extract inspectable centreline primitives without equating a pen movement
 * with a dictionary stroke. Coordinates are expected in the normalized 0..1
 * structural frame.
 */
export function extractVisualPrimitives(movements: readonly PrimitiveMovement[]): VisualPrimitive[] {
  const primitives: VisualPrimitive[] = [];
  for (const movement of movements) {
    const clean = cleanPoints(movement.points);
    for (const piece of splitAtCorners(clean)) {
      if (!piece.length) continue;
      const startPoint = piece[0];
      const endPoint = piece.at(-1)!;
      const bounds = boundsFor(piece);
      const length = pathLength(piece);
      const directDistance = distance(startPoint, endPoint);
      primitives.push({
        id: `primitive-${primitives.length}`,
        sourceMovementIds: [movement.id],
        typeProbabilities: classify(piece),
        points: piece,
        bounds,
        centre: { x: (bounds.xMin + bounds.xMax) / 2, y: (bounds.yMin + bounds.yMax) / 2 },
        length,
        directDistance,
        angle: Math.atan2(endPoint.y - startPoint.y, endPoint.x - startPoint.x) * 180 / Math.PI,
        curvature: directDistance > 0.001 ? length / directDistance - 1 : 1,
        startPoint,
        endPoint,
        intersections: [],
      });
    }
  }
  for (let left = 0; left < primitives.length; left += 1) {
    for (let right = left + 1; right < primitives.length; right += 1) {
      if (!primitivesIntersect(primitives[left], primitives[right])) continue;
      primitives[left].intersections.push(primitives[right].id);
      primitives[right].intersections.push(primitives[left].id);
    }
  }
  return primitives;
}
