import { describe, expect, it } from "vitest";
import { gradeRankedCandidates, markingStatus, targetAwareCorrect } from "./grading";
import type { CharacterPrediction } from "./types";

function candidates(...characters: string[]): CharacterPrediction[] {
  return characters.map((character, index) => ({ character, rank: index + 1 }));
}

describe("ranked candidate grading", () => {
  it("accepts every expected character within the selected top five", () => {
    const result = gradeRankedCandidates("听写", [candidates("听"), candidates("乌", "与", "写")], 5);
    expect(result.correct).toBe(true);
    expect(result.expectedRanks).toEqual([1, 3]);
    expect(result.detectedCharacters).toEqual(["听", "乌"]);
  });

  it("rejects an expected character ranked below the threshold", () => {
    const result = gradeRankedCandidates("写", [candidates("乌", "与", "学", "字", "它", "写")], 5);
    expect(result.correct).toBe(false);
    expect(result.expectedRanks).toEqual([6]);
  });

  it("rejects a missing expected candidate", () => {
    expect(gradeRankedCandidates("写", [candidates("乌", "与")], 15).correct).toBe(false);
  });

  it("caps acceptance at rank five even if a larger value is supplied", () => {
    expect(gradeRankedCandidates("写", [candidates("乌", "与", "学", "字", "它", "写")], 15).correct).toBe(false);
  });
});

describe("target-aware grading", () => {
  it("never lets a recognition rank bypass a failed shape assessment", () => {
    expect(targetAwareCorrect(true, [{ passed: true }, { passed: false }], 2)).toBe(false);
    expect(targetAwareCorrect(true, [{ passed: true }, { passed: true }], 2)).toBe(true);
    expect(targetAwareCorrect(false, [{ passed: true }, { passed: true }], 2)).toBe(false);
  });

  it("fails closed when a character assessment is missing", () => {
    expect(targetAwareCorrect(true, [{ passed: true }], 2)).toBe(false);
    expect(targetAwareCorrect(true, [], 1)).toBe(false);
  });

  it("uses the completed visual shape as the gate, independent of stroke-count tips", () => {
    expect(markingStatus(true, [{ passed: true }], 1)).toBe("correct");
    expect(markingStatus(true, [{ passed: false }], 1)).toBe("shape");
    expect(markingStatus(false, [{ passed: true }], 1)).toBe("unrecognized");
  });

  it("reports an unfinished square before recognition or shape failure", () => {
    expect(markingStatus(false, [{ passed: true }, { passed: false, blank: true }], 2)).toBe("incomplete");
  });

  it("fails closed when the number of visual assessments is wrong", () => {
    expect(markingStatus(true, [{ passed: true }], 2)).toBe("shape");
    expect(markingStatus(true, [{ passed: true }, { passed: true }], 1)).toBe("shape");
  });
});
