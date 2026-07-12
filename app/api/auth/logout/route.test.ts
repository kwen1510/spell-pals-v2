import { NextRequest } from "next/server";
import { describe, expect, it } from "vitest";
import { SESSION_COOKIE_NAME } from "../../../../lib/auth/session";
import { POST } from "./route";

describe("logout route", () => {
  it("expires the session cookie for same-origin requests", async () => {
    const response = await POST(new NextRequest("https://example.test/api/auth/logout", {
      method: "POST",
      headers: { Origin: "https://example.test", "Sec-Fetch-Site": "same-origin" },
    }));
    expect(response.status).toBe(200);
    expect(response.cookies.get(SESSION_COOKIE_NAME)?.value).toBe("");
    expect(response.cookies.get(SESSION_COOKIE_NAME)?.maxAge).toBe(0);
  });

  it("rejects cross-site logout requests", async () => {
    const response = await POST(new NextRequest("https://example.test/api/auth/logout", {
      method: "POST",
      headers: { Origin: "https://attacker.test", "Sec-Fetch-Site": "cross-site" },
    }));
    expect(response.status).toBe(403);
  });
});
