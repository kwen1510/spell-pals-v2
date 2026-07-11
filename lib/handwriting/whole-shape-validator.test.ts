import { describe, expect, it } from "vitest";
import { getCharacterComponents } from "./character-components";
import { getCharacterShapeReference, SUPPORTED_SHAPE_CHARACTERS, type ShapePoint } from "./character-shape-references";
import { getShapeCompetitors } from "./shape-competitors";
import type { CharacterBounds } from "./shape-validator";
import {
  assessWholeCharacterShape,
  shouldPreferWholeShapeAlignment,
  WHOLE_SHAPE_MIN_MODEL_STROKE_COVERAGE,
} from "./whole-shape-validator";
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

function pathLength(path: ShapePoint[]): number {
  return path.slice(1).reduce((sum, point, index) => (
    sum + Math.hypot(point.x - path[index].x, point.y - path[index].y)
  ), 0);
}

function pointAtLength(path: ShapePoint[], distance: number): ShapePoint {
  let travelled = 0;
  for (let index = 1; index < path.length; index += 1) {
    const start = path[index - 1];
    const end = path[index];
    const segmentLength = Math.hypot(end.x - start.x, end.y - start.y);
    if (travelled + segmentLength >= distance) {
      const progress = segmentLength ? (distance - travelled) / segmentLength : 0;
      return {
        x: start.x + (end.x - start.x) * progress,
        y: start.y + (end.y - start.y) * progress,
      };
    }
    travelled += segmentLength;
  }
  return { ...path.at(-1)! };
}

function prefixByLength(path: ShapePoint[], retainedFraction: number): ShapePoint[] {
  const target = pathLength(path) * retainedFraction;
  const prefix: ShapePoint[] = [path[0]];
  let travelled = 0;
  for (let index = 1; index < path.length; index += 1) {
    const start = path[index - 1];
    const end = path[index];
    const segmentLength = Math.hypot(end.x - start.x, end.y - start.y);
    if (travelled + segmentLength >= target) {
      prefix.push(pointAtLength(path, target));
      break;
    }
    prefix.push(end);
    travelled += segmentLength;
  }
  return prefix;
}

function removeCenteredLength(path: ShapePoint[], removedFraction: number): ShapePoint[][] {
  const total = pathLength(path);
  const gapStart = total * (0.5 - removedFraction / 2);
  const gapEnd = total * (0.5 + removedFraction / 2);
  const prefix = prefixByLength(path, gapStart / total);
  const suffix = [pointAtLength(path, gapEnd)];
  let travelled = 0;
  for (let index = 1; index < path.length; index += 1) {
    const segmentLength = Math.hypot(path[index].x - path[index - 1].x, path[index].y - path[index - 1].y);
    travelled += segmentLength;
    if (travelled > gapEnd) suffix.push(path[index]);
  }
  return [prefix, suffix];
}

describe("whole-character quadrant and component validation", () => {
  it("ranks hard-gate feasibility ahead of a higher raw alignment score", () => {
    expect(shouldPreferWholeShapeAlignment(
      { gateRatio: 0.99, score: 0.99 },
      { gateRatio: 1.01, score: 0.95 },
    )).toBe(false);
    expect(shouldPreferWholeShapeAlignment(
      { gateRatio: 1.02, score: 0.97 },
      { gateRatio: 1.08, score: 0.96 },
    )).toBe(true);
    expect(shouldPreferWholeShapeAlignment(
      { gateRatio: 0.98, score: 0.9 },
      { gateRatio: 0.92, score: 0.99 },
    )).toBe(true);
  });

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

  it.each([
    ["机", 8],
    ["听", 10],
    ["机", 10],
    ["场", 10],
  ] as const)("does not reject canonical %s rotated %d° as a competitor", (character, degrees) => {
    const reference = getCharacterShapeReference(character)!;
    const radians = degrees * Math.PI / 180;
    const rotated = transformPaths(reference, (point) => ({
      x: 512 + (point.x - 512) * Math.cos(radians) - (point.y - 512) * Math.sin(radians),
      y: 512 + (point.x - 512) * Math.sin(radians) + (point.y - 512) * Math.cos(radians),
    }));
    const assessment = assessWholeCharacterShape(strokesFromPaths(rotated), character, BOUNDS);

    expect(assessment.passed, JSON.stringify({ issues: assessment.issues, metrics: assessment.metrics, alignment: assessment.alignment, competitor: assessment.closestCompetitor })).toBe(true);
  });

  it("allows modest student proportion differences without stretching them away", () => {
    for (const character of SUPPORTED_SHAPE_CHARACTERS) {
      const reference = getCharacterShapeReference(character)!;
      const handVariation = transformPaths(reference, (point, pointIndex, strokeIndex) => ({
        x: 512 + (point.x - 512) * 1.07 + Math.sin(pointIndex + strokeIndex) * 3,
        y: 512 + (point.y - 512) * 0.94 + Math.cos(pointIndex * 2 + strokeIndex) * 3,
      }));
      const assessment = assessWholeCharacterShape(strokesFromPaths(handVariation), character, BOUNDS);
      expect(assessment.passed, `${character}: ${JSON.stringify(assessment.issues)} ${JSON.stringify(assessment.metrics)}`).toBe(true);
    }
  });

  it("allows a small capture gap in an otherwise complete visible line", () => {
    const writing = getCharacterShapeReference("写")!;
    const pathIndex = 3;
    const path = writing[pathIndex];
    const splitIndex = 6;
    const start = path[splitIndex];
    const end = path[splitIndex + 1];
    const beforeGap = {
      x: start.x + (end.x - start.x) * 0.44,
      y: start.y + (end.y - start.y) * 0.44,
    };
    const afterGap = {
      x: start.x + (end.x - start.x) * 0.56,
      y: start.y + (end.y - start.y) * 0.56,
    };
    const withSmallGap = [
      ...writing.slice(0, pathIndex),
      [...path.slice(0, splitIndex + 1), beforeGap],
      [afterGap, ...path.slice(splitIndex + 1)],
      ...writing.slice(pathIndex + 1),
    ];
    const assessment = assessWholeCharacterShape(strokesFromPaths(withSmallGap), "写", BOUNDS);

    expect(assessment.passed, JSON.stringify({ issues: assessment.issues, metrics: assessment.metrics })).toBe(true);
  });

  it("rejects a large gap through a required long visible line", () => {
    const teacher = getCharacterShapeReference("师")!;
    const longLineIndex = teacher.length - 1;
    const longLine = teacher[longLineIndex];
    const segmentIndex = longLine.length - 2;
    const start = longLine[segmentIndex];
    const end = longLine[segmentIndex + 1];
    const firstEdge = {
      x: start.x + (end.x - start.x) * 0.2,
      y: start.y + (end.y - start.y) * 0.2,
    };
    const secondEdge = {
      x: start.x + (end.x - start.x) * 0.8,
      y: start.y + (end.y - start.y) * 0.8,
    };
    const withLargeGap = [
      ...teacher.slice(0, longLineIndex),
      [...longLine.slice(0, segmentIndex + 1), firstEdge],
      [secondEdge, end],
    ];
    const assessment = assessWholeCharacterShape(strokesFromPaths(withLargeGap), "师", BOUNDS);

    expect(assessment.passed).toBe(false);
    expect(assessment.metrics.modelStrokeCoverages.at(-1)).toBeLessThan(
      assessment.metrics.modelStrokeRequiredCoverages.at(-1)!,
    );
    expect(assessment.issues).toContainEqual(expect.objectContaining({ code: "missing-major-shape" }));
  });

  it("uses size and placement as coaching feedback instead of correctness failures", () => {
    const reference = getCharacterShapeReference("写")!;
    const slightlyRight = transformPaths(reference, (point) => ({ ...point, x: point.x + 78 }));
    const warning = assessWholeCharacterShape(strokesFromPaths(slightlyRight), "写", BOUNDS);
    expect(warning.passed).toBe(true);
    expect(warning.issues).toContainEqual(expect.objectContaining({ code: "too-far-right", severity: "warning" }));

    const farRight = transformPaths(reference, (point) => ({ ...point, x: point.x + 170 }));
    const farRightAssessment = assessWholeCharacterShape(strokesFromPaths(farRight), "写", BOUNDS);
    expect(farRightAssessment.passed, JSON.stringify(farRightAssessment.issues)).toBe(true);
    expect(farRightAssessment.issues).toContainEqual(expect.objectContaining({
      code: "too-far-right",
      severity: "warning",
    }));

    const smallAndShifted = transformPaths(reference, (point) => ({
      x: 730 + (point.x - 512) * 0.42,
      y: 300 + (point.y - 512) * 0.42,
    }));
    const small = assessWholeCharacterShape(strokesFromPaths(smallAndShifted), "写", BOUNDS);
    expect(small.passed, JSON.stringify({ issues: small.issues, metrics: small.metrics })).toBe(true);
    expect(small.issues).toContainEqual(expect.objectContaining({ code: "too-small", severity: "warning" }));
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
      message: expect.stringMatching(/口/),
    }));
    expect(withoutMouth.issues.some((issue) => issue.cell?.includes("left"))).toBe(true);
  });

  it("rejects excessive separation between visible components in 听", () => {
    const listening = getCharacterShapeReference("听")!;
    const misplacedRight = listening.map((path, strokeIndex) => path.map((point) => ({
      ...point,
      y: strokeIndex >= 3 ? point.y + 240 : point.y,
    })));
    const assessment = assessWholeCharacterShape(strokesFromPaths(misplacedRight), "听", BOUNDS);

    expect(assessment.passed).toBe(false);
    expect(assessment.issues).toContainEqual(expect.objectContaining({
      code: "missing-major-shape",
      severity: "error",
    }));
  });

  it("rejects a major long line which has been shortened", () => {
    const teacher = getCharacterShapeReference("师")!;
    const shortened = teacher.map((path, strokeIndex) => {
      if (strokeIndex !== teacher.length - 1) return path;
      const anchor = path[0];
      return path.map((point) => ({
        x: anchor.x + (point.x - anchor.x) * 0.38,
        y: anchor.y + (point.y - anchor.y) * 0.38,
      }));
    });
    const assessment = assessWholeCharacterShape(strokesFromPaths(shortened), "师", BOUNDS);

    expect(assessment.passed).toBe(false);
    expect(assessment.metrics.modelStrokeCoverages.at(-1)).toBeLessThan(
      assessment.metrics.modelStrokeRequiredCoverages.at(-1)!,
    );
    expect(assessment.issues).toContainEqual(expect.objectContaining({ code: "missing-major-shape" }));
  });

  it.each([
    ["听", 4, 0.5],
    ["老", 3, 0.6],
    ["飞", 0, 0.4],
  ] as const)("rejects a centered gap in %s model path %d (fraction %f)", (character, pathIndex, removedFraction) => {
    const reference = getCharacterShapeReference(character)!;
    const withGap = [
      ...reference.slice(0, pathIndex),
      ...removeCenteredLength(reference[pathIndex], removedFraction),
      ...reference.slice(pathIndex + 1),
    ];
    const assessment = assessWholeCharacterShape(strokesFromPaths(withGap), character, BOUNDS);

    expect(assessment.passed, JSON.stringify({ issues: assessment.issues, metrics: assessment.metrics })).toBe(false);
    expect(assessment.metrics.modelStrokeCoverages[pathIndex]).toBeLessThan(
      assessment.metrics.modelStrokeRequiredCoverages[pathIndex],
    );
  });

  it("rejects every long official visible path shortened to half length", () => {
    let checkedLongPaths = 0;
    for (const character of SUPPORTED_SHAPE_CHARACTERS) {
      const reference = getCharacterShapeReference(character)!;
      for (let pathIndex = 0; pathIndex < reference.length; pathIndex += 1) {
        const shortened = reference.map((path, index) => (
          index === pathIndex ? prefixByLength(path, 0.5) : path
        ));
        const assessment = assessWholeCharacterShape(strokesFromPaths(shortened), character, BOUNDS);
        if (assessment.metrics.modelStrokeRequiredCoverages[pathIndex] === WHOLE_SHAPE_MIN_MODEL_STROKE_COVERAGE) {
          continue;
        }
        checkedLongPaths += 1;
        expect(
          assessment.passed,
          `${character} path ${pathIndex}: ${JSON.stringify({ issues: assessment.issues, metrics: assessment.metrics })}`,
        ).toBe(false);
        expect(assessment.metrics.modelStrokeCoverages[pathIndex]).toBeLessThan(
          assessment.metrics.modelStrokeRequiredCoverages[pathIndex],
        );
      }
    }
    expect(checkedLongPaths).toBeGreaterThan(0);
  });

  it("rejects a collapsed inner component even when its path count is unchanged", () => {
    const flying = getCharacterShapeReference("飞")!;
    const componentPaths = flying.slice(1);
    const points = componentPaths.flat();
    const centerX = (Math.min(...points.map((point) => point.x)) + Math.max(...points.map((point) => point.x))) / 2;
    const centerY = (Math.min(...points.map((point) => point.y)) + Math.max(...points.map((point) => point.y))) / 2;
    const collapsed = flying.map((path, pathIndex) => path.map((point) => pathIndex === 0 ? point : ({
      x: centerX + (point.x - centerX) * 0.5,
      y: centerY + (point.y - centerY) * 0.5,
    })));
    const assessment = assessWholeCharacterShape(strokesFromPaths(collapsed), "飞", BOUNDS);

    expect(assessment.passed, JSON.stringify({ issues: assessment.issues, metrics: assessment.metrics })).toBe(false);
    expect(assessment.metrics.modelStrokeCoverages.slice(1).some((coverage, index) => (
      coverage < assessment.metrics.modelStrokeRequiredCoverages[index + 1]
    ))).toBe(true);
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

    expect(assessment.passed, JSON.stringify(assessment.metrics)).toBe(false);
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
