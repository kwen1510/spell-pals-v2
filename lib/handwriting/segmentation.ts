import { strokeBounds } from "./stroke-utils";
import type { SegmentationResult, Stroke } from "./types";

function strokeCentreX(stroke: Stroke) {
  const bounds = strokeBounds(stroke);
  return (bounds.left + bounds.right) / 2;
}

export function segmentByBoxes(strokes: Stroke[], characterCount: number, width: number): SegmentationResult {
  const groups = Array.from({ length: characterCount }, () => [] as Stroke[]);
  for (const stroke of strokes) {
    const index = Math.min(characterCount - 1, Math.max(0, Math.floor(strokeCentreX(stroke) / (width / characterCount))));
    groups[index].push(stroke);
  }
  return {
    groups,
    separators: Array.from({ length: characterCount - 1 }, (_, index) => width * (index + 1) / characterCount),
    weak: groups.some((group) => group.length === 0),
  };
}

export function segmentByWhitespace(strokes: Stroke[], characterCount: number, width: number): SegmentationResult {
  if (characterCount <= 1) return { groups: [strokes], separators: [], weak: strokes.length === 0 };
  if (!strokes.length || width <= 0) {
    return { groups: Array.from({ length: characterCount }, () => []), separators: [], weak: true };
  }

  const bins = Math.max(120, Math.round(width));
  const ink = new Float64Array(bins);
  for (const stroke of strokes) {
    const bounds = strokeBounds(stroke);
    const left = Math.max(0, Math.floor((bounds.left / width) * bins));
    const right = Math.min(bins - 1, Math.ceil((bounds.right / width) * bins));
    for (let index = left; index <= right; index += 1) ink[index] += 1;
  }

  const candidates: { x: number; score: number; empty: boolean }[] = [];
  const margin = Math.floor(bins * 0.1);
  for (let index = margin; index < bins - margin; index += 1) {
    const radius = Math.max(3, Math.floor(bins * 0.025));
    let occupancy = 0;
    for (let sample = Math.max(0, index - radius); sample <= Math.min(bins - 1, index + radius); sample += 1) occupancy += ink[sample];
    const balance = 1 - Math.abs(index / bins - 0.5) * 0.25;
    candidates.push({ x: (index / bins) * width, score: -occupancy * 100 + balance, empty: ink[index] === 0 });
  }

  const separators: number[] = [];
  const minimumGap = width / (characterCount * 2.25);
  for (const candidate of candidates.sort((a, b) => b.score - a.score)) {
    if (separators.every((separator) => Math.abs(separator - candidate.x) >= minimumGap)) separators.push(candidate.x);
    if (separators.length === characterCount - 1) break;
  }
  while (separators.length < characterCount - 1) separators.push(width * (separators.length + 1) / characterCount);
  separators.sort((a, b) => a - b);

  const groups = Array.from({ length: characterCount }, () => [] as Stroke[]);
  for (const stroke of strokes) {
    const pointCounts = Array.from({ length: characterCount }, () => 0);
    for (const point of stroke.points) {
      const region = separators.findIndex((separator) => point.x < separator);
      pointCounts[region === -1 ? characterCount - 1 : region] += 1;
    }
    const maxCount = Math.max(...pointCounts);
    let region = pointCounts.indexOf(maxCount);
    if (maxCount === 0) region = separators.filter((separator) => strokeCentreX(stroke) >= separator).length;
    groups[region].push(stroke);
  }

  const chosen = separators.map((separator) => candidates.reduce((best, item) => Math.abs(item.x - separator) < Math.abs(best.x - separator) ? item : best));
  return { groups, separators, weak: groups.some((group) => group.length === 0) || chosen.some((item) => !item.empty) };
}
