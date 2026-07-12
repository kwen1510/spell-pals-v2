import { NextRequest } from "next/server";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { SESSION_COOKIE_NAME, verifySessionToken } from "../../../../lib/auth/session";
import { POST } from "./route";

function loginRequest(password: unknown) {
  return new NextRequest("https://example.test/api/auth/login", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "X-Forwarded-For": `test-${crypto.randomUUID()}`,
    },
    body: JSON.stringify({ password }),
  });
}

describe("password login route", () => {
  beforeEach(() => {
    process.env.PASSWORD = "classroom-password";
  });

  afterEach(() => {
    delete process.env.PASSWORD;
  });

  it("sets an HttpOnly signed session after the correct password", async () => {
    const response = await POST(loginRequest("classroom-password"));
    expect(response.status).toBe(200);
    const cookie = response.cookies.get(SESSION_COOKIE_NAME);
    expect(cookie?.httpOnly).toBe(true);
    expect(cookie?.sameSite).toBe("strict");
    expect(cookie?.value && verifySessionToken(cookie.value, "classroom-password")).toBe(true);
  });

  it("does not set a session for an incorrect password", async () => {
    const response = await POST(loginRequest("wrong"));
    expect(response.status).toBe(401);
    expect(response.cookies.get(SESSION_COOKIE_NAME)).toBeUndefined();
    expect(await response.json()).toEqual({ message: "The password is incorrect." });
  });

  it("fails safely when PASSWORD is missing", async () => {
    delete process.env.PASSWORD;
    expect((await POST(loginRequest("anything"))).status).toBe(503);
  });
});
