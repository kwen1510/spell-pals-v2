import type { ShapePoint } from "./character-shape-references";
import type { CharacterComponentPosition } from "./character-components";
import { getShapeCompetitors, type ShapeCompetitorSource } from "./shape-competitors";
import { dedupePath, pathLength } from "./shape-geometry";
import type { CharacterBounds } from "./shape-validator";
import type { Stroke } from "./types";
import { normalizeVisibleShape } from "./visible-shape-normalization";
import { STRUCTURAL_GRADING_CONFIG } from "./structural-grading-config";
import { getCharacterTemplate } from "./character-template";
import { assessRoughShape, type RoughShapeAssessment } from "./rough-shape-matcher";

/**
 * A light-weight, pen-lift-independent character check.
 *
 * Both the official median and the captured ink are uniformly scaled and
 * centred in the same structural frame before correctness is decided. This
 * removes whole-character size and placement without stretching proportions.
 * Raw square-relative geometry is retained separately for coaching feedback.
 */

export const WHOLE_SHAPE_MASK_SIZE = STRUCTURAL_GRADING_CONFIG.matching.maskSize;
export const WHOLE_SHAPE_MATCH_DISTANCE_RATIO = STRUCTURAL_GRADING_CONFIG.matching.broadDistanceRatio;
export const WHOLE_SHAPE_MIN_EXPECTED_COVERAGE = STRUCTURAL_GRADING_CONFIG.advisory.expectedCoverageMinimum;
export const WHOLE_SHAPE_MIN_STUDENT_PRECISION = STRUCTURAL_GRADING_CONFIG.advisory.studentPrecisionMinimum;
export const WHOLE_SHAPE_MIN_MAJOR_CELL_COVERAGE = STRUCTURAL_GRADING_CONFIG.advisory.majorCellCoverageMinimum;
export const WHOLE_SHAPE_MAJOR_CELL_SHARE = STRUCTURAL_GRADING_CONFIG.advisory.majorCellInkShare;
export const WHOLE_SHAPE_BLANK_LENGTH_RATIO = STRUCTURAL_GRADING_CONFIG.hard.blankLengthRatio;
export const WHOLE_SHAPE_MIN_COMPONENT_COVERAGE = STRUCTURAL_GRADING_CONFIG.advisory.componentCoverageMinimum;
export const WHOLE_SHAPE_MAX_COMPONENT_CENTROID_DELTA = STRUCTURAL_GRADING_CONFIG.advisory.componentCentroidDeltaMaximum;
export const WHOLE_SHAPE_COMPONENT_ASSIGN_DISTANCE_RATIO = STRUCTURAL_GRADING_CONFIG.matching.componentAssignmentDistanceRatio;
export const WHOLE_SHAPE_MIN_COMPONENT_PRECISION = STRUCTURAL_GRADING_CONFIG.advisory.componentPrecisionMinimum;
export const WHOLE_SHAPE_MIN_COMPONENT_SIZE_RATIO = STRUCTURAL_GRADING_CONFIG.advisory.componentSizeRatioMinimum;
export const WHOLE_SHAPE_MAX_COMPONENT_SIZE_RATIO = STRUCTURAL_GRADING_CONFIG.advisory.componentSizeRatioMaximum;
export const WHOLE_SHAPE_MAX_UNASSIGNED_INK_SHARE = STRUCTURAL_GRADING_CONFIG.advisory.unassignedInkShareMaximum;
export const WHOLE_SHAPE_MIN_DIRECTIONAL_EXPECTED_COVERAGE = STRUCTURAL_GRADING_CONFIG.advisory.directionalExpectedCoverageMinimum;
export const WHOLE_SHAPE_MIN_DIRECTIONAL_STUDENT_PRECISION = STRUCTURAL_GRADING_CONFIG.advisory.directionalStudentPrecisionMinimum;
export const WHOLE_SHAPE_DIRECTION_TOLERANCE_DEGREES = STRUCTURAL_GRADING_CONFIG.matching.directionToleranceDegrees;
export const WHOLE_SHAPE_MIN_COMPETITOR_MARGIN = -STRUCTURAL_GRADING_CONFIG.hard.competitorBetterBy;
export const WHOLE_SHAPE_MODEL_STROKE_DISTANCE_RATIO = STRUCTURAL_GRADING_CONFIG.matching.modelPathDistanceRatio;
export const WHOLE_SHAPE_MODEL_ENDPOINT_DISTANCE_RATIO = STRUCTURAL_GRADING_CONFIG.matching.modelEndpointDistanceRatio;
export const WHOLE_SHAPE_MODEL_STROKE_DIRECTION_TOLERANCE_DEGREES = STRUCTURAL_GRADING_CONFIG.matching.modelPathDirectionToleranceDegrees;
export const WHOLE_SHAPE_MIN_MODEL_STROKE_COVERAGE = STRUCTURAL_GRADING_CONFIG.hard.shortPathCoverageMinimum;
export const WHOLE_SHAPE_MIN_LONG_MODEL_STROKE_COVERAGE = STRUCTURAL_GRADING_CONFIG.hard.longPathCoverageMinimum;
export const WHOLE_SHAPE_LONG_MODEL_STROKE_LENGTH = STRUCTURAL_GRADING_CONFIG.hard.longPathLength;

const WHOLE_SHAPE_HARD_COMPONENT_COVERAGE = STRUCTURAL_GRADING_CONFIG.hard.componentCoverageMinimum;
const WHOLE_SHAPE_HARD_COMPONENT_PRECISION = STRUCTURAL_GRADING_CONFIG.hard.componentPrecisionMinimum;
const WHOLE_SHAPE_HARD_COMPONENT_CENTROID_DELTA = STRUCTURAL_GRADING_CONFIG.hard.componentCentroidDeltaMaximum;
const WHOLE_SHAPE_HARD_COMPONENT_MIN_SIZE_RATIO = STRUCTURAL_GRADING_CONFIG.hard.componentSizeRatioMinimum;
const WHOLE_SHAPE_HARD_COMPONENT_MAX_SIZE_RATIO = STRUCTURAL_GRADING_CONFIG.hard.componentSizeRatioMaximum;

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

export type WholeShapeDecision = "pass" | "pass-with-tip" | "fail";

export type WholeShapeFeedbackCode =
  | "BLANK_CHARACTER"
  | "INVALID_CAPTURE"
  | "MISSING_REFERENCE"
  | "MISSING_REQUIRED_PATH"
  | "MISSING_MAJOR_COMPONENT"
  | "MAJOR_EXTRA_LINE"
  | "STRONGER_CONFUSABLE_MATCH"
  | "REGION_SHAPE_DIFFERS"
  | "COMPONENT_PROPORTION_DIFFERS"
  | "MINOR_EXTRA_INK"
  | "CLOSE_CONFUSABLE_SHAPE"
  | "PLACEMENT_OR_SIZE_TIP";

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
  /** Student centreline length owned by each model path, relative to that path. */
  modelStrokeSupportRatios: number[];
  /** Longest consecutive unsupported share of each model path. */
  modelStrokeLongestGaps: number[];
  /** Fraction (0, .5, or 1) of each model path's endpoints supported by its owned ink. */
  modelStrokeEndpointCoverages: number[];
  /** Per-path threshold; long visible lines deliberately require more support. */
  modelStrokeRequiredCoverages: number[];
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
  /** Captured vector samples which are not near any model path. */
  unmatchedInkShare: number;
  /** Longest contiguous unmatched run as a share of all captured samples. */
  longestUnmatchedRunShare: number;
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
  decision: WholeShapeDecision;
  feedbackCodes: WholeShapeFeedbackCode[];
  /** Pen-lift-independent visible line/curve matching used for correctness. */
  roughShape: RoughShapeAssessment | null;
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

export interface WholeShapeAlignmentRank {
  /** Lowest normalized hard-gate margin; values at or above 1 are feasible. */
  gateRatio: number;
  /** Broad bidirectional raster quality used only after feasibility. */
  score: number;
}

/**
 * A feasible alignment always beats an infeasible one. Among feasible
 * alignments visual quality wins; among infeasible ones the closest hard-gate
 * margin wins. This prevents a raw average from selecting a transform which
 * needlessly fails a stricter long-line requirement.
 */
export function shouldPreferWholeShapeAlignment(
  candidate: WholeShapeAlignmentRank,
  current: WholeShapeAlignmentRank | null,
): boolean {
  if (!current) return true;
  const candidateFeasible = candidate.gateRatio >= 1;
  const currentFeasible = current.gateRatio >= 1;
  if (candidateFeasible !== currentFeasible) return candidateFeasible;
  if (candidateFeasible) {
    return candidate.score > current.score + 1e-6
      || (Math.abs(candidate.score - current.score) <= 1e-6 && candidate.gateRatio > current.gateRatio);
  }
  return candidate.gateRatio > current.gateRatio + 1e-6
    || (Math.abs(candidate.gateRatio - current.gateRatio) <= 1e-6 && candidate.score > current.score);
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
  modelPathSupport: ModelPathSupportEvidence[];
  /** Lowest normalized hard-gate margin for this alignment; 1 means feasible. */
  gateRatio: number;
}

interface OrientedSample extends ShapePoint {
  tangentX: number;
  tangentY: number;
}

interface ModelPathSupportEvidence {
  coverage: number;
  supportRatio: number;
  longestGap: number;
  endpointCoverage: number;
  /** Conservative combined score used by the hard completeness gate. */
  score: number;
}

const QUADRANTS: readonly WholeShapeQuadrant[] = ["top-left", "top-right", "bottom-left", "bottom-right"];
const CELLS: readonly WholeShapeCell[] = [
  "upper-left", "upper-middle", "upper-right",
  "middle-left", "center", "middle-right",
  "lower-left", "lower-middle", "lower-right",
];
// Whole-character scale and translation have already been removed uniformly.
// Only a bounded rotation search remains for normal slant in student writing.
const TRANSLATIONS = [0] as const;
const SCALES = [0.94, 0.97, 1, 1.03, 1.06] as const;
const COMPARISON_ROTATIONS = Array.from(
  {
    length: Math.floor(
      STRUCTURAL_GRADING_CONFIG.normalization.maximumRotationDegrees * 2
      / STRUCTURAL_GRADING_CONFIG.normalization.rotationStepDegrees,
    ) + 1,
  },
  (_, index) => (
    -STRUCTURAL_GRADING_CONFIG.normalization.maximumRotationDegrees
    + index * STRUCTURAL_GRADING_CONFIG.normalization.rotationStepDegrees
  ),
);
const EMPTY_METRICS: WholeShapeMetrics = {
  expectedCoverage: 0,
  studentPrecision: 0,
  directionalExpectedCoverage: 0,
  directionalStudentPrecision: 0,
  modelStrokeCoverages: [],
  modelStrokeSupportRatios: [],
  modelStrokeLongestGaps: [],
  modelStrokeEndpointCoverages: [],
  modelStrokeRequiredCoverages: [],
  minimumModelStrokeCoverage: 0,
  score: 0,
  centroidDeltaX: 0,
  centroidDeltaY: 0,
  widthRatio: 0,
  heightRatio: 0,
  outsideInkRatio: 0,
  unassignedInkShare: 0,
  unmatchedInkShare: 0,
  longestUnmatchedRunShare: 0,
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

interface UnmatchedInkEvidence {
  unmatchedInkShare: number;
  longestUnmatchedRunShare: number;
}

/**
 * Detect a real extra line from vector continuity instead of broad raster
 * precision. Small hooks, jitter, and style differences may create scattered
 * unmatched samples; only a long contiguous unsupported run is correctness
 * evidence.
 */
function unmatchedStudentInkEvidence(
  studentPaths: readonly ShapePoint[][],
  transform: WholeShapeTransform,
  referencePaths: readonly ShapePoint[][],
): UnmatchedInkEvidence {
  const referenceSamples = orientedSamples(referencePaths);
  const maximumDistance = STRUCTURAL_GRADING_CONFIG.hard.unmatchedSampleDistanceRatio * 1024;
  const maximumDistanceSquared = maximumDistance ** 2;
  const perPath = studentPaths.map((path) => orientedSamples([path], transform));
  const totalSamples = perPath.reduce((sum, samples) => sum + samples.length, 0);
  if (!totalSamples || !referenceSamples.length) {
    return { unmatchedInkShare: totalSamples ? 1 : 0, longestUnmatchedRunShare: totalSamples ? 1 : 0 };
  }
  let unmatchedSamples = 0;
  let longestRun = 0;
  for (const samples of perPath) {
    let currentRun = 0;
    for (const sample of samples) {
      const matched = referenceSamples.some((reference) => {
        const deltaX = sample.x - reference.x;
        const deltaY = sample.y - reference.y;
        return deltaX ** 2 + deltaY ** 2 <= maximumDistanceSquared;
      });
      if (matched) {
        currentRun = 0;
      } else {
        unmatchedSamples += 1;
        currentRun += 1;
        longestRun = Math.max(longestRun, currentRun);
      }
    }
  }
  return {
    unmatchedInkShare: unmatchedSamples / totalSamples,
    longestUnmatchedRunShare: longestRun / totalSamples,
  };
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

/**
 * Give every captured centreline sample to at most one official path, then
 * measure completeness using only that path's owned samples.
 *
 * This is deliberately independent of captured pen lifts: joined and split
 * pen movements are sampled into one pool. Ownership prevents a nearby line
 * from being reused to make two distinct official paths appear complete.
 * The length and longest-gap terms also stop a short fragment from covering a
 * long reference path merely because the spatial tolerance reaches both ways.
 */
function uniquelySupportedModelPaths(
  referencePaths: readonly ShapePoint[][],
  studentSamples: readonly OrientedSample[],
): ModelPathSupportEvidence[] {
  const references = referencePaths.map((path) => orientedSamples([path]));
  const maximumDistance = WHOLE_SHAPE_MODEL_STROKE_DISTANCE_RATIO * 1024;
  const maximumDistanceSquared = maximumDistance ** 2;
  const minimumCosine = Math.cos(WHOLE_SHAPE_MODEL_STROKE_DIRECTION_TOLERANCE_DEGREES * Math.PI / 180);
  const ownedSamples = references.map((): OrientedSample[] => []);

  for (const sample of studentSamples) {
    let owner = -1;
    let bestCost = Number.POSITIVE_INFINITY;
    for (let pathIndex = 0; pathIndex < references.length; pathIndex += 1) {
      for (const reference of references[pathIndex]) {
        const deltaX = sample.x - reference.x;
        const deltaY = sample.y - reference.y;
        const distanceSquared = deltaX ** 2 + deltaY ** 2;
        if (distanceSquared > maximumDistanceSquared) continue;
        const cosine = Math.abs(sample.tangentX * reference.tangentX + sample.tangentY * reference.tangentY);
        if (cosine < minimumCosine) continue;
        // Distance owns the sample; the small angle term resolves close
        // junction/parallel-line ties without making direction mandatory.
        const cost = distanceSquared + (1 - cosine) * maximumDistanceSquared * 0.15;
        if (cost < bestCost) {
          bestCost = cost;
          owner = pathIndex;
        }
      }
    }
    if (owner >= 0) ownedSamples[owner].push(sample);
  }

  return references.map((referenceSamples, pathIndex) => {
    if (!referenceSamples.length) {
      return { coverage: 0, supportRatio: 0, longestGap: 1, endpointCoverage: 0, score: 0 };
    }
    const support = ownedSamples[pathIndex];
    const matched = referenceSamples.map((reference) => support.some((sample) => {
      const deltaX = sample.x - reference.x;
      const deltaY = sample.y - reference.y;
      if (deltaX ** 2 + deltaY ** 2 > maximumDistanceSquared) return false;
      const cosine = Math.abs(sample.tangentX * reference.tangentX + sample.tangentY * reference.tangentY);
      return cosine >= minimumCosine;
    }));
    const matchedCount = matched.filter(Boolean).length;
    let longestGapCount = 0;
    let currentGapCount = 0;
    for (const isMatched of matched) {
      if (isMatched) {
        currentGapCount = 0;
      } else {
        currentGapCount += 1;
        longestGapCount = Math.max(longestGapCount, currentGapCount);
      }
    }
    const coverage = matchedCount / referenceSamples.length;
    const supportRatio = support.length / referenceSamples.length;
    const longestGap = longestGapCount / referenceSamples.length;
    const maximumEndpointDistanceSquared = (WHOLE_SHAPE_MODEL_ENDPOINT_DISTANCE_RATIO * 1024) ** 2;
    // Endpoints shared at a junction may legitimately be supplied by a joined
    // neighbouring movement, so endpoint anchors use the full centreline pool.
    // Path interiors and length remain exclusively owned above.
    const endpointCoverage = [referenceSamples[0], referenceSamples.at(-1)!]
      .filter((endpoint) => studentSamples.some((sample) => {
        const deltaX = sample.x - endpoint.x;
        const deltaY = sample.y - endpoint.y;
        if (deltaX ** 2 + deltaY ** 2 > maximumEndpointDistanceSquared) return false;
        return true;
      })).length / 2;
    return {
      coverage,
      supportRatio,
      longestGap,
      endpointCoverage,
      score: Math.min(coverage, Math.min(1, supportRatio), 1 - longestGap, endpointCoverage),
    };
  });
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
  const scaleCost = Math.abs(transform.scale - 1) / 0.06 * 0.001;
  return expectedCoverage * 0.58 + studentPrecision * 0.42 - scaleCost - outsideInkRatio * 0.2;
}

function requiredModelPathCoverage(referencePath: ShapePoint[]): number {
  return pathLength(referencePath) >= WHOLE_SHAPE_LONG_MODEL_STROKE_LENGTH
    ? WHOLE_SHAPE_MIN_LONG_MODEL_STROKE_COVERAGE
    : WHOLE_SHAPE_MIN_MODEL_STROKE_COVERAGE;
}

function bestMatch(
  studentPaths: ShapePoint[][],
  expectedPaths: ShapePoint[][],
  expectedMask: Uint8Array,
): MatchCandidate {
  const distanceToExpected = distanceField(expectedMask);
  const maximumDistance = WHOLE_SHAPE_MATCH_DISTANCE_RATIO * WHOLE_SHAPE_MASK_SIZE;
  const expectedSamples = orientedSamples(expectedPaths);
  const requiredPathCoverages = expectedPaths.map(requiredModelPathCoverage);
  let best: MatchCandidate | null = null;
  for (const translateX of TRANSLATIONS) {
    for (const translateY of TRANSLATIONS) {
      for (const scale of SCALES) {
        for (const rotationDegrees of COMPARISON_ROTATIONS) {
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
          const transformedStudentSamples = orientedSamples(studentPaths, transform);
          const modelPathSupport = uniquelySupportedModelPaths(expectedPaths, transformedStudentSamples);
          const minimumPathGateRatio = modelPathSupport.length
            ? Math.min(...modelPathSupport.map((evidence, index) => (
              evidence.score / requiredPathCoverages[index]
            )))
            : 0;
          const directionalExpectedCoverage = directionalCoverage(expectedSamples, transformedStudentSamples);
          const directionalStudentPrecision = directionalCoverage(transformedStudentSamples, expectedSamples);
          const gateRatio = Math.min(
            expectedCoverage / WHOLE_SHAPE_MIN_EXPECTED_COVERAGE,
            studentPrecision / WHOLE_SHAPE_MIN_STUDENT_PRECISION,
            directionalExpectedCoverage / WHOLE_SHAPE_MIN_DIRECTIONAL_EXPECTED_COVERAGE,
            directionalStudentPrecision / WHOLE_SHAPE_MIN_DIRECTIONAL_STUDENT_PRECISION,
            minimumPathGateRatio,
          );
          if (shouldPreferWholeShapeAlignment({ gateRatio, score }, best)) {
            best = {
              transform,
              raster,
              distanceToStudent,
              expectedCoverage,
              studentPrecision,
              score,
              modelPathSupport,
              gateRatio,
            };
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

/** Fair target/competitor score after the same small rotation search. */
function rotationInvariantComparisonScore(studentPaths: ShapePoint[][], referenceMask: Uint8Array): number {
  let best = 0;
  for (const rotationDegrees of COMPARISON_ROTATIONS) {
    const score = fixedAlignmentScore(rasterize(studentPaths, {
      translateX: 0,
      translateY: 0,
      scale: 1,
      rotationDegrees,
    }), referenceMask);
    best = Math.max(best, score);
  }
  return best;
}

function maskGeometry(mask: Uint8Array): MaskGeometry {
  const size = WHOLE_SHAPE_MASK_SIZE;
  let count = 0;
  let sumX = 0;
  let sumY = 0;
  let minimumX: number = size;
  let maximumX: number = -1;
  let minimumY: number = size;
  let maximumY: number = -1;
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
      severity: "warning" as const,
      cell: cell.region,
      quadrant: quadrantForCell(cell.region),
      message: `The strokes in the ${cell.region.replace("-", " ")} differ from the model; keep the main parts a little closer to the guide.`,
    }));
}

function placementIssues(expected: MaskGeometry, student: MaskGeometry): WholeShapeIssue[] {
  const issues: WholeShapeIssue[] = [];
  const deltaX = student.centroidX - expected.centroidX;
  const deltaY = student.centroidY - expected.centroidY;
  const addPosition = (code: WholeShapeIssueCode, amount: number, message: string) => {
    if (amount <= 0.065) return;
    issues.push({ code, severity: "warning", message });
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
      severity: "warning",
      message: "The character is too small for the square.",
    });
  } else if (areaScale > 1.28) {
    issues.push({
      code: "too-large",
      severity: "warning",
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
    decision: "fail",
    feedbackCodes: [issue.code === "blank"
      ? "BLANK_CHARACTER"
      : issue.code === "missing-reference"
        ? "MISSING_REFERENCE"
        : "INVALID_CAPTURE"],
    roughShape: null,
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
  const template = getCharacterTemplate(expected);
  const referencePaths = template?.modelStrokes.map((stroke) => (
    stroke.median.map((point) => ({ x: point.x * 1024, y: point.y * 1024 }))
  )) ?? null;
  if (!template || !referencePaths) {
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

  const normalizedReference = normalizeVisibleShape(referencePaths);
  const normalizedStudent = normalizeVisibleShape(studentPaths);
  if (!normalizedReference || !normalizedStudent) {
    return baseAssessment(strokes.length, referencePaths.length, referencePaths, studentPaths, {
      code: "invalid-input",
      severity: "error",
      message: "The writing square or captured points are invalid.",
    }, false);
  }
  const structuralReferencePaths = normalizedReference.paths;
  const structuralStudentPaths = normalizedStudent.paths;
  const rawExpectedRaster = rasterize(referencePaths);
  const expectedRaster = rasterize(structuralReferencePaths);
  const rawStudentRaster = rasterize(studentPaths);
  const match = bestMatch(structuralStudentPaths, structuralReferencePaths, expectedRaster.mask);
  const roughShape = assessRoughShape(
    template,
    structuralStudentPaths.map((path) => path.map((point) => {
      const aligned = transformPoint(point, match.transform);
      return { x: aligned.x / 1024, y: aligned.y / 1024 };
    })),
  );
  // Target and competitors are compared in the same independently normalized
  // frame, without the target's residual alignment. This avoids target-biased
  // fitting and an additional 81-transform search per competitor on iPad.
  const targetComparisonScore = rotationInvariantComparisonScore(structuralStudentPaths, expectedRaster.mask);
  const closestCompetitor = getShapeCompetitors(expected)
    .map((competitor): WholeShapeCompetitorEvidence => {
      const normalizedCompetitor = normalizeVisibleShape(competitor.paths);
      const competitorScore = normalizedCompetitor
        ? rotationInvariantComparisonScore(structuralStudentPaths, rasterize(normalizedCompetitor.paths).mask)
        : 0;
      return {
        character: competitor.character,
        source: competitor.source,
        score: competitorScore,
        margin: targetComparisonScore - competitorScore,
      };
    })
    .sort((left, right) => right.score - left.score)[0] ?? null;
  const expectedDirectionalSamples = orientedSamples(structuralReferencePaths);
  const studentDirectionalSamples = orientedSamples(structuralStudentPaths, match.transform);
  const directionalExpectedCoverage = directionalCoverage(expectedDirectionalSamples, studentDirectionalSamples);
  const directionalStudentPrecision = directionalCoverage(studentDirectionalSamples, expectedDirectionalSamples);
  const modelPathSupport = match.modelPathSupport;
  const modelStrokeCoverages = modelPathSupport.map((evidence) => evidence.score);
  const modelStrokeSupportRatios = modelPathSupport.map((evidence) => evidence.supportRatio);
  const modelStrokeLongestGaps = modelPathSupport.map((evidence) => evidence.longestGap);
  const modelStrokeEndpointCoverages = modelPathSupport.map((evidence) => evidence.endpointCoverage);
  const modelStrokeRequiredCoverages = structuralReferencePaths.map(requiredModelPathCoverage);
  const modelStrokeCompletenessPassed = modelStrokeCoverages.every((coverage, index) => (
    coverage >= modelStrokeRequiredCoverages[index]
  ));
  // The centreline/raster check is deliberately independent from primitive
  // extraction. It corroborates attempts whose visible shape is complete but
  // whose corners were sampled unusually (fast Pencil input, a tiny capture
  // gap, or a harmless extra pen lift). It cannot rescue genuinely missing or
  // extra ink because both expected coverage and student precision must stay
  // high in both ordinary and direction-aware comparisons.
  const legacyStrongComplete = modelStrokeCompletenessPassed
    && match.expectedCoverage >= 0.92
    && match.studentPrecision >= 0.86
    && directionalExpectedCoverage >= 0.82
    && directionalStudentPrecision >= 0.82;
  // The ordinary coverage thresholds are useful coaching signals. Correctness
  // only fails when a complete visible path is clearly absent; this leaves
  // room for non-calligraphic proportions and alternate joins.
  const roughMissingRequiredShape = roughShape.missingCriticalPieceIds.length > 0
    || roughShape.components.some((component) => !component.passed);
  const clearlyMissingModelPath = roughMissingRequiredShape && !legacyStrongComplete;
  const minimumModelStrokeCoverage = modelStrokeCoverages.length ? Math.min(...modelStrokeCoverages) : 0;
  const distanceToExpected = distanceField(expectedRaster.mask);
  const expectedGeometry = maskGeometry(rawExpectedRaster.mask);
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
  const componentSources = template.components.map((templateComponent) => {
    const definition = {
      id: templateComponent.id,
      label: templateComponent.label,
      position: templateComponent.position,
      strokeIndices: templateComponent.expectedStrokeIndexes,
    };
    const componentPaths = definition.strokeIndices
      .map((strokeIndex) => structuralReferencePaths[strokeIndex])
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
    const roughComponent = roughShape.components.find((component) => component.id === definition.id);
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
      passed: roughComponent
        ? roughComponent.passed || legacyStrongComplete
        : expectedCoverage >= WHOLE_SHAPE_MIN_COMPONENT_COVERAGE
          && studentPrecision >= WHOLE_SHAPE_MIN_COMPONENT_PRECISION
          && placementPassed
          && relativeSizePassed,
    };
  });
  const unassignedInkShare = studentInkTotal ? unassignedStudentInk / studentInkTotal : 0;
  const unmatchedInk = unmatchedStudentInkEvidence(
    structuralStudentPaths,
    match.transform,
    structuralReferencePaths,
  );
  const majorExtraLine = roughShape.majorExtraInk && !legacyStrongComplete;
  const issues: WholeShapeIssue[] = [];
  const failedRoughComponents = clearlyMissingModelPath
    ? roughShape.components.filter((component) => !component.passed)
    : [];
  for (const component of failedRoughComponents) {
    issues.push({
      code: "missing-major-shape",
      severity: "error",
      message: `The ${component.label} part is missing one or more required visible pieces.`,
    });
  }
  if (clearlyMissingModelPath && roughShape.missingCriticalPieceIds.length > 0) {
    issues.push({
      code: "missing-major-shape",
      severity: "error",
      message: roughShape.missingCriticalPieceIds.length === 1
        ? "One required visible line or curve could not be found."
        : `${roughShape.missingCriticalPieceIds.length} required visible lines or curves could not be found.`,
    });
  } else if (!legacyStrongComplete && roughShape.missingExpectedPieceIds.length > 0) {
    issues.push({
      code: "missing-major-shape",
      severity: "warning",
      message: "A small model detail is unclear, but all important visible pieces are present.",
    });
  }
  const effectiveMinorExtraInk = roughShape.extraStudentPieceIds.length > 0 && !legacyStrongComplete;
  if (majorExtraLine || effectiveMinorExtraInk) {
    issues.push({
      code: "extra-ink",
      severity: majorExtraLine ? "error" : "warning",
      message: majorExtraLine
        ? "There is a substantial extra line that is not part of this character."
        : "There is a small unmatched mark; it does not change the readable character.",
    });
  }
  const reviewedConfusable = closestCompetitor?.source === "known-confusable";
  if (
    closestCompetitor
    && reviewedConfusable
    && !roughShape.passed
    && closestCompetitor.margin < WHOLE_SHAPE_MIN_COMPETITOR_MARGIN
  ) {
    issues.push({
      code: "closer-to-other-character",
      severity: "error",
      message: `The overall shape is too close to ${closestCompetitor.character}; check the character's main parts.`,
    });
  } else if (
    closestCompetitor
    && reviewedConfusable
    && closestCompetitor.margin < STRUCTURAL_GRADING_CONFIG.advisory.competitorTipMargin
  ) {
    issues.push({
      code: "closer-to-other-character",
      severity: "warning",
      message: `A few strokes also resemble ${closestCompetitor.character}; keep the distinguishing part clear.`,
    });
  }

  const uniqueIssues = issues.filter((issue, index) =>
    issues.findIndex((candidate) => (
      candidate.code === issue.code
      && candidate.severity === issue.severity
      && candidate.cell === issue.cell
      && candidate.message === issue.message
    )) === index,
  );
  const metrics: WholeShapeMetrics = {
    expectedCoverage: match.expectedCoverage,
    studentPrecision: match.studentPrecision,
    directionalExpectedCoverage,
    directionalStudentPrecision,
    modelStrokeCoverages,
    modelStrokeSupportRatios,
    modelStrokeLongestGaps,
    modelStrokeEndpointCoverages,
    modelStrokeRequiredCoverages,
    minimumModelStrokeCoverage,
    score: match.score,
    centroidDeltaX: studentGeometry.centroidX - expectedGeometry.centroidX,
    centroidDeltaY: studentGeometry.centroidY - expectedGeometry.centroidY,
    widthRatio,
    heightRatio,
    outsideInkRatio: rawStudentRaster.outsideInkRatio,
    unassignedInkShare,
    unmatchedInkShare: unmatchedInk.unmatchedInkShare,
    longestUnmatchedRunShare: unmatchedInk.longestUnmatchedRunShare,
  };
  const hardMetricFailure = clearlyMissingModelPath || majorExtraLine;
  const passed = !hardMetricFailure && !uniqueIssues.some((issue) => issue.severity === "error");
  const decision: WholeShapeDecision = !passed
    ? "fail"
    : uniqueIssues.some((issue) => issue.severity === "warning")
      ? "pass-with-tip"
      : "pass";
  const feedbackCodes = Array.from(new Set<WholeShapeFeedbackCode>([
    ...(clearlyMissingModelPath ? ["MISSING_REQUIRED_PATH" as const] : []),
    ...(failedRoughComponents.length > 0
      ? ["MISSING_MAJOR_COMPONENT" as const] : []),
    ...(majorExtraLine ? ["MAJOR_EXTRA_LINE" as const] : []),
    ...(uniqueIssues.some((issue) => issue.severity === "error" && issue.code === "closer-to-other-character")
      ? ["STRONGER_CONFUSABLE_MATCH" as const] : []),
    ...(uniqueIssues.some((issue) => issue.severity === "warning" && issue.code === "missing-major-shape")
      ? ["REGION_SHAPE_DIFFERS" as const] : []),
    ...(effectiveMinorExtraInk && !majorExtraLine ? ["MINOR_EXTRA_INK" as const] : []),
    ...(uniqueIssues.some((issue) => issue.severity === "warning" && issue.code === "closer-to-other-character")
      ? ["CLOSE_CONFUSABLE_SHAPE" as const] : []),
    ...(uniqueIssues.some((issue) => issue.severity === "warning" && issue.code.startsWith("too-"))
      ? ["PLACEMENT_OR_SIZE_TIP" as const] : []),
  ]));
  return {
    passed,
    decision,
    feedbackCodes,
    roughShape,
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
