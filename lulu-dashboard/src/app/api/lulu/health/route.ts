import { NextResponse } from "next/server";
import os from "node:os";
import fs from "node:fs/promises";

const LULU_BASE_URL = process.env.LULU_API_BASE_URL ?? "http://127.0.0.1:8000";
const startedAt = Date.now();

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
  const timeout = setTimeout(() => controller.abort(), 2500);

  let health: Record<string, string> | null = null;
  let serverOnline = false;

  try {
    const response = await fetch(`${LULU_BASE_URL}/health`, {
      cache: "no-store",
      signal: controller.signal
    });
    serverOnline = response.ok;
    health = response.ok ? await response.json() : null;
  } catch {
    serverOnline = false;
  } finally {
    clearTimeout(timeout);
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
    source: LULU_BASE_URL,
    checked_at: new Date().toISOString()
  });
}
