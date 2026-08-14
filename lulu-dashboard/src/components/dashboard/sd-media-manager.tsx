"use client";

import { ChangeEvent, ReactNode, useEffect, useMemo, useState } from "react";
import { Check, File, Folder, Loader2, Pencil, RefreshCw, Trash2, Upload, X } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";

type SdMode = "cloud" | "local";

type SdMediaItem = {
  name: string;
  path: string;
  type: "directory" | "file";
  size?: number;
  modified?: string;
};

type UploadResponse = {
  ok?: boolean;
  count?: number;
  queued?: boolean;
  detail?: string;
};

type SdMediaManagerProps = {
  title: string;
  subtitle: string;
  rootPath: string;
  accept: string;
  emptyText: string;
  icon: ReactNode;
  uploadLabel: string;
};

const DEFAULT_LULU_STORAGE_URL = process.env.NEXT_PUBLIC_LULU_SD_URL ?? "http://192.168.43.73";
const LULU_STORAGE_URL_KEY = "lulu-storage-url";
const SD_CONNECTION_MODE_KEY = "lulu-sd-connection-mode";
const CACHE_TTL_MS = 15000;

function cleanPath(value: string) {
  return value.replace(/\\/g, "/").replace(/^\/+/, "").replace(/\/+$/, "");
}

function formatBytes(value = 0) {
  if (value < 1024) return `${value} B`;
  if (value < 1024 * 1024) return `${(value / 1024).toFixed(1)} KB`;
  return `${(value / 1024 / 1024).toFixed(1)} MB`;
}

function cacheKey(mode: SdMode, path: string) {
  return `lulu-sd-media:${mode}:${cleanPath(path).toLowerCase()}`;
}

function readCachedListing(mode: SdMode, path: string) {
  if (typeof window === "undefined") return null;
  try {
    const cached = JSON.parse(window.sessionStorage.getItem(cacheKey(mode, path)) ?? "null");
    if (!cached || Date.now() - Number(cached.savedAt ?? 0) > CACHE_TTL_MS) return null;
    return cached as { path: string; items: SdMediaItem[] };
  } catch {
    return null;
  }
}

function writeCachedListing(mode: SdMode, path: string, items: SdMediaItem[]) {
  window.sessionStorage.setItem(cacheKey(mode, path), JSON.stringify({ path, items, savedAt: Date.now() }));
}

export function SdMediaManager({ title, subtitle, rootPath, accept, emptyText, icon, uploadLabel }: SdMediaManagerProps) {
  const [mode, setMode] = useState<SdMode>(() =>
    typeof window === "undefined" ? "cloud" : (window.localStorage.getItem(SD_CONNECTION_MODE_KEY) === "local" ? "local" : "cloud")
  );
  const [luluStorageUrl, setLuluStorageUrl] = useState(() =>
    typeof window === "undefined" ? DEFAULT_LULU_STORAGE_URL : window.localStorage.getItem(LULU_STORAGE_URL_KEY) ?? DEFAULT_LULU_STORAGE_URL
  );
  const [currentPath, setCurrentPath] = useState(cleanPath(rootPath));
  const [items, setItems] = useState<SdMediaItem[]>([]);
  const [status, setStatus] = useState("");
  const [loading, setLoading] = useState(true);
  const [pendingFiles, setPendingFiles] = useState<File[]>([]);
  const [fileInputKey, setFileInputKey] = useState(0);
  const [uploading, setUploading] = useState(false);
  const [uploadProgress, setUploadProgress] = useState(0);
  const [uploadPhase, setUploadPhase] = useState("");
  const [renamingPath, setRenamingPath] = useState("");
  const [renameValue, setRenameValue] = useState("");

  const folders = items.filter((item) => item.type === "directory");
  const files = items.filter((item) => item.type === "file");
  const parentPath = useMemo(() => {
    const parts = currentPath.split("/").filter(Boolean);
    if (parts.length <= 1) return cleanPath(rootPath);
    parts.pop();
    return parts.join("/");
  }, [currentPath, rootPath]);

  useEffect(() => {
    const cached = readCachedListing(mode, currentPath);
    if (cached) {
      setItems(cached.items);
      setLoading(false);
    }
    void loadItems(currentPath, { quiet: Boolean(cached) });
  }, [mode, currentPath]);

  function directStorageUrl() {
    return luluStorageUrl.trim().replace(/\/$/, "");
  }

  function sdQueryParams(path = currentPath) {
    const params = new URLSearchParams({ mode, action: "list", path });
    if (mode === "local") params.set("baseUrl", directStorageUrl());
    return params;
  }

  async function loadItems(path = currentPath, options: { quiet?: boolean } = {}) {
    if (!options.quiet) setLoading(true);
    try {
      const response = await fetch(`/api/lulu/sd?${sdQueryParams(path).toString()}`, { cache: "no-store" });
      const data = await response.json().catch(() => ({}));
      if (response.status === 202 || data?.queued) {
        setStatus(data.detail ?? "LULU is still syncing SD files.");
        return;
      }
      if (!response.ok) throw new Error(data.detail ?? "Could not load SD files");
      const nextItems = Array.isArray(data.items) ? data.items : [];
      const nextPath = cleanPath(String(data.path ?? path));
      setCurrentPath(nextPath);
      setItems(nextItems);
      writeCachedListing(mode, nextPath, nextItems);
      setStatus(`${title} files loaded from ${mode === "cloud" ? "cloud relay" : "local SD"}.`);
    } catch (error) {
      setStatus(error instanceof Error ? error.message : "Could not load SD files");
    } finally {
      setLoading(false);
    }
  }

  function selectFiles(event: ChangeEvent<HTMLInputElement>) {
    setPendingFiles(Array.from(event.target.files ?? []));
    setUploadProgress(0);
    setUploadPhase("");
  }

  function clearPendingFiles(resetProgress = true) {
    setPendingFiles([]);
    setFileInputKey((key) => key + 1);
    if (resetProgress) {
      setUploadProgress(0);
      setUploadPhase("");
    }
  }

  function uploadOneFile(file: File, index: number, total: number) {
    return new Promise<{ ok: boolean; data: UploadResponse }>((resolve, reject) => {
      const formData = new FormData();
      formData.append("mode", mode);
      if (mode === "local") formData.append("baseUrl", directStorageUrl());
      formData.append("path", currentPath);
      formData.append("overwrite", "1");
      formData.append("files", file, file.name);

      const xhr = new XMLHttpRequest();
      xhr.open("POST", "/api/lulu/sd");
      xhr.upload.onprogress = (event) => {
        if (!event.lengthComputable || event.total <= 0) return;
        const fileProgress = Math.round((event.loaded / event.total) * (100 / total));
        setUploadProgress(Math.min(99, Math.round((index / total) * 100) + fileProgress));
      };
      xhr.upload.onload = () => setUploadPhase(mode === "cloud" ? "Queueing on cloud relay" : "Writing to LULU SD");
      xhr.onload = () => {
        let data: UploadResponse = {};
        try {
          data = xhr.responseText ? JSON.parse(xhr.responseText) : {};
        } catch {
          data = { detail: xhr.responseText };
        }
        resolve({ ok: xhr.status >= 200 && xhr.status < 300, data });
      };
      xhr.onerror = () => reject(new Error("Upload failed"));
      xhr.onabort = () => reject(new Error("Upload cancelled"));
      xhr.send(formData);
    });
  }

  async function uploadFiles() {
    if (!pendingFiles.length) {
      setStatus("Choose files before uploading.");
      return;
    }
    setUploading(true);
    setUploadProgress(0);
    setUploadPhase("Preparing upload");
    let queued = 0;
    let uploaded = 0;
    try {
      for (let index = 0; index < pendingFiles.length; index += 1) {
        setUploadPhase(`Uploading ${index + 1} of ${pendingFiles.length}`);
        const result = await uploadOneFile(pendingFiles[index], index, pendingFiles.length);
        if (!result.ok) throw new Error(result.data.detail ?? `Could not upload ${pendingFiles[index].name}`);
        if (result.data.queued) queued += 1;
        else uploaded += result.data.count ?? 1;
      }
      clearPendingFiles(false);
      setUploadProgress(100);
      setUploadPhase(queued ? "Queued for LULU SD" : "Upload complete");
      setStatus(queued ? `Queued ${queued} file(s). Refresh after LULU writes them to SD.` : `Uploaded ${uploaded} file(s) to LULU SD.`);
      window.sessionStorage.removeItem(cacheKey(mode, currentPath));
      await loadItems(currentPath);
    } catch (error) {
      setStatus(error instanceof Error ? error.message : "Upload failed");
    } finally {
      setUploading(false);
    }
  }

  async function deleteItem(item: SdMediaItem) {
    if (!window.confirm(`Delete ${item.name}?`)) return;
    const response = await fetch("/api/lulu/sd", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ mode, action: "delete", baseUrl: mode === "local" ? directStorageUrl() : "", dir: currentPath, path: item.path })
    });
    const data = await response.json().catch(() => ({}));
    if (response.status === 202 || data?.queued) {
      setStatus(`Delete queued for ${item.name}. Refresh after LULU confirms it.`);
      return;
    }
    setStatus(response.ok ? `Deleted ${item.name}.` : data.detail ?? `Could not delete ${item.name}`);
    if (response.ok) {
      window.sessionStorage.removeItem(cacheKey(mode, currentPath));
      await loadItems(currentPath);
    }
  }

  async function renameItem(item: SdMediaItem) {
    const name = renameValue.trim();
    if (!name) return;
    const response = await fetch("/api/lulu/sd", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ mode, action: "rename", baseUrl: mode === "local" ? directStorageUrl() : "", dir: currentPath, path: item.path, name })
    });
    const data = await response.json().catch(() => ({}));
    if (response.status === 202 || data?.queued) {
      setStatus(`Rename queued for ${item.name}. Refresh after LULU confirms it.`);
      setRenamingPath("");
      setRenameValue("");
      return;
    }
    setStatus(response.ok ? `Renamed ${item.name}.` : data.detail ?? `Could not rename ${item.name}`);
    setRenamingPath("");
    setRenameValue("");
    if (response.ok) {
      window.sessionStorage.removeItem(cacheKey(mode, currentPath));
      await loadItems(currentPath);
    }
  }

  function openItem(item: SdMediaItem) {
    if (item.type === "directory") {
      setCurrentPath(cleanPath(item.path));
      return;
    }
    setStatus("Preview is not available here yet.");
  }

  return (
    <div className="grid gap-3 xl:grid-cols-[20rem_minmax(0,1fr)]">
      <aside className="rounded-lg border border-white/10 bg-white/5 p-3">
        <div className="space-y-3 text-xs">
          <div className="flex items-center gap-2">
            <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-md bg-cyan-200 text-slate-950">{icon}</span>
            <div className="min-w-0">
              <h2 className="text-sm font-semibold text-white">{title}</h2>
              <p className="truncate text-cyan-100/80">{subtitle}</p>
            </div>
          </div>

          <div className="grid grid-cols-2 gap-2">
            <Button variant={mode === "cloud" ? undefined : "secondary"} onClick={() => {
              setMode("cloud");
              window.localStorage.setItem(SD_CONNECTION_MODE_KEY, "cloud");
            }}>Cloud</Button>
            <Button variant={mode === "local" ? undefined : "secondary"} onClick={() => {
              setMode("local");
              window.localStorage.setItem(SD_CONNECTION_MODE_KEY, "local");
            }}>Local</Button>
          </div>

          {mode === "local" ? (
            <Input
              aria-label="LULU SD address"
              placeholder="LULU SD address"
              value={luluStorageUrl}
              onChange={(event) => {
                setLuluStorageUrl(event.target.value);
                window.localStorage.setItem(LULU_STORAGE_URL_KEY, event.target.value);
              }}
            />
          ) : (
            <div className="rounded-md border border-cyan-200/20 bg-cyan-200/10 p-2 text-cyan-100">Cloud relay uses the hosted LULU backend.</div>
          )}

          <label className="flex min-h-24 cursor-pointer flex-col items-center justify-center gap-2 rounded-md border border-dashed border-white/20 bg-black/30 p-3 text-center transition hover:bg-black/50">
            <Upload className="h-5 w-5 text-cyan-100" />
            <span className="font-medium text-white">{pendingFiles.length ? `${pendingFiles.length} file(s) selected` : uploadLabel}</span>
            <input key={fileInputKey} className="sr-only" type="file" multiple accept={accept} onChange={selectFiles} />
          </label>

          {pendingFiles.length ? (
            <div className="max-h-24 space-y-1 overflow-y-auto rounded-md border border-white/10 bg-black/30 p-2">
              {pendingFiles.map((file) => (
                <div key={`${file.name}-${file.size}`} className="flex items-center justify-between gap-2">
                  <span className="truncate">{file.name}</span>
                  <span className="shrink-0 text-cyan-100/70">{formatBytes(file.size)}</span>
                </div>
              ))}
            </div>
          ) : null}

          <div className="grid grid-cols-[1fr_auto] gap-2">
            <Button disabled={!pendingFiles.length || uploading} onClick={uploadFiles}>
              <Upload className="h-4 w-4" />
              {uploading ? "Uploading" : "Upload"}
            </Button>
            <Button variant="secondary" className="h-9 w-9 px-0" disabled={!pendingFiles.length || uploading} title="Clear files" onClick={() => clearPendingFiles()}>
              <X className="h-4 w-4" />
            </Button>
          </div>

          {(uploading || uploadProgress > 0) ? (
            <div className="space-y-2 rounded-md border border-white/10 bg-black/30 p-2">
              <div className="flex items-center justify-between gap-3 text-cyan-100/80">
                <span className="truncate">{uploadPhase || "Uploading"}</span>
                <span className="shrink-0 tabular-nums">{uploadProgress}%</span>
              </div>
              <div className="h-2 overflow-hidden rounded-full bg-white/10">
                <div className="h-full rounded-full bg-cyan-300 transition-[width] duration-200" style={{ width: `${Math.min(100, Math.max(0, uploadProgress))}%` }} />
              </div>
            </div>
          ) : null}

          <Button variant="secondary" className="w-full" disabled={loading} onClick={() => loadItems(currentPath)}>
            {loading ? <Loader2 className="h-4 w-4 animate-spin" /> : <RefreshCw className="h-4 w-4" />}
            Refresh
          </Button>
          <p className="min-h-4 text-pink-100">{status}</p>
        </div>
      </aside>

      <section className="rounded-lg border border-white/10 bg-black/60 p-3">
        <div className="mb-3 flex flex-wrap items-center justify-between gap-2">
          <div>
            <h3 className="text-sm font-semibold text-white">/{currentPath}</h3>
            <p className="text-xs text-cyan-100/80">{files.length} file(s), {folders.length} folder(s)</p>
          </div>
          <div className="flex gap-2">
            <Button variant="ghost" className="h-9 w-9 px-0" title="Parent folder" onClick={() => setCurrentPath(parentPath)}>
              <Folder className="h-4 w-4" />
            </Button>
            <Button variant="secondary" onClick={() => setCurrentPath(cleanPath(rootPath))}>Root</Button>
          </div>
        </div>

        {loading && !items.length ? (
          <p className="flex items-center gap-2 rounded-md border border-white/10 bg-white/5 p-3 text-xs text-cyan-100/80">
            <Loader2 className="h-4 w-4 animate-spin" />
            Loading SD files
          </p>
        ) : null}

        <div className="grid gap-2 text-xs md:grid-cols-2 xl:grid-cols-3">
          {items.map((item) => (
            <div key={item.path} className="rounded-md border border-white/10 bg-white/5 p-2">
              {renamingPath === item.path ? (
                <div className="flex gap-2">
                  <Input className="h-8" value={renameValue} onChange={(event) => setRenameValue(event.target.value)} />
                  <Button variant="ghost" className="h-8 w-8 px-0" title="Save rename" onClick={() => renameItem(item)}>
                    <Check className="h-4 w-4" />
                  </Button>
                  <Button variant="ghost" className="h-8 w-8 px-0" title="Cancel rename" onClick={() => setRenamingPath("")}>
                    <X className="h-4 w-4" />
                  </Button>
                </div>
              ) : (
                <div className="flex min-w-0 items-center justify-between gap-2">
                  <button className="flex min-w-0 items-center gap-2 text-left hover:text-cyan-100" onClick={() => openItem(item)}>
                    {item.type === "directory" ? <Folder className="h-4 w-4 shrink-0 text-cyan-100" /> : <File className="h-4 w-4 shrink-0 text-cyan-100" />}
                    <span className="truncate">{item.name}</span>
                  </button>
                  <span className="shrink-0 text-cyan-100/60">{item.type === "file" ? formatBytes(item.size ?? 0) : "Folder"}</span>
                </div>
              )}
              {renamingPath !== item.path ? (
                <div className="mt-2 flex justify-end gap-1">
                  <Button variant="ghost" className="h-8 w-8 px-0" title="Rename" onClick={() => {
                    setRenamingPath(item.path);
                    setRenameValue(item.name);
                  }}>
                    <Pencil className="h-4 w-4" />
                  </Button>
                  <Button variant="ghost" className="h-8 w-8 px-0" title="Delete" onClick={() => deleteItem(item)}>
                    <Trash2 className="h-4 w-4" />
                  </Button>
                </div>
              ) : null}
            </div>
          ))}
        </div>

        {!loading && !items.length ? (
          <p className="rounded-md border border-white/10 bg-white/5 p-3 text-xs text-cyan-100/80">{emptyText}</p>
        ) : null}
      </section>
    </div>
  );
}
