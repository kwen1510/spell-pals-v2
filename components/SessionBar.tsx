"use client";

import { useState } from "react";

export function SessionBar() {
  const [loggingOut, setLoggingOut] = useState(false);

  async function logout() {
    if (loggingOut) return;
    setLoggingOut(true);
    try {
      const response = await fetch("/api/auth/logout", { method: "POST" });
      if (!response.ok) throw new Error("Logout failed");
      window.location.assign("/");
    } catch {
      setLoggingOut(false);
    }
  }

  return (
    <header className="session-bar">
      <p><span aria-hidden="true" /> Private practice session</p>
      <button type="button" onClick={logout} disabled={loggingOut}>
        {loggingOut ? "Logging out…" : "Log out"}
      </button>
    </header>
  );
}
