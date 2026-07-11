import type { CharacterPrediction } from "./types";

export interface RankedGrade {
  correct: boolean;
  expectedRanks: Array<number | null>;
  detectedCharacters: string[];
}

export function gradeRankedCandidates(
  expected: string,
  candidateLists: CharacterPrediction[][],
  threshold: number,
): RankedGrade {
  const expectedCharacters = Array.from(expected);
  const safeThreshold = Math.max(1, Math.floor(threshold));
  const expectedRanks = expectedCharacters.map((character, index) => {
    const candidateIndex = (candidateLists[index] ?? []).findIndex((candidate) => candidate.character === character);
    return candidateIndex === -1 ? null : candidateIndex + 1;
  });
  return {
    correct: expectedRanks.every((rank) => rank !== null && rank <= safeThreshold),
    expectedRanks,
    detectedCharacters: expectedCharacters.map((_, index) => candidateLists[index]?.[0]?.character ?? ""),
  };
}
