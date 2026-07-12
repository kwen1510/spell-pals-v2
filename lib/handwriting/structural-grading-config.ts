/**
 * Central tuning surface for deterministic handwriting grading.
 *
 * `advisory` values describe model/style similarity and can produce a tip.
 * `hard` values protect character identity and are allowed to block credit.
 * Character templates may override selected values after teacher calibration.
 */
export const STRUCTURAL_GRADING_CONFIG = Object.freeze({
  normalization: {
    maximumRotationDegrees: 12,
    rotationStepDegrees: 2,
  },
  advisory: {
    expectedCoverageMinimum: 0.78,
    studentPrecisionMinimum: 0.74,
    directionalExpectedCoverageMinimum: 0.68,
    directionalStudentPrecisionMinimum: 0.75,
    majorCellCoverageMinimum: 0.44,
    majorCellInkShare: 0.075,
    componentCoverageMinimum: 0.55,
    componentPrecisionMinimum: 0.62,
    componentCentroidDeltaMaximum: 0.11,
    componentSizeRatioMinimum: 0.5,
    componentSizeRatioMaximum: 1.75,
    unassignedInkShareMaximum: 0.18,
    competitorTipMargin: 0.04,
  },
  hard: {
    blankLengthRatio: 0.025,
    shortPathCoverageMinimum: 0.62,
    longPathCoverageMinimum: 0.74,
    longPathLength: 220,
    componentCoverageMinimum: 0.45,
    componentPrecisionMinimum: 0.5,
    componentCentroidDeltaMaximum: 0.17,
    componentSizeRatioMinimum: 0.36,
    componentSizeRatioMaximum: 2.25,
    // A competitor must be materially better. A near tie is advisory because
    // coarse raster scores are not a distinguishing-feature proof.
    competitorBetterBy: 0.005,
    majorUnmatchedRunRatio: 0.15,
    majorUnmatchedLengthRatio: 0.12,
    unmatchedSampleDistanceRatio: 0.085,
  },
  matching: {
    maskSize: 64,
    broadDistanceRatio: 0.055,
    modelPathDistanceRatio: 0.05,
    modelEndpointDistanceRatio: 0.05,
    componentAssignmentDistanceRatio: 0.1,
    directionToleranceDegrees: 50,
    modelPathDirectionToleranceDegrees: 45,
  },
} as const);

export type StructuralGradingConfig = typeof STRUCTURAL_GRADING_CONFIG;
