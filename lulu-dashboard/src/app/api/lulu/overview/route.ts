import { NextResponse } from "next/server";
import { LULU_API_BASE_URL } from "@/lib/lulu-api";

let cachedOverview: { data: unknown; status: number; expiresAt: number } | null = null;
let pendingOverview: Promise<{ data: unknown; status: number }> | null = null;
const OVERVIEW_CACHE_MS = 4500;

export async function GET() {
  const now = Date.now();
  if (cachedOverview && cachedOverview.expiresAt > now) {
    return NextResponse.json(cachedOverview.data, { status: cachedOverview.status });
  }

  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 6000);

  try {
    pendingOverview ??= fetch(`${LULU_API_BASE_URL}/dashboard/overview`, {
      cache: "no-store",
      signal: controller.signal
    }).then(async (response) => ({
      data: await response.json().catch(() => ({})),
      status: response.status
    }));

    const result = await pendingOverview;
    cachedOverview = { ...result, expiresAt: Date.now() + OVERVIEW_CACHE_MS };
    return NextResponse.json(result.data, { status: result.status });
  } catch {
    if (cachedOverview?.data) {
      return NextResponse.json(cachedOverview.data, { status: cachedOverview.status === 200 ? 200 : 206 });
    }
    return NextResponse.json({ detail: "LULU overview endpoint is not reachable" }, { status: 503 });
  } finally {
    pendingOverview = null;
    clearTimeout(timeout);
  }
}
