import type { SupportedShapeCharacter } from "./character-shape-references";

export type CharacterComponentPosition = "left" | "right" | "upper" | "lower" | "main" | "inside";

export interface CharacterComponentDefinition {
  id: string;
  /** Short teacher-facing name. Chinese labels are used where a conventional component exists. */
  label: string;
  position: CharacterComponentPosition;
  /** Indices in the pinned official median-stroke array. */
  strokeIndices: readonly number[];
}

/**
 * Structural groups for the seven supported characters.  These are reference
 * stroke groups only: captured strokes are never assigned to a component, so
 * a student may join or split pen strokes without changing component grading.
 */
const CHARACTER_COMPONENTS: Record<SupportedShapeCharacter, readonly CharacterComponentDefinition[]> = {
  "听": [
    { id: "mouth", label: "口", position: "left", strokeIndices: [0, 1, 2] },
    { id: "axe", label: "斤", position: "right", strokeIndices: [3, 4, 5, 6] },
  ],
  "写": [
    { id: "cover", label: "冖", position: "upper", strokeIndices: [0, 1] },
    { id: "yu", label: "与", position: "lower", strokeIndices: [2, 3, 4] },
  ],
  "老": [
    { id: "old-top", label: "耂", position: "upper", strokeIndices: [0, 1, 2, 3] },
    { id: "spoon", label: "匕", position: "lower", strokeIndices: [4, 5] },
  ],
  "师": [
    { id: "left-strokes", label: "left strokes", position: "left", strokeIndices: [0, 1] },
    { id: "za", label: "帀", position: "right", strokeIndices: [2, 3, 4, 5] },
  ],
  "飞": [
    { id: "main-hook", label: "main hook", position: "main", strokeIndices: [0] },
    { id: "inside-strokes", label: "inside strokes", position: "inside", strokeIndices: [1, 2] },
  ],
  "机": [
    { id: "wood", label: "木", position: "left", strokeIndices: [0, 1, 2, 3] },
    { id: "table", label: "几", position: "right", strokeIndices: [4, 5] },
  ],
  "场": [
    { id: "earth", label: "土", position: "left", strokeIndices: [0, 1, 2] },
    { id: "right-side", label: "right side", position: "right", strokeIndices: [3, 4, 5] },
  ],
};

export function getCharacterComponents(character: string): readonly CharacterComponentDefinition[] {
  return CHARACTER_COMPONENTS[character as SupportedShapeCharacter] ?? [];
}
