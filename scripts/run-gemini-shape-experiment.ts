import { getCharacterTemplate } from "../lib/handwriting/character-template";
import { assessShapeWithGemini, GEMINI_SHAPE_MODEL } from "../lib/handwriting/gemini-shape-experiment";
import { assessRoughShape } from "../lib/handwriting/rough-shape-matcher";
import type { PrimitivePoint } from "../lib/handwriting/primitive-analysis";

async function main() {
const apiKey = process.env.GEMINI_API_KEY?.trim();
if (!apiKey) throw new Error("GEMINI_API_KEY is not configured.");

const template = getCharacterTemplate("听");
if (!template) throw new Error("Missing 听 template.");

const canonical = template.modelStrokes.map((stroke) => stroke.median);
const mouth = template.components.find((component) => component.label === "口");
if (!mouth) throw new Error("Missing 口 component.");
const continuousMouth: PrimitivePoint[] = [
  { x: mouth.expectedRegion.xMin, y: mouth.expectedRegion.yMin },
  { x: mouth.expectedRegion.xMax, y: mouth.expectedRegion.yMin },
  { x: mouth.expectedRegion.xMax, y: mouth.expectedRegion.yMax },
  { x: mouth.expectedRegion.xMin, y: mouth.expectedRegion.yMax },
  { x: mouth.expectedRegion.xMin, y: mouth.expectedRegion.yMin },
];
const rightSide = template.modelStrokes
  .filter((stroke) => stroke.componentId !== mouth.id)
  .map((stroke) => stroke.median);

const cases: Array<{
  name: string;
  paths: PrimitivePoint[][];
  expectedGemini: "correct_shape" | "incorrect_shape";
}> = [
  { name: "official complete median", paths: canonical, expectedGemini: "correct_shape" },
  {
    name: "missing bottom line of 口",
    paths: template.modelStrokes.filter((stroke) => stroke.index !== 2).map((stroke) => stroke.median),
    expectedGemini: "incorrect_shape",
  },
  {
    name: "continuous one-movement 口",
    paths: [continuousMouth, ...rightSide],
    expectedGemini: "correct_shape",
  },
  {
    name: "modest student distortion",
    paths: canonical.map((path) => path.map((point) => ({
      x: point.x * 1.08 + 0.12,
      y: point.y * 0.94 - 0.08,
    }))),
    expectedGemini: "correct_shape",
  },
  {
    name: "substantial unrelated extra line",
    paths: [...canonical, [{ x: 0.04, y: 0.94 }, { x: 0.96, y: 0.08 }]],
    expectedGemini: "incorrect_shape",
  },
];

const results = [];
for (const testCase of cases) {
  const deterministic = assessRoughShape(template, testCase.paths);
  const startedAt = Date.now();
  const gemini = await assessShapeWithGemini({
    apiKey,
    template,
    studentPaths: testCase.paths,
    signal: AbortSignal.timeout(90_000),
  });
  results.push({
    case: testCase.name,
    expected: testCase.expectedGemini,
    gemini: gemini.verdict,
    geminiAgreed: gemini.verdict === testCase.expectedGemini,
    deterministic: deterministic.passed ? "correct_shape" : "incorrect_shape",
    requiredPiecesPresent: gemini.allRequiredVisiblePiecesPresent,
    substantialExtra: gemini.hasSubstantialExtraMark,
    summary: gemini.summary,
    elapsedMs: Date.now() - startedAt,
  });
}

console.log(JSON.stringify({
  model: GEMINI_SHAPE_MODEL,
  thinkingLevel: "minimal",
  temperature: 0,
  cases: results,
  agreement: `${results.filter((result) => result.geminiAgreed).length}/${results.length}`,
}, null, 2));
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : "Gemini experiment failed.");
  process.exitCode = 1;
});
