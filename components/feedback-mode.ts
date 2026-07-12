import type { MarkingStatus } from "@/lib/handwriting/grading";

export const DETAILED_FEEDBACK_STORAGE_KEY = "spell-pals:detailed-feedback";

export function parseDetailedFeedbackPreference(value: string | null): boolean {
  return value !== "off";
}

export function serializeDetailedFeedbackPreference(enabled: boolean): "on" | "off" {
  return enabled ? "on" : "off";
}

export function resultHeading(status: MarkingStatus, detailedFeedback: boolean): string {
  if (status === "correct" || status === "tip") {
    return status === "tip" && detailedFeedback ? "Correct — with a shape tip" : "Correct!";
  }
  if (status === "incomplete") return detailedFeedback ? "Finish every character first" : "Finish your answer";
  if (!detailedFeedback) return "Try again";
  if (status === "shape") return "I can read it, but part of the shape needs practice";
  return "Character not recognized";
}

export function simpleResultMessage(status: MarkingStatus): string {
  if (status === "correct" || status === "tip") return "Your answer passed both the recognition and shape checks.";
  if (status === "incomplete") return "Write one character in every square, then mark your answer again.";
  return "This answer did not pass both the recognition and shape checks.";
}

export function compactResultTone(status: MarkingStatus): "pass" | "fail" {
  return status === "correct" || status === "tip" ? "pass" : "fail";
}
