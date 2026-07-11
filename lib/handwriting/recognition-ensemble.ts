import { convertStrokesForRecognizer, type RecognizerStrokeInput } from "./coordinate-adapter";
import { isSimplifiedCandidate } from "./simplified";
import type {
  CharacterPrediction,
  RecognitionVariantFamily,
  Stroke,
  StrokePoint,
} from "./types";

export const BASELINE_TOLERANCES = [2.25, 4, 6] as const;
export const PAUSE_SPLIT_MS = 100;
export const ACCIDENTAL_LIFT_MAX_GAP_MS = 120;
export const ACCIDENTAL_LIFT_MAX_DISTANCE_RATIO = 0.035;
export const MAX_CORNER_SPLITS_PER_STROKE = 3;
export const RAW_LOOKUP_LIMIT = 40;

export const VARIANT_WEIGHTS: Record<RecognitionVariantFamily, number> = {
  baseline: 1,
  pause: 0.9,
  corner90: 0.9,
  corner45: 0.8,
  merge: 0.6,
};

const RRF_K = 10;
const BASELINE_RETENTION_RANK = 30;
const STRUCTURAL_SUPPORT_RANK = 20;
const STRUCTURAL_FAMILIES: RecognitionVariantFamily[] = ["pause", "corner90", "corner45", "merge"];

export interface RecognitionVariant {
  id: string;
  family: RecognitionVariantFamily;
  weight: number;
  input: RecognizerStrokeInput;
}

export interface RawRecognitionMatch {
  hanzi: string;
  score?: number;
}

export interface VariantRecognitionResult {
  variantId: string;
  matches: RawRecognitionMatch[];
}

interface CornerCandidate {
  index: number;
  angle: number;
  pathPosition: number;
}

function clonePoint(point: StrokePoint): StrokePoint {
  return { ...point };
}

function copyStroke(stroke: Stroke, id = stroke.id, points = stroke.points): Stroke {
  return { ...stroke, id, points: points.map(clonePoint) };
}

function characterSpan(strokes: Stroke[]): number {
  const points = strokes.flatMap((stroke) => stroke.points).filter((point) => Number.isFinite(point.x) && Number.isFinite(point.y));
  if (!points.length) return 1;
  const xs = points.map((point) => point.x);
  const ys = points.map((point) => point.y);
  return Math.max(Math.max(...xs) - Math.min(...xs), Math.max(...ys) - Math.min(...ys), 1);
}

function splitStroke(stroke: Stroke, splitIndices: number[], suffix: string): Stroke[] {
  if (!splitIndices.length) return [copyStroke(stroke)];
  const pieces: Stroke[] = [];
  let start = 0;
  for (const splitIndex of splitIndices) {
    const points = stroke.points.slice(start, splitIndex + 1);
    if (points.length) pieces.push(copyStroke(stroke, `${stroke.id}:${suffix}:${pieces.length}`, points));
    // A corner belongs to both sides of the reconstructed pen lift. Pause splits
    // are passed as the first point after the pause and override this below.
    start = splitIndex;
  }
  const points = stroke.points.slice(start);
  if (points.length) pieces.push(copyStroke(stroke, `${stroke.id}:${suffix}:${pieces.length}`, points));
  return pieces;
}

export function splitStrokesAtPauses(strokes: Stroke[], minimumPauseMs = PAUSE_SPLIT_MS): Stroke[] {
  return strokes.flatMap((stroke) => {
    if (stroke.points.length < 2) return [copyStroke(stroke)];
    const pieces: Stroke[] = [];
    let start = 0;
    for (let index = 1; index < stroke.points.length; index += 1) {
      const gap = stroke.points[index].timestamp - stroke.points[index - 1].timestamp;
      if (!Number.isFinite(gap) || gap < minimumPauseMs) continue;
      const points = stroke.points.slice(start, index);
      if (points.length) pieces.push(copyStroke(stroke, `${stroke.id}:pause:${pieces.length}`, points));
      start = index;
    }
    const points = stroke.points.slice(start);
    if (points.length) pieces.push(copyStroke(stroke, `${stroke.id}:pause:${pieces.length}`, points));
    return pieces.length > 1 ? pieces : [copyStroke(stroke)];
  });
}

function pathPositions(points: StrokePoint[]): number[] {
  const positions = [0];
  for (let index = 1; index < points.length; index += 1) {
    positions.push(positions[index - 1] + Math.hypot(points[index].x - points[index - 1].x, points[index].y - points[index - 1].y));
  }
  return positions;
}

function angleAt(points: StrokePoint[], positions: number[], index: number, lookDistance: number): number | null {
  let before = index - 1;
  while (before > 0 && positions[index] - positions[before] < lookDistance) before -= 1;
  let after = index + 1;
  while (after < points.length - 1 && positions[after] - positions[index] < lookDistance) after += 1;
  if (positions[index] - positions[before] < lookDistance * 0.5 || positions[after] - positions[index] < lookDistance * 0.5) return null;
  const incomingX = points[index].x - points[before].x;
  const incomingY = points[index].y - points[before].y;
  const outgoingX = points[after].x - points[index].x;
  const outgoingY = points[after].y - points[index].y;
  const incomingLength = Math.hypot(incomingX, incomingY);
  const outgoingLength = Math.hypot(outgoingX, outgoingY);
  if (incomingLength === 0 || outgoingLength === 0) return null;
  const cosine = Math.max(-1, Math.min(1, (incomingX * outgoingX + incomingY * outgoingY) / (incomingLength * outgoingLength)));
  return Math.acos(cosine) * (180 / Math.PI);
}

function cornerIndices(stroke: Stroke, minimumAngle: number, span: number): number[] {
  if (stroke.points.length < 3) return [];
  const positions = pathPositions(stroke.points);
  const totalLength = positions.at(-1) ?? 0;
  if (totalLength === 0) return [];
  const lookDistance = Math.max(span * 0.035, totalLength * 0.015, 1.5);
  const candidates: CornerCandidate[] = [];
  for (let index = 1; index < stroke.points.length - 1; index += 1) {
    const angle = angleAt(stroke.points, positions, index, lookDistance);
    if (angle != null && angle >= minimumAngle) candidates.push({ index, angle, pathPosition: positions[index] });
  }
  const minimumSeparation = Math.max(span * 0.06, totalLength * 0.04, lookDistance);
  const selected: CornerCandidate[] = [];
  for (const candidate of candidates.sort((left, right) => right.angle - left.angle || left.index - right.index)) {
    if (selected.some((item) => Math.abs(item.pathPosition - candidate.pathPosition) < minimumSeparation)) continue;
    selected.push(candidate);
    if (selected.length === MAX_CORNER_SPLITS_PER_STROKE) break;
  }
  return selected.map((candidate) => candidate.index).sort((left, right) => left - right);
}

export function splitStrokesAtCorners(strokes: Stroke[], minimumAngle: 45 | 90): Stroke[] {
  const span = characterSpan(strokes);
  return strokes.flatMap((stroke) => splitStroke(stroke, cornerIndices(stroke, minimumAngle, span), `corner${minimumAngle}`));
}

export function mergeAccidentalLifts(
  strokes: Stroke[],
  maximumDistanceRatio = ACCIDENTAL_LIFT_MAX_DISTANCE_RATIO,
  maximumGapMs = ACCIDENTAL_LIFT_MAX_GAP_MS,
): Stroke[] {
  const span = characterSpan(strokes);
  const maximumDistance = span * maximumDistanceRatio;
  const merged: Stroke[] = [];
  for (const source of strokes) {
    const stroke = copyStroke(source);
    const previous = merged.at(-1);
    const previousPoint = previous?.points.at(-1);
    const nextPoint = stroke.points[0];
    if (previous && previousPoint && nextPoint) {
      const timeGap = nextPoint.timestamp - previousPoint.timestamp;
      const distance = Math.hypot(nextPoint.x - previousPoint.x, nextPoint.y - previousPoint.y);
      if (Number.isFinite(timeGap) && timeGap >= 0 && timeGap <= maximumGapMs && distance <= maximumDistance) {
        previous.id = `${previous.id}+${stroke.id}`;
        previous.points.push(...stroke.points.map(clonePoint));
        continue;
      }
    }
    merged.push(stroke);
  }
  return merged;
}

function appendStructuralVariant(
  variants: RecognitionVariant[],
  source: Stroke[],
  transformed: Stroke[],
  family: Exclude<RecognitionVariantFamily, "baseline">,
): void {
  if (transformed.length === source.length) return;
  const input = convertStrokesForRecognizer(transformed, { simplifyTolerance: BASELINE_TOLERANCES[0] });
  if (input.length) variants.push({ id: family, family, weight: VARIANT_WEIGHTS[family], input });
}

export function createRecognitionVariants(strokes: Stroke[]): RecognitionVariant[] {
  const variants = BASELINE_TOLERANCES.flatMap((tolerance) => {
    const input = convertStrokesForRecognizer(strokes, { simplifyTolerance: tolerance });
    return input.length ? [{ id: `baseline-${tolerance}`, family: "baseline" as const, weight: VARIANT_WEIGHTS.baseline, input }] : [];
  });
  if (!variants.length) return [];
  appendStructuralVariant(variants, strokes, splitStrokesAtPauses(strokes), "pause");
  appendStructuralVariant(variants, strokes, splitStrokesAtCorners(strokes, 90), "corner90");
  appendStructuralVariant(variants, strokes, splitStrokesAtCorners(strokes, 45), "corner45");
  appendStructuralVariant(variants, strokes, mergeAccidentalLifts(strokes), "merge");
  return variants;
}

export function fuseRecognitionResults(
  variants: RecognitionVariant[],
  results: VariantRecognitionResult[],
  maximumResults = 15,
): CharacterPrediction[] {
  const variantsById = new Map(variants.map((variant) => [variant.id, variant]));
  const candidates = new Map<string, {
    familyRanks: Partial<Record<RecognitionVariantFamily, number>>;
    familyContributions: Partial<Record<RecognitionVariantFamily, number>>;
    bestRawRank: number;
  }>();

  for (const result of results) {
    const variant = variantsById.get(result.variantId);
    if (!variant) continue;
    const seen = new Set<string>();
    result.matches.forEach((match, index) => {
      if (seen.has(match.hanzi)) return;
      seen.add(match.hanzi);
      const rank = index + 1;
      const candidate = candidates.get(match.hanzi) ?? { familyRanks: {}, familyContributions: {}, bestRawRank: rank };
      const existingRank = candidate.familyRanks[variant.family];
      if (existingRank == null || rank < existingRank) {
        candidate.familyRanks[variant.family] = rank;
        candidate.familyContributions[variant.family] = variant.weight / (RRF_K + rank);
      }
      candidate.bestRawRank = Math.min(candidate.bestRawRank, rank);
      candidates.set(match.hanzi, candidate);
    });
  }

  const retained = Array.from(candidates.entries()).flatMap(([character, candidate]) => {
    if (!isSimplifiedCandidate(character)) return [];
    const baselineRank = candidate.familyRanks.baseline;
    const structuralSupport = STRUCTURAL_FAMILIES.filter((family) => (candidate.familyRanks[family] ?? Infinity) <= STRUCTURAL_SUPPORT_RANK);
    if ((baselineRank ?? Infinity) > BASELINE_RETENTION_RANK && structuralSupport.length < 2) return [];
    const fusedScore = Object.values(candidate.familyContributions).reduce((sum, contribution) => sum + (contribution ?? 0), 0);
    return [{
      character,
      score: fusedScore,
      rank: 0,
      evidence: {
        fusedScore,
        baselineRank,
        bestRawRank: candidate.bestRawRank,
        familyRanks: candidate.familyRanks,
        structuralSupport,
      },
    } satisfies CharacterPrediction];
  });

  retained.sort((left, right) =>
    (right.score ?? 0) - (left.score ?? 0)
    || (left.evidence?.baselineRank ?? Infinity) - (right.evidence?.baselineRank ?? Infinity)
    || (left.evidence?.bestRawRank ?? Infinity) - (right.evidence?.bestRawRank ?? Infinity)
    || left.character.codePointAt(0)! - right.character.codePointAt(0)!
  );
  const safeMaximum = Number.isFinite(maximumResults) ? Math.max(1, Math.floor(maximumResults)) : 15;
  return retained.slice(0, safeMaximum).map((candidate, index) => ({ ...candidate, rank: index + 1 }));
}
