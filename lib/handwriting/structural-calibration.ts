import type { WholeShapeDecision, WholeShapeFeedbackCode } from "./whole-shape-validator";

export type TeacherStructuralLabel = "acceptable" | "borderline" | "unacceptable";

export interface LabelledStructuralAttempt {
  id: string;
  character: string;
  writerGroup: string;
  label: TeacherStructuralLabel;
  decision: WholeShapeDecision;
  feedbackCodes: WholeShapeFeedbackCode[];
}

export interface StructuralCalibrationSummary {
  total: number;
  acceptable: number;
  unacceptable: number;
  acceptedAcceptable: number;
  rejectedUnacceptable: number;
  falseRejects: number;
  falseAccepts: number;
  falseRejectRate: number;
  falseAcceptRate: number;
}

/**
 * Pure confusion-matrix helper for teacher-labelled calibration sets. A
 * borderline example is deliberately excluded from the hard error rates and
 * remains available for qualitative threshold review.
 */
export function summarizeStructuralCalibration(
  attempts: readonly LabelledStructuralAttempt[],
): StructuralCalibrationSummary {
  const isAccepted = (attempt: LabelledStructuralAttempt) => attempt.decision !== "fail";
  const acceptable = attempts.filter((attempt) => attempt.label === "acceptable");
  const unacceptable = attempts.filter((attempt) => attempt.label === "unacceptable");
  const acceptedAcceptable = acceptable.filter(isAccepted).length;
  const rejectedUnacceptable = unacceptable.filter((attempt) => !isAccepted(attempt)).length;
  const falseRejects = acceptable.length - acceptedAcceptable;
  const falseAccepts = unacceptable.length - rejectedUnacceptable;
  return {
    total: attempts.length,
    acceptable: acceptable.length,
    unacceptable: unacceptable.length,
    acceptedAcceptable,
    rejectedUnacceptable,
    falseRejects,
    falseAccepts,
    falseRejectRate: acceptable.length ? falseRejects / acceptable.length : 0,
    falseAcceptRate: unacceptable.length ? falseAccepts / unacceptable.length : 0,
  };
}
