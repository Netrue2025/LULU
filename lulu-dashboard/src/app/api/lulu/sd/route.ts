import { NextResponse } from "next/server";
import { execFile } from "node:child_process";
import { randomUUID } from "node:crypto";
import { mkdir, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { promisify } from "node:util";
import { LULU_API_BASE_URL } from "@/lib/lulu-api";

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

function boolFormValue(value: FormDataEntryValue | null, fallback = false) {
  if (value === null) return fallback;
  const normalized = String(value).trim().toLowerCase();
  return ["1", "true", "yes", "overwrite"].includes(normalized);
}

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

async function fetchFromCloudSd(path: string, init?: RequestInit, timeoutMs = 30000) {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), timeoutMs);
  try {
    return await fetch(`${LULU_API_BASE_URL}${path}`, { ...init, cache: "no-store", signal: controller.signal });
  } finally {
    clearTimeout(timeout);
  }
}

function isMusicPath(value: string) {
  return cleanPath(value).toLowerCase() === "/music";
}

function cleanRelativePath(value: string) {
  return value
    .replace(/\\/g, "/")
    .split("/")
    .map((part) => part.trim())
    .filter((part) => part && part !== "." && part !== "..")
    .join("/");
}

function splitUploadPath(basePath: string, fileName: string) {
  const safeName = cleanRelativePath(fileName) || "upload.bin";
  const parts = safeName.split("/");
  const name = parts.pop() || "upload.bin";
  const base = cleanPath(basePath);
  const baseWithoutSlash = base.replace(/^\/|\/$/g, "");
  let relativeDir = parts.join("/");

  if (baseWithoutSlash && (relativeDir === baseWithoutSlash || relativeDir.startsWith(`${baseWithoutSlash}/`))) {
    relativeDir = relativeDir.slice(baseWithoutSlash.length).replace(/^\/+/, "");
  }

  if (baseWithoutSlash.toLowerCase() === "lulu/bible") {
    const lowerRelativeDir = relativeDir.toLowerCase();
    if (lowerRelativeDir === "bible" || lowerRelativeDir.startsWith("bible/")) {
      relativeDir = relativeDir.slice("bible".length).replace(/^\/+/, "");
    } else if (lowerRelativeDir === "lulu/bible" || lowerRelativeDir.startsWith("lulu/bible/")) {
      relativeDir = relativeDir.slice("lulu/bible".length).replace(/^\/+/, "");
    }
  }

  const dir = cleanPath([baseWithoutSlash, relativeDir].filter(Boolean).join("/"));
  return { dir, name };
}

async function ensureSdDirectory(baseUrl: string, dir: string) {
  const parts = cleanPath(dir).split("/").filter(Boolean);
  let current = "";

  for (const part of parts) {
    const parent = cleanPath(current);
    await fetchFromSd(baseUrl, "/mkdir", {
      method: "POST",
      body: new URLSearchParams({ dir: parent, name: part })
    });
    current = cleanPath(`${current}/${part}`);
  }
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
  const mode = searchParams.get("mode") ?? "";

  try {
    if (mode === "cloud") {
      if (action === "bible_status") {
        const response = await fetchFromCloudSd("/remote/sd/request", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ action: "bible_status", timeout_seconds: 18 })
        }, 30000);
        const data = await response.json().catch(() => ({}));
        return NextResponse.json(data.data ?? data, { status: response.status });
      }

      if (action === "list") {
        const response = await fetchFromCloudSd("/remote/sd/request", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ action: "list", path, timeout_seconds: 18 })
        }, 30000);
        const data = await response.json().catch(() => ({}));
        return NextResponse.json(data.data ?? data, { status: response.status });
      }

      return NextResponse.json({ detail: "Cloud SD mode does not support this action yet" }, { status: 400 });
    }

    if (action === "bible_status") {
      const response = await fetchFromSd(baseUrl, "/bible/status");
      const data = await response.json().catch(() => ({}));
      return NextResponse.json(data, { status: response.status });
    }

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
      const mode = String(incoming.get("mode") ?? "");
      const baseUrl = cleanBaseUrl(String(incoming.get("baseUrl") ?? ""));
      const path = cleanPath(String(incoming.get("path") ?? ""));
      let uploaded = 0;
      for (const file of incoming.getAll("files")) {
        if (typeof file === "object" && file && "arrayBuffer" in file) {
          const upload = file as File;
          const target = splitUploadPath(path, upload.name);
          const overwrite = boolFormValue(incoming.get("overwrite"), true);

          if (mode === "cloud") {
            const outgoing = new FormData();
            outgoing.append("action", "upload");
            outgoing.append("path", target.dir);
            outgoing.append("overwrite", overwrite ? "1" : "0");
            outgoing.append("file", upload, target.name);
            const queued = await fetchFromCloudSd("/remote/sd/request", {
              method: "POST",
              body: outgoing
            }, 300000);
            const queuedData = await queued.json().catch(() => ({}));
            if (!queued.ok) {
              return NextResponse.json(queuedData, { status: queued.status });
            }
            uploaded += 1;
            continue;
          }

          await ensureSdDirectory(baseUrl, target.dir);
          const outgoing = new FormData();
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
            outgoing.append("upload", upload, target.name);
          }

          const uploadPath = `/upload?dir=${encodeURIComponent(target.dir)}&overwrite=${overwrite ? "1" : "0"}`;
          const response = await fetchFromSd(baseUrl, uploadPath, {
            method: "POST",
            body: outgoing
          }, 300000);

          if (!response.ok) {
            return NextResponse.json(
              { detail: `Could not upload ${target.name} to ${target.dir}`, status: response.status, count: uploaded },
              { status: response.status }
            );
          }
          uploaded += 1;
        }
      }
      return NextResponse.json({ ok: true, count: uploaded });
    }

    const body = await request.json().catch(() => ({}));
    const baseUrl = cleanBaseUrl(String(body.baseUrl ?? ""));
    const action = String(body.action ?? "");
    const dir = cleanPath(String(body.dir ?? ""));
    const path = cleanPath(String(body.path ?? ""));
    const mode = String(body.mode ?? "");

    if (mode === "cloud") {
      if (action === "folder") {
        const response = await fetchFromCloudSd("/remote/sd/request", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ action: "mkdir", path: dir, name: String(body.name ?? ""), timeout_seconds: 18 })
        }, 30000);
        const data = await response.json().catch(() => ({}));
        return NextResponse.json(data.data ?? data, { status: response.status });
      }

      return NextResponse.json({ detail: "Cloud SD mode does not support this action yet" }, { status: 400 });
    }

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
