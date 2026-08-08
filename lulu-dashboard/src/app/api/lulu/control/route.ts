import { NextResponse } from "next/server";

const LULU_BASE_URL = process.env.LULU_API_BASE_URL ?? "http://127.0.0.1:8000";

export async function POST(request: Request) {
  const body = await request.json().catch(() => null);
  const action = typeof body?.action === "string" ? body.action.trim() : "";
  const text = typeof body?.text === "string" ? body.text.trim() : "";

  if (!["speak", "radio", "stop", "ready", "listen"].includes(action)) {
    return NextResponse.json({ detail: "Unsupported remote action" }, { status: 400 });
  }

  if (action === "speak" && !text) {
    return NextResponse.json({ detail: "Speak action requires text" }, { status: 400 });
  }

  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 5000);

  try {
    const response = await fetch(`${LULU_BASE_URL}/remote/command`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ action, text }),
      signal: controller.signal
    });
    const data = await response.json().catch(() => ({}));
    return NextResponse.json(data, { status: response.status });
  } catch {
    return NextResponse.json({ detail: "LULU remote command endpoint is not reachable" }, { status: 503 });
  } finally {
    clearTimeout(timeout);
  }
}
