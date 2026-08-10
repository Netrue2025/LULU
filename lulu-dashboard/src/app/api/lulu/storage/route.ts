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
  const action = searchParams.get("action") ?? "files";
  const path = searchParams.get("path") ?? "";
  const language = searchParams.get("language") ?? "portuguese";
  const lesson = searchParams.get("lesson") ?? "";

  try {
    if (action === "status") return forwardJson("/database/storage");
    if (action === "database") return forwardJson("/database/status");
    if (action === "read") return forwardJson(`/database/read-file?path=${encodeURIComponent(path)}`);
    if (action === "language") {
      const suffix = lesson ? `?lesson=${encodeURIComponent(lesson)}` : "";
      return forwardJson(`/language/${encodeURIComponent(language)}/lesson${suffix}`);
    }
    if (action === "progress") return forwardJson(`/language/${encodeURIComponent(language)}/progress`);
    return forwardJson(`/database/files?path=${encodeURIComponent(path)}`);
  } catch {
    return NextResponse.json({ detail: "LULU storage endpoint is not reachable" }, { status: 503 });
  }
}

export async function POST(request: Request) {
  const contentType = request.headers.get("content-type") ?? "";

  if (contentType.includes("multipart/form-data")) {
    try {
      const formData = await request.formData();
      const response = await fetch(`${LULU_API_BASE_URL}/database/upload-file`, {
        method: "POST",
        body: formData,
        cache: "no-store"
      });
      const data = await response.json().catch(() => ({}));
      return NextResponse.json(data, { status: response.status });
    } catch {
      return NextResponse.json({ detail: "LULU storage endpoint is not reachable" }, { status: 503 });
    }
  }

  const body = await request.json().catch(() => ({}));
  const action = typeof body.action === "string" ? body.action : "";

  try {
    if (action === "sync_to_sd") return forwardJson("/database/sync-to-sd", { method: "POST", body: "{}" });
    if (action === "sync_from_sd") return forwardJson("/database/sync-from-sd", { method: "POST", body: "{}" });
    if (action === "delete") return forwardJson("/database/delete-file", { method: "POST", body: JSON.stringify({ path: body.path }) });
    if (action === "folder") return forwardJson("/database/create-folder", { method: "POST", body: JSON.stringify({ path: body.path }) });
    if (action === "language") {
      return forwardJson(`/language/${encodeURIComponent(body.language ?? "portuguese")}/lesson`, {
        method: "POST",
        body: JSON.stringify(body.lesson ?? {})
      });
    }
    if (action === "progress") {
      return forwardJson(`/language/${encodeURIComponent(body.language ?? "portuguese")}/progress`, {
        method: "POST",
        body: JSON.stringify(body.progress ?? {})
      });
    }
    return forwardJson("/database/write-file", {
      method: "POST",
      body: JSON.stringify({ path: body.path, content: body.content ?? "" })
    });
  } catch {
    return NextResponse.json({ detail: "LULU storage endpoint is not reachable" }, { status: 503 });
  }
}
