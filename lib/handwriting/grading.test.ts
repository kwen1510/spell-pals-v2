import { describe, expect, it } from "vitest";
import { gradeRankedCandidates } from "./grading";
import type { CharacterPrediction } from "./types";

function candidates(...characters: string[]): CharacterPrediction[] {
  return characters.map((character, index) => ({ character, rank: index + 1 }));
}

describe("ranked candidate grading", () => {
  it("accepts every expected character within the default top five", () => {
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
});
