import { describe, expect, it } from "vitest";
import { idsLayoutType, parseIds } from "./ids-parser";

describe("IDS parsing", () => {
  it("parses nested binary layouts", () => {
    const node = parseIds("⿰口斤");
    expect(node).toMatchObject({ type: "composition", operator: "⿰" });
    expect(idsLayoutType(node)).toBe("left-right");
  });

  it("parses ternary and enclosure layouts", () => {
    expect(idsLayoutType(parseIds("⿲木口木"))).toBe("left-middle-right");
    expect(idsLayoutType(parseIds("⿴囗玉"))).toBe("enclosure");
  });

  it("rejects incomplete and trailing expressions", () => {
    expect(() => parseIds("⿰口")).toThrow(/ended/);
    expect(() => parseIds("⿰口斤木")).toThrow(/trailing/);
  });
});
