import type { ShapePoint } from "./character-shape-references";

const EPSILON = 1e-9;

export function pointDistance(left: ShapePoint, right: ShapePoint): number {
  return Math.hypot(left.x - right.x, left.y - right.y);
}

export function pathLength(points: readonly ShapePoint[]): number {
  let total = 0;
  for (let index = 1; index < points.length; index += 1) {
    total += pointDistance(points[index - 1], points[index]);
  }
  return total;
}

export function dedupePath(points: readonly ShapePoint[], minimumDistance = 0.5): ShapePoint[] {
  const result: ShapePoint[] = [];
  for (const point of points) {
    if (!Number.isFinite(point.x) || !Number.isFinite(point.y)) continue;
    const previous = result.at(-1);
    if (!previous || pointDistance(previous, point) >= minimumDistance) result.push({ x: point.x, y: point.y });
  }
  return result;
}

export function resamplePath(points: readonly ShapePoint[], sampleCount: number): ShapePoint[] {
  const clean = dedupePath(points, EPSILON);
  if (!clean.length || sampleCount <= 0) return [];
  if (clean.length === 1 || sampleCount === 1) return [{ ...clean[0] }];
  const cumulative = [0];
  for (let index = 1; index < clean.length; index += 1) {
    cumulative.push(cumulative[index - 1] + pointDistance(clean[index - 1], clean[index]));
  }
  const total = cumulative.at(-1) ?? 0;
  if (total <= EPSILON) return Array.from({ length: sampleCount }, () => ({ ...clean[0] }));

  const sampled: ShapePoint[] = [];
  let segment = 1;
  for (let sample = 0; sample < sampleCount; sample += 1) {
    const target = (sample / (sampleCount - 1)) * total;
    while (segment < cumulative.length - 1 && cumulative[segment] < target) segment += 1;
    const startDistance = cumulative[segment - 1];
    const segmentDistance = cumulative[segment] - startDistance;
    const progress = segmentDistance <= EPSILON ? 0 : (target - startDistance) / segmentDistance;
    sampled.push({
      x: clean[segment - 1].x + (clean[segment].x - clean[segment - 1].x) * progress,
      y: clean[segment - 1].y + (clean[segment].y - clean[segment - 1].y) * progress,
    });
  }
  return sampled;
}

export function averageDistanceToPath(points: readonly ShapePoint[], reference: readonly ShapePoint[]): number {
  if (!points.length || !reference.length) return Infinity;
  let total = 0;
  for (const point of points) {
    total += Math.min(...reference.map((referencePoint) => pointDistance(point, referencePoint)));
  }
  return total / points.length;
}

function average(values: readonly number[]): number {
  return values.length ? values.reduce((sum, value) => sum + value, 0) / values.length : -1;
}

function cosineSimilarity(left: ShapePoint, right: ShapePoint): number {
  const leftMagnitude = Math.hypot(left.x, left.y);
  const rightMagnitude = Math.hypot(right.x, right.y);
  if (leftMagnitude <= EPSILON || rightMagnitude <= EPSILON) return -1;
  return (left.x * right.x + left.y * right.y) / (leftMagnitude * rightMagnitude);
}

function edgeVectors(points: readonly ShapePoint[]): ShapePoint[] {
  const vectors: ShapePoint[] = [];
  for (let index = 1; index < points.length; index += 1) {
    const vector = { x: points[index].x - points[index - 1].x, y: points[index].y - points[index - 1].y };
    if (Math.hypot(vector.x, vector.y) > EPSILON) vectors.push(vector);
  }
  return vectors;
}

/** Hanzi Writer-style direction score: each captured edge finds its closest direction in the reference. */
export function directionSimilarity(points: readonly ShapePoint[], reference: readonly ShapePoint[]): number {
  const capturedVectors = edgeVectors(resamplePath(points, 20));
  const referenceVectors = edgeVectors(reference);
  if (!capturedVectors.length || !referenceVectors.length) return -1;
  return average(capturedVectors.map((captured) =>
    Math.max(...referenceVectors.map((expected) => cosineSimilarity(captured, expected))),
  ));
}

function rotate(points: readonly ShapePoint[], angle: number): ShapePoint[] {
  const cosine = Math.cos(angle);
  const sine = Math.sin(angle);
  return points.map((point) => ({
    x: cosine * point.x - sine * point.y,
    y: sine * point.x + cosine * point.y,
  }));
}

function normalizeCurve(points: readonly ShapePoint[]): ShapePoint[] {
  const outlined = resamplePath(points, 30);
  if (outlined.length < 2) return [];
  const mean = {
    x: average(outlined.map((point) => point.x)),
    y: average(outlined.map((point) => point.y)),
  };
  const translated = outlined.map((point) => ({ x: point.x - mean.x, y: point.y - mean.y }));
  const first = translated[0];
  const last = translated.at(-1)!;
  let scale = Math.sqrt(((first.x ** 2 + first.y ** 2) + (last.x ** 2 + last.y ** 2)) / 2);
  // Closed or nearly closed paths have unstable endpoint scaling. Falling back
  // to RMS radius preserves the same translation/scale invariant comparison.
  if (!Number.isFinite(scale) || scale < 1) {
    scale = Math.sqrt(average(translated.map((point) => point.x ** 2 + point.y ** 2)));
  }
  if (!Number.isFinite(scale) || scale <= EPSILON) return [];
  const scaled = translated.map((point) => ({ x: point.x / scale, y: point.y / scale }));
  const subdivided = scaled.slice(0, 1);
  for (const point of scaled.slice(1)) {
    const previous = subdivided.at(-1)!;
    const segmentLength = pointDistance(previous, point);
    const pieces = Math.max(1, Math.ceil(segmentLength / 0.05));
    for (let piece = 1; piece <= pieces; piece += 1) {
      subdivided.push({
        x: previous.x + (point.x - previous.x) * (piece / pieces),
        y: previous.y + (point.y - previous.y) * (piece / pieces),
      });
    }
  }
  return subdivided;
}

/** Iterative discrete Fréchet distance, matching Hanzi Writer's curve-shape metric. */
export function discreteFrechetDistance(left: readonly ShapePoint[], right: readonly ShapePoint[]): number {
  if (!left.length || !right.length) return Infinity;
  let previous = new Float64Array(right.length);
  for (let leftIndex = 0; leftIndex < left.length; leftIndex += 1) {
    const current = new Float64Array(right.length);
    for (let rightIndex = 0; rightIndex < right.length; rightIndex += 1) {
      const distance = pointDistance(left[leftIndex], right[rightIndex]);
      if (leftIndex === 0 && rightIndex === 0) current[rightIndex] = distance;
      else if (leftIndex === 0) current[rightIndex] = Math.max(current[rightIndex - 1], distance);
      else if (rightIndex === 0) current[rightIndex] = Math.max(previous[rightIndex], distance);
      else current[rightIndex] = Math.max(
        Math.min(previous[rightIndex], previous[rightIndex - 1], current[rightIndex - 1]),
        distance,
      );
    }
    previous = current;
  }
  return previous[right.length - 1];
}

const SHAPE_ROTATIONS = [Math.PI / 16, Math.PI / 32, 0, -Math.PI / 32, -Math.PI / 16];

export function shapeFrechetDistance(points: readonly ShapePoint[], reference: readonly ShapePoint[]): number {
  const normalizedPoints = normalizeCurve(points);
  const normalizedReference = normalizeCurve(reference);
  if (normalizedPoints.length < 2 || normalizedReference.length < 2) return Infinity;
  return Math.min(...SHAPE_ROTATIONS.map((angle) =>
    discreteFrechetDistance(normalizedPoints, rotate(normalizedReference, angle)),
  ));
}

export function angleBetweenTangents(first: ShapePoint, second: ShapePoint): number {
  const cosine = Math.max(-1, Math.min(1, cosineSimilarity(first, second)));
  return Number.isFinite(cosine) ? Math.acos(cosine) * (180 / Math.PI) : Infinity;
}
