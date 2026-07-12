import { describe, expect, it } from "vitest";
import {
  createSessionToken,
  passwordMatches,
  SESSION_TTL_SECONDS,
  verifySessionToken,
} from "./session";

describe("password session", () => {
  it("creates a signed token that expires after seven days", () => {
    const now = Date.UTC(2026, 6, 13);
    const token = createSessionToken("teacher secret", now);
    expect(verifySessionToken(token, "teacher secret", now + 1_000)).toBe(true);
    expect(verifySessionToken(token, "teacher secret", now + SESSION_TTL_SECONDS * 1_000)).toBe(false);
  });

  it("rejects a wrong password, modified token, and wrong signing secret", () => {
    const token = createSessionToken("correct");
    expect(passwordMatches("correct", "correct")).toBe(true);
    expect(passwordMatches("wrong", "correct")).toBe(false);
    expect(verifySessionToken(`${token}x`, "correct")).toBe(false);
    expect(verifySessionToken(token, "different")).toBe(false);
  });

  it("rejects malformed tokens", () => {
    expect(verifySessionToken("", "secret")).toBe(false);
    expect(verifySessionToken("v1.tomorrow.signature", "secret")).toBe(false);
    expect(verifySessionToken("v2.9999999999.signature", "secret")).toBe(false);
  });
});
