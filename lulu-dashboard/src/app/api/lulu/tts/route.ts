import { NextResponse } from "next/server";

const LULU_BASE_URL = process.env.LULU_API_BASE_URL ?? "http://127.0.0.1:8000";

async function forwardJson(path: string, init?: RequestInit) {
  const response = await fetch(`${LULU_BASE_URL}${path}`, {
    ...init,
    cache: "no-store",
    headers: {
      "Content-Type": "application/json",
      ...(init?.headers ?? {})
    }
  });
  const data = await response.json().catch(() => ({}));
  return NextResponse.json(data, { status: response.status });
}

export async function GET(request: Request) {
  const { searchParams } = new URL(request.url);
  const action = searchParams.get("action") ?? "config";

  try {
    if (action === "voices") return forwardJson("/api/tts/voices");
    if (action === "cache") return forwardJson("/api/tts/cache");
    return forwardJson("/api/tts/config");
  } catch {
    return NextResponse.json({ detail: "LULU TTS endpoint is not reachable" }, { status: 503 });
  }
}

export async function POST(request: Request) {
  const body = await request.json().catch(() => ({}));
  const action = typeof body.action === "string" ? body.action : "";

  try {
    if (action === "speak") {
      return forwardJson("/api/tts/speak", {
        method: "POST",
        body: JSON.stringify({ text: body.text ?? "", mode: body.mode ?? "conversation" })
      });
    }
    if (action === "preload") {
      return forwardJson("/api/tts/cache/preload", { method: "POST", body: "{}" });
    }
    return forwardJson("/api/tts/config", {
      method: "POST",
      body: JSON.stringify(body.config ?? {})
    });
  } catch {
    return NextResponse.json({ detail: "LULU TTS endpoint is not reachable" }, { status: 503 });
  }
}

export async function DELETE(request: Request) {
  const { searchParams } = new URL(request.url);
  const file = searchParams.get("file");
  const suffix = file ? `?file=${encodeURIComponent(file)}` : "";

  try {
    return forwardJson(`/api/tts/cache${suffix}`, { method: "DELETE" });
  } catch {
    return NextResponse.json({ detail: "LULU TTS endpoint is not reachable" }, { status: 503 });
  }
}
