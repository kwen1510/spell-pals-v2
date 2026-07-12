import { cookies } from "next/headers";
import { HandwritingApp } from "@/components/HandwritingApp";
import { LoginForm } from "@/components/LoginForm";
import { SessionBar } from "@/components/SessionBar";
import { passwordSecret, SESSION_COOKIE_NAME, verifySessionToken } from "@/lib/auth/session";

export const dynamic = "force-dynamic";

export default async function Page() {
  const secret = passwordSecret();
  if (!secret) {
    return (
      <main className="login-shell">
        <section className="login-card configuration-error" role="alert">
          <div className="login-mark" aria-hidden="true">听</div>
          <p className="eyebrow">Configuration required</p>
          <h1>Password login is not configured</h1>
          <p>Add the server-side <code>PASSWORD</code> environment variable, then restart the app.</p>
        </section>
      </main>
    );
  }

  const cookieStore = await cookies();
  const authenticated = verifySessionToken(cookieStore.get(SESSION_COOKIE_NAME)?.value, secret);
  if (!authenticated) {
    return (
      <main className="login-shell">
        <section className="login-card">
          <div className="login-mark" aria-hidden="true">听</div>
          <p className="eyebrow">Private classroom tool</p>
          <h1>Welcome back</h1>
          <p className="login-copy">Enter the shared password to open the handwriting app.</p>
          <LoginForm />
        </section>
      </main>
    );
  }

  return (
    <div className="authenticated-shell">
      <SessionBar />
      <HandwritingApp />
    </div>
  );
}
