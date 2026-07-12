import { describe, expect, it } from "vitest";
import { summarizeStructuralCalibration, type LabelledStructuralAttempt } from "./structural-calibration";

describe("structural calibration summaries", () => {
  it("separates false rejects from false accepts and excludes borderline labels", () => {
    const attempts: LabelledStructuralAttempt[] = [
      { id: "a1", character: "听", writerGroup: "pencil", label: "acceptable", decision: "pass", feedbackCodes: [] },
      { id: "a2", character: "听", writerGroup: "pencil", label: "acceptable", decision: "fail", feedbackCodes: ["MISSING_REQUIRED_PATH"] },
      { id: "u1", character: "写", writerGroup: "touch", label: "unacceptable", decision: "fail", feedbackCodes: ["MAJOR_EXTRA_LINE"] },
      { id: "u2", character: "写", writerGroup: "touch", label: "unacceptable", decision: "pass-with-tip", feedbackCodes: ["MINOR_EXTRA_INK"] },
      { id: "b1", character: "老", writerGroup: "mouse", label: "borderline", decision: "pass-with-tip", feedbackCodes: [] },
    ];

    expect(summarizeStructuralCalibration(attempts)).toMatchObject({
      total: 5,
      acceptable: 2,
      unacceptable: 2,
      acceptedAcceptable: 1,
      rejectedUnacceptable: 1,
      falseRejects: 1,
      falseAccepts: 1,
      falseRejectRate: 0.5,
      falseAcceptRate: 0.5,
    });
  });
});
