import { describe, expect, it } from "vitest";
import { getCharacterShapeReference, SUPPORTED_SHAPE_CHARACTERS, type ShapePoint } from "./character-shape-references";
import {
  AVERAGE_DISTANCE_LIMIT,
  assessCharacterShape,
  MAX_LENGTH_RATIO,
  type CharacterBounds,
} from "./shape-validator";
import type { Stroke } from "./types";

const BOUNDS: CharacterBounds = { x: 80, y: 40, width: 512, height: 512 };

const CONFUSABLE_YANG: ShapePoint[][] = [
  [[135,546],[201,546],[372,598],[425,603]],
  [[300,810],[325,795],[345,764],[329,437],[329,134],[322,103],[304,71],[279,78],[195,118],[176,134],[165,135]],
  [[63,262],[106,257],[386,448]],
  [[443,685],[484,675],[537,683],[665,717],[693,701],[646,614],[559,484],[551,457],[587,451],[823,497],[853,495],[871,486],[888,463],[872,347],[842,228],[812,146],[775,81],[749,49],[722,31],[646,80],[626,87]],
  [[570,423],[590,399],[549,322],[486,244],[423,193]],
  [[687,453],[718,427],[717,420],[694,356],[651,274],[601,196],[559,145],[510,95],[473,64],[462,63],[458,54]],
].map((stroke) => stroke.map(([x, y]) => ({ x, y: 900 - y })));

const CONFUSABLE_TANG: ShapePoint[][] = [
  [[253,763],[340,704],[362,664]],
  [[178,554],[254,495],[269,469]],
  [[219,34],[207,65],[204,114],[233,162],[348,398]],
  [[449,710],[496,698],[658,735],[678,734],[699,716],[647,643],[543,526],[510,481],[499,455],[535,449],[811,498],[836,496],[857,486],[874,466],[857,332],[833,232],[799,129],[768,76],[742,45],[718,29],[614,95]],
  [[529,423],[549,405],[550,394],[523,335],[460,246],[415,202],[390,186]],
  [[677,461],[712,429],[676,332],[638,258],[555,142],[491,76],[462,52],[449,49],[446,41]],
].map((stroke) => stroke.map(([x, y]) => ({ x, y: 900 - y })));

function screenPoint(point: ShapePoint, bounds = BOUNDS): ShapePoint {
  return {
    x: bounds.x + (point.x / 1024) * bounds.width,
    y: bounds.y + (point.y / 1024) * bounds.height,
  };
}

function strokesFromPaths(paths: ShapePoint[][], bounds = BOUNDS, pointInterval = 12): Stroke[] {
  let timestamp = 100;
  return paths.map((path, strokeIndex) => {
    timestamp += 180;
    return {
      id: `stroke-${strokeIndex}`,
      width: 5,
      points: path.map((point) => ({
        ...screenPoint(point, bounds),
        timestamp: timestamp += pointInterval,
        pressure: 0.5,
      })),
    };
  });
}

function canonical(character: string, bounds = BOUNDS): Stroke[] {
  const reference = getCharacterShapeReference(character);
  if (!reference) throw new Error(`Missing test reference for ${character}`);
  return strokesFromPaths(reference, bounds);
}

function transformPaths(
  paths: ShapePoint[][],
  transform: (point: ShapePoint, pointIndex: number, strokeIndex: number) => ShapePoint,
): ShapePoint[][] {
  return paths.map((path, strokeIndex) => path.map((point, pointIndex) => transform(point, pointIndex, strokeIndex)));
}

function densifyPaths(paths: ShapePoint[][]): ShapePoint[][] {
  return paths.map((path, strokeIndex) => path.flatMap((point, pointIndex) => {
    const next = path[pointIndex + 1];
    if (!next) return [point];
    return Array.from({ length: 10 }, (_, sample) => {
      const progress = sample / 10;
      const jitter = Math.sin((strokeIndex + 1) * (pointIndex + 1) * (sample + 1)) * 0.7;
      return {
        x: point.x + (next.x - point.x) * progress + jitter,
        y: point.y + (next.y - point.y) * progress - jitter,
      };
    });
  }));
}

describe("target-aware character shape validation", () => {
  it("accepts the official median geometry for all seven supported characters", () => {
    for (const character of SUPPORTED_SHAPE_CHARACTERS) {
      const assessment = assessCharacterShape(canonical(character), character, BOUNDS);
      expect(assessment.passed, `${character}: ${JSON.stringify(assessment.matches)}`).toBe(true);
      expect(assessment.failureReasons, character).toEqual([]);
      expect(assessment.repairApplied, character).toBe("none");
      expect(assessment.matches, character).toHaveLength(assessment.expectedStrokeCount);
    }
  });

  it("accepts natural translation, scale, light jitter, and fast Pencil timing", () => {
    for (const character of SUPPORTED_SHAPE_CHARACTERS) {
      const reference = getCharacterShapeReference(character)!;
      const natural = transformPaths(reference, (point, pointIndex, strokeIndex) => ({
        x: 512 + (point.x - 512) * 0.94 + 18 + Math.sin((strokeIndex + 1) * (pointIndex + 1)) * 2,
        y: 512 + (point.y - 512) * 0.94 - 12 + Math.cos((strokeIndex + 1) * (pointIndex + 1)) * 2,
      }));
      const assessment = assessCharacterShape(strokesFromPaths(densifyPaths(natural), BOUNDS, 2), character, BOUNDS);
      expect(assessment.passed, `${character}: ${JSON.stringify(assessment.matches)}`).toBe(true);
    }
  });

  it("allows a different stroke order but reports it", () => {
    const strokes = canonical("听");
    const reordered = [strokes[2], strokes[0], strokes[1], strokes[4], strokes[3], strokes[6], strokes[5]];
    const assessment = assessCharacterShape(reordered, "听", BOUNDS);
    expect(assessment.passed).toBe(true);
    expect(assessment.strokeOrderWarning).toBe(true);
    expect(assessment.matches.map((match) => match.expectedIndex)).toEqual([2, 0, 1, 4, 3, 6, 5]);
  });

  it("rejects missing, extra, and multiple-repair stroke counts", () => {
    const strokes = canonical("老");
    const missing = assessCharacterShape(strokes.slice(0, -1), "老", BOUNDS);
    expect(missing.passed).toBe(false);
    expect(missing.failureReasons).toContain("missing-stroke");

    const extraStroke = { ...strokes[0], id: "extra", points: strokes[0].points.map((point) => ({ ...point, timestamp: point.timestamp + 5_000 })) };
    const extra = assessCharacterShape([...strokes, extraStroke], "老", BOUNDS);
    expect(extra.passed).toBe(false);
    expect(extra.failureReasons).toContain("extra-stroke");

    const twoExtra = assessCharacterShape([...strokes, extraStroke, { ...extraStroke, id: "extra-2" }], "老", BOUNDS);
    expect(twoExtra.passed).toBe(false);
    expect(twoExtra.repairApplied).toBe("none");
    expect(twoExtra.failureReasons).toContain("extra-stroke");
  });

  it("rejects an incomplete one-line 师 and a malformed 老", () => {
    const incomplete = assessCharacterShape(canonical("师").slice(0, 1), "师", BOUNDS);
    expect(incomplete.passed).toBe(false);
    expect(incomplete.failureReasons).toContain("missing-stroke");

    const malformed = canonical("老");
    malformed[4] = {
      ...malformed[4],
      points: malformed[4].points.map((point) => ({ ...point, x: point.x - BOUNDS.width * 0.32 })),
    };
    const assessment = assessCharacterShape(malformed, "老", BOUNDS);
    expect(assessment.passed).toBe(false);
    expect(assessment.failureReasons).toContain("misplaced-stroke");
  });

  it("rejects reversed, shortened, displaced, and incorrectly curved strokes", () => {
    const reversed = canonical("写");
    reversed[3] = { ...reversed[3], points: [...reversed[3].points].reverse() };
    const reversedAssessment = assessCharacterShape(reversed, "写", BOUNDS);
    expect(reversedAssessment.passed).toBe(false);
    expect(reversedAssessment.failureReasons).toContain("wrong-direction");

    const shortened = canonical("写");
    const first = shortened[3].points[0];
    const second = shortened[3].points[1];
    shortened[3] = {
      ...shortened[3],
      points: [first, { ...second, x: first.x + (second.x - first.x) * 0.15, y: first.y + (second.y - first.y) * 0.15 }],
    };
    const shortAssessment = assessCharacterShape(shortened, "写", BOUNDS);
    expect(shortAssessment.passed).toBe(false);
    expect(shortAssessment.failureReasons).toContain("shortened-stroke");

    const displaced = canonical("机");
    displaced[3] = { ...displaced[3], points: displaced[3].points.map((point) => ({ ...point, y: point.y + BOUNDS.height * 0.35 })) };
    const displacedAssessment = assessCharacterShape(displaced, "机", BOUNDS);
    expect(displacedAssessment.passed).toBe(false);
    expect(displacedAssessment.failureReasons).toContain("misplaced-stroke");

    const curved = canonical("场");
    const curveStart = curved[0].points[0];
    const curveEnd = curved[0].points.at(-1)!;
    curved[0] = {
      ...curved[0],
      points: [curveStart, {
        x: (curveStart.x + curveEnd.x) / 2,
        y: (curveStart.y + curveEnd.y) / 2 - BOUNDS.height * 0.38,
        timestamp: (curveStart.timestamp + curveEnd.timestamp) / 2,
      }, curveEnd],
    };
    const curveAssessment = assessCharacterShape(curved, "场", BOUNDS);
    expect(curveAssessment.passed).toBe(false);
    expect(curveAssessment.failureReasons).toContain("wrong-curve");
  });

  it("repairs exactly one conservative accidental lift", () => {
    const strokes = canonical("听");
    const source = strokes[4];
    const splitIndex = 3;
    const first: Stroke = { ...source, id: "lift-a", points: source.points.slice(0, splitIndex + 1).map((point) => ({ ...point })) };
    const lastTime = first.points.at(-1)!.timestamp;
    const second: Stroke = {
      ...source,
      id: "lift-b",
      points: source.points.slice(splitIndex).map((point, index) => ({ ...point, timestamp: lastTime + 50 + index * 12 })),
    };
    const assessment = assessCharacterShape([...strokes.slice(0, 4), first, second, ...strokes.slice(5)], "听", BOUNDS);
    expect(assessment.passed).toBe(true);
    expect(assessment.rawStrokeCount).toBe(8);
    expect(assessment.assessedStrokeCount).toBe(7);
    expect(assessment.repairApplied).toBe("merge");
  });

  it("repairs exactly one conservative paused join", () => {
    const strokes = canonical("飞");
    const firstPart = strokes[1].points.map((point) => ({ ...point }));
    const secondPart = strokes[2].points.map((point) => ({ ...point }));
    const previous = firstPart.at(-1)!;
    const start = secondPart[0];
    const dx = start.x - previous.x;
    const dy = start.y - previous.y;
    const distance = Math.hypot(dx, dy);
    // Bring the bridge just inside 4% of the square without materially changing the stroke.
    secondPart[0] = { ...start, x: previous.x + dx * (19.5 / distance), y: previous.y + dy * (19.5 / distance), timestamp: previous.timestamp + 110 };
    for (let index = 1; index < secondPart.length; index += 1) secondPart[index].timestamp = secondPart[index - 1].timestamp + 12;
    const joined: Stroke = { id: "paused-join", width: 5, points: [...firstPart, ...secondPart] };
    const assessment = assessCharacterShape([strokes[0], joined], "飞", BOUNDS);
    expect(assessment.passed).toBe(true);
    expect(assessment.rawStrokeCount).toBe(2);
    expect(assessment.assessedStrokeCount).toBe(3);
    expect(assessment.repairApplied).toBe("split");
  });

  it("does not split a join without a pause or merge an incompatible lift", () => {
    const flying = canonical("飞");
    const noPauseJoin: Stroke = {
      id: "no-pause",
      width: 5,
      points: [...flying[1].points, ...flying[2].points.map((point, index) => ({
        ...point,
        timestamp: flying[1].points.at(-1)!.timestamp + (index + 1) * 12,
      }))],
    };
    const noSplit = assessCharacterShape([flying[0], noPauseJoin], "飞", BOUNDS);
    expect(noSplit.passed).toBe(false);
    expect(noSplit.repairApplied).toBe("none");
    expect(noSplit.failureReasons).toContain("missing-stroke");

    const listening = canonical("听");
    const source = listening[4];
    const first: Stroke = { ...source, id: "bad-lift-a", points: source.points.slice(0, 4) };
    const secondPoints = source.points.slice(3).map((point) => ({ ...point }));
    secondPoints[1] = { ...secondPoints[1], x: secondPoints[0].x - 80, timestamp: secondPoints[0].timestamp + 20 };
    const second: Stroke = { ...source, id: "bad-lift-b", points: secondPoints };
    const noMerge = assessCharacterShape([...listening.slice(0, 4), first, second, ...listening.slice(5)], "听", BOUNDS);
    expect(noMerge.passed).toBe(false);
    expect(noMerge.repairApplied).toBe("none");
    expect(noMerge.failureReasons).toContain("extra-stroke");
  });

  it("does not manufacture validity from corner-split scribbles", () => {
    const timestamp = 100;
    const scribble: Stroke = {
      id: "scribble",
      width: 5,
      points: [
        { x: 120, y: 120, timestamp },
        { x: 500, y: 120, timestamp: timestamp + 10 },
        { x: 500, y: 480, timestamp: timestamp + 20 },
        { x: 120, y: 480, timestamp: timestamp + 30 },
      ],
    };
    const assessment = assessCharacterShape([scribble], "写", BOUNDS);
    expect(assessment.passed).toBe(false);
    expect(assessment.repairApplied).toBe("none");
    expect(assessment.failureReasons).toContain("missing-stroke");
  });

  it("rejects known 扬/汤 to 场 recognition confusables", () => {
    const raisedHand = assessCharacterShape(strokesFromPaths(CONFUSABLE_YANG), "场", BOUNDS);
    expect(raisedHand.passed).toBe(false);
    expect(raisedHand.failureReasons).toContain("overlong-stroke");
    expect(raisedHand.matches.some((match) => match.metrics.lengthRatio > MAX_LENGTH_RATIO)).toBe(true);

    const soup = assessCharacterShape(strokesFromPaths(CONFUSABLE_TANG), "场", BOUNDS);
    expect(soup.passed).toBe(false);
    expect(soup.failureReasons.length).toBeGreaterThan(0);
  });

  it("fails closed for missing references, invalid points, and stretched bounds", () => {
    expect(assessCharacterShape([], "水", BOUNDS).failureReasons).toEqual(["missing-reference"]);

    const invalid = canonical("飞");
    invalid[0].points[0].x = Number.NaN;
    const invalidAssessment = assessCharacterShape(invalid, "飞", BOUNDS);
    expect(invalidAssessment.passed).toBe(false);
    expect(invalidAssessment.failureReasons).toContain("invalid-input");

    const stretched = assessCharacterShape(canonical("飞"), "飞", { ...BOUNDS, width: 700 });
    expect(stretched.passed).toBe(false);
    expect(stretched.failureReasons).toEqual(["invalid-input"]);
  });

  it("returns faithful 0..1024 display polylines and per-stroke diagnostics", () => {
    const assessment = assessCharacterShape(canonical("写"), "写", BOUNDS);
    expect(assessment.studentPaths).toEqual(assessment.referencePaths);
    expect(assessment.studentPaths.flat().every((point) => point.x >= 0 && point.x <= 1024 && point.y >= 0 && point.y <= 1024)).toBe(true);
    expect(assessment.matches.every((match) => match.passed && match.failureReasons.length === 0)).toBe(true);
    expect(assessment.matches[0].metrics.averageDistance).toBeLessThan(AVERAGE_DISTANCE_LIMIT);
    expect(assessment.matches[0].metrics).toMatchObject({ startDistance: 0, endDistance: 0, frechetDistance: 0, lengthRatio: 1 });
  });
});
