"use client";

import { FormEvent, useState } from "react";
import { useRouter } from "next/navigation";

export function LoginForm() {
  const router = useRouter();
  const [password, setPassword] = useState("");
  const [message, setMessage] = useState("");
  const [submitting, setSubmitting] = useState(false);

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!password || submitting) return;
    setSubmitting(true);
    setMessage("");
    try {
      const response = await fetch("/api/auth/login", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ password }),
      });
      const result = await response.json().catch(() => ({})) as { message?: string };
      if (!response.ok) {
        setMessage(result.message || "Unable to sign in. Please try again.");
        return;
      }
      setPassword("");
      router.refresh();
    } catch {
      setMessage("Unable to reach the app. Check your connection and try again.");
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <form className="login-form" onSubmit={submit}>
      <label htmlFor="password">Password</label>
      <input
        id="password"
        name="password"
        type="password"
        autoComplete="current-password"
        autoFocus
        required
        value={password}
        onChange={(event) => setPassword(event.target.value)}
        aria-describedby={message ? "login-message" : undefined}
        aria-invalid={Boolean(message)}
      />
      {message && <p id="login-message" className="login-error" role="alert">{message}</p>}
      <button type="submit" disabled={!password || submitting}>
        {submitting ? "Signing in…" : "Open handwriting app"}
      </button>
    </form>
  );
}
