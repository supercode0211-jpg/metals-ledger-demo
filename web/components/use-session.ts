"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { loadSession, type Session } from "@/lib/api";

/** The signed-in session, or null while it's being checked / redirecting. */
export function useSession(requiredRole?: "admin"): Session | null {
  const router = useRouter();
  const [session, setSession] = useState<Session | null>(null);

  useEffect(() => {
    const current = loadSession();
    if (!current) {
      router.replace("/");
    } else if (requiredRole && current.user.role !== requiredRole) {
      router.replace("/holdings");
    } else {
      setSession(current);
    }
  }, [router, requiredRole]);

  return session;
}
