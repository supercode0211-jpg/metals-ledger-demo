"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { api, errorMessage, loadSession, type Session } from "@/lib/api";
import { ErrorNote, buttonClass, inputClass } from "@/components/ui";

const DEMO_PASSWORD = "demo1234";
const DEMO_ACCOUNTS = [
  { email: "maya@demo.local", label: "Maya", hint: "holder with gold, silver and platinum" },
  { email: "omar@demo.local", label: "Omar", hint: "holder with a pending deposit" },
  { email: "admin@demo.local", label: "Ops Admin", hint: "approval queue and reconciliation" },
];

const homeFor = (session: Session) => (session.user.role === "admin" ? "/admin" : "/holdings");

export default function SignInPage() {
  const router = useRouter();
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    const session = loadSession();
    if (session) router.replace(homeFor(session));
  }, [router]);

  const signIn = async (asEmail: string, asPassword: string) => {
    setBusy(true);
    setError(null);
    try {
      const session = await api.login(asEmail, asPassword);
      router.replace(homeFor(session));
    } catch (err) {
      setError(errorMessage(err));
      setBusy(false);
    }
  };

  return (
    <main className="mx-auto flex min-h-screen max-w-sm flex-col justify-center px-4 py-10">
      <h1 className="text-2xl font-semibold text-gold">Metals Ledger</h1>
      <p className="mt-1 text-sm text-muted">Sign in to see your gold, silver and platinum.</p>

      <form
        className="mt-6 space-y-3"
        onSubmit={(e) => {
          e.preventDefault();
          void signIn(email, password);
        }}
      >
        <input
          className={inputClass}
          type="email"
          placeholder="Email"
          autoComplete="email"
          value={email}
          onChange={(e) => setEmail(e.target.value)}
          required
        />
        <input
          className={inputClass}
          type="password"
          placeholder="Password"
          autoComplete="current-password"
          value={password}
          onChange={(e) => setPassword(e.target.value)}
          required
        />
        <ErrorNote message={error} />
        <button type="submit" disabled={busy} className={`${buttonClass} w-full bg-gold py-2 text-ink hover:bg-gold/90`}>
          {busy ? "Signing in..." : "Sign in"}
        </button>
      </form>

      <div className="mt-8 rounded-xl border border-line bg-panel p-4">
        <p className="text-xs uppercase tracking-wider text-muted">Demo accounts</p>
        <ul className="mt-3 space-y-2">
          {DEMO_ACCOUNTS.map((account) => (
            <li key={account.email}>
              <button
                type="button"
                disabled={busy}
                onClick={() => void signIn(account.email, DEMO_PASSWORD)}
                className="w-full rounded-md border border-line px-3 py-2 text-left hover:border-gold/50 disabled:opacity-50"
              >
                <span className="block text-sm">{account.label}</span>
                <span className="block text-xs text-muted">{account.hint}</span>
              </button>
            </li>
          ))}
        </ul>
      </div>
    </main>
  );
}
