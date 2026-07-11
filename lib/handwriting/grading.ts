import type { CharacterPrediction } from "./types";

export interface RankedGrade {
  correct: boolean;
  expectedRanks: Array<number | null>;
  detectedCharacters: string[];
}

export interface ShapeGradeLike {
  passed: boolean;
}

export function gradeRankedCandidates(
  expected: string,
  candidateLists: CharacterPrediction[][],
  threshold: number,
): RankedGrade {
  const expectedCharacters = Array.from(expected);
  const safeThreshold = Math.min(5, Math.max(1, Math.floor(threshold)));
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

export function targetAwareCorrect(
  recognitionCorrect: boolean,
  shapeAssessments: ShapeGradeLike[],
  expectedCharacterCount: number,
): boolean {
  return recognitionCorrect
    && expectedCharacterCount > 0
    && shapeAssessments.length === expectedCharacterCount
    && shapeAssessments.every((assessment) => assessment.passed);
}
