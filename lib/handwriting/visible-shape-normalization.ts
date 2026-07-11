import type { ShapePoint } from "./character-shape-references";

/**
 * Affine transform used only by structural grading.
 *
 * The captured paths returned to the UI remain in writing-square coordinates.
 * This transform removes only whole-character size and translation, preserving
 * aspect ratio and every relative distance inside the character.
 */
export interface VisibleShapeTransform {
  scale: number;
  translateX: number;
  translateY: number;
}

export interface VisibleShapeBounds {
  minX: number;
  minY: number;
  maxX: number;
  maxY: number;
  width: number;
  height: number;
  centerX: number;
  centerY: number;
}

export interface NormalizedVisibleShape {
  paths: ShapePoint[][];
  bounds: VisibleShapeBounds;
  transform: VisibleShapeTransform;
}

/** Leave a useful margin for small residual rotation during matching. */
export const VISIBLE_SHAPE_TARGET_SPAN = 820;

export function visibleShapeBounds(paths: readonly (readonly ShapePoint[])[]): VisibleShapeBounds | null {
  let minX = Number.POSITIVE_INFINITY;
  let minY = Number.POSITIVE_INFINITY;
  let maxX = Number.NEGATIVE_INFINITY;
  let maxY = Number.NEGATIVE_INFINITY;
  let pointCount = 0;

  for (const path of paths) {
    for (const point of path) {
      if (!Number.isFinite(point.x) || !Number.isFinite(point.y)) return null;
      minX = Math.min(minX, point.x);
      minY = Math.min(minY, point.y);
      maxX = Math.max(maxX, point.x);
      maxY = Math.max(maxY, point.y);
      pointCount += 1;
    }
  }

  if (!pointCount) return null;
  const width = maxX - minX;
  const height = maxY - minY;
  const span = Math.max(width, height);
  if (!Number.isFinite(span) || span < 1e-6) return null;
  return {
    minX,
    minY,
    maxX,
    maxY,
    width,
    height,
    centerX: (minX + maxX) / 2,
    centerY: (minY + maxY) / 2,
  };
}

export function applyVisibleShapeTransform(
  paths: readonly (readonly ShapePoint[])[],
  transform: VisibleShapeTransform,
): ShapePoint[][] {
  return paths.map((path) => path.map((point) => ({
    x: point.x * transform.scale + transform.translateX,
    y: point.y * transform.scale + transform.translateY,
  })));
}

/**
 * Put the ink bounding box in a common structural frame.
 *
 * A single uniform scale is deliberate: independently stretching x and y
 * would make a short or narrow malformed component look correct. Pen-lift
 * boundaries, path order, point order, and the geometry within the ink are
 * otherwise untouched.
 */
export function normalizeVisibleShape(
  paths: readonly (readonly ShapePoint[])[],
  targetSpan = VISIBLE_SHAPE_TARGET_SPAN,
): NormalizedVisibleShape | null {
  if (!Number.isFinite(targetSpan) || targetSpan <= 0 || targetSpan > 1024) return null;
  const bounds = visibleShapeBounds(paths);
  if (!bounds) return null;

  const scale = targetSpan / Math.max(bounds.width, bounds.height);
  const transform: VisibleShapeTransform = {
    scale,
    translateX: 512 - bounds.centerX * scale,
    translateY: 512 - bounds.centerY * scale,
  };
  return {
    paths: applyVisibleShapeTransform(paths, transform),
    bounds,
    transform,
  };
}
