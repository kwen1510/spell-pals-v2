import { GoogleGenAI } from "@google/genai";
import { PNG } from "pngjs";
import { z } from "zod";
import type { CharacterTemplate } from "./character-template";
import { extractVisualPrimitives, type PrimitivePoint } from "./primitive-analysis";

export const GEMINI_SHAPE_MODEL = "gemini-3.1-pro-preview";

export const geminiShapeAssessmentSchema = z.object({
  verdict: z.enum(["correct_shape", "incorrect_shape", "uncertain"]),
  recognizableAsExpected: z.boolean(),
  allRequiredVisiblePiecesPresent: z.boolean(),
  hasSubstantialExtraMark: z.boolean(),
  components: z.array(z.object({
    id: z.string(),
    label: z.string(),
    status: z.enum(["present", "incomplete", "missing"]),
    issues: z.array(z.string()),
  })),
  missingPieces: z.array(z.object({
    componentId: z.string(),
    description: z.string(),
  })),
  extraPieces: z.array(z.object({
    description: z.string(),
  })),
  summary: z.string(),
});

export type GeminiShapeAssessment = z.infer<typeof geminiShapeAssessmentSchema>;

const RESPONSE_SCHEMA = {
  type: "object",
  additionalProperties: false,
  required: [
    "verdict",
    "recognizableAsExpected",
    "allRequiredVisiblePiecesPresent",
    "hasSubstantialExtraMark",
    "components",
    "missingPieces",
    "extraPieces",
    "summary",
  ],
  properties: {
    verdict: { type: "string", enum: ["correct_shape", "incorrect_shape", "uncertain"] },
    recognizableAsExpected: { type: "boolean" },
    allRequiredVisiblePiecesPresent: { type: "boolean" },
    hasSubstantialExtraMark: { type: "boolean" },
    components: {
      type: "array",
      items: {
        type: "object",
        additionalProperties: false,
        required: ["id", "label", "status", "issues"],
        properties: {
          id: { type: "string" },
          label: { type: "string" },
          status: { type: "string", enum: ["present", "incomplete", "missing"] },
          issues: { type: "array", items: { type: "string" } },
        },
      },
    },
    missingPieces: {
      type: "array",
      items: {
        type: "object",
        additionalProperties: false,
        required: ["componentId", "description"],
        properties: {
          componentId: { type: "string" },
          description: { type: "string" },
        },
      },
    },
    extraPieces: {
      type: "array",
      items: {
        type: "object",
        additionalProperties: false,
        required: ["description"],
        properties: { description: { type: "string" } },
      },
    },
    summary: { type: "string" },
  },
} as const;

export function normalizeShapePaths(paths: readonly (readonly PrimitivePoint[])[]): PrimitivePoint[][] {
  const points = paths.flat();
  if (!points.length) return [];
  const xMin = Math.min(...points.map((point) => point.x));
  const xMax = Math.max(...points.map((point) => point.x));
  const yMin = Math.min(...points.map((point) => point.y));
  const yMax = Math.max(...points.map((point) => point.y));
  const span = Math.max(1e-6, xMax - xMin, yMax - yMin);
  const scale = 0.78 / span;
  const centreX = (xMin + xMax) / 2;
  const centreY = (yMin + yMax) / 2;
  return paths.map((path) => path.map((point) => ({
    x: 0.5 + (point.x - centreX) * scale,
    y: 0.5 + (point.y - centreY) * scale,
  })));
}

function paintCircle(png: PNG, centreX: number, centreY: number, radius: number): void {
  const xMin = Math.max(0, Math.floor(centreX - radius));
  const xMax = Math.min(png.width - 1, Math.ceil(centreX + radius));
  const yMin = Math.max(0, Math.floor(centreY - radius));
  const yMax = Math.min(png.height - 1, Math.ceil(centreY + radius));
  for (let y = yMin; y <= yMax; y += 1) {
    for (let x = xMin; x <= xMax; x += 1) {
      if (Math.hypot(x - centreX, y - centreY) > radius) continue;
      const offset = (png.width * y + x) * 4;
      png.data[offset] = 18;
      png.data[offset + 1] = 66;
      png.data[offset + 2] = 56;
      png.data[offset + 3] = 255;
    }
  }
}

function paintLine(png: PNG, start: PrimitivePoint, end: PrimitivePoint, radius: number): void {
  const x1 = start.x * (png.width - 1);
  const y1 = start.y * (png.height - 1);
  const x2 = end.x * (png.width - 1);
  const y2 = end.y * (png.height - 1);
  const steps = Math.max(1, Math.ceil(Math.hypot(x2 - x1, y2 - y1) * 1.5));
  for (let index = 0; index <= steps; index += 1) {
    const progress = index / steps;
    paintCircle(png, x1 + (x2 - x1) * progress, y1 + (y2 - y1) * progress, radius);
  }
}

export function renderShapePng(paths: readonly (readonly PrimitivePoint[])[], size = 384): Buffer {
  const png = new PNG({ width: size, height: size, colorType: 6 });
  png.data.fill(255);
  const normalized = normalizeShapePaths(paths);
  const radius = Math.max(2.5, size * 0.012);
  for (const path of normalized) {
    if (path.length === 1) paintCircle(png, path[0].x * (size - 1), path[0].y * (size - 1), radius);
    for (let index = 1; index < path.length; index += 1) paintLine(png, path[index - 1], path[index], radius);
  }
  return PNG.sync.write(png);
}

function componentEvidence(template: CharacterTemplate) {
  return template.components.map((component) => ({
    id: component.id,
    label: component.label,
    position: component.position,
    required: component.required,
    expectedVisiblePaths: component.expectedStrokeIndexes.map((strokeIndex) => {
      const stroke = template.modelStrokes[strokeIndex];
      return {
        strokeIndex,
        criticality: stroke?.criticality ?? "unknown",
        primitiveTypes: stroke?.primitiveTypes ?? [],
        relativeLength: stroke ? Number(stroke.length.toFixed(3)) : 0,
      };
    }),
  }));
}

export function buildGeminiShapePrompt(
  template: CharacterTemplate,
  studentPaths: readonly (readonly PrimitivePoint[])[],
): string {
  const normalizedStudent = normalizeShapePaths(studentPaths);
  const studentPrimitives = extractVisualPrimitives(normalizedStudent.map((points, index) => ({
    id: `movement-${index}`,
    points,
  }))).map((piece) => ({
    type: Object.entries(piece.typeProbabilities).sort((left, right) => (right[1] ?? 0) - (left[1] ?? 0))[0]?.[0] ?? "unknown",
    relativeLength: Number(piece.length.toFixed(3)),
    centre: { x: Number(piece.centre.x.toFixed(3)), y: Number(piece.centre.y.toFixed(3)) },
  }));
  return `You are evaluating whether a primary-school student's handwritten Chinese character contains all required VISIBLE SHAPES.

Expected character: ${template.character}
IDS/layout: ${template.layout.ids ?? template.layout.type}

The first image is the student's ink, normalized uniformly and centred. The second image is the official Make Me a Hanzi-derived median skeleton, also normalized uniformly and centred.

Important grading policy:
- Judge visible lines, curves, hooks, turns, enclosures, and components. Do NOT require official pen-lift count or stroke order.
- A square such as 口 may be drawn as one continuous loop or several movements; it passes if its visible enclosure is complete.
- Ignore whole-character translation, overall size, minor rotation, ordinary handwriting wobble, and small connection gaps.
- Fail when a required visible line/curve/component is absent, a characteristically long line is reduced to a short mark, a required connection has a large gap, or there is a substantial unrelated extra line.
- Do not excuse a missing piece merely because the character is recognizable or because the expected answer is supplied.
- Do not compare calligraphic beauty. Students are not calligraphers.
- If the images or evidence do not support a reliable decision, return uncertain rather than guessing.

Grounding component tree and expected paths:
${JSON.stringify(componentEvidence(template), null, 2)}

Target-independent primitive summary extracted from the student's raw paths:
${JSON.stringify(studentPrimitives, null, 2)}

Return the required JSON assessment. Every component id in the component tree must appear exactly once in components.`;
}

export async function assessShapeWithGemini(args: {
  apiKey: string;
  template: CharacterTemplate;
  studentPaths: readonly (readonly PrimitivePoint[])[];
  signal?: AbortSignal;
}): Promise<GeminiShapeAssessment> {
  const client = new GoogleGenAI({ apiKey: args.apiKey });
  const response = await client.interactions.create({
    model: GEMINI_SHAPE_MODEL,
    store: false,
    system_instruction: "Be conservative and evidence-based. The expected answer is context, not proof that the student wrote it correctly.",
    input: [
      { type: "text", text: buildGeminiShapePrompt(args.template, args.studentPaths) },
      { type: "image", data: renderShapePng(args.studentPaths).toString("base64"), mime_type: "image/png" },
      { type: "image", data: renderShapePng(args.template.modelStrokes.map((stroke) => stroke.median)).toString("base64"), mime_type: "image/png" },
    ],
    response_format: { type: "text", mime_type: "application/json", schema: RESPONSE_SCHEMA },
    generation_config: { temperature: 0 },
  }, { signal: args.signal });
  if (!response.output_text) throw new Error("Gemini returned no structured assessment.");
  return geminiShapeAssessmentSchema.parse(JSON.parse(response.output_text));
}
