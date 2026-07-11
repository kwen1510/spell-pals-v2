import { describe, expect, it } from "vitest";
import { getCharacterComponents } from "./character-components";
import { getCharacterShapeReference, SUPPORTED_SHAPE_CHARACTERS, type ShapePoint } from "./character-shape-references";
import { getShapeCompetitors } from "./shape-competitors";
import type { CharacterBounds } from "./shape-validator";
import { assessWholeCharacterShape } from "./whole-shape-validator";
import type { Stroke } from "./types";

const BOUNDS: CharacterBounds = { x: 50, y: 20, width: 400, height: 400 };

function screenPoint(point: ShapePoint, bounds = BOUNDS): ShapePoint {
  return {
    x: bounds.x + point.x / 1024 * bounds.width,
    y: bounds.y + point.y / 1024 * bounds.height,
  };
}

function strokesFromPaths(paths: ShapePoint[][], bounds = BOUNDS): Stroke[] {
  let timestamp = 100;
  return paths.map((path, strokeIndex) => ({
    id: `stroke-${strokeIndex}`,
    width: 6,
    points: path.map((point) => ({
      ...screenPoint(point, bounds),
      timestamp: timestamp += 9,
      pressure: 0.5,
    })),
  }));
}

function canonical(character: string): Stroke[] {
  const paths = getCharacterShapeReference(character);
  if (!paths) throw new Error(`Missing test reference for ${character}`);
  return strokesFromPaths(paths);
}

function competingPaths(actual: string, expected: string): ShapePoint[][] {
  if (SUPPORTED_SHAPE_CHARACTERS.includes(actual as (typeof SUPPORTED_SHAPE_CHARACTERS)[number])) {
    return getCharacterShapeReference(actual)!;
  }
  const competitor = getShapeCompetitors(expected).find((item) => item.character === actual);
  if (!competitor) throw new Error(`Missing competitor ${actual} for ${expected}`);
  return competitor.paths;
}

function transformPaths(
  paths: ShapePoint[][],
  transform: (point: ShapePoint, pointIndex: number, strokeIndex: number) => ShapePoint,
): ShapePoint[][] {
  return paths.map((path, strokeIndex) => path.map((point, pointIndex) => transform(point, pointIndex, strokeIndex)));
}

describe("whole-character quadrant and component validation", () => {
  it("accepts every official median and reports square-relative regions and components", () => {
    for (const character of SUPPORTED_SHAPE_CHARACTERS) {
      const assessment = assessWholeCharacterShape(canonical(character), character, BOUNDS);
      expect(assessment.passed, `${character}: ${JSON.stringify(assessment.issues)}`).toBe(true);
      expect(assessment.metrics.expectedCoverage).toBe(1);
      expect(assessment.metrics.studentPrecision).toBe(1);
      expect(assessment.quadrants).toHaveLength(4);
      expect(assessment.cells).toHaveLength(9);
      expect(assessment.components.map((component) => component.label)).toEqual(
        getCharacterComponents(character).map((component) => component.label),
      );
      expect(assessment.components.every((component) => component.passed)).toBe(true);
      expect(assessment.quadrants.reduce((sum, quadrant) => sum + quadrant.expectedShare, 0)).toBeCloseTo(1, 5);
    }
  });

  it("does not use pen-lift count as a correctness requirement", () => {
    const reference = getCharacterShapeReference("飞")!;
    const fewerPaths = [reference[0], [...reference[1], ...reference[2]]];
    const fewer = assessWholeCharacterShape(strokesFromPaths(fewerPaths), "飞", BOUNDS);
    expect(fewer.rawStrokeCount).toBe(2);
    expect(fewer.expectedStrokeCount).toBe(3);
    expect(fewer.passed, JSON.stringify(fewer.issues)).toBe(true);

    const splitPaths = reference.flatMap((path) => {
      const split = Math.max(1, Math.floor(path.length / 2));
      return [path.slice(0, split + 1), path.slice(split)].filter((piece) => piece.length >= 2);
    });
    const more = assessWholeCharacterShape(strokesFromPaths(splitPaths), "飞", BOUNDS);
    expect(more.rawStrokeCount).toBeGreaterThan(more.expectedStrokeCount);
    expect(more.passed, JSON.stringify(more.issues)).toBe(true);
  });

  it("treats drawing direction as a coaching detail when the visible paths are unchanged", () => {
    const reference = getCharacterShapeReference("听")!;
    const reversed = reference.map((path) => [...path].reverse());
    const assessment = assessWholeCharacterShape(strokesFromPaths(reversed), "听", BOUNDS);

    expect(assessment.passed, JSON.stringify(assessment.issues)).toBe(true);
    expect(assessment.metrics.directionalExpectedCoverage).toBe(1);
  });

  it("rejects omitted visible model strokes while still allowing joined pen movements", () => {
    for (const character of SUPPORTED_SHAPE_CHARACTERS) {
      const reference = getCharacterShapeReference(character)!;
      for (let omittedIndex = 0; omittedIndex < reference.length; omittedIndex += 1) {
        const incomplete = reference.filter((_, index) => index !== omittedIndex);
        const assessment = assessWholeCharacterShape(strokesFromPaths(incomplete), character, BOUNDS);
        expect(
          assessment.passed,
          `${character} without model stroke ${omittedIndex + 1}: ${JSON.stringify(assessment.metrics)}`,
        ).toBe(false);
      }
    }
  });

  it("allows small square-relative translation, scale, rotation, and jitter", () => {
    for (const character of SUPPORTED_SHAPE_CHARACTERS) {
      const reference = getCharacterShapeReference(character)!;
      const angle = 3 * Math.PI / 180;
      const transformed = transformPaths(reference, (point, pointIndex, strokeIndex) => {
        const x = (point.x - 512) * 0.96;
        const y = (point.y - 512) * 0.96;
        return {
          x: 512 + x * Math.cos(angle) - y * Math.sin(angle) + 28
            + Math.sin((strokeIndex + 1) * (pointIndex + 1)) * 2,
          y: 512 + x * Math.sin(angle) + y * Math.cos(angle) - 22
            + Math.cos((strokeIndex + 1) * (pointIndex + 1)) * 2,
        };
      });
      const assessment = assessWholeCharacterShape(strokesFromPaths(transformed), character, BOUNDS);
      expect(assessment.passed, `${character}: ${JSON.stringify(assessment.issues)} ${JSON.stringify(assessment.metrics)} ${JSON.stringify(assessment.alignment)}`).toBe(true);
    }
  });

  it("keeps placement relative to the writing square instead of fitting the ink bounding box", () => {
    const reference = getCharacterShapeReference("写")!;
    const slightlyRight = transformPaths(reference, (point) => ({ ...point, x: point.x + 78 }));
    const warning = assessWholeCharacterShape(strokesFromPaths(slightlyRight), "写", BOUNDS);
    expect(warning.passed).toBe(true);
    expect(warning.issues).toContainEqual(expect.objectContaining({ code: "too-far-right", severity: "warning" }));

    const farRight = transformPaths(reference, (point) => ({ ...point, x: point.x + 170 }));
    const failed = assessWholeCharacterShape(strokesFromPaths(farRight), "写", BOUNDS);
    expect(failed.passed).toBe(false);
    expect(failed.issues).toContainEqual(expect.objectContaining({ code: "too-far-right", severity: "error" }));
  });

  it("fails blank and missing-major-component attempts with actionable feedback", () => {
    const blank = assessWholeCharacterShape([], "听", BOUNDS);
    expect(blank.passed).toBe(false);
    expect(blank.blank).toBe(true);
    expect(blank.issues).toEqual([expect.objectContaining({ code: "blank" })]);

    const listening = getCharacterShapeReference("听")!;
    const withoutMouth = assessWholeCharacterShape(strokesFromPaths(listening.slice(3)), "听", BOUNDS);
    expect(withoutMouth.passed).toBe(false);
    expect(withoutMouth.components.find((component) => component.label === "口")).toMatchObject({ passed: false });
    expect(withoutMouth.issues).toContainEqual(expect.objectContaining({
      code: "missing-major-shape",
      message: expect.stringMatching(/口.*missing/),
    }));
    expect(withoutMouth.issues.some((issue) => issue.cell?.includes("left"))).toBe(true);
  });

  it("identifies a misplaced right-side component in 听", () => {
    const listening = getCharacterShapeReference("听")!;
    const misplacedRight = listening.map((path, strokeIndex) => path.map((point) => ({
      ...point,
      y: strokeIndex >= 3 ? point.y + 135 : point.y,
    })));
    const assessment = assessWholeCharacterShape(strokesFromPaths(misplacedRight), "听", BOUNDS);

    expect(assessment.passed).toBe(false);
    expect(assessment.components.find((component) => component.label === "口")).toMatchObject({ passed: true });
    expect(assessment.components.find((component) => component.label === "斤")).toMatchObject({ passed: false });
    expect(assessment.issues).toContainEqual(expect.objectContaining({
      code: "missing-major-shape",
      message: expect.stringMatching(/斤.*too low/),
    }));
  });

  it("rejects conspicuous extra ink and identifies its grid region", () => {
    const strokes = canonical("写");
    strokes.push({
      id: "extra-cross",
      width: 6,
      points: [
        { ...screenPoint({ x: 40, y: 760 }), timestamp: 10_000 },
        { ...screenPoint({ x: 320, y: 980 }), timestamp: 10_010 },
        { ...screenPoint({ x: 40, y: 980 }), timestamp: 10_020 },
        { ...screenPoint({ x: 320, y: 760 }), timestamp: 10_030 },
      ],
    });
    const assessment = assessWholeCharacterShape(strokes, "写", BOUNDS);
    expect(assessment.passed, JSON.stringify({ metrics: assessment.metrics, issues: assessment.issues, cells: assessment.cells })).toBe(false);
    expect(assessment.issues).toContainEqual(expect.objectContaining({
      code: "extra-ink",
      cell: expect.stringContaining("lower"),
    }));
  });

  it("does not let alignment hide a square border outside the transformed mask", () => {
    const reference = getCharacterShapeReference("写")!;
    const border = [{ x: 20, y: 20 }, { x: 1_000, y: 20 }, { x: 1_000, y: 1_000 }, { x: 20, y: 1_000 }, { x: 20, y: 20 }];
    const assessment = assessWholeCharacterShape(strokesFromPaths([...reference, border]), "写", BOUNDS);

    expect(assessment.passed).toBe(false);
    expect(assessment.metrics.studentPrecision).toBeLessThan(0.78);
    expect(assessment.metrics.unassignedInkShare).toBeGreaterThan(0.14);
    expect(assessment.issues).toContainEqual(expect.objectContaining({ code: "extra-ink" }));
  });

  it("rejects a large crossing scribble even when it lies in dense expected cells", () => {
    const reference = getCharacterShapeReference("写")!;
    const cross = [
      [{ x: 100, y: 512 }, { x: 924, y: 512 }],
      [{ x: 512, y: 100 }, { x: 512, y: 924 }],
    ];
    const assessment = assessWholeCharacterShape(strokesFromPaths([...reference, ...cross]), "写", BOUNDS);

    expect(assessment.passed).toBe(false);
    expect(assessment.metrics.directionalStudentPrecision).toBeLessThan(0.76);
    expect(assessment.issues).toContainEqual(expect.objectContaining({ code: "extra-ink" }));
  });

  it.each([
    ["昕", "听"],
    ["帅", "师"],
    ["扬", "场"],
    ["汤", "场"],
    ["杌", "机"],
    ["场", "老"],
  ])("rejects competitor %s as expected %s even when recognition proposes the target", (actual, expected) => {
    const assessment = assessWholeCharacterShape(strokesFromPaths(competingPaths(actual, expected)), expected, BOUNDS);

    expect(assessment.passed).toBe(false);
    expect(assessment.closestCompetitor?.character).toBe(actual);
    expect(assessment.issues).toContainEqual(expect.objectContaining({ code: "closer-to-other-character" }));
  });

  it("rejects every other supported target character even when recognition guesses the expected one", () => {
    for (const expected of SUPPORTED_SHAPE_CHARACTERS) {
      for (const actual of SUPPORTED_SHAPE_CHARACTERS) {
        if (actual === expected) continue;
        const assessment = assessWholeCharacterShape(canonical(actual), expected, BOUNDS);
        expect(assessment.passed, `${actual} must not pass as ${expected}`).toBe(false);
      }
    }
  });

  it("fails closed for unsupported references, invalid points, and non-square bounds", () => {
    expect(assessWholeCharacterShape([], "水", BOUNDS).issues).toEqual([
      expect.objectContaining({ code: "missing-reference" }),
    ]);

    const invalid = canonical("飞");
    invalid[0].points[0].x = Number.NaN;
    expect(assessWholeCharacterShape(invalid, "飞", BOUNDS).issues).toEqual([
      expect.objectContaining({ code: "invalid-input" }),
    ]);

    expect(assessWholeCharacterShape(canonical("飞"), "飞", { ...BOUNDS, width: 600 }).issues).toEqual([
      expect.objectContaining({ code: "invalid-input" }),
    ]);
  });
});
