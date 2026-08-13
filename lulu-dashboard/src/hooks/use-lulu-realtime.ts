"use client";

import { useEffect, useMemo, useState } from "react";
import { initialEvents } from "@/lib/mock-data";
import { cachedJson } from "@/lib/client-cache";
import type { ActivityEvent, LuluHealth, LuluOverview, LuluStatus } from "@/lib/types";

type LuluRealtimeOptions = {
  poll?: boolean;
  pollHealth?: boolean;
  pollOverview?: boolean;
  healthIntervalMs?: number;
  overviewIntervalMs?: number;
  healthCacheMs?: number;
  overviewCacheMs?: number;
};

export function useLuluRealtime(options: LuluRealtimeOptions = {}) {
  const {
    poll = false,
    pollHealth = false,
    pollOverview = false,
    healthIntervalMs = 15000,
    overviewIntervalMs = 5000,
    healthCacheMs = 15000,
    overviewCacheMs = 900
  } = options;
  const [health, setHealth] = useState<LuluHealth | null>(null);
  const [overview, setOverview] = useState<LuluOverview | null>(null);
  const [events, setEvents] = useState<ActivityEvent[]>(initialEvents);
  const [lastError, setLastError] = useState("");
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    let cancelled = false;

    async function loadHealth() {
      try {
        const data = await cachedJson<LuluHealth>("lulu:health", "/api/lulu/health", healthCacheMs);
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

    async function loadOverview() {
      try {
        const data = await cachedJson<LuluOverview>("lulu:overview", "/api/lulu/overview", overviewCacheMs);
        if (cancelled) return;
        setOverview(data);
        if (data.activities.length > 0) {
          setEvents((current) => {
            const mapped = data.activities.map((activity) => ({
              id: activity.id,
              timestamp: activity.timestamp,
              type: "device" as const,
              description: activity.description
            }));
            const known = new Set(mapped.map((event) => event.id));
            return [...mapped, ...current.filter((event) => !known.has(event.id))].slice(0, 150);
          });
        }
      } catch {
        // Health remains the authoritative online/offline signal.
      }
    }

    void loadHealth();
    void loadOverview();
    const healthTimer = poll || pollHealth ? window.setInterval(loadHealth, healthIntervalMs) : undefined;
    const overviewTimer = poll || pollOverview ? window.setInterval(loadOverview, overviewIntervalMs) : undefined;
    return () => {
      cancelled = true;
      if (healthTimer) window.clearInterval(healthTimer);
      if (overviewTimer) window.clearInterval(overviewTimer);
    };
  }, [healthCacheMs, healthIntervalMs, overviewCacheMs, overviewIntervalMs, poll, pollHealth, pollOverview]);

  const status: LuluStatus = useMemo(() => {
    if (loading) return "thinking";
    if (lastError) return "error";
    return health?.status === "online" ? "online" : "offline";
  }, [health?.status, lastError, loading]);

  return { health, overview, events, setEvents, status, lastError, loading };
}
