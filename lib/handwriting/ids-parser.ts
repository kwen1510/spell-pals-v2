import type { CharacterLayoutType } from "./character-template";

const BINARY_OPERATORS = new Set(["⿰", "⿱", "⿴", "⿵", "⿶", "⿷", "⿸", "⿹", "⿺", "⿻"]);
const TERNARY_OPERATORS = new Set(["⿲", "⿳"]);

export interface IdsLeaf {
  type: "leaf";
  value: string;
}

export interface IdsComposition {
  type: "composition";
  operator: string;
  children: IdsNode[];
}

export type IdsNode = IdsLeaf | IdsComposition;

function parseAt(tokens: string[], start: number): { node: IdsNode; next: number } {
  const token = tokens[start];
  if (!token) throw new Error("IDS ended before all components were supplied.");
  const childCount = BINARY_OPERATORS.has(token) ? 2 : TERNARY_OPERATORS.has(token) ? 3 : 0;
  if (!childCount) return { node: { type: "leaf", value: token }, next: start + 1 };
  const children: IdsNode[] = [];
  let next = start + 1;
  for (let index = 0; index < childCount; index += 1) {
    const parsed = parseAt(tokens, next);
    children.push(parsed.node);
    next = parsed.next;
  }
  return { node: { type: "composition", operator: token, children }, next };
}

/** Parse one Unicode IDS expression and reject trailing or incomplete data. */
export function parseIds(expression: string): IdsNode {
  const tokens = Array.from(expression.trim());
  if (!tokens.length) throw new Error("IDS is empty.");
  const parsed = parseAt(tokens, 0);
  if (parsed.next !== tokens.length) throw new Error("IDS contains trailing components.");
  return parsed.node;
}

export function idsLayoutType(node: IdsNode): CharacterLayoutType {
  if (node.type === "leaf") return "single";
  if (node.operator === "⿰") return "left-right";
  if (node.operator === "⿱") return "top-bottom";
  if (node.operator === "⿲") return "left-middle-right";
  if (node.operator === "⿳") return "top-middle-bottom";
  if (["⿴", "⿵", "⿶", "⿷", "⿸", "⿹", "⿺", "⿻"].includes(node.operator)) {
    return "enclosure";
  }
  return "unknown";
}
