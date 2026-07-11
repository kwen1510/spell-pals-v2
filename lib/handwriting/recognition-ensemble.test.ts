import { describe, expect, it } from "vitest";
import {
  createRecognitionVariants,
  fuseRecognitionResults,
  mergeAccidentalLifts,
  splitStrokesAtCorners,
  splitStrokesAtPauses,
  type RecognitionVariant,
  type VariantRecognitionResult,
} from "./recognition-ensemble";
import type { RecognitionVariantFamily, Stroke } from "./types";

function stroke(id: string, points: Array<[number, number, number, number?]>): Stroke {
  return {
    id,
    width: 7,
    points: points.map(([x, y, timestamp, pressure]) => ({ x, y, timestamp, pressure })),
  };
}

function variant(id: string, family: RecognitionVariantFamily, weight: number): RecognitionVariant {
  return { id, family, weight, input: [[[0, 0], [1, 1]]] };
}

function result(variantId: string, characters: string[]): VariantRecognitionResult {
  return { variantId, matches: characters.map((hanzi) => ({ hanzi })) };
}

describe("recognition variants", () => {
  it("splits at a genuine pause while preserving point data and order", () => {
    const source = stroke("joined", [
      [0, 0, 10, 0.25],
      [10, 0, 20, 0.5],
      [10, 10, 130, 0.75],
      [20, 10, 140, 1],
    ]);
    const split = splitStrokesAtPauses([source]);
    expect(split).toHaveLength(2);
    expect(split.flatMap((item) => item.points).map((point) => point.timestamp)).toEqual([10, 20, 130, 140]);
    expect(split.flatMap((item) => item.points).map((point) => point.pressure)).toEqual([0.25, 0.5, 0.75, 1]);
    expect(source.points).toHaveLength(4);
  });

  it("does not split ordinary fast samples", () => {
    const source = stroke("fast", [[0, 0, 0], [5, 0, 60], [5, 5, 99]]);
    expect(splitStrokesAtPauses([source])).toHaveLength(1);
  });

  it("finds strong corners but adds no more than three boundaries per captured stroke", () => {
    const source = stroke("zigzag", [
      [0, 0, 0], [20, 0, 10], [20, 20, 20], [40, 20, 30],
      [40, 40, 40], [60, 40, 50], [60, 60, 60], [80, 60, 70],
    ]);
    const split = splitStrokesAtCorners([source], 45);
    expect(split.length).toBeGreaterThan(1);
    expect(split.length).toBeLessThanOrEqual(4);
    const originalPoints = new Set(source.points.map((point) => `${point.x},${point.y},${point.timestamp}`));
    expect(split.flatMap((item) => item.points).every((point) => originalPoints.has(`${point.x},${point.y},${point.timestamp}`))).toBe(true);
  });

  it("merges only close consecutive lifts with a short non-negative time gap", () => {
    const first = stroke("first", [[0, 0, 0], [50, 0, 20]]);
    const close = stroke("close", [[52, 1, 80], [80, 10, 100]]);
    const far = stroke("far", [[10, 90, 110], [20, 90, 120]]);
    const merged = mergeAccidentalLifts([first, close, far]);
    expect(merged).toHaveLength(2);
    expect(merged[0].points.map((point) => point.timestamp)).toEqual([0, 20, 80, 100]);
    expect(merged[1].id).toBe("far");
    expect(first.points).toHaveLength(2);

    expect(mergeAccidentalLifts([
      first,
      stroke("late", [[51, 0, 200], [60, 0, 210]]),
    ])).toHaveLength(2);
  });

  it("builds three correlated baselines and only structural variants that changed boundaries", () => {
    const source = stroke("joined", [[0, 0, 0], [40, 0, 20], [40, 40, 140], [80, 40, 160]]);
    const variants = createRecognitionVariants([source]);
    expect(variants.filter((item) => item.family === "baseline")).toHaveLength(3);
    expect(variants.some((item) => item.family === "pause")).toBe(true);
    expect(variants.some((item) => item.family === "corner45")).toBe(true);
    expect(new Set(variants.map((item) => item.id)).size).toBe(variants.length);
  });
});

describe("reciprocal-rank fusion", () => {
  it("counts correlated baseline tolerances as one family contribution", () => {
    const variants = [
      variant("baseline-2.25", "baseline", 1),
      variant("baseline-4", "baseline", 1),
      variant("baseline-6", "baseline", 1),
    ];
    const fused = fuseRecognitionResults(variants, variants.map((item) => result(item.id, ["听", "明"])), 15);
    expect(fused[0].character).toBe("听");
    expect(fused[0].score).toBeCloseTo(1 / 11);
    expect(fused[0].evidence?.familyRanks).toEqual({ baseline: 1 });
  });

  it("retains a non-baseline candidate only with two structural families", () => {
    const variants = [
      variant("baseline", "baseline", 1),
      variant("corner45", "corner45", 0.8),
      variant("corner90", "corner90", 0.9),
      variant("pause", "pause", 0.9),
    ];
    const baseline = Array.from({ length: 40 }, (_, index) => String.fromCodePoint(0x4e00 + index));
    const fused = fuseRecognitionResults(variants, [
      result("baseline", baseline),
      result("corner45", ["写", "老"]),
      result("corner90", ["写"]),
      result("pause", ["师"]),
    ], 40);
    expect(fused.some((candidate) => candidate.character === "写")).toBe(true);
    expect(fused.find((candidate) => candidate.character === "写")?.evidence?.structuralSupport).toEqual(["corner90", "corner45"]);
    expect(fused.some((candidate) => candidate.character === "师")).toBe(false);
    expect(fused.some((candidate) => candidate.character === "老")).toBe(false);
  });

  it("filters traditional-only, non-Han, and multi-character matches and reranks the result", () => {
    const variants = [variant("baseline", "baseline", 1)];
    const fused = fuseRecognitionResults(variants, [result("baseline", ["高", "聽", "機", "水", "?", "听写", "听", "写"])], 15);
    expect(fused.map((candidate) => candidate.character)).toEqual(["高", "水", "听", "写"]);
    expect(fused.map((candidate) => candidate.rank)).toEqual([1, 2, 3, 4]);
  });

  it("caps the returned list and assigns fused ranks", () => {
    const variants = [variant("baseline", "baseline", 1)];
    const matches = Array.from({ length: 20 }, (_, index) => String.fromCodePoint(0x4e00 + index));
    const fused = fuseRecognitionResults(variants, [result("baseline", matches)], 15);
    expect(fused).toHaveLength(15);
    expect(fused.at(-1)?.rank).toBe(15);
  });
});
