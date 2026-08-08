"use client";

import { useEffect, useMemo, useState } from "react";
import { initialEvents } from "@/lib/mock-data";
import type { ActivityEvent, LuluHealth, LuluStatus } from "@/lib/types";

export function useLuluRealtime() {
  const [health, setHealth] = useState<LuluHealth | null>(null);
  const [events, setEvents] = useState<ActivityEvent[]>(initialEvents);
  const [lastError, setLastError] = useState("");
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    let cancelled = false;

    async function loadHealthOnce() {
      try {
        const response = await fetch("/api/lulu/health", { cache: "no-store" });
        if (!response.ok) throw new Error(`Health check failed with ${response.status}`);
        const data = (await response.json()) as LuluHealth;
        if (!cancelled) {
          const healthEvent: ActivityEvent = {
            id: `health-${Date.now()}`,
            timestamp: data.checked_at,
            type: data.status === "online" ? "heartbeat" : "error",
            description:
              data.status === "online"
                ? "LULU health checked on page load"
                : "LULU server was offline on page load"
          };
          setHealth(data);
          setLastError("");
          setEvents((current) => [healthEvent, ...current].slice(0, 150));
        }
      } catch (error) {
        if (!cancelled) {
          const errorEvent: ActivityEvent = {
            id: `health-error-${Date.now()}`,
            timestamp: new Date().toISOString(),
            type: "error",
            description: "LULU health check failed on page load"
          };
          setLastError(error instanceof Error ? error.message : "Health check failed");
          setHealth((current) => current ?? null);
          setEvents((current) => [errorEvent, ...current].slice(0, 150));
        }
      } finally {
        if (!cancelled) setLoading(false);
      }
    }

    void loadHealthOnce();
    return () => {
      cancelled = true;
    };
  }, []);

  const status: LuluStatus = useMemo(() => {
    if (loading) return "thinking";
    if (lastError) return "error";
    return health?.status === "online" ? "online" : "offline";
  }, [health?.status, lastError, loading]);

  return { health, events, setEvents, status, lastError, loading };
}
