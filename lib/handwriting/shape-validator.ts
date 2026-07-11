import { getCharacterShapeReference, type ShapePoint } from "./character-shape-references";
import {
  angleBetweenTangents,
  averageDistanceToPath,
  dedupePath,
  directionSimilarity,
  pathLength,
  pointDistance,
  resamplePath,
  shapeFrechetDistance,
} from "./shape-geometry";
import type { Stroke } from "./types";

export const SHAPE_LENIENCY = 0.8;
export const AVERAGE_DISTANCE_LIMIT = 140;
export const ENDPOINT_DISTANCE_LIMIT = 200;
export const FRECHET_DISTANCE_LIMIT = 0.32;
export const MAX_LENGTH_RATIO = 1.65;
export const MERGE_MAX_GAP_MS = 120;
export const MERGE_MAX_DISTANCE_RATIO = 0.035;
export const MERGE_MAX_TANGENT_ANGLE = 30;
export const SPLIT_MIN_PAUSE_MS = 100;
export const SPLIT_MAX_BRIDGE_RATIO = 0.04;
export const SPLIT_MIN_PIECE_LENGTH_RATIO = 0.08;

export interface CharacterBounds {
  x: number;
  y: number;
  width: number;
  height: number;
}

export type ShapeRepair = "none" | "split" | "merge";

export type ShapeFailureReason =
  | "missing-stroke"
  | "extra-stroke"
  | "wrong-direction"
  | "misplaced-stroke"
  | "shortened-stroke"
  | "overlong-stroke"
  | "wrong-curve"
  | "invalid-input"
  | "missing-reference";

export interface ShapeMatchMetrics {
  averageDistance: number;
  startDistance: number;
  endDistance: number;
  frechetDistance: number;
  directionSimilarity: number;
  lengthRatio: number;
}

export interface ShapeStrokeMatch {
  /** Index in the repaired/assessed stroke list. */
  capturedIndex: number;
  expectedIndex: number;
  passed: boolean;
  failureReasons: ShapeFailureReason[];
  metrics: ShapeMatchMetrics;
}

export interface ShapeAssessment {
  passed: boolean;
  rawStrokeCount: number;
  assessedStrokeCount: number;
  expectedStrokeCount: number;
  matches: ShapeStrokeMatch[];
  failureReasons: ShapeFailureReason[];
  repairApplied: ShapeRepair;
  strokeOrderWarning: boolean;
  /** Faithful captured geometry, normalized to a 0..1024 y-down square. */
  studentPaths: ShapePoint[][];
  /** Official median geometry, normalized to a 0..1024 y-down square. */
  referencePaths: ShapePoint[][];
}

interface NormalizedPoint extends ShapePoint {
  timestamp: number;
}

interface NormalizedStroke {
  points: NormalizedPoint[];
}

interface PairEvaluation extends ShapeStrokeMatch {
  cost: number;
}

interface CandidateAssessment extends ShapeAssessment {
  assignmentCost: number;
}

function uniqueReasons(reasons: readonly ShapeFailureReason[]): ShapeFailureReason[] {
  return Array.from(new Set(reasons));
}

function validBounds(bounds: CharacterBounds): boolean {
  if (![bounds.x, bounds.y, bounds.width, bounds.height].every(Number.isFinite)) return false;
  if (bounds.width <= 0 || bounds.height <= 0) return false;
  // Character references use a square coordinate system. Stretching a
  // rectangular region would conceal proportion errors, so fail closed when
  // callers supply bounds more than 5% away from square.
  return Math.max(bounds.width, bounds.height) / Math.min(bounds.width, bounds.height) <= 1.05;
}

function normalizeStrokes(strokes: readonly Stroke[], bounds: CharacterBounds): NormalizedStroke[] {
  const side = Math.min(bounds.width, bounds.height);
  const left = bounds.x + (bounds.width - side) / 2;
  const top = bounds.y + (bounds.height - side) / 2;
  return strokes.map((stroke) => ({
    points: stroke.points.map((point) => ({
      x: ((point.x - left) / side) * 1024,
      y: ((point.y - top) / side) * 1024,
      timestamp: point.timestamp,
    })),
  }));
}

function geometry(stroke: NormalizedStroke): ShapePoint[] {
  return dedupePath(stroke.points);
}

function invalidStroke(stroke: NormalizedStroke): boolean {
  if (stroke.points.length < 2) return true;
  if (stroke.points.some((point) => !Number.isFinite(point.x) || !Number.isFinite(point.y) || !Number.isFinite(point.timestamp))) return true;
  return geometry(stroke).length < 2;
}

function reversedEndpointsAreCloser(points: readonly ShapePoint[], reference: readonly ShapePoint[]): boolean {
  if (points.length < 2 || reference.length < 2) return false;
  const start = points[0];
  const end = points.at(-1)!;
  const expectedStart = reference[0];
  const expectedEnd = reference.at(-1)!;
  const forward = pointDistance(start, expectedStart) + pointDistance(end, expectedEnd);
  const backwardStart = pointDistance(start, expectedEnd);
  const backwardEnd = pointDistance(end, expectedStart);
  return backwardStart <= ENDPOINT_DISTANCE_LIMIT
    && backwardEnd <= ENDPOINT_DISTANCE_LIMIT
    && backwardStart + backwardEnd + 32 < forward;
}

function evaluatePair(
  captured: NormalizedStroke,
  capturedIndex: number,
  reference: ShapePoint[],
  expectedIndex: number,
): PairEvaluation {
  const points = geometry(captured);
  if (invalidStroke(captured)) {
    return {
      capturedIndex,
      expectedIndex,
      passed: false,
      failureReasons: ["invalid-input"],
      metrics: {
        averageDistance: Infinity,
        startDistance: Infinity,
        endDistance: Infinity,
        frechetDistance: Infinity,
        directionSimilarity: -1,
        lengthRatio: 0,
      },
      cost: 1_000_000,
    };
  }

  // Uniform resampling prevents stylus sampling density from weighting one
  // part of a stroke more heavily. Reference distances still use the official
  // discrete median points, as Hanzi Writer does.
  // Eight arclength samples are enough to remove device sampling-density
  // bias without over-weighting interpolated points between sparse official
  // medians (notably the final vertical stroke in 师).
  const distanceSamples = resamplePath(points, 8);
  const averageDistance = averageDistanceToPath(distanceSamples, reference);
  const startDistance = pointDistance(points[0], reference[0]);
  const endDistance = pointDistance(points.at(-1)!, reference.at(-1)!);
  const frechetDistance = shapeFrechetDistance(points, reference);
  const directionScore = directionSimilarity(points, reference);
  const capturedLength = pathLength(points);
  const referenceLength = pathLength(reference);
  const lengthRatio = referenceLength > 0 ? capturedLength / referenceLength : 0;
  const minimumLengthPassed = (SHAPE_LENIENCY * (capturedLength + 25)) / (referenceLength + 25) >= 0.35;
  const maximumLengthPassed = lengthRatio <= MAX_LENGTH_RATIO;
  const lengthPassed = minimumLengthPassed && maximumLengthPassed;
  const endpointsPassed = startDistance <= ENDPOINT_DISTANCE_LIMIT && endDistance <= ENDPOINT_DISTANCE_LIMIT;
  const backwards = reversedEndpointsAreCloser(points, reference);
  const directionPassed = directionScore > 0 && !backwards;
  const placementPassed = averageDistance <= AVERAGE_DISTANCE_LIMIT && endpointsPassed;
  const curvePassed = frechetDistance <= FRECHET_DISTANCE_LIMIT;
  const failureReasons: ShapeFailureReason[] = [];
  if (!directionPassed) failureReasons.push("wrong-direction");
  if (averageDistance > AVERAGE_DISTANCE_LIMIT || (!endpointsPassed && !backwards)) failureReasons.push("misplaced-stroke");
  if (!minimumLengthPassed) failureReasons.push("shortened-stroke");
  if (!maximumLengthPassed) failureReasons.push("overlong-stroke");
  if (!curvePassed) failureReasons.push("wrong-curve");

  const safeFrechet = Number.isFinite(frechetDistance) ? frechetDistance : 100;
  const cost = averageDistance / AVERAGE_DISTANCE_LIMIT
    + startDistance / ENDPOINT_DISTANCE_LIMIT
    + endDistance / ENDPOINT_DISTANCE_LIMIT
    + safeFrechet / FRECHET_DISTANCE_LIMIT
    + Math.abs(Math.log(Math.max(lengthRatio, 0.001))) * 0.25
    + (directionPassed ? 0 : 4);
  return {
    capturedIndex,
    expectedIndex,
    passed: placementPassed && directionPassed && lengthPassed && curvePassed,
    failureReasons: uniqueReasons(failureReasons),
    metrics: {
      averageDistance,
      startDistance,
      endDistance,
      frechetDistance,
      directionSimilarity: directionScore,
      lengthRatio,
    },
    cost,
  };
}

interface Assignment {
  failedCount: number;
  cost: number;
  expectedIndices: number[];
}

function betterAssignment(left: Assignment | null, right: Assignment): Assignment {
  if (!left) return right;
  if (right.failedCount !== left.failedCount) return right.failedCount < left.failedCount ? right : left;
  return right.cost < left.cost ? right : left;
}

function minimumCostAssignment(matrix: PairEvaluation[][]): Assignment {
  const count = matrix.length;
  const memo = new Map<string, Assignment>();
  const visit = (capturedIndex: number, usedMask: number): Assignment => {
    if (capturedIndex === count) return { failedCount: 0, cost: 0, expectedIndices: [] };
    const key = `${capturedIndex}:${usedMask}`;
    const cached = memo.get(key);
    if (cached) return cached;
    let best: Assignment | null = null;
    for (let expectedIndex = 0; expectedIndex < count; expectedIndex += 1) {
      if ((usedMask & (1 << expectedIndex)) !== 0) continue;
      const edge = matrix[capturedIndex][expectedIndex];
      const remainder = visit(capturedIndex + 1, usedMask | (1 << expectedIndex));
      best = betterAssignment(best, {
        failedCount: remainder.failedCount + (edge.passed ? 0 : 1),
        cost: remainder.cost + edge.cost,
        expectedIndices: [expectedIndex, ...remainder.expectedIndices],
      });
    }
    const result = best ?? { failedCount: count, cost: Infinity, expectedIndices: [] };
    memo.set(key, result);
    return result;
  };
  return visit(0, 0);
}

function assessExactCount(
  strokes: NormalizedStroke[],
  rawStrokeCount: number,
  reference: ShapePoint[][],
  repairApplied: ShapeRepair,
  studentPaths: ShapePoint[][],
): CandidateAssessment {
  const matrix = strokes.map((stroke, capturedIndex) =>
    reference.map((expected, expectedIndex) => evaluatePair(stroke, capturedIndex, expected, expectedIndex)),
  );
  const assignment = minimumCostAssignment(matrix);
  const matches = assignment.expectedIndices.map((expectedIndex, capturedIndex) => {
    const { cost: _cost, ...match } = matrix[capturedIndex][expectedIndex];
    return match;
  });
  const failureReasons = uniqueReasons(matches.flatMap((match) => match.failureReasons));
  return {
    passed: matches.length === reference.length && matches.every((match) => match.passed),
    rawStrokeCount,
    assessedStrokeCount: strokes.length,
    expectedStrokeCount: reference.length,
    matches,
    failureReasons,
    repairApplied,
    strokeOrderWarning: matches.some((match, index) => match.expectedIndex !== index),
    studentPaths,
    referencePaths: reference,
    assignmentCost: assignment.cost,
  };
}

function endpointTangent(points: readonly NormalizedPoint[], fromEnd: boolean): ShapePoint | null {
  if (points.length < 2) return null;
  const anchor = fromEnd ? points.at(-1)! : points[0];
  for (let offset = 1; offset < points.length; offset += 1) {
    const other = fromEnd ? points[points.length - 1 - offset] : points[offset];
    if (pointDistance(anchor, other) < 2) continue;
    return fromEnd
      ? { x: anchor.x - other.x, y: anchor.y - other.y }
      : { x: other.x - anchor.x, y: other.y - anchor.y };
  }
  return null;
}

function mergeCandidates(strokes: NormalizedStroke[]): NormalizedStroke[][] {
  const results: NormalizedStroke[][] = [];
  const maximumDistance = 1024 * MERGE_MAX_DISTANCE_RATIO;
  for (let index = 0; index < strokes.length - 1; index += 1) {
    const first = strokes[index];
    const second = strokes[index + 1];
    if (invalidStroke(first) || invalidStroke(second)) continue;
    const firstEnd = first.points.at(-1)!;
    const secondStart = second.points[0];
    const timeGap = secondStart.timestamp - firstEnd.timestamp;
    if (!Number.isFinite(timeGap) || timeGap < 0 || timeGap > MERGE_MAX_GAP_MS) continue;
    if (pointDistance(firstEnd, secondStart) > maximumDistance) continue;
    const firstTangent = endpointTangent(first.points, true);
    const secondTangent = endpointTangent(second.points, false);
    if (!firstTangent || !secondTangent || angleBetweenTangents(firstTangent, secondTangent) > MERGE_MAX_TANGENT_ANGLE) continue;
    const merged: NormalizedStroke = { points: [...first.points.map((point) => ({ ...point })), ...second.points.map((point) => ({ ...point }))] };
    results.push([
      ...strokes.slice(0, index).map(cloneNormalizedStroke),
      merged,
      ...strokes.slice(index + 2).map(cloneNormalizedStroke),
    ]);
  }
  return results;
}

function splitCandidates(strokes: NormalizedStroke[]): NormalizedStroke[][] {
  const results: NormalizedStroke[][] = [];
  const maximumBridge = 1024 * SPLIT_MAX_BRIDGE_RATIO;
  const minimumPieceLength = 1024 * SPLIT_MIN_PIECE_LENGTH_RATIO;
  strokes.forEach((stroke, strokeIndex) => {
    if (invalidStroke(stroke)) return;
    for (let index = 1; index < stroke.points.length; index += 1) {
      const previous = stroke.points[index - 1];
      const next = stroke.points[index];
      const pause = next.timestamp - previous.timestamp;
      if (!Number.isFinite(pause) || pause < SPLIT_MIN_PAUSE_MS) continue;
      if (pointDistance(previous, next) > maximumBridge) continue;
      const first: NormalizedStroke = { points: stroke.points.slice(0, index).map((point) => ({ ...point })) };
      const second: NormalizedStroke = { points: stroke.points.slice(index).map((point) => ({ ...point })) };
      if (pathLength(geometry(first)) <= minimumPieceLength || pathLength(geometry(second)) <= minimumPieceLength) continue;
      results.push([
        ...strokes.slice(0, strokeIndex).map(cloneNormalizedStroke),
        first,
        second,
        ...strokes.slice(strokeIndex + 1).map(cloneNormalizedStroke),
      ]);
    }
  });
  return results;
}

function cloneNormalizedStroke(stroke: NormalizedStroke): NormalizedStroke {
  return { points: stroke.points.map((point) => ({ ...point })) };
}

function countFailureAssessment(
  strokes: NormalizedStroke[],
  reference: ShapePoint[][],
  rawStrokeCount: number,
  studentPaths: ShapePoint[][],
  extraReasons: ShapeFailureReason[] = [],
): ShapeAssessment {
  const countReason: ShapeFailureReason = strokes.length < reference.length ? "missing-stroke" : "extra-stroke";
  return {
    passed: false,
    rawStrokeCount,
    assessedStrokeCount: strokes.length,
    expectedStrokeCount: reference.length,
    matches: [],
    failureReasons: uniqueReasons([countReason, ...extraReasons]),
    repairApplied: "none",
    strokeOrderWarning: false,
    studentPaths,
    referencePaths: reference,
  };
}

function chooseCandidate(candidates: CandidateAssessment[]): ShapeAssessment {
  candidates.sort((left, right) =>
    Number(right.passed) - Number(left.passed)
    || left.matches.filter((match) => !match.passed).length - right.matches.filter((match) => !match.passed).length
    || left.failureReasons.length - right.failureReasons.length
    || left.assignmentCost - right.assignmentCost,
  );
  const { assignmentCost: _assignmentCost, ...chosen } = candidates[0];
  return chosen;
}

export function assessCharacterShape(
  strokes: Stroke[],
  expected: string,
  bounds: CharacterBounds,
): ShapeAssessment {
  const reference = getCharacterShapeReference(expected);
  if (!reference) {
    return {
      passed: false,
      rawStrokeCount: strokes.length,
      assessedStrokeCount: strokes.length,
      expectedStrokeCount: 0,
      matches: [],
      failureReasons: ["missing-reference"],
      repairApplied: "none",
      strokeOrderWarning: false,
      studentPaths: [],
      referencePaths: [],
    };
  }
  if (!validBounds(bounds)) {
    return {
      passed: false,
      rawStrokeCount: strokes.length,
      assessedStrokeCount: strokes.length,
      expectedStrokeCount: reference.length,
      matches: [],
      failureReasons: ["invalid-input"],
      repairApplied: "none",
      strokeOrderWarning: false,
      studentPaths: [],
      referencePaths: reference,
    };
  }

  const normalized = normalizeStrokes(strokes, bounds);
  const studentPaths = normalized.map(geometry);
  const rawStrokeCount = normalized.length;
  if (normalized.some(invalidStroke)) {
    if (normalized.length !== reference.length) {
      return countFailureAssessment(normalized, reference, rawStrokeCount, studentPaths, ["invalid-input"]);
    }
  }
  if (normalized.length === reference.length) {
    return chooseCandidate([assessExactCount(normalized, rawStrokeCount, reference, "none", studentPaths)]);
  }
  if (normalized.length === reference.length + 1) {
    const candidates = mergeCandidates(normalized).map((candidate) =>
      assessExactCount(candidate, rawStrokeCount, reference, "merge", studentPaths),
    );
    return candidates.length ? chooseCandidate(candidates) : countFailureAssessment(normalized, reference, rawStrokeCount, studentPaths);
  }
  if (normalized.length === reference.length - 1) {
    const candidates = splitCandidates(normalized).map((candidate) =>
      assessExactCount(candidate, rawStrokeCount, reference, "split", studentPaths),
    );
    return candidates.length ? chooseCandidate(candidates) : countFailureAssessment(normalized, reference, rawStrokeCount, studentPaths);
  }
  return countFailureAssessment(normalized, reference, rawStrokeCount, studentPaths);
}
