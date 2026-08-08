import { NextResponse } from "next/server";
import { execFile } from "node:child_process";
import { randomUUID } from "node:crypto";
import { mkdir, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { promisify } from "node:util";

const DEFAULT_LULU_SD_URL = process.env.NEXT_PUBLIC_LULU_SD_URL ?? "http://192.168.43.73";
const execFileAsync = promisify(execFile);

type SdItem = {
  name: string;
  path: string;
  type: "directory" | "file";
  size: number;
  modified: string;
  editable: boolean;
};

function cleanBaseUrl(value: string | null) {
  return (value || DEFAULT_LULU_SD_URL).trim().replace(/\/$/, "");
}

function cleanPath(value: string | null) {
  return `/${(value || "").trim().replace(/^\/+/, "")}`;
}

function decodeHtml(value: string) {
  return value
    .replace(/&amp;/g, "&")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'");
}

function stripTags(value: string) {
  return decodeHtml(value.replace(/<[^>]*>/g, " ").replace(/\s+/g, " ").trim());
}

function itemName(path: string) {
  const parts = path.replace(/\\/g, "/").split("/").filter(Boolean);
  return parts.at(-1) ?? path;
}

function parseStorageHtml(html: string, currentPath: string) {
  const items: SdItem[] = [];
  const seen = new Set<string>();

  for (const match of html.matchAll(/href=['"]\/\?dir=([^'"]+)['"][^>]*>([\s\S]*?)<\/a>/gim)) {
    const path = decodeURIComponent(match[1] ?? "/");
    const label = stripTags(match[2] ?? "");
    if (!path || path === currentPath || label.toLowerCase().includes("parent folder") || seen.has(path)) continue;
    seen.add(path);
    items.push({ name: itemName(path), path, type: "directory", size: 0, modified: "", editable: false });
  }

  for (const match of html.matchAll(/href=['"]\/download\?path=([^'"]+)['"][\s\S]*?<input[^>]+name=['"]path['"][^>]+value=['"]([^'"]+)['"]/gim)) {
    const path = decodeHtml(match[2] ? match[2] : decodeURIComponent(match[1] ?? ""));
    if (!path || seen.has(path)) continue;
    const rowStart = Math.max(0, match.index ? html.lastIndexOf("<div class='row'", match.index) : 0);
    const rowEnd = html.indexOf("</div>", match.index ?? 0);
    const rowHtml = rowEnd > rowStart ? html.slice(rowStart, rowEnd) : "";
    const sizeMatch = rowHtml.match(/(\d+)\s+bytes/i);
    seen.add(path);
    items.push({
      name: itemName(path),
      path,
      type: "file",
      size: sizeMatch ? Number(sizeMatch[1]) : 0,
      modified: "",
      editable: false
    });
  }

  return { path: currentPath.replace(/^\//, ""), items, sdcard_active: true };
}

async function fetchFromSd(baseUrl: string, path: string, init?: RequestInit, timeoutMs = 10000) {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), timeoutMs);
  try {
    return await fetch(`${baseUrl}${path}`, { ...init, cache: "no-store", signal: controller.signal });
  } finally {
    clearTimeout(timeout);
  }
}

function isMusicPath(value: string) {
  return cleanPath(value).toLowerCase() === "/music";
}

function safeAudioBaseName(fileName: string) {
  const parsed = path.parse(fileName.replace(/\\/g, "/"));
  return (parsed.name || "song").replace(/[^\w.-]+/g, "_").replace(/^_+|_+$/g, "") || "song";
}

async function convertMusicUploadToWav(file: File) {
  const workDir = path.join(tmpdir(), `lulu-music-${randomUUID()}`);
  await mkdir(workDir, { recursive: true });
  const inputPath = path.join(workDir, file.name || "upload.audio");
  const outputName = `${safeAudioBaseName(file.name)}.wav`;
  const outputPath = path.join(workDir, outputName);

  try {
    await writeFile(inputPath, Buffer.from(await file.arrayBuffer()));
    await execFileAsync(
      process.env.FFMPEG_BIN || "ffmpeg",
      ["-y", "-hide_banner", "-loglevel", "error", "-i", inputPath, "-ac", "1", "-ar", "22050", "-sample_fmt", "s16", outputPath],
      { timeout: 180000 }
    );
    return { name: outputName, blob: new Blob([await readFile(outputPath)], { type: "audio/wav" }) };
  } finally {
    await rm(workDir, { recursive: true, force: true });
  }
}

export async function GET(request: Request) {
  const { searchParams } = new URL(request.url);
  const action = searchParams.get("action") ?? "list";
  const baseUrl = cleanBaseUrl(searchParams.get("baseUrl"));
  const path = cleanPath(searchParams.get("path"));

  try {
    if (action === "download") {
      const response = await fetchFromSd(baseUrl, `/download?path=${encodeURIComponent(path)}`);
      const headers = new Headers(response.headers);
      return new Response(response.body, { status: response.status, headers });
    }

    const listResponse = await fetchFromSd(baseUrl, `/list?dir=${encodeURIComponent(path)}`);
    if (listResponse.ok) {
      const data = await listResponse.json();
      return NextResponse.json({
        path: String(data.path ?? path).replace(/^\//, ""),
        items: data.items ?? [],
        sdcard_active: true,
        source: baseUrl
      });
    }

    const htmlResponse = await fetchFromSd(baseUrl, `/?dir=${encodeURIComponent(path)}`);
    if (!htmlResponse.ok) {
      return NextResponse.json({ detail: "LULU SD card is not reachable" }, { status: htmlResponse.status });
    }
    return NextResponse.json({ ...parseStorageHtml(await htmlResponse.text(), path), source: baseUrl });
  } catch {
    return NextResponse.json({ detail: "LULU SD card is not reachable" }, { status: 503 });
  }
}

export async function POST(request: Request) {
  const contentType = request.headers.get("content-type") ?? "";

  try {
    if (contentType.includes("multipart/form-data")) {
      const incoming = await request.formData();
      const baseUrl = cleanBaseUrl(String(incoming.get("baseUrl") ?? ""));
      const path = cleanPath(String(incoming.get("path") ?? ""));
      const outgoing = new FormData();
      for (const file of incoming.getAll("files")) {
        if (typeof file === "object" && file && "arrayBuffer" in file) {
          const upload = file as File;
          if (isMusicPath(path)) {
            try {
              const converted = await convertMusicUploadToWav(upload);
              outgoing.append("upload", converted.blob, converted.name);
            } catch (error) {
              return NextResponse.json(
                { detail: `Could not convert ${upload.name || "music file"} to LULU WAV. Check ffmpeg is installed.`, error: String(error) },
                { status: 422 }
              );
            }
          } else {
            outgoing.append("upload", upload, upload.name);
          }
        }
      }
      const response = await fetchFromSd(baseUrl, `/upload?dir=${encodeURIComponent(path)}`, {
        method: "POST",
        body: outgoing
      }, 300000);
      return NextResponse.json({ ok: response.ok, status: response.status }, { status: response.ok ? 200 : response.status });
    }

    const body = await request.json().catch(() => ({}));
    const baseUrl = cleanBaseUrl(String(body.baseUrl ?? ""));
    const action = String(body.action ?? "");
    const dir = cleanPath(String(body.dir ?? ""));
    const path = cleanPath(String(body.path ?? ""));

    if (action === "delete") {
      const response = await fetchFromSd(baseUrl, "/delete", {
        method: "POST",
        body: new URLSearchParams({ dir, path })
      });
      return NextResponse.json({ ok: response.ok }, { status: response.ok ? 200 : response.status });
    }

    if (action === "rename") {
      const response = await fetchFromSd(baseUrl, "/rename", {
        method: "POST",
        body: new URLSearchParams({ dir, path, name: String(body.name ?? "") })
      });
      return NextResponse.json({ ok: response.ok }, { status: response.ok ? 200 : response.status });
    }

    if (action === "folder") {
      const response = await fetchFromSd(baseUrl, "/mkdir", {
        method: "POST",
        body: new URLSearchParams({ dir, name: String(body.name ?? "") })
      });
      return NextResponse.json({ ok: response.ok }, { status: response.ok ? 200 : response.status });
    }

    return NextResponse.json({ detail: "Unsupported SD action" }, { status: 400 });
  } catch {
    return NextResponse.json({ detail: "LULU SD card is not reachable" }, { status: 503 });
  }
}
