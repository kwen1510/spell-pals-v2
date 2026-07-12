import {
  getCharacterShapeReference,
  SUPPORTED_SHAPE_CHARACTERS,
  type ShapePoint,
  type SupportedShapeCharacter,
} from "./character-shape-references";
import {
  getCharacterComponents,
  type CharacterComponentPosition,
} from "./character-components";
import { getShapeCompetitors, type ShapeCompetitorSource } from "./shape-competitors";
import { pathLength } from "./shape-geometry";
import { extractVisualPrimitives, type PrimitiveType } from "./primitive-analysis";
import { idsLayoutType, parseIds } from "./ids-parser";

export interface NormalizedBounds {
  xMin: number;
  yMin: number;
  xMax: number;
  yMax: number;
}

export type CharacterLayoutType =
  | "single"
  | "left-right"
  | "top-bottom"
  | "left-middle-right"
  | "top-middle-bottom"
  | "enclosure"
  | "nested"
  | "unknown";

export type TemplateSource = "deterministic" | "reviewed" | "gemini_fallback";
export type ModelStrokeCriticality = "low" | "medium" | "high";

export interface CharacterTemplateComponent {
  id: string;
  label: string;
  position: CharacterComponentPosition;
  expectedRegion: NormalizedBounds;
  allowedRegion: NormalizedBounds;
  expectedStrokeIndexes: number[];
  required: boolean;
  weight: number;
}

export interface CharacterTemplateStroke {
  index: number;
  median: ShapePoint[];
  bounds: NormalizedBounds;
  centre: ShapePoint;
  length: number;
  componentId: string | null;
  criticality: ModelStrokeCriticality;
  primitiveTypes: PrimitiveType[];
}

export interface CharacterCriticalFeature {
  id: string;
  type: "required_path" | "required_component" | "relative_layout";
  componentId?: string;
  strokeIndex?: number;
  criticality: "medium" | "high";
}

export interface CharacterConfusionRule {
  competingCharacter: string;
  source: ShapeCompetitorSource;
  distinguishingFeatures: string[];
}

export interface CharacterToleranceOverrides {
  shortPathCoverageMinimum?: number;
  longPathCoverageMinimum?: number;
  longPathLength?: number;
  competitorBetterBy?: number;
  majorUnmatchedRunRatio?: number;
}

export interface CharacterTemplate {
  character: string;
  version: number;
  datasetRevision: string;
  source: TemplateSource;
  confidence: number;
  layout: {
    ids?: string;
    type: CharacterLayoutType;
  };
  modelBounds: NormalizedBounds;
  components: CharacterTemplateComponent[];
  modelStrokes: CharacterTemplateStroke[];
  criticalFeatures: CharacterCriticalFeature[];
  confusionRules: CharacterConfusionRule[];
  tolerances: CharacterToleranceOverrides;
}

const DATASET_REVISION = "hanzi-writer-data@68d10a4b21150cae5e1ebbd223eed289cf32d90c";

const REVIEWED_LAYOUTS: Record<SupportedShapeCharacter, CharacterTemplate["layout"]> = {
  "听": { type: "left-right", ids: "⿰口斤" },
  "写": { type: "top-bottom", ids: "⿱冖与" },
  "老": { type: "top-bottom", ids: "⿱耂匕" },
  "师": { type: "left-right", ids: "⿰丨帀" },
  "飞": { type: "single" },
  "机": { type: "left-right", ids: "⿰木几" },
  "场": { type: "left-right", ids: "⿰土昜" },
};

const DISTINGUISHING_FEATURES: Partial<Record<SupportedShapeCharacter, Record<string, string[]>>> = {
  "听": { "昕": ["口 has no internal horizontal", "斤 remains on the right"] },
  "师": { "帅": ["帀 contains its full right-side structure"] },
  "机": { "杌": ["几, rather than 兀, forms the right component"] },
  "场": {
    "扬": ["土 remains the left component"],
    "汤": ["土, rather than water dots, remains on the left"],
  },
};

const templateCache = new Map<string, CharacterTemplate>();

function clamp01(value: number): number {
  return Math.max(0, Math.min(1, value));
}

function pathBounds(paths: readonly (readonly ShapePoint[])[]): NormalizedBounds {
  const points = paths.flat();
  if (!points.length) return { xMin: 0, yMin: 0, xMax: 1, yMax: 1 };
  return {
    xMin: clamp01(Math.min(...points.map((point) => point.x))),
    yMin: clamp01(Math.min(...points.map((point) => point.y))),
    xMax: clamp01(Math.max(...points.map((point) => point.x))),
    yMax: clamp01(Math.max(...points.map((point) => point.y))),
  };
}

function padBounds(bounds: NormalizedBounds, padding: number): NormalizedBounds {
  return {
    xMin: clamp01(bounds.xMin - padding),
    yMin: clamp01(bounds.yMin - padding),
    xMax: clamp01(bounds.xMax + padding),
    yMax: clamp01(bounds.yMax + padding),
  };
}

function normalizePaths(paths: ShapePoint[][]): ShapePoint[][] {
  return paths.map((path) => path.map((point) => ({ x: point.x / 1024, y: point.y / 1024 })));
}

function strokeCriticality(length: number): ModelStrokeCriticality {
  if (length >= 0.22) return "high";
  if (length >= 0.11) return "medium";
  return "low";
}

function buildTemplate(character: SupportedShapeCharacter): CharacterTemplate | null {
  const rawPaths = getCharacterShapeReference(character);
  if (!rawPaths) return null;
  const medians = normalizePaths(rawPaths);
  const definitions = getCharacterComponents(character);
  const componentForStroke = new Map<number, string>();
  definitions.forEach((component) => component.strokeIndices.forEach((index) => {
    componentForStroke.set(index, component.id);
  }));

  const components = definitions.map((component): CharacterTemplateComponent => {
    const componentPaths = component.strokeIndices
      .map((index) => medians[index])
      .filter((path): path is ShapePoint[] => Boolean(path));
    const expectedRegion = pathBounds(componentPaths);
    return {
      id: component.id,
      label: component.label,
      position: component.position,
      expectedRegion,
      allowedRegion: padBounds(expectedRegion, 0.18),
      expectedStrokeIndexes: [...component.strokeIndices],
      required: true,
      weight: 1 / Math.max(1, definitions.length),
    };
  });

  const modelStrokes = medians.map((median, index): CharacterTemplateStroke => {
    const bounds = pathBounds([median]);
    const length = pathLength(median);
    return {
      index,
      median,
      bounds,
      centre: {
        x: (bounds.xMin + bounds.xMax) / 2,
        y: (bounds.yMin + bounds.yMax) / 2,
      },
      length,
      componentId: componentForStroke.get(index) ?? null,
      criticality: strokeCriticality(length),
      primitiveTypes: Array.from(new Set(
        extractVisualPrimitives([{ id: `model-${index}`, points: median }])
          .flatMap((primitive) => Object.entries(primitive.typeProbabilities)
            .filter(([, probability]) => (probability ?? 0) >= 0.6)
            .map(([type]) => type as PrimitiveType)),
      )),
    };
  });

  const criticalFeatures: CharacterCriticalFeature[] = [
    ...components.map((component) => ({
      id: `component:${component.id}`,
      type: "required_component" as const,
      componentId: component.id,
      criticality: "high" as const,
    })),
    ...modelStrokes
      .filter((stroke) => stroke.criticality === "high")
      .map((stroke) => ({
        id: `path:${stroke.index}`,
        type: "required_path" as const,
        strokeIndex: stroke.index,
        criticality: "high" as const,
      })),
  ];

  const reviewedConfusions = DISTINGUISHING_FEATURES[character] ?? {};
  const confusionRules = getShapeCompetitors(character).map((competitor): CharacterConfusionRule => ({
    competingCharacter: competitor.character,
    source: competitor.source,
    distinguishingFeatures: reviewedConfusions[competitor.character] ?? [],
  }));

  return {
    character,
    version: 1,
    datasetRevision: DATASET_REVISION,
    source: "reviewed",
    confidence: 1,
    layout: {
      ...REVIEWED_LAYOUTS[character],
      type: REVIEWED_LAYOUTS[character].ids
        ? idsLayoutType(parseIds(REVIEWED_LAYOUTS[character].ids))
        : REVIEWED_LAYOUTS[character].type,
    },
    modelBounds: pathBounds(medians),
    components,
    modelStrokes,
    criticalFeatures,
    confusionRules,
    tolerances: {},
  };
}

/** Return a stable cached template. Reviewed templates override future generators. */
export function getCharacterTemplate(character: string): CharacterTemplate | null {
  if (!SUPPORTED_SHAPE_CHARACTERS.includes(character as SupportedShapeCharacter)) return null;
  const key = `${character}:1:${DATASET_REVISION}`;
  const cached = templateCache.get(key);
  if (cached) return cached;
  const template = buildTemplate(character as SupportedShapeCharacter);
  if (template) templateCache.set(key, template);
  return template;
}

export function clearCharacterTemplateCache(): void {
  templateCache.clear();
}
