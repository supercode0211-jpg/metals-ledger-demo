"use client";

import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import { clearSession, type Session } from "@/lib/api";

export function AppShell({ session, children }: { session: Session; children: React.ReactNode }) {
  const pathname = usePathname();
  const router = useRouter();

  const links = [
    { href: "/holdings", label: "Holdings" },
    ...(session.user.role === "admin" ? [{ href: "/admin", label: "Admin" }] : []),
  ];

  const signOut = () => {
    clearSession();
    router.replace("/");
  };

  return (
    <div className="min-h-screen">
      <header className="border-b border-line bg-panel/80">
        <div className="mx-auto flex max-w-6xl flex-wrap items-center gap-x-6 gap-y-2 px-4 py-3">
          <span className="font-semibold tracking-wide text-gold">Metals Ledger</span>
          <nav className="flex gap-1">
            {links.map((link) => (
              <Link
                key={link.href}
                href={link.href}
                className={`rounded-md px-3 py-1.5 text-sm ${
                  pathname === link.href ? "bg-raised text-text" : "text-muted hover:text-text"
                }`}
              >
                {link.label}
              </Link>
            ))}
          </nav>
          <div className="ml-auto flex items-center gap-3 text-sm">
            <span className="text-muted">
              {session.user.name}
              {session.user.role === "admin" && <span className="ml-1 text-gold">(admin)</span>}
            </span>
            <button onClick={signOut} className="rounded-md border border-line px-2.5 py-1 text-muted hover:text-text">
              Sign out
            </button>
          </div>
        </div>
      </header>
      <main className="mx-auto max-w-6xl space-y-6 px-4 py-6">{children}</main>
    </div>
  );
}
