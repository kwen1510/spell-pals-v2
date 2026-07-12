import type { CharacterTemplate, ModelStrokeCriticality } from "./character-template";
import {
  extractVisualPrimitives,
  type PrimitiveMovement,
  type PrimitivePoint,
  type PrimitiveType,
  type VisualPrimitive,
} from "./primitive-analysis";

export const ROUGH_SHAPE_THRESHOLDS = Object.freeze({
  minimumPieceScore: 0.56,
  maximumCentreDistance: 0.26,
  minimumLengthRatio: 0.65,
  maximumLengthRatio: 2.1,
  criticalPieceLength: 0.06,
  requiredComponentCoverage: 0.62,
  advisoryComponentCoverage: 0.8,
  majorExtraPieceLength: 0.12,
  maximumExtraLengthShare: 0.18,
  retraceCentreDistance: 0.11,
  retraceMinimumScore: 0.48,
  maximumComponentCentreDistance: 0.18,
  maximumComponentTranslationSpread: 0.13,
  maximumComponentLogScaleSpread: 0.48,
  maximumRelativeComponentLayoutError: 0.16,
} as const);

export interface ModelVisualPiece extends VisualPrimitive {
  modelStrokeIndex: number;
  componentId: string | null;
  criticality: ModelStrokeCriticality;
  required: boolean;
}

export interface StudentVisualPiece extends VisualPrimitive {
  mergedFrom: string[];
}

export interface PieceMatchEvidence {
  expectedPieceId: string;
  studentPieceId: string;
  score: number;
  typeScore: number;
  positionScore: number;
  lengthScore: number;
  orientationScore: number;
  shapeScore: number;
  centreDistance: number;
  lengthRatio: number;
  rotationDegrees: number;
  translationX: number;
  translationY: number;
}

export interface RoughComponentAssessment {
  id: string;
  label: string;
  required: boolean;
  expectedPieceIds: string[];
  matchedPieceIds: string[];
  coverage: number;
  centreDistance: number;
  widthRatio: number;
  heightRatio: number;
  translationSpread: number;
  lengthScaleSpread: number;
  expectedCentre: PrimitivePoint;
  studentCentre: PrimitivePoint | null;
  relativeLayoutError: number;
  passed: boolean;
}

export interface RoughShapeAssessment {
  passed: boolean;
  expectedPieces: ModelVisualPiece[];
  studentPieces: StudentVisualPiece[];
  matches: PieceMatchEvidence[];
  components: RoughComponentAssessment[];
  matchedExpectedPieceIds: string[];
  missingExpectedPieceIds: string[];
  missingCriticalPieceIds: string[];
  matchedStudentPieceIds: string[];
  extraStudentPieceIds: string[];
  ignoredRetracePieceIds: string[];
  expectedCoverage: number;
  studentPrecision: number;
  extraLengthShare: number;
  majorExtraInk: boolean;
}

interface PairEvidence extends PieceMatchEvidence {
  qualifies: boolean;
}

function clamp01(value: number): number {
  return Math.max(0, Math.min(1, value));
}

function median(values: readonly number[]): number {
  if (!values.length) return 0;
  const ordered = [...values].sort((left, right) => left - right);
  const middle = Math.floor(ordered.length / 2);
  return ordered.length % 2
    ? ordered[middle]
    : (ordered[middle - 1] + ordered[middle]) / 2;
}

function dominantType(primitive: VisualPrimitive): PrimitiveType {
  return (Object.entries(primitive.typeProbabilities)
    .sort((left, right) => (right[1] ?? 0) - (left[1] ?? 0))[0]?.[0] ?? "unknown") as PrimitiveType;
}

function typeCompatibility(expected: VisualPrimitive, student: VisualPrimitive): number {
  const left = dominantType(expected);
  const right = dominantType(student);
  if (left === right) return 1;
  if (left === "unknown" || right === "unknown") return 0.55;
  const curved = new Set<PrimitiveType>(["curve", "hook", "turn"]);
  if (curved.has(left) && curved.has(right)) return 0.78;
  const diagonal = new Set<PrimitiveType>(["left_falling", "right_falling"]);
  if (diagonal.has(left) && (diagonal.has(right) || curved.has(right))) return 0.62;
  if (diagonal.has(right) && curved.has(left)) return 0.62;
  return 0.12;
}

function orientationDifference(leftDegrees: number, rightDegrees: number): number {
  let difference = Math.abs(leftDegrees - rightDegrees) % 180;
  if (difference > 90) difference = 180 - difference;
  return difference;
}

function pointAtDistance(points: readonly PrimitivePoint[], target: number): PrimitivePoint {
  let travelled = 0;
  for (let index = 1; index < points.length; index += 1) {
    const start = points[index - 1];
    const end = points[index];
    const segment = Math.hypot(end.x - start.x, end.y - start.y);
    if (travelled + segment >= target) {
      const progress = segment ? (target - travelled) / segment : 0;
      return { x: start.x + (end.x - start.x) * progress, y: start.y + (end.y - start.y) * progress };
    }
    travelled += segment;
  }
  return { ...points.at(-1)! };
}

function resample(points: readonly PrimitivePoint[], count = 12): PrimitivePoint[] {
  if (!points.length) return [];
  if (points.length === 1) return Array.from({ length: count }, () => ({ ...points[0] }));
  const length = points.slice(1).reduce((sum, point, index) => (
    sum + Math.hypot(point.x - points[index].x, point.y - points[index].y)
  ), 0);
  if (!length) return Array.from({ length: count }, () => ({ ...points[0] }));
  return Array.from({ length: count }, (_, index) => pointAtDistance(points, length * index / (count - 1)));
}

function intrinsicPath(points: readonly PrimitivePoint[]): PrimitivePoint[] {
  const sampled = resample(points);
  if (!sampled.length) return [];
  const start = sampled[0];
  const end = sampled.at(-1)!;
  const angle = Math.atan2(end.y - start.y, end.x - start.x);
  const cosine = Math.cos(-angle);
  const sine = Math.sin(-angle);
  const scale = Math.max(0.001, Math.hypot(end.x - start.x, end.y - start.y));
  return sampled.map((point) => {
    const x = point.x - start.x;
    const y = point.y - start.y;
    return { x: (x * cosine - y * sine) / scale, y: (x * sine + y * cosine) / scale };
  });
}

function intrinsicShapeScore(expected: VisualPrimitive, student: VisualPrimitive): number {
  const left = intrinsicPath(expected.points);
  const forward = intrinsicPath(student.points);
  const reverse = intrinsicPath([...student.points].reverse());
  if (!left.length || !forward.length || left.length !== forward.length) return 0;
  const distanceFor = (candidate: PrimitivePoint[]) => left.reduce((sum, point, index) => (
    sum + Math.hypot(point.x - candidate[index].x, point.y - candidate[index].y)
  ), 0) / left.length;
  const shapeDistance = Math.min(distanceFor(forward), distanceFor(reverse));
  return clamp01(1 - shapeDistance / 0.32);
}

function comparePieces(expected: ModelVisualPiece, student: StudentVisualPiece): PairEvidence {
  const centreDistance = Math.hypot(
    expected.centre.x - student.centre.x,
    expected.centre.y - student.centre.y,
  );
  const lengthRatio = student.length / Math.max(0.001, expected.length);
  const rotationDegrees = orientationDifference(expected.angle, student.angle);
  const typeScore = typeCompatibility(expected, student);
  const positionScore = clamp01(1 - centreDistance / ROUGH_SHAPE_THRESHOLDS.maximumCentreDistance);
  const lengthScore = clamp01(1 - Math.abs(Math.log(Math.max(0.001, lengthRatio))) / Math.log(2.5));
  const orientationScore = clamp01(1 - rotationDegrees / 55);
  const shapeScore = intrinsicShapeScore(expected, student);
  const score = typeScore * 0.26
    + positionScore * 0.2
    + lengthScore * 0.19
    + orientationScore * 0.17
    + shapeScore * 0.18;
  return {
    expectedPieceId: expected.id,
    studentPieceId: student.id,
    score,
    typeScore,
    positionScore,
    lengthScore,
    orientationScore,
    shapeScore,
    centreDistance,
    lengthRatio,
    rotationDegrees,
    translationX: student.centre.x - expected.centre.x,
    translationY: student.centre.y - expected.centre.y,
    qualifies: score >= ROUGH_SHAPE_THRESHOLDS.minimumPieceScore
      && centreDistance <= ROUGH_SHAPE_THRESHOLDS.maximumCentreDistance
      && lengthRatio >= ROUGH_SHAPE_THRESHOLDS.minimumLengthRatio
      && lengthRatio <= ROUGH_SHAPE_THRESHOLDS.maximumLengthRatio,
  };
}

/** Hungarian maximum-weight assignment with zero-weight unmatched dummies. */
function maximumWeightAssignment(weights: number[][]): number[] {
  const rowCount = weights.length;
  const columnCount = weights[0]?.length ?? 0;
  const size = Math.max(rowCount, columnCount);
  if (!size) return [];
  const maximum = Math.max(0, ...weights.flat());
  const cost = Array.from({ length: size }, (_, row) => Array.from({ length: size }, (_, column) => (
    maximum - (row < rowCount && column < columnCount ? weights[row][column] : 0)
  )));
  const u = new Array(size + 1).fill(0);
  const v = new Array(size + 1).fill(0);
  const p = new Array(size + 1).fill(0);
  const way = new Array(size + 1).fill(0);
  for (let row = 1; row <= size; row += 1) {
    p[0] = row;
    let column0 = 0;
    const minimum = new Array(size + 1).fill(Number.POSITIVE_INFINITY);
    const used = new Array(size + 1).fill(false);
    do {
      used[column0] = true;
      const row0 = p[column0];
      let delta = Number.POSITIVE_INFINITY;
      let column1 = 0;
      for (let column = 1; column <= size; column += 1) {
        if (used[column]) continue;
        const current = cost[row0 - 1][column - 1] - u[row0] - v[column];
        if (current < minimum[column]) {
          minimum[column] = current;
          way[column] = column0;
        }
        if (minimum[column] < delta) {
          delta = minimum[column];
          column1 = column;
        }
      }
      for (let column = 0; column <= size; column += 1) {
        if (used[column]) {
          u[p[column]] += delta;
          v[column] -= delta;
        } else {
          minimum[column] -= delta;
        }
      }
      column0 = column1;
    } while (p[column0] !== 0);
    do {
      const column1 = way[column0];
      p[column0] = p[column1];
      column0 = column1;
    } while (column0 !== 0);
  }
  const assignment = new Array(rowCount).fill(-1);
  for (let column = 1; column <= size; column += 1) {
    const row = p[column] - 1;
    if (row >= 0 && row < rowCount && column - 1 < columnCount) assignment[row] = column - 1;
  }
  return assignment;
}

function endpoints(piece: VisualPrimitive): PrimitivePoint[] {
  return [piece.startPoint, piece.endPoint];
}

function endpointDistance(left: VisualPrimitive, right: VisualPrimitive): number {
  return Math.min(...endpoints(left).flatMap((a) => endpoints(right).map((b) => Math.hypot(a.x - b.x, a.y - b.y))));
}

function mergePieces(left: StudentVisualPiece, right: StudentVisualPiece): StudentVisualPiece {
  const options: Array<{ points: PrimitivePoint[]; gap: number }> = [
    { points: [...left.points, ...right.points], gap: Math.hypot(left.endPoint.x - right.startPoint.x, left.endPoint.y - right.startPoint.y) },
    { points: [...left.points, ...[...right.points].reverse()], gap: Math.hypot(left.endPoint.x - right.endPoint.x, left.endPoint.y - right.endPoint.y) },
    { points: [...[...left.points].reverse(), ...right.points], gap: Math.hypot(left.startPoint.x - right.startPoint.x, left.startPoint.y - right.startPoint.y) },
    { points: [...[...left.points].reverse(), ...[...right.points].reverse()], gap: Math.hypot(left.startPoint.x - right.endPoint.x, left.startPoint.y - right.endPoint.y) },
  ];
  const points = options.sort((a, b) => a.gap - b.gap)[0].points;
  const merged = extractVisualPrimitives([{ id: `${left.id}+${right.id}`, points }])[0];
  return {
    ...merged,
    id: `student-merged-${left.id}-${right.id}`,
    sourceMovementIds: Array.from(new Set([...left.sourceMovementIds, ...right.sourceMovementIds])),
    mergedFrom: [...left.mergedFrom, ...right.mergedFrom],
  };
}

function mergeFragmentedStudentPieces(
  pieces: StudentVisualPiece[],
  expectedPieces: ModelVisualPiece[],
): StudentVisualPiece[] {
  const result = [...pieces];
  let changed = true;
  while (changed) {
    changed = false;
    outer: for (let left = 0; left < result.length; left += 1) {
      for (let right = left + 1; right < result.length; right += 1) {
        if (result[left].sourceMovementIds.some((id) => result[right].sourceMovementIds.includes(id))) continue;
        const angle = orientationDifference(result[left].angle, result[right].angle);
        if (endpointDistance(result[left], result[right]) > 0.025 || angle > 65) continue;
        const combinedSpan = Math.max(...endpoints(result[left]).flatMap((a) => endpoints(result[right]).map((b) => (
          Math.hypot(a.x - b.x, a.y - b.y)
        ))));
        if (combinedSpan < Math.max(result[left].directDistance, result[right].directDistance) * 1.1) continue;
        const merged = mergePieces(result[left], result[right]);
        const bestMerged = expectedPieces
          .map((expected) => comparePieces(expected, merged))
          .sort((a, b) => b.score - a.score)[0];
        if (!bestMerged?.qualifies) continue;
        const bestLeft = Math.max(0, ...expectedPieces.map((expected) => comparePieces(expected, result[left]).score));
        const bestRight = Math.max(0, ...expectedPieces.map((expected) => comparePieces(expected, result[right]).score));
        // Merge only when the combined stencil fit is materially better than
        // treating either fragment as a complete visible piece. This keeps two
        // legitimate neighbouring dictionary strokes separate.
        if (bestMerged.score < Math.max(bestLeft, bestRight) + 0.055) continue;
        result.splice(right, 1);
        result.splice(left, 1, merged);
        changed = true;
        break outer;
      }
    }
  }
  return result;
}

function modelPieces(template: CharacterTemplate): ModelVisualPiece[] {
  const normalizedPaths = normalizePathSet(template.modelStrokes.map((stroke) => stroke.median));
  return template.modelStrokes.flatMap((stroke) => {
    const extracted = extractVisualPrimitives([{ id: `model-stroke-${stroke.index}`, points: normalizedPaths[stroke.index] }])
      .filter((piece) => piece.length >= 0.035 || dominantType(piece) === "dot");
    return extracted.map((piece, pieceIndex): ModelVisualPiece => ({
        ...piece,
        id: `model-${stroke.index}-${pieceIndex}`,
        modelStrokeIndex: stroke.index,
        componentId: stroke.componentId,
        criticality: stroke.criticality,
        required: piece.length >= ROUGH_SHAPE_THRESHOLDS.criticalPieceLength
          || (extracted.length === 1 && piece.length >= 0.03),
      }));
  });
}

function normalizePathSet(paths: readonly (readonly PrimitivePoint[])[]): PrimitivePoint[][] {
  const points = paths.flat();
  if (!points.length) return paths.map(() => []);
  const xMin = Math.min(...points.map((point) => point.x));
  const xMax = Math.max(...points.map((point) => point.x));
  const yMin = Math.min(...points.map((point) => point.y));
  const yMax = Math.max(...points.map((point) => point.y));
  const span = Math.max(0.001, xMax - xMin, yMax - yMin);
  const scale = 0.84 / span;
  const centreX = (xMin + xMax) / 2;
  const centreY = (yMin + yMax) / 2;
  return paths.map((path) => path.map((point) => ({
    x: 0.5 + (point.x - centreX) * scale,
    y: 0.5 + (point.y - centreY) * scale,
  })));
}

function studentPieces(
  paths: readonly (readonly PrimitivePoint[])[],
  expectedPieces: ModelVisualPiece[],
): StudentVisualPiece[] {
  const movements: PrimitiveMovement[] = paths.map((points, index) => ({ id: `movement-${index}`, points: [...points] }));
  const extracted = extractVisualPrimitives(movements).map((piece): StudentVisualPiece => ({
    ...piece,
    id: `student-${piece.id}`,
    mergedFrom: [piece.id],
  }));
  return mergeFragmentedStudentPieces(extracted, expectedPieces);
}

export function assessRoughShape(
  template: CharacterTemplate,
  normalizedStudentPaths: readonly (readonly PrimitivePoint[])[],
): RoughShapeAssessment {
  const expectedPieces = modelPieces(template);
  const capturedPieces = studentPieces(normalizePathSet(normalizedStudentPaths), expectedPieces);
  const evidence = expectedPieces.map((expected) => capturedPieces.map((student) => comparePieces(expected, student)));
  const assignment = maximumWeightAssignment(evidence.map((row) => row.map((candidate) => candidate.qualifies ? candidate.score : 0)));
  const matches = assignment.flatMap((studentIndex, expectedIndex) => {
    if (studentIndex < 0) return [];
    const candidate = evidence[expectedIndex][studentIndex];
    return candidate?.qualifies ? [candidate] : [];
  });
  const matchedExpected = new Set(matches.map((match) => match.expectedPieceId));
  const matchedStudent = new Set(matches.map((match) => match.studentPieceId));
  const missing = expectedPieces.filter((piece) => !matchedExpected.has(piece.id));
  const missingCritical = missing.filter((piece) => piece.required);

  const unmatchedStudent = capturedPieces.filter((piece) => !matchedStudent.has(piece.id));
  const ignoredRetraces = unmatchedStudent.filter((student) => evidence.some((row) => row.some((candidate) => (
    candidate.studentPieceId === student.id
    && candidate.score >= ROUGH_SHAPE_THRESHOLDS.retraceMinimumScore
    && candidate.centreDistance <= ROUGH_SHAPE_THRESHOLDS.retraceCentreDistance
  ))));
  const ignoredRetraceIds = new Set(ignoredRetraces.map((piece) => piece.id));
  const extras = unmatchedStudent.filter((piece) => !ignoredRetraceIds.has(piece.id));

  const totalExpectedLength = expectedPieces.reduce((sum, piece) => sum + piece.length, 0);
  const matchedExpectedLength = expectedPieces
    .filter((piece) => matchedExpected.has(piece.id))
    .reduce((sum, piece) => sum + piece.length, 0);
  const totalStudentLength = capturedPieces.reduce((sum, piece) => sum + piece.length, 0);
  const extraLength = extras.reduce((sum, piece) => sum + piece.length, 0);
  const extraLengthShare = totalStudentLength ? extraLength / totalStudentLength : 0;
  const componentDrafts = template.components.map((component): RoughComponentAssessment => {
    const pieces = expectedPieces.filter((piece) => piece.componentId === component.id);
    const totalLength = pieces.reduce((sum, piece) => sum + piece.length, 0);
    const matchedLength = pieces
      .filter((piece) => matchedExpected.has(piece.id))
      .reduce((sum, piece) => sum + piece.length, 0);
    const coverage = totalLength ? matchedLength / totalLength : 0;
    const matchedStudentIds = new Set(matches
      .filter((match) => pieces.some((piece) => piece.id === match.expectedPieceId))
      .map((match) => match.studentPieceId));
    const componentMatches = matches.filter((match) => pieces.some((piece) => piece.id === match.expectedPieceId));
    const studentComponentPieces = capturedPieces.filter((piece) => matchedStudentIds.has(piece.id));
    const pieceBounds = (values: readonly VisualPrimitive[]) => values.length ? {
      xMin: Math.min(...values.map((piece) => piece.bounds.xMin)),
      xMax: Math.max(...values.map((piece) => piece.bounds.xMax)),
      yMin: Math.min(...values.map((piece) => piece.bounds.yMin)),
      yMax: Math.max(...values.map((piece) => piece.bounds.yMax)),
    } : null;
    const expectedBounds = pieceBounds(pieces);
    const studentBounds = pieceBounds(studentComponentPieces);
    const expectedWidth = expectedBounds ? expectedBounds.xMax - expectedBounds.xMin : 0;
    const expectedHeight = expectedBounds ? expectedBounds.yMax - expectedBounds.yMin : 0;
    const studentWidth = studentBounds ? studentBounds.xMax - studentBounds.xMin : 0;
    const studentHeight = studentBounds ? studentBounds.yMax - studentBounds.yMin : 0;
    const widthRatio = expectedWidth > 0.04 ? studentWidth / expectedWidth : 1;
    const heightRatio = expectedHeight > 0.04 ? studentHeight / expectedHeight : 1;
    const centreDistance = expectedBounds && studentBounds ? Math.hypot(
      (expectedBounds.xMin + expectedBounds.xMax - studentBounds.xMin - studentBounds.xMax) / 2,
      (expectedBounds.yMin + expectedBounds.yMax - studentBounds.yMin - studentBounds.yMax) / 2,
    ) : 1;
    const expectedCentre = expectedBounds ? {
      x: (expectedBounds.xMin + expectedBounds.xMax) / 2,
      y: (expectedBounds.yMin + expectedBounds.yMax) / 2,
    } : { x: 0.5, y: 0.5 };
    const studentCentre = studentBounds ? {
      x: (studentBounds.xMin + studentBounds.xMax) / 2,
      y: (studentBounds.yMin + studentBounds.yMax) / 2,
    } : null;
    // A component may translate and scale modestly as a whole. Its individual
    // pieces may not each choose an unrelated warp, because that lets two
    // similar lines swap roles and hides a genuinely missing/shortened piece.
    const medianTranslationX = median(componentMatches.map((match) => match.translationX));
    const medianTranslationY = median(componentMatches.map((match) => match.translationY));
    const translationSpread = componentMatches.reduce((maximum, match) => Math.max(
      maximum,
      Math.hypot(
        match.translationX - medianTranslationX,
        match.translationY - medianTranslationY,
      ),
    ), 0);
    const logarithmicScales = componentMatches.map((match) => Math.log(Math.max(0.001, match.lengthRatio)));
    const medianLogScale = median(logarithmicScales);
    const lengthScaleSpread = logarithmicScales.reduce((maximum, scale) => (
      Math.max(maximum, Math.abs(scale - medianLogScale))
    ), 0);
    const sizePassed = widthRatio >= 0.54 && widthRatio <= 1.85
      && heightRatio >= 0.54 && heightRatio <= 1.85;
    const placementPassed = centreDistance <= ROUGH_SHAPE_THRESHOLDS.maximumComponentCentreDistance;
    const coherentWarp = translationSpread <= ROUGH_SHAPE_THRESHOLDS.maximumComponentTranslationSpread
      && lengthScaleSpread <= ROUGH_SHAPE_THRESHOLDS.maximumComponentLogScaleSpread;
    return {
      id: component.id,
      label: component.label,
      required: component.required,
      expectedPieceIds: pieces.map((piece) => piece.id),
      matchedPieceIds: pieces.filter((piece) => matchedExpected.has(piece.id)).map((piece) => piece.id),
      coverage,
      centreDistance,
      widthRatio,
      heightRatio,
      translationSpread,
      lengthScaleSpread,
      expectedCentre,
      studentCentre,
      relativeLayoutError: 0,
      passed: !component.required || (
        coverage >= ROUGH_SHAPE_THRESHOLDS.requiredComponentCoverage
        && sizePassed
        && placementPassed
        && coherentWarp
      ),
    };
  });
  const components = componentDrafts.map((component): RoughComponentAssessment => {
    if (!component.studentCentre || !component.required) return component;
    const studentCentre = component.studentCentre;
    const relativeLayoutError = componentDrafts.reduce((maximum, other) => {
      if (other.id === component.id || !other.required || !other.studentCentre) return maximum;
      const expectedDx = component.expectedCentre.x - other.expectedCentre.x;
      const expectedDy = component.expectedCentre.y - other.expectedCentre.y;
      const studentDx = studentCentre.x - other.studentCentre.x;
      const studentDy = studentCentre.y - other.studentCentre.y;
      return Math.max(maximum, Math.hypot(studentDx - expectedDx, studentDy - expectedDy));
    }, 0);
    return {
      ...component,
      relativeLayoutError,
      passed: component.passed
        && relativeLayoutError <= ROUGH_SHAPE_THRESHOLDS.maximumRelativeComponentLayoutError,
    };
  });
  const longestExtra = extras.reduce((maximum, piece) => Math.max(maximum, piece.length), 0);
  const majorExtraInk = longestExtra >= 0.16
    || (longestExtra >= ROUGH_SHAPE_THRESHOLDS.majorExtraPieceLength
      && extraLengthShare >= 0.15);
  const passed = missingCritical.length === 0
    && components.every((component) => component.passed)
    && !majorExtraInk;
  return {
    passed,
    expectedPieces,
    studentPieces: capturedPieces,
    matches,
    components,
    matchedExpectedPieceIds: Array.from(matchedExpected),
    missingExpectedPieceIds: missing.map((piece) => piece.id),
    missingCriticalPieceIds: missingCritical.map((piece) => piece.id),
    matchedStudentPieceIds: Array.from(matchedStudent),
    extraStudentPieceIds: extras.map((piece) => piece.id),
    ignoredRetracePieceIds: Array.from(ignoredRetraceIds),
    expectedCoverage: totalExpectedLength ? matchedExpectedLength / totalExpectedLength : 0,
    studentPrecision: totalStudentLength ? (totalStudentLength - extraLength) / totalStudentLength : 0,
    extraLengthShare,
    majorExtraInk,
  };
}
