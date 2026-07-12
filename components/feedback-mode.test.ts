import { describe, expect, it } from "vitest";
import {
  compactResultTone,
  parseDetailedFeedbackPreference,
  resultHeading,
  serializeDetailedFeedbackPreference,
  simpleResultMessage,
} from "./feedback-mode";

describe("feedback mode", () => {
  it("defaults to detailed feedback and persists both choices", () => {
    expect(parseDetailedFeedbackPreference(null)).toBe(true);
    expect(parseDetailedFeedbackPreference("on")).toBe(true);
    expect(parseDetailedFeedbackPreference("off")).toBe(false);
    expect(serializeDetailedFeedbackPreference(true)).toBe("on");
    expect(serializeDetailedFeedbackPreference(false)).toBe("off");
  });

  it("collapses unsuccessful results to one clear retry instruction", () => {
    expect(resultHeading("shape", false)).toBe("Try again");
    expect(resultHeading("unrecognized", false)).toBe("Try again");
    expect(resultHeading("incomplete", false)).toBe("Finish your answer");
    expect(resultHeading("correct", false)).toBe("Correct!");
    expect(resultHeading("tip", false)).toBe("Correct!");
    expect(compactResultTone("correct")).toBe("pass");
    expect(compactResultTone("tip")).toBe("pass");
    expect(compactResultTone("shape")).toBe("fail");
    expect(compactResultTone("unrecognized")).toBe("fail");
    expect(compactResultTone("incomplete")).toBe("fail");
  });

  it("retains the existing instructional headings when feedback is on", () => {
    expect(resultHeading("shape", true)).toContain("shape needs practice");
    expect(resultHeading("unrecognized", true)).toBe("Character not recognized");
    expect(resultHeading("tip", true)).toContain("Correct");
    expect(simpleResultMessage("shape")).not.toContain("guess");
    expect(simpleResultMessage("correct")).toContain("correct");
  });
});
