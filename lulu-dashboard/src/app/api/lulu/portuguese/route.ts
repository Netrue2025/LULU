import { NextResponse } from "next/server";
import { LULU_API_BASE_URL } from "@/lib/lulu-api";

async function forwardJson(path: string, init?: RequestInit) {
  const response = await fetch(`${LULU_API_BASE_URL}${path}`, {
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
  const action = searchParams.get("action") ?? "pack";

  try {
    if (action === "lesson") return forwardJson("/language/lesson");
    if (action === "progress") return forwardJson("/language/progress");
    if (action === "revision") return forwardJson("/language/revision");
    return forwardJson("/language/pack");
  } catch {
    return NextResponse.json({ detail: "Portuguese tutor endpoint is not reachable" }, { status: 503 });
  }
}

export async function POST(request: Request) {
  const body = await request.json().catch(() => ({}));
  const action = typeof body.action === "string" ? body.action : "";

  try {
    if (action === "translate") return forwardJson("/language/translate", { method: "POST", body: JSON.stringify(body) });
    if (action === "quiz") return forwardJson("/language/quiz", { method: "POST", body: JSON.stringify(body) });
    if (action === "conversation") return forwardJson("/language/conversation", { method: "POST", body: JSON.stringify(body) });
    if (action === "check") return forwardJson("/language/check-answer", { method: "POST", body: JSON.stringify(body) });
    if (action === "pronunciation") return forwardJson("/language/pronunciation", { method: "POST", body: JSON.stringify(body) });
    if (action === "progress") return forwardJson("/language/progress", { method: "POST", body: JSON.stringify(body.progress ?? {}) });
    if (action === "pack") return forwardJson("/language/pack", { method: "POST", body: JSON.stringify(body.pack ?? {}) });
    return NextResponse.json({ detail: "Unknown Portuguese tutor action" }, { status: 400 });
  } catch {
    return NextResponse.json({ detail: "Portuguese tutor endpoint is not reachable" }, { status: 503 });
  }
}
