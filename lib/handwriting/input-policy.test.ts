import { describe, expect, it } from "vitest";
import { shouldIgnoreTouchInput } from "./input-policy";

describe("iPad input policy", () => {
  it("always rejects palm and finger contacts in pen-only mode", () => {
    expect(shouldIgnoreTouchInput({ pointerType: "touch", width: 8, height: 8 }, { stylusOnly: true, millisecondsSincePen: Infinity })).toBe(true);
  });

  it("rejects a palm shortly after Pencil input", () => {
    expect(shouldIgnoreTouchInput({ pointerType: "touch", width: 8, height: 8 }, { stylusOnly: false, millisecondsSincePen: 200 })).toBe(true);
  });

  it("rejects a broad palm contact but allows an intentional finger", () => {
    expect(shouldIgnoreTouchInput({ pointerType: "touch", width: 48, height: 35 }, { stylusOnly: false, millisecondsSincePen: Infinity })).toBe(true);
    expect(shouldIgnoreTouchInput({ pointerType: "touch", width: 10, height: 10 }, { stylusOnly: false, millisecondsSincePen: Infinity })).toBe(false);
  });

  it("never rejects Pencil input", () => {
    expect(shouldIgnoreTouchInput({ pointerType: "pen", width: 50, height: 50 }, { stylusOnly: true, millisecondsSincePen: 0 })).toBe(false);
  });
});
