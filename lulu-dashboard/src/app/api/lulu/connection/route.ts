import { NextResponse } from "next/server";
import { LULU_API_BASE_URL } from "@/lib/lulu-api";

async function fetchJson(path: string, timeoutMs = 6000) {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const response = await fetch(`${LULU_API_BASE_URL}${path}`, {
      cache: "no-store",
      signal: controller.signal
    });
    const data = await response.json().catch(() => null);
    return { ok: response.ok, status: response.status, data };
  } catch {
    return { ok: false, status: 0, data: null };
  } finally {
    clearTimeout(timeout);
  }
}

export async function GET() {
  const [health, remote] = await Promise.all([
    fetchJson("/health"),
    fetchJson("/remote/status")
  ]);

  return NextResponse.json({
    connected: health.ok,
    backend: {
      online: health.ok,
      status: health.status,
      baseUrl: LULU_API_BASE_URL,
      health: health.data
    },
    remote: remote.data ?? null,
    checked_at: new Date().toISOString()
  });
}
