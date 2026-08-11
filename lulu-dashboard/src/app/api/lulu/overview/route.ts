import { NextResponse } from "next/server";
import { LULU_API_BASE_URL } from "@/lib/lulu-api";

export async function GET() {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 6000);

  try {
    const response = await fetch(`${LULU_API_BASE_URL}/dashboard/overview`, {
      cache: "no-store",
      signal: controller.signal
    });
    const data = await response.json().catch(() => ({}));
    return NextResponse.json(data, { status: response.status });
  } catch {
    return NextResponse.json({ detail: "LULU overview endpoint is not reachable" }, { status: 503 });
  } finally {
    clearTimeout(timeout);
  }
}
