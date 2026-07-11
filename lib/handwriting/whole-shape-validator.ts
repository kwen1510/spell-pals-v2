import { getCharacterShapeReference, type ShapePoint } from "./character-shape-references";
import { getCharacterComponents, type CharacterComponentPosition } from "./character-components";
import { getShapeCompetitors, type ShapeCompetitorSource } from "./shape-competitors";
import { dedupePath, pathLength } from "./shape-geometry";
import type { CharacterBounds } from "./shape-validator";
import type { Stroke } from "./types";

/**
 * A light-weight, pen-lift-independent character check.
 *
 * Both the official median and the captured ink are rendered into the same
 * square-relative mask.  We intentionally never fit either path to its ink
 * bounding box: a character written in the wrong part of the 田字格 must stay
 * in the wrong part of the 田字格.  A very small transform search absorbs normal
 * Pencil variation while retaining useful placement feedback.
 */

export const WHOLE_SHAPE_MASK_SIZE = 64;
export const WHOLE_SHAPE_MATCH_DISTANCE_RATIO = 0.055;
export const WHOLE_SHAPE_MIN_EXPECTED_COVERAGE = 0.8;
export const WHOLE_SHAPE_MIN_STUDENT_PRECISION = 0.78;
export const WHOLE_SHAPE_MIN_MAJOR_CELL_COVERAGE = 0.48;
export const WHOLE_SHAPE_MAJOR_CELL_SHARE = 0.075;
export const WHOLE_SHAPE_BLANK_LENGTH_RATIO = 0.025;
export const WHOLE_SHAPE_MIN_COMPONENT_COVERAGE = 0.62;
export const WHOLE_SHAPE_MAX_COMPONENT_CENTROID_DELTA = 0.075;
export const WHOLE_SHAPE_COMPONENT_ASSIGN_DISTANCE_RATIO = 0.1;
export const WHOLE_SHAPE_MIN_COMPONENT_PRECISION = 0.68;
export const WHOLE_SHAPE_MIN_COMPONENT_SIZE_RATIO = 0.62;
export const WHOLE_SHAPE_MAX_COMPONENT_SIZE_RATIO = 1.45;
export const WHOLE_SHAPE_MAX_UNASSIGNED_INK_SHARE = 0.14;
export const WHOLE_SHAPE_MIN_DIRECTIONAL_EXPECTED_COVERAGE = 0.72;
export const WHOLE_SHAPE_MIN_DIRECTIONAL_STUDENT_PRECISION = 0.76;
export const WHOLE_SHAPE_DIRECTION_TOLERANCE_DEGREES = 50;
export const WHOLE_SHAPE_MIN_COMPETITOR_MARGIN = 0.015;
export const WHOLE_SHAPE_MODEL_STROKE_DISTANCE_RATIO = 0.05;
export const WHOLE_SHAPE_MODEL_STROKE_DIRECTION_TOLERANCE_DEGREES = 45;
export const WHOLE_SHAPE_MIN_MODEL_STROKE_COVERAGE = 0.6;

export type WholeShapeQuadrant = "top-left" | "top-right" | "bottom-left" | "bottom-right";

export type WholeShapeCell =
  | "upper-left"
  | "upper-middle"
  | "upper-right"
  | "middle-left"
  | "center"
  | "middle-right"
  | "lower-left"
  | "lower-middle"
  | "lower-right";

export type WholeShapeIssueCode =
  | "blank"
  | "invalid-input"
  | "missing-reference"
  | "missing-major-shape"
  | "closer-to-other-character"
  | "extra-ink"
  | "too-far-left"
  | "too-far-right"
  | "too-high"
  | "too-low"
  | "too-small"
  | "too-large";

export type WholeShapeIssueSeverity = "warning" | "error";

export interface WholeShapeIssue {
  code: WholeShapeIssueCode;
  severity: WholeShapeIssueSeverity;
  message: string;
  cell?: WholeShapeCell;
  quadrant?: WholeShapeQuadrant;
}

export interface WholeShapeRegionAssessment<TRegion extends string> {
  region: TRegion;
  /** Proportion of all expected ink which lies in this region. */
  expectedShare: number;
  /** Proportion of all captured ink which lies in this region after the limited alignment. */
  studentShare: number;
  /** Expected ink in this region which is close to captured ink. */
  expectedCoverage: number;
  /** Captured ink in this region which is close to expected ink. */
  studentPrecision: number;
  major: boolean;
}

export interface WholeShapeComponentAssessment {
  id: string;
  label: string;
  position: CharacterComponentPosition;
  expectedStrokeIndices: number[];
  /** Fraction of this official component covered by any captured ink. */
  expectedCoverage: number;
  /** Fraction of all captured ink which supports this component. */
  studentSupportShare: number;
  /** Assigned component ink which is within the normal shape tolerance. */
  studentPrecision: number;
  expectedShare: number;
  hasStudentSupport: boolean;
  centroidDeltaX: number;
  centroidDeltaY: number;
  widthRatio: number;
  heightRatio: number;
  passed: boolean;
}

export interface WholeShapeTransform {
  /** Correction applied to captured ink as a proportion of the square side. */
  translateX: number;
  translateY: number;
  scale: number;
  rotationDegrees: number;
}

export interface WholeShapeMetrics {
  expectedCoverage: number;
  studentPrecision: number;
  directionalExpectedCoverage: number;
  directionalStudentPrecision: number;
  modelStrokeCoverages: number[];
  minimumModelStrokeCoverage: number;
  score: number;
  /** Raw, pre-alignment centroid difference as a proportion of the square side. */
  centroidDeltaX: number;
  centroidDeltaY: number;
  widthRatio: number;
  heightRatio: number;
  outsideInkRatio: number;
  /** Aligned in-square ink too far from every official component. */
  unassignedInkShare: number;
}

export interface WholeShapeCompetitorEvidence {
  character: string;
  source: ShapeCompetitorSource;
  score: number;
  /** Target score minus competitor score; larger is safer. */
  margin: number;
}

export interface WholeShapeAssessment {
  passed: boolean;
  blank: boolean;
  rawStrokeCount: number;
  expectedStrokeCount: number;
  issues: WholeShapeIssue[];
  metrics: WholeShapeMetrics;
  alignment: WholeShapeTransform;
  quadrants: WholeShapeRegionAssessment<WholeShapeQuadrant>[];
  cells: WholeShapeRegionAssessment<WholeShapeCell>[];
  components: WholeShapeComponentAssessment[];
  closestCompetitor: WholeShapeCompetitorEvidence | null;
  /** Faithful raw capture normalized to the 0..1024 y-down writing square. */
  studentPaths: ShapePoint[][];
  referencePaths: ShapePoint[][];
}

interface RasterizedInk {
  mask: Uint8Array;
  inkCount: number;
  outsideInkRatio: number;
}

interface MaskGeometry {
  centroidX: number;
  centroidY: number;
  width: number;
  height: number;
}

interface MatchCandidate {
  transform: WholeShapeTransform;
  raster: RasterizedInk;
  distanceToStudent: Float32Array;
  expectedCoverage: number;
  studentPrecision: number;
  score: number;
}

interface OrientedSample extends ShapePoint {
  tangentX: number;
  tangentY: number;
}

const QUADRANTS: readonly WholeShapeQuadrant[] = ["top-left", "top-right", "bottom-left", "bottom-right"];
const CELLS: readonly WholeShapeCell[] = [
  "upper-left", "upper-middle", "upper-right",
  "middle-left", "center", "middle-right",
  "lower-left", "lower-middle", "lower-right",
];
const TRANSLATIONS = [-0.05, 0, 0.05] as const;
const SCALES = [0.94, 1, 1.06] as const;
const ROTATIONS = [-4, 0, 4] as const;
const EMPTY_METRICS: WholeShapeMetrics = {
  expectedCoverage: 0,
  studentPrecision: 0,
  directionalExpectedCoverage: 0,
  directionalStudentPrecision: 0,
  modelStrokeCoverages: [],
  minimumModelStrokeCoverage: 0,
  score: 0,
  centroidDeltaX: 0,
  centroidDeltaY: 0,
  widthRatio: 0,
  heightRatio: 0,
  outsideInkRatio: 0,
  unassignedInkShare: 0,
};
const IDENTITY_TRANSFORM: WholeShapeTransform = {
  translateX: 0,
  translateY: 0,
  scale: 1,
  rotationDegrees: 0,
};

function validBounds(bounds: CharacterBounds): boolean {
  if (![bounds.x, bounds.y, bounds.width, bounds.height].every(Number.isFinite)) return false;
  if (bounds.width <= 0 || bounds.height <= 0) return false;
  return Math.max(bounds.width, bounds.height) / Math.min(bounds.width, bounds.height) <= 1.05;
}

function normalizeStrokes(strokes: readonly Stroke[], bounds: CharacterBounds): ShapePoint[][] | null {
  const side = Math.min(bounds.width, bounds.height);
  const left = bounds.x + (bounds.width - side) / 2;
  const top = bounds.y + (bounds.height - side) / 2;
  const paths: ShapePoint[][] = [];
  for (const stroke of strokes) {
    if (!Array.isArray(stroke.points)) return null;
    const points: ShapePoint[] = [];
    for (const point of stroke.points) {
      if (!Number.isFinite(point.x) || !Number.isFinite(point.y)) return null;
      points.push({
        x: ((point.x - left) / side) * 1024,
        y: ((point.y - top) / side) * 1024,
      });
    }
    const clean = dedupePath(points);
    if (clean.length) paths.push(clean);
  }
  return paths;
}

function transformPoint(point: ShapePoint, transform: WholeShapeTransform): ShapePoint {
  const angle = transform.rotationDegrees * (Math.PI / 180);
  const cosine = Math.cos(angle);
  const sine = Math.sin(angle);
  const centeredX = (point.x - 512) * transform.scale;
  const centeredY = (point.y - 512) * transform.scale;
  return {
    x: 512 + centeredX * cosine - centeredY * sine + transform.translateX * 1024,
    y: 512 + centeredX * sine + centeredY * cosine + transform.translateY * 1024,
  };
}

function orientedSamples(
  paths: readonly ShapePoint[][],
  transform: WholeShapeTransform = IDENTITY_TRANSFORM,
): OrientedSample[] {
  const samples: OrientedSample[] = [];
  const spacing = 12;
  for (const path of paths) {
    for (let index = 1; index < path.length; index += 1) {
      const rawStart = path[index - 1];
      const rawEnd = path[index];
      const start = transformPoint(rawStart, transform);
      const end = transformPoint(rawEnd, transform);
      const deltaX = end.x - start.x;
      const deltaY = end.y - start.y;
      const length = Math.hypot(deltaX, deltaY);
      if (!Number.isFinite(length) || length < 0.5) continue;
      const pieces = Math.max(1, Math.ceil(length / spacing));
      for (let piece = 0; piece < pieces; piece += 1) {
        const progress = (piece + 0.5) / pieces;
        samples.push({
          x: start.x + deltaX * progress,
          y: start.y + deltaY * progress,
          tangentX: deltaX / length,
          tangentY: deltaY / length,
        });
      }
    }
  }
  return samples;
}

/**
 * Pen direction and lift boundaries are ignored, but nearby ink must follow
 * roughly the same local axis. This distinguishes a crossing scribble from a
 * legitimate split or joined version of the same visible line.
 */
function directionalCoverage(
  source: readonly OrientedSample[],
  target: readonly OrientedSample[],
  maximumDistanceRatio = WHOLE_SHAPE_MATCH_DISTANCE_RATIO,
  directionToleranceDegrees = WHOLE_SHAPE_DIRECTION_TOLERANCE_DEGREES,
): number {
  if (!source.length || !target.length) return 0;
  const maximumDistance = maximumDistanceRatio * 1024;
  const maximumDistanceSquared = maximumDistance ** 2;
  const minimumCosine = Math.cos(directionToleranceDegrees * Math.PI / 180);
  let matched = 0;
  for (const sample of source) {
    let found = false;
    for (const candidate of target) {
      const deltaX = sample.x - candidate.x;
      const deltaY = sample.y - candidate.y;
      if (deltaX ** 2 + deltaY ** 2 > maximumDistanceSquared) continue;
      // Absolute cosine deliberately accepts either drawing direction.
      const cosine = Math.abs(sample.tangentX * candidate.tangentX + sample.tangentY * candidate.tangentY);
      if (cosine >= minimumCosine) {
        found = true;
        break;
      }
    }
    if (found) matched += 1;
  }
  return matched / source.length;
}

function markDisk(mask: Uint8Array, x: number, y: number, radius: number): void {
  const size = WHOLE_SHAPE_MASK_SIZE;
  const minimumX = Math.max(0, Math.floor(x - radius));
  const maximumX = Math.min(size - 1, Math.ceil(x + radius));
  const minimumY = Math.max(0, Math.floor(y - radius));
  const maximumY = Math.min(size - 1, Math.ceil(y + radius));
  for (let row = minimumY; row <= maximumY; row += 1) {
    for (let column = minimumX; column <= maximumX; column += 1) {
      if ((column - x) ** 2 + (row - y) ** 2 <= radius ** 2) mask[row * size + column] = 1;
    }
  }
}

function rasterize(paths: readonly ShapePoint[][], transform: WholeShapeTransform = IDENTITY_TRANSFORM): RasterizedInk {
  const mask = new Uint8Array(WHOLE_SHAPE_MASK_SIZE ** 2);
  const scale = (WHOLE_SHAPE_MASK_SIZE - 1) / 1024;
  let outsideSamples = 0;
  let totalSamples = 0;
  const renderPoint = (source: ShapePoint) => {
    const point = transformPoint(source, transform);
    totalSamples += 1;
    if (point.x < 0 || point.x > 1024 || point.y < 0 || point.y > 1024) {
      outsideSamples += 1;
      return;
    }
    markDisk(mask, point.x * scale, point.y * scale, 0.9);
  };

  for (const path of paths) {
    if (!path.length) continue;
    if (path.length === 1) {
      renderPoint(path[0]);
      continue;
    }
    for (let index = 1; index < path.length; index += 1) {
      const start = path[index - 1];
      const end = path[index];
      const length = Math.hypot(end.x - start.x, end.y - start.y);
      // Half-pixel sampling avoids holes in fast, sparsely sampled Pencil paths.
      const pieces = Math.max(1, Math.ceil(length / (1024 / WHOLE_SHAPE_MASK_SIZE / 2)));
      for (let piece = index === 1 ? 0 : 1; piece <= pieces; piece += 1) {
        const progress = piece / pieces;
        renderPoint({
          x: start.x + (end.x - start.x) * progress,
          y: start.y + (end.y - start.y) * progress,
        });
      }
    }
  }
  return {
    mask,
    inkCount: mask.reduce((sum, value) => sum + value, 0),
    outsideInkRatio: totalSamples ? outsideSamples / totalSamples : 0,
  };
}

/** Fast 8-neighbour chamfer field. Values are measured in mask pixels. */
function distanceField(mask: Uint8Array): Float32Array {
  const size = WHOLE_SHAPE_MASK_SIZE;
  const diagonal = Math.SQRT2;
  const distances = new Float32Array(mask.length);
  for (let index = 0; index < mask.length; index += 1) distances[index] = mask[index] ? 0 : size * 2;

  for (let row = 0; row < size; row += 1) {
    for (let column = 0; column < size; column += 1) {
      const index = row * size + column;
      if (column > 0) distances[index] = Math.min(distances[index], distances[index - 1] + 1);
      if (row > 0) distances[index] = Math.min(distances[index], distances[index - size] + 1);
      if (column > 0 && row > 0) distances[index] = Math.min(distances[index], distances[index - size - 1] + diagonal);
      if (column + 1 < size && row > 0) distances[index] = Math.min(distances[index], distances[index - size + 1] + diagonal);
    }
  }
  for (let row = size - 1; row >= 0; row -= 1) {
    for (let column = size - 1; column >= 0; column -= 1) {
      const index = row * size + column;
      if (column + 1 < size) distances[index] = Math.min(distances[index], distances[index + 1] + 1);
      if (row + 1 < size) distances[index] = Math.min(distances[index], distances[index + size] + 1);
      if (column + 1 < size && row + 1 < size) distances[index] = Math.min(distances[index], distances[index + size + 1] + diagonal);
      if (column > 0 && row + 1 < size) distances[index] = Math.min(distances[index], distances[index + size - 1] + diagonal);
    }
  }
  return distances;
}

function directedCoverage(source: Uint8Array, targetDistances: Float32Array, maximumDistance: number): number {
  let ink = 0;
  let covered = 0;
  for (let index = 0; index < source.length; index += 1) {
    if (!source[index]) continue;
    ink += 1;
    if (targetDistances[index] <= maximumDistance) covered += 1;
  }
  return ink ? covered / ink : 0;
}

function candidateScore(expectedCoverage: number, studentPrecision: number, transform: WholeShapeTransform, outsideInkRatio: number): number {
  const transformCost = (
    Math.abs(transform.translateX) / 0.05
    + Math.abs(transform.translateY) / 0.05
    + Math.abs(transform.scale - 1) / 0.06
    + Math.abs(transform.rotationDegrees) / 4
  ) * 0.004;
  return expectedCoverage * 0.58 + studentPrecision * 0.42 - transformCost - outsideInkRatio * 0.2;
}

function bestMatch(studentPaths: ShapePoint[][], expectedMask: Uint8Array): MatchCandidate {
  const distanceToExpected = distanceField(expectedMask);
  const maximumDistance = WHOLE_SHAPE_MATCH_DISTANCE_RATIO * WHOLE_SHAPE_MASK_SIZE;
  let best: MatchCandidate | null = null;
  for (const translateX of TRANSLATIONS) {
    for (const translateY of TRANSLATIONS) {
      for (const scale of SCALES) {
        for (const rotationDegrees of ROTATIONS) {
          const transform: WholeShapeTransform = { translateX, translateY, scale, rotationDegrees };
          const raster = rasterize(studentPaths, transform);
          const distanceToStudent = distanceField(raster.mask);
          const expectedCoverage = directedCoverage(expectedMask, distanceToStudent, maximumDistance);
          // Transformed ink outside the square is unmatched, not invisible.
          // Without this denominator adjustment a scale candidate can push a
          // border or stray stroke just beyond the mask and obtain 100%
          // precision from only the remaining in-square ink.
          const inSquarePrecision = directedCoverage(raster.mask, distanceToExpected, maximumDistance);
          const studentPrecision = inSquarePrecision * (1 - raster.outsideInkRatio);
          const score = candidateScore(expectedCoverage, studentPrecision, transform, raster.outsideInkRatio);
          if (!best || score > best.score) {
            best = { transform, raster, distanceToStudent, expectedCoverage, studentPrecision, score };
          }
        }
      }
    }
  }
  // The transform grid is non-empty by construction.
  return best!;
}

function fixedAlignmentScore(studentRaster: RasterizedInk, referenceMask: Uint8Array): number {
  const maximumDistance = WHOLE_SHAPE_MATCH_DISTANCE_RATIO * WHOLE_SHAPE_MASK_SIZE;
  const distanceToStudent = distanceField(studentRaster.mask);
  const distanceToReference = distanceField(referenceMask);
  const expectedCoverage = directedCoverage(referenceMask, distanceToStudent, maximumDistance);
  const inSquarePrecision = directedCoverage(studentRaster.mask, distanceToReference, maximumDistance);
  const studentPrecision = inSquarePrecision * (1 - studentRaster.outsideInkRatio);
  return expectedCoverage * 0.58 + studentPrecision * 0.42;
}

function maskGeometry(mask: Uint8Array): MaskGeometry {
  const size = WHOLE_SHAPE_MASK_SIZE;
  let count = 0;
  let sumX = 0;
  let sumY = 0;
  let minimumX = size;
  let maximumX = -1;
  let minimumY = size;
  let maximumY = -1;
  mask.forEach((value, index) => {
    if (!value) return;
    const x = index % size;
    const y = Math.floor(index / size);
    count += 1;
    sumX += x;
    sumY += y;
    minimumX = Math.min(minimumX, x);
    maximumX = Math.max(maximumX, x);
    minimumY = Math.min(minimumY, y);
    maximumY = Math.max(maximumY, y);
  });
  if (!count) return { centroidX: 0, centroidY: 0, width: 0, height: 0 };
  return {
    centroidX: sumX / count / (size - 1),
    centroidY: sumY / count / (size - 1),
    width: (maximumX - minimumX + 1) / size,
    height: (maximumY - minimumY + 1) / size,
  };
}

function regionForIndex(index: number, divisions: 2 | 3): number {
  const size = WHOLE_SHAPE_MASK_SIZE;
  const x = index % size;
  const y = Math.floor(index / size);
  const column = Math.min(divisions - 1, Math.floor(x * divisions / size));
  const row = Math.min(divisions - 1, Math.floor(y * divisions / size));
  return row * divisions + column;
}

function regionAssessments<TRegion extends string>(
  regions: readonly TRegion[],
  divisions: 2 | 3,
  expectedMask: Uint8Array,
  studentMask: Uint8Array,
  distanceToExpected: Float32Array,
  distanceToStudent: Float32Array,
): WholeShapeRegionAssessment<TRegion>[] {
  const maximumDistance = WHOLE_SHAPE_MATCH_DISTANCE_RATIO * WHOLE_SHAPE_MASK_SIZE;
  const expectedTotal = expectedMask.reduce((sum, value) => sum + value, 0);
  const studentTotal = studentMask.reduce((sum, value) => sum + value, 0);
  return regions.map((region, regionIndex) => {
    let expectedInk = 0;
    let studentInk = 0;
    let expectedCovered = 0;
    let studentCovered = 0;
    for (let index = 0; index < expectedMask.length; index += 1) {
      if (regionForIndex(index, divisions) !== regionIndex) continue;
      if (expectedMask[index]) {
        expectedInk += 1;
        if (distanceToStudent[index] <= maximumDistance) expectedCovered += 1;
      }
      if (studentMask[index]) {
        studentInk += 1;
        if (distanceToExpected[index] <= maximumDistance) studentCovered += 1;
      }
    }
    const expectedShare = expectedTotal ? expectedInk / expectedTotal : 0;
    return {
      region,
      expectedShare,
      studentShare: studentTotal ? studentInk / studentTotal : 0,
      expectedCoverage: expectedInk ? expectedCovered / expectedInk : 1,
      studentPrecision: studentInk ? studentCovered / studentInk : expectedInk ? 0 : 1,
      major: expectedShare >= WHOLE_SHAPE_MAJOR_CELL_SHARE,
    };
  });
}

function quadrantForCell(cell: WholeShapeCell): WholeShapeQuadrant | undefined {
  if (cell === "upper-left") return "top-left";
  if (cell === "upper-right") return "top-right";
  if (cell === "lower-left") return "bottom-left";
  if (cell === "lower-right") return "bottom-right";
  return undefined;
}

function componentPositionPhrase(position: CharacterComponentPosition): string {
  if (position === "upper") return "at the top";
  if (position === "lower") return "at the bottom";
  if (position === "inside") return "inside the character";
  if (position === "main") return "forming the main outline";
  return `on the ${position}`;
}

function missingCellIssues(cells: WholeShapeRegionAssessment<WholeShapeCell>[]): WholeShapeIssue[] {
  return cells
    .filter((cell) => cell.major && cell.expectedCoverage < WHOLE_SHAPE_MIN_MAJOR_CELL_COVERAGE)
    .sort((left, right) => left.expectedCoverage - right.expectedCoverage)
    .slice(0, 2)
    .map((cell) => ({
      code: "missing-major-shape" as const,
      severity: "error" as const,
      cell: cell.region,
      quadrant: quadrantForCell(cell.region),
      message: `The ${cell.region.replace("-", " ")} part is missing or too far from the expected shape.`,
    }));
}

function placementIssues(expected: MaskGeometry, student: MaskGeometry): WholeShapeIssue[] {
  const issues: WholeShapeIssue[] = [];
  const deltaX = student.centroidX - expected.centroidX;
  const deltaY = student.centroidY - expected.centroidY;
  const addPosition = (code: WholeShapeIssueCode, amount: number, message: string) => {
    if (amount <= 0.065) return;
    issues.push({ code, severity: amount > 0.115 ? "error" : "warning", message });
  };
  addPosition("too-far-left", -deltaX, "The whole character is too far left in the square.");
  addPosition("too-far-right", deltaX, "The whole character is too far right in the square.");
  addPosition("too-high", -deltaY, "The whole character is too high in the square.");
  addPosition("too-low", deltaY, "The whole character is too low in the square.");

  const areaScale = expected.width > 0 && expected.height > 0
    ? Math.sqrt((student.width * student.height) / (expected.width * expected.height))
    : 0;
  if (areaScale > 0 && areaScale < 0.76) {
    issues.push({
      code: "too-small",
      severity: areaScale < 0.62 ? "error" : "warning",
      message: "The character is too small for the square.",
    });
  } else if (areaScale > 1.28) {
    issues.push({
      code: "too-large",
      severity: areaScale > 1.48 ? "error" : "warning",
      message: "The character is too large for the square.",
    });
  }
  return issues;
}

function baseAssessment(
  rawStrokeCount: number,
  expectedStrokeCount: number,
  referencePaths: ShapePoint[][],
  studentPaths: ShapePoint[][],
  issue: WholeShapeIssue,
  blank: boolean,
): WholeShapeAssessment {
  return {
    passed: false,
    blank,
    rawStrokeCount,
    expectedStrokeCount,
    issues: [issue],
    metrics: { ...EMPTY_METRICS },
    alignment: { ...IDENTITY_TRANSFORM },
    quadrants: [],
    cells: [],
    components: [],
    closestCompetitor: null,
    studentPaths,
    referencePaths,
  };
}

/**
 * Compare the complete captured character with an official median while
 * treating pen lifts and stroke count as advisory metadata only.
 */
export function assessWholeCharacterShape(
  strokes: readonly Stroke[],
  expected: string,
  bounds: CharacterBounds,
): WholeShapeAssessment {
  const referencePaths = getCharacterShapeReference(expected);
  if (!referencePaths) {
    return baseAssessment(strokes.length, 0, [], [], {
      code: "missing-reference",
      severity: "error",
      message: "No official shape reference is available for this character.",
    }, false);
  }
  if (!validBounds(bounds)) {
    return baseAssessment(strokes.length, referencePaths.length, referencePaths, [], {
      code: "invalid-input",
      severity: "error",
      message: "The writing square or captured points are invalid.",
    }, false);
  }
  const studentPaths = normalizeStrokes(strokes, bounds);
  if (!studentPaths) {
    return baseAssessment(strokes.length, referencePaths.length, referencePaths, [], {
      code: "invalid-input",
      severity: "error",
      message: "The writing square or captured points are invalid.",
    }, false);
  }
  const studentLength = studentPaths.reduce((sum, path) => sum + pathLength(path), 0);
  if (!studentPaths.length || studentLength < 1024 * WHOLE_SHAPE_BLANK_LENGTH_RATIO) {
    return baseAssessment(strokes.length, referencePaths.length, referencePaths, studentPaths, {
      code: "blank",
      severity: "error",
      message: "Write this character before marking the answer.",
    }, true);
  }

  const expectedRaster = rasterize(referencePaths);
  const rawStudentRaster = rasterize(studentPaths);
  const match = bestMatch(studentPaths, expectedRaster.mask);
  // Competitors reuse the one target-aligned student raster. This avoids an
  // additional 81-transform search per reference on iPad while still asking
  // whether the same visible ink fits another character at least as well.
  const targetComparisonScore = fixedAlignmentScore(match.raster, expectedRaster.mask);
  const closestCompetitor = getShapeCompetitors(expected)
    .map((competitor): WholeShapeCompetitorEvidence => {
      const competitorScore = fixedAlignmentScore(match.raster, rasterize(competitor.paths).mask);
      return {
        character: competitor.character,
        source: competitor.source,
        score: competitorScore,
        margin: targetComparisonScore - competitorScore,
      };
    })
    .sort((left, right) => right.score - left.score)[0] ?? null;
  const expectedDirectionalSamples = orientedSamples(referencePaths);
  const studentDirectionalSamples = orientedSamples(studentPaths, match.transform);
  const directionalExpectedCoverage = directionalCoverage(expectedDirectionalSamples, studentDirectionalSamples);
  const directionalStudentPrecision = directionalCoverage(studentDirectionalSamples, expectedDirectionalSamples);
  const modelStrokeCoverages = referencePaths.map((referencePath) => directionalCoverage(
    orientedSamples([referencePath]),
    studentDirectionalSamples,
    WHOLE_SHAPE_MODEL_STROKE_DISTANCE_RATIO,
    WHOLE_SHAPE_MODEL_STROKE_DIRECTION_TOLERANCE_DEGREES,
  ));
  const minimumModelStrokeCoverage = modelStrokeCoverages.length ? Math.min(...modelStrokeCoverages) : 0;
  const distanceToExpected = distanceField(expectedRaster.mask);
  const expectedGeometry = maskGeometry(expectedRaster.mask);
  const studentGeometry = maskGeometry(rawStudentRaster.mask);
  const widthRatio = expectedGeometry.width ? studentGeometry.width / expectedGeometry.width : 0;
  const heightRatio = expectedGeometry.height ? studentGeometry.height / expectedGeometry.height : 0;
  const quadrants = regionAssessments(
    QUADRANTS,
    2,
    expectedRaster.mask,
    match.raster.mask,
    distanceToExpected,
    match.distanceToStudent,
  );
  const cells = regionAssessments(
    CELLS,
    3,
    expectedRaster.mask,
    match.raster.mask,
    distanceToExpected,
    match.distanceToStudent,
  );
  const studentInkTotal = match.raster.inkCount;
  const componentSources = getCharacterComponents(expected).map((definition) => {
    const componentPaths = definition.strokeIndices
      .map((strokeIndex) => referencePaths[strokeIndex])
      .filter((path): path is ShapePoint[] => Boolean(path));
    const componentRaster = rasterize(componentPaths);
    const distanceToComponent = distanceField(componentRaster.mask);
    return { definition, componentRaster, distanceToComponent };
  });
  const componentStudentMasks = componentSources.map(() => new Uint8Array(match.raster.mask.length));
  const componentAssignmentDistance = WHOLE_SHAPE_COMPONENT_ASSIGN_DISTANCE_RATIO * WHOLE_SHAPE_MASK_SIZE;
  let unassignedStudentInk = 0;
  for (let index = 0; index < match.raster.mask.length; index += 1) {
    if (!match.raster.mask[index] || !componentSources.length) continue;
    let nearestComponent = 0;
    for (let componentIndex = 1; componentIndex < componentSources.length; componentIndex += 1) {
      if (componentSources[componentIndex].distanceToComponent[index]
        < componentSources[nearestComponent].distanceToComponent[index]) nearestComponent = componentIndex;
    }
    if (componentSources[nearestComponent].distanceToComponent[index] <= componentAssignmentDistance) {
      componentStudentMasks[nearestComponent][index] = 1;
    } else {
      unassignedStudentInk += 1;
    }
  }
  const maximumDistance = WHOLE_SHAPE_MATCH_DISTANCE_RATIO * WHOLE_SHAPE_MASK_SIZE;
  const components: WholeShapeComponentAssessment[] = componentSources.map((source, componentIndex) => {
    const { definition, componentRaster } = source;
    const studentComponentMask = componentStudentMasks[componentIndex];
    const supportingStudentInk = studentComponentMask.reduce((sum, value) => sum + value, 0);
    let matchedSupportingInk = 0;
    for (let index = 0; index < studentComponentMask.length; index += 1) {
      if (studentComponentMask[index] && source.distanceToComponent[index] <= maximumDistance) matchedSupportingInk += 1;
    }
    const studentPrecision = supportingStudentInk ? matchedSupportingInk / supportingStudentInk : 0;
    const expectedCoverage = directedCoverage(
      componentRaster.mask,
      match.distanceToStudent,
      maximumDistance,
    );
    const expectedComponentGeometry = maskGeometry(componentRaster.mask);
    const studentComponentGeometry = maskGeometry(studentComponentMask);
    const hasStudentSupport = supportingStudentInk > 0;
    const centroidDeltaX = supportingStudentInk
      ? studentComponentGeometry.centroidX - expectedComponentGeometry.centroidX
      : 0;
    const centroidDeltaY = supportingStudentInk
      ? studentComponentGeometry.centroidY - expectedComponentGeometry.centroidY
      : 0;
    const widthRatio = expectedComponentGeometry.width > 0
      ? studentComponentGeometry.width / expectedComponentGeometry.width
      : 0;
    const heightRatio = expectedComponentGeometry.height > 0
      ? studentComponentGeometry.height / expectedComponentGeometry.height
      : 0;
    const placementPassed = hasStudentSupport
      && Math.abs(centroidDeltaX) <= WHOLE_SHAPE_MAX_COMPONENT_CENTROID_DELTA
      && Math.abs(centroidDeltaY) <= WHOLE_SHAPE_MAX_COMPONENT_CENTROID_DELTA;
    const relativeSizePassed = widthRatio >= WHOLE_SHAPE_MIN_COMPONENT_SIZE_RATIO
      && widthRatio <= WHOLE_SHAPE_MAX_COMPONENT_SIZE_RATIO
      && heightRatio >= WHOLE_SHAPE_MIN_COMPONENT_SIZE_RATIO
      && heightRatio <= WHOLE_SHAPE_MAX_COMPONENT_SIZE_RATIO;
    return {
      id: definition.id,
      label: definition.label,
      position: definition.position,
      expectedStrokeIndices: [...definition.strokeIndices],
      expectedCoverage,
      studentSupportShare: studentInkTotal ? supportingStudentInk / studentInkTotal : 0,
      studentPrecision,
      expectedShare: expectedRaster.inkCount ? componentRaster.inkCount / expectedRaster.inkCount : 0,
      hasStudentSupport,
      centroidDeltaX,
      centroidDeltaY,
      widthRatio,
      heightRatio,
      passed: expectedCoverage >= WHOLE_SHAPE_MIN_COMPONENT_COVERAGE
        && studentPrecision >= WHOLE_SHAPE_MIN_COMPONENT_PRECISION
        && placementPassed
        && relativeSizePassed,
    };
  });
  const unassignedInkShare = studentInkTotal ? unassignedStudentInk / studentInkTotal : 0;
  const issues = [
    ...placementIssues(expectedGeometry, studentGeometry),
    ...missingCellIssues(cells),
  ];

  for (const component of components.filter((component) => !component.passed)) {
    const direction = component.hasStudentSupport && Math.abs(component.centroidDeltaY) >= Math.abs(component.centroidDeltaX)
      ? component.centroidDeltaY > WHOLE_SHAPE_MAX_COMPONENT_CENTROID_DELTA
        ? "too low"
        : component.centroidDeltaY < -WHOLE_SHAPE_MAX_COMPONENT_CENTROID_DELTA
          ? "too high"
          : null
      : component.centroidDeltaX > WHOLE_SHAPE_MAX_COMPONENT_CENTROID_DELTA
        ? "too far right"
        : component.centroidDeltaX < -WHOLE_SHAPE_MAX_COMPONENT_CENTROID_DELTA
          ? "too far left"
          : null;
    const sizeProblem = component.hasStudentSupport
      ? component.widthRatio > WHOLE_SHAPE_MAX_COMPONENT_SIZE_RATIO
        ? "too wide"
        : component.widthRatio < WHOLE_SHAPE_MIN_COMPONENT_SIZE_RATIO
          ? "too narrow"
          : component.heightRatio > WHOLE_SHAPE_MAX_COMPONENT_SIZE_RATIO
            ? "too tall"
            : component.heightRatio < WHOLE_SHAPE_MIN_COMPONENT_SIZE_RATIO
              ? "too short"
              : null
      : null;
    issues.push({
      code: "missing-major-shape",
      severity: "error",
      message: !component.hasStudentSupport
        ? `The ${component.label} component ${componentPositionPhrase(component.position)} is missing.`
        : direction
          ? `The ${component.label} component ${componentPositionPhrase(component.position)} is ${direction}.`
          : sizeProblem
            ? `The ${component.label} component ${componentPositionPhrase(component.position)} is ${sizeProblem}.`
            : `The ${component.label} component ${componentPositionPhrase(component.position)} is incomplete or misplaced.`,
    });
  }

  if (
    (match.expectedCoverage < WHOLE_SHAPE_MIN_EXPECTED_COVERAGE
      || directionalExpectedCoverage < WHOLE_SHAPE_MIN_DIRECTIONAL_EXPECTED_COVERAGE
      || minimumModelStrokeCoverage < WHOLE_SHAPE_MIN_MODEL_STROKE_COVERAGE)
    && !issues.some((issue) => issue.code === "missing-major-shape")
  ) {
    issues.push({
      code: "missing-major-shape",
      severity: "error",
      message: "A major part of the expected character is missing or misplaced.",
    });
  }
  const extraCell = [...cells]
    .filter((cell) =>
      cell.studentPrecision < 0.55
      && cell.studentShare >= 0.06
      && cell.studentShare - cell.expectedShare >= 0.08,
    )
    .sort((left, right) =>
      (right.studentShare - right.expectedShare) - (left.studentShare - left.expectedShare),
    )[0];
  if (
    match.studentPrecision < WHOLE_SHAPE_MIN_STUDENT_PRECISION
    || directionalStudentPrecision < WHOLE_SHAPE_MIN_DIRECTIONAL_STUDENT_PRECISION
    || rawStudentRaster.outsideInkRatio > 0.08
    || unassignedInkShare > WHOLE_SHAPE_MAX_UNASSIGNED_INK_SHARE
    || extraCell
  ) {
    issues.push({
      code: "extra-ink",
      severity: "error",
      cell: extraCell?.region,
      quadrant: extraCell ? quadrantForCell(extraCell.region) : undefined,
      message: extraCell
        ? `There is extra ink in the ${extraCell.region.replace("-", " ")} part of the square.`
        : "There is too much ink away from the expected character shape.",
    });
  }
  if (closestCompetitor && closestCompetitor.margin < WHOLE_SHAPE_MIN_COMPETITOR_MARGIN) {
    issues.push({
      code: "closer-to-other-character",
      severity: "error",
      message: `The overall shape is too close to ${closestCompetitor.character}; check the character's main parts.`,
    });
  }

  const uniqueIssues = issues.filter((issue, index) =>
    issues.findIndex((candidate) => candidate.code === issue.code && candidate.cell === issue.cell) === index,
  );
  const metrics: WholeShapeMetrics = {
    expectedCoverage: match.expectedCoverage,
    studentPrecision: match.studentPrecision,
    directionalExpectedCoverage,
    directionalStudentPrecision,
    modelStrokeCoverages,
    minimumModelStrokeCoverage,
    score: match.score,
    centroidDeltaX: studentGeometry.centroidX - expectedGeometry.centroidX,
    centroidDeltaY: studentGeometry.centroidY - expectedGeometry.centroidY,
    widthRatio,
    heightRatio,
    outsideInkRatio: rawStudentRaster.outsideInkRatio,
    unassignedInkShare,
  };
  const hardMetricFailure = match.expectedCoverage < WHOLE_SHAPE_MIN_EXPECTED_COVERAGE
    || match.studentPrecision < WHOLE_SHAPE_MIN_STUDENT_PRECISION
    || directionalExpectedCoverage < WHOLE_SHAPE_MIN_DIRECTIONAL_EXPECTED_COVERAGE
    || directionalStudentPrecision < WHOLE_SHAPE_MIN_DIRECTIONAL_STUDENT_PRECISION
    || minimumModelStrokeCoverage < WHOLE_SHAPE_MIN_MODEL_STROKE_COVERAGE;
  return {
    passed: !hardMetricFailure && !uniqueIssues.some((issue) => issue.severity === "error"),
    blank: false,
    rawStrokeCount: strokes.length,
    expectedStrokeCount: referencePaths.length,
    issues: uniqueIssues,
    metrics,
    alignment: match.transform,
    quadrants,
    cells,
    components,
    closestCompetitor,
    studentPaths,
    referencePaths,
  };
}
