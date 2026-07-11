import type { CharacterBounds } from "./shape-validator";

export type ShapeGuideMode = "free" | "boxes";

export function characterShapeRegions(
  count: number,
  mode: ShapeGuideMode,
  width: number,
  height: number,
  separators: number[],
): CharacterBounds[] {
  if (!Number.isInteger(count) || count <= 0 || !Number.isFinite(width) || !Number.isFinite(height) || width <= 0 || height <= 0) return [];
  if (mode === "boxes") {
    const regionWidth = width / count;
    return Array.from({ length: count }, (_, index) => ({ x: index * regionWidth, y: 0, width: regionWidth, height }));
  }

  const validSeparators = separators.length === count - 1
    ? separators
    : Array.from({ length: count - 1 }, (_, index) => width * (index + 1) / count);
  const edges = [0, ...validSeparators, width];
  return Array.from({ length: count }, (_, index) => {
    const left = edges[index];
    const right = edges[index + 1];
    return { x: (left + right - height) / 2, y: 0, width: height, height };
  });
}
