import { NextResponse } from "next/server";
import os from "node:os";
import fs from "node:fs/promises";
import { LULU_API_BASE_URL } from "@/lib/lulu-api";

const startedAt = Date.now();
const HEALTH_CACHE_MS = 15000;
let cachedBackendHealth: { data: Record<string, string> | null; online: boolean; expiresAt: number } | null = null;

async function getDiskUsage() {
  try {
    const stats = await fs.statfs(process.cwd());
    const total = stats.blocks * stats.bsize;
    const free = stats.bfree * stats.bsize;
    const used = Math.max(total - free, 0);
    return {
      total,
      used,
      free,
      percent: total > 0 ? Math.round((used / total) * 100) : 0
    };
  } catch {
    return { total: 0, used: 0, free: 0, percent: 0 };
  }
}

export async function GET() {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 6000);

  let health: Record<string, string> | null = null;
  let serverOnline = false;

  if (cachedBackendHealth && cachedBackendHealth.expiresAt > Date.now()) {
    serverOnline = cachedBackendHealth.online;
    health = cachedBackendHealth.data;
    clearTimeout(timeout);
  } else {
    try {
      const response = await fetch(`${LULU_API_BASE_URL}/health`, {
        cache: "no-store",
        signal: controller.signal
      });
      serverOnline = response.ok;
      health = response.ok ? await response.json() : null;
      cachedBackendHealth = { data: health, online: serverOnline, expiresAt: Date.now() + HEALTH_CACHE_MS };
    } catch {
      serverOnline = false;
      cachedBackendHealth = { data: null, online: false, expiresAt: Date.now() + 3000 };
    } finally {
      clearTimeout(timeout);
    }
  }

  const totalMemory = os.totalmem();
  const freeMemory = os.freemem();
  const usedMemory = Math.max(totalMemory - freeMemory, 0);
  const disk = await getDiskUsage();
  const loadAverage = os.loadavg()[0] ?? 0;
  const cpuCount = os.cpus().length || 1;

  return NextResponse.json({
    status: serverOnline ? "online" : "offline",
    lulu: health,
    metrics: {
      dashboard_uptime_seconds: Math.floor((Date.now() - startedAt) / 1000),
      cpu_percent: Math.min(100, Math.round((loadAverage / cpuCount) * 100)),
      ram_percent: totalMemory > 0 ? Math.round((usedMemory / totalMemory) * 100) : 0,
      ram_used: usedMemory,
      ram_total: totalMemory,
      disk_percent: disk.percent,
      disk_used: disk.used,
      disk_total: disk.total,
      active_connections: serverOnline ? 1 : 0
    },
    source: LULU_API_BASE_URL,
    checked_at: new Date().toISOString()
  });
}
