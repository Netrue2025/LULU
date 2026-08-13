"use client";

import { BookOpen, CheckCircle2, Database, File, Folder, HardDrive, Loader2, Mic, RefreshCw, Square, Upload, X } from "lucide-react";
import { ChangeEvent, useEffect, useMemo, useState } from "react";
import { DashboardShell } from "@/components/dashboard/dashboard-shell";
import { PageGrid, StatusBadge } from "@/components/dashboard/shared";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { useLuluRealtime } from "@/hooks/use-lulu-realtime";

type BibleOfflineStatus = {
  success?: boolean;
  available?: boolean;
  translation?: string;
  language?: string;
  audioFormat?: string;
  offline?: boolean;
  books?: number;
  chapters?: number;
  mp3_files?: number;
  storage_used_bytes?: number;
  sd_used_bytes?: number;
  sd_total_bytes?: number;
  sd_free_bytes?: number;
  index_exists?: boolean;
  lastError?: string;
};

type BibleSdItem = {
  name: string;
  path: string;
  type: "directory" | "file";
  size: number;
  modified?: string;
  editable?: boolean;
};

type BibleUploadResponse = {
  ok?: boolean;
  count?: number;
  detail?: string;
};

type BibleDuplicateChoice = "skip" | "overwrite";

type BibleDuplicatePrompt = {
  fileName: string;
  targetPath: string;
  resolve: (choice: BibleDuplicateChoice) => void;
};

type BibleUploadTarget = {
  dir: string;
  name: string;
  path: string;
};

const DEFAULT_LULU_STORAGE_URL = process.env.NEXT_PUBLIC_LULU_SD_URL ?? "http://192.168.43.73";
const LULU_STORAGE_URL_KEY = "lulu-storage-url";
const BIBLE_ROOT_PATH = "lulu/bible";
const SD_CONNECTION_MODE_KEY = "lulu-sd-connection-mode";

function formatBytes(value = 0) {
  if (value < 1024) return `${value} B`;
  if (value < 1024 * 1024) return `${(value / 1024).toFixed(1)} KB`;
  return `${(value / 1024 / 1024).toFixed(1)} MB`;
}

function formatGb(value = 0) {
  return `${(value / 1024 / 1024 / 1024).toFixed(2)} GB`;
}

function cleanRelativePath(value: string) {
  return value
    .replace(/\\/g, "/")
    .split("/")
    .map((part) => part.trim())
    .filter((part) => part && part !== "." && part !== "..")
    .join("/");
}

function splitBibleUploadPath(file: File): BibleUploadTarget {
  const safeName = cleanRelativePath(file.webkitRelativePath || file.name) || "upload.bin";
  const parts = safeName.split("/");
  const name = parts.pop() || "upload.bin";
  const base = cleanRelativePath(BIBLE_ROOT_PATH);
  let relativeDir = parts.join("/");
  const lowerRelativeDir = relativeDir.toLowerCase();

  if (lowerRelativeDir === base || lowerRelativeDir.startsWith(`${base}/`)) {
    relativeDir = relativeDir.slice(base.length).replace(/^\/+/, "");
  } else if (lowerRelativeDir === "bible" || lowerRelativeDir.startsWith("bible/")) {
    relativeDir = relativeDir.slice("bible".length).replace(/^\/+/, "");
  }

  const dir = [base, relativeDir].filter(Boolean).join("/");
  return { dir, name, path: `/${[dir, name].filter(Boolean).join("/")}` };
}

export function SpiritualPage() {
  const { overview, events, status } = useLuluRealtime();
  const [remoteStatus, setRemoteStatus] = useState("");
  const [sending, setSending] = useState(false);
  const [offlineStatus, setOfflineStatus] = useState<BibleOfflineStatus | null>(null);
  const [offlineMessage, setOfflineMessage] = useState("");
  const [offlineBusy, setOfflineBusy] = useState(false);
  const [luluStorageUrl, setLuluStorageUrl] = useState(() =>
    typeof window === "undefined" ? DEFAULT_LULU_STORAGE_URL : window.localStorage.getItem(LULU_STORAGE_URL_KEY) ?? DEFAULT_LULU_STORAGE_URL
  );
  const [sdMode, setSdMode] = useState<"cloud" | "local">(() =>
    typeof window === "undefined" ? "cloud" : (window.localStorage.getItem(SD_CONNECTION_MODE_KEY) === "local" ? "local" : "cloud")
  );
  const [bibleFiles, setBibleFiles] = useState<BibleSdItem[]>([]);
  const [biblePath, setBiblePath] = useState(BIBLE_ROOT_PATH);
  const [pendingBibleFiles, setPendingBibleFiles] = useState<File[]>([]);
  const [bibleInputKey, setBibleInputKey] = useState(0);
  const [uploadingBible, setUploadingBible] = useState(false);
  const [bibleUploadProgress, setBibleUploadProgress] = useState(0);
  const [bibleUploadPhase, setBibleUploadPhase] = useState("");
  const [duplicateBiblePrompt, setDuplicateBiblePrompt] = useState<BibleDuplicatePrompt | null>(null);
  const bible = overview?.bible;
  const bibleActivities = useMemo(
    () => (overview?.activities ?? events).filter((item) => /bible|scripture|reading|verse|psalm|proverb/i.test(item.description)).slice(0, 5),
    [events, overview?.activities]
  );
  const bibleFolders = bibleFiles.filter((item) => item.type === "directory");
  const bibleFileItems = bibleFiles.filter((item) => item.type === "file");
  const sdTotalBytes = offlineStatus?.sd_total_bytes ?? 0;
  const sdUsedBytes = offlineStatus?.sd_used_bytes ?? offlineStatus?.storage_used_bytes ?? 0;
  const sdUsedPercent = sdTotalBytes > 0 ? Math.min(100, Math.max(0, Math.round((sdUsedBytes / sdTotalBytes) * 100))) : 0;
  const sdReady = Boolean(offlineStatus?.success || sdTotalBytes > 0 || typeof offlineStatus?.index_exists === "boolean");
  const sdLoading = offlineBusy || !offlineStatus;

  useEffect(() => {
    void loadBibleStatus();
    void loadBibleFiles(BIBLE_ROOT_PATH);
  }, []);

  function directStorageUrl() {
    return luluStorageUrl.trim().replace(/\/$/, "");
  }

  function sdQueryParams() {
    const params = new URLSearchParams({ mode: sdMode });
    if (sdMode === "local") params.set("baseUrl", directStorageUrl());
    return params;
  }

  async function sendRemoteCommand(action: "listen" | "stop") {
    setSending(true);
    setRemoteStatus("");
    try {
      const response = await fetch("/api/lulu/control", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action })
      });
      const data = await response.json().catch(() => ({}));
      if (!response.ok) throw new Error(data.detail ?? "Remote command failed");
      setRemoteStatus(action === "listen" ? "Listening command sent." : "Stop command sent.");
    } catch (error) {
      setRemoteStatus(error instanceof Error ? error.message : "Remote command failed");
    } finally {
      setSending(false);
    }
  }

  async function loadBibleStatus() {
    setOfflineBusy(true);
    setOfflineMessage("");
    try {
      const baseUrl = directStorageUrl();
      const params = sdQueryParams();
      params.set("action", "bible_status");
      if (sdMode === "local") params.set("baseUrl", baseUrl);
      const response = await fetch(`/api/lulu/sd?${params.toString()}`, { cache: "no-store" });
      const data = await response.json().catch(() => ({}));
      if (!response.ok) throw new Error(data.detail ?? "Offline Bible status unavailable");
      setOfflineStatus(data);
      setOfflineMessage("Offline Bible status loaded.");
    } catch (error) {
      setOfflineMessage(error instanceof Error ? error.message : "Offline Bible status unavailable");
    } finally {
      setOfflineBusy(false);
    }
  }

  async function loadBibleFiles(path = biblePath) {
    setOfflineBusy(true);
    setOfflineMessage("");
    try {
      const response = await fetch(
        `/api/lulu/sd?${new URLSearchParams({ ...Object.fromEntries(sdQueryParams()), action: "list", path }).toString()}`,
        { cache: "no-store" }
      );
      const data = await response.json().catch(() => ({}));
      if (!response.ok) throw new Error(data.detail ?? "Bible files unavailable");
      setBiblePath(String(data.path ?? path).replace(/^\//, ""));
      setBibleFiles(Array.isArray(data.items) ? data.items : []);
      setOfflineMessage("Bible files loaded from LULU SD.");
    } catch (error) {
      setBibleFiles([]);
      setOfflineMessage(error instanceof Error ? error.message : "Bible files unavailable");
    } finally {
      setOfflineBusy(false);
    }
  }

  function selectBibleFiles(event: ChangeEvent<HTMLInputElement>) {
    const files = Array.from(event.target.files ?? []);
    setPendingBibleFiles(files);
    setBibleUploadProgress(0);
    setBibleUploadPhase(files.length ? "Ready to upload" : "");
  }

  function clearBibleFiles(resetProgress = true) {
    setPendingBibleFiles([]);
    setBibleInputKey((key) => key + 1);
    if (resetProgress) {
      setBibleUploadProgress(0);
      setBibleUploadPhase("");
    }
  }

  function uploadFormDataWithProgress(formData: FormData) {
    return new Promise<{ ok: boolean; data: BibleUploadResponse }>((resolve, reject) => {
      const xhr = new XMLHttpRequest();
      xhr.open("POST", "/api/lulu/sd");

      xhr.upload.onprogress = (event) => {
        if (event.lengthComputable && event.total > 0) {
          setBibleUploadProgress(Math.min(99, Math.max(1, Math.round((event.loaded / event.total) * 100))));
          return;
        }
        setBibleUploadProgress((current) => current || 10);
      };

      xhr.upload.onload = () => {
        setBibleUploadPhase("Writing files to LULU SD");
      };

      xhr.onload = () => {
        let data: BibleUploadResponse = {};
        try {
          data = xhr.responseText ? JSON.parse(xhr.responseText) : {};
        } catch {
          data = { detail: xhr.responseText };
        }
        resolve({ ok: xhr.status >= 200 && xhr.status < 300, data });
      };

      xhr.onerror = () => reject(new Error("Bible upload failed"));
      xhr.onabort = () => reject(new Error("Bible upload cancelled"));
      xhr.send(formData);
    });
  }

  function chooseBibleDuplicate(fileName: string, targetPath: string) {
    return new Promise<BibleDuplicateChoice>((resolve) => {
      setDuplicateBiblePrompt({ fileName, targetPath, resolve });
    });
  }

  function resolveBibleDuplicate(choice: BibleDuplicateChoice) {
    duplicateBiblePrompt?.resolve(choice);
    setDuplicateBiblePrompt(null);
  }

  async function loadBibleDirectoryItems(path: string) {
    const response = await fetch(
      `/api/lulu/sd?${new URLSearchParams({ ...Object.fromEntries(sdQueryParams()), action: "list", path }).toString()}`,
      { cache: "no-store" }
    );
    const data = await response.json().catch(() => ({}));
    if (!response.ok) throw new Error(data.detail ?? `Could not check /${path} on LULU SD`);
    return Array.isArray(data.items) ? data.items as BibleSdItem[] : [];
  }

  async function bibleTargetExists(target: BibleUploadTarget, cache: Map<string, BibleSdItem[]>) {
    const cacheKey = target.dir.toLowerCase();
    let items = cache.get(cacheKey);
    if (!items) {
      items = await loadBibleDirectoryItems(target.dir);
      cache.set(cacheKey, items);
    }
    return items.some((item) => item.type === "file" && item.name.toLowerCase() === target.name.toLowerCase());
  }

  async function uploadBibleFiles() {
    if (!pendingBibleFiles.length) {
      setOfflineMessage("Choose the prepared lulu/bible folder first.");
      return;
    }

    setUploadingBible(true);
    setBibleUploadProgress(0);
    setBibleUploadPhase("Preparing Bible upload");
    setOfflineMessage("");

    let uploaded = 0;
    let skipped = 0;
    let processed = 0;

    try {
      const directoryCache = new Map<string, BibleSdItem[]>();
      for (const file of pendingBibleFiles) {
        const target = splitBibleUploadPath(file);
        let overwrite = false;

        if (await bibleTargetExists(target, directoryCache)) {
          setBibleUploadPhase(`Waiting for ${target.name}`);
          const choice = await chooseBibleDuplicate(target.name, target.path);
          if (choice === "skip") {
            skipped += 1;
            processed += 1;
            setBibleUploadProgress(Math.round((processed / pendingBibleFiles.length) * 100));
            setBibleUploadPhase(`Skipped ${target.name}`);
            continue;
          }
          overwrite = true;
        }

        const formData = new FormData();
        formData.append("mode", sdMode);
        if (sdMode === "local") formData.append("baseUrl", directStorageUrl());
        formData.append("path", BIBLE_ROOT_PATH);
        formData.append("overwrite", overwrite ? "1" : "0");
        formData.append("files", file, file.webkitRelativePath || file.name);

        setBibleUploadProgress(Math.round((processed / pendingBibleFiles.length) * 100));
        setBibleUploadPhase(`Uploading ${processed + 1} of ${pendingBibleFiles.length}`);
        const response = await uploadFormDataWithProgress(formData);
        if (!response.ok) throw new Error(response.data.detail ?? `Bible upload failed at ${file.name}`);
        uploaded += response.data.count ?? 1;
        processed += 1;
        setBibleUploadProgress(Math.round((processed / pendingBibleFiles.length) * 100));
      }

      const skippedText = skipped ? ` Skipped ${skipped} existing file(s).` : "";
      setOfflineMessage((sdMode === "cloud" ? `Queued ${uploaded} Bible file(s) for LULU SD sync.` : `Uploaded ${uploaded} Bible file(s) to LULU SD.`) + skippedText);
      setBibleUploadProgress(100);
      setBibleUploadPhase("Upload complete");
      clearBibleFiles(false);
      await loadBibleStatus();
      await loadBibleFiles(BIBLE_ROOT_PATH);
    } catch (error) {
      const keptText = uploaded || skipped ? ` ${uploaded} uploaded and ${skipped} skipped before it stopped; those files are kept.` : "";
      setBibleUploadPhase("Upload stopped");
      setOfflineMessage((error instanceof Error ? error.message : "Bible upload failed") + keptText);
    } finally {
      setUploadingBible(false);
    }
  }

  async function openBibleItem(item: BibleSdItem) {
    if (item.type === "directory") {
      await loadBibleFiles(item.path);
      return;
    }
    if (sdMode === "local") {
      window.open(`/api/lulu/sd?action=download&baseUrl=${encodeURIComponent(directStorageUrl())}&path=${encodeURIComponent(item.path)}`, "_blank");
      return;
    }
    setOfflineMessage("Cloud SD file download is not available yet.");
  }

  function parentBiblePath() {
    const parts = biblePath.split("/").filter(Boolean);
    parts.pop();
    return parts.join("/") || BIBLE_ROOT_PATH;
  }

  return (
    <DashboardShell title="Spiritual" subtitle="Bible room">
      <PageGrid>
        <section className="lulu-baby-panel mx-auto w-full max-w-5xl overflow-hidden rounded-lg border border-white/10">
          <div className="lulu-rainbow-bar" />
          <div className="grid gap-4 p-3 sm:p-4 lg:grid-cols-[minmax(0,1fr)_18rem]">
            <div className="rounded-lg border border-white/10 bg-black/70 p-3 sm:p-4">
              <div className="mb-3 flex items-center justify-between gap-3">
                <div className="flex items-center gap-2">
                  <span className="flex h-8 w-8 items-center justify-center rounded-md bg-yellow-200 text-slate-950">
                    <BookOpen className="h-4 w-4" />
                  </span>
                  <div>
                    <h2 className="text-sm font-semibold text-white">Bible</h2>
                    <p className="text-xs text-cyan-100/80">{bible?.reference || "No active passage"}</p>
                  </div>
                </div>
                <StatusBadge status={status} />
              </div>
              <div className="rounded-md border border-white/10 bg-white/5 p-3">
                <p className="text-xs font-semibold uppercase text-muted-foreground">Reading session</p>
                <p className="mt-2 text-lg font-semibold">{bible?.active ? `${bible.reference}` : "Ready for Bible reading"}</p>
                <p className="mt-1 text-xs text-muted-foreground">
                  {bible?.active ? `Next part ${bible.next_part} of ${bible.total_parts} | ${bible.translation}` : "Ask LULU for a book, chapter, or verse."}
                </p>
              </div>
              <div className="mt-3 rounded-md border border-white/10 bg-slate-950 p-3 font-mono text-xs text-cyan-100">
                {bibleActivities.length > 0 ? bibleActivities.map((item) => <p key={item.id} className="truncate py-1">{item.description}</p>) : <p>No Bible activity yet.</p>}
              </div>
            </div>

            <aside className="rounded-lg border border-white/10 bg-white/5 p-3">
              <div className="grid grid-cols-2 gap-2">
                <Button disabled={sending} onClick={() => sendRemoteCommand("listen")}>
                  <Mic className="h-4 w-4" />
                  Listen
                </Button>
                <Button variant="destructive" disabled={sending} onClick={() => sendRemoteCommand("stop")}>
                  <Square className="h-4 w-4" />
                  Stop
                </Button>
              </div>
              <p className="mt-3 min-h-4 text-xs text-pink-100">{remoteStatus || "Say continue Bible for the next part."}</p>
            </aside>
          </div>
          <div className="border-t border-white/10 p-3 sm:p-4">
            <div className="grid gap-3 xl:grid-cols-[minmax(0,1fr)_21rem]">
              <div className="rounded-lg border border-white/10 bg-black/60 p-3">
                <div className="mb-3 flex items-center gap-2">
                  <span className="flex h-8 w-8 items-center justify-center rounded-md bg-cyan-200 text-slate-950">
                    <Database className="h-4 w-4" />
                  </span>
                  <div>
                    <h2 className="text-sm font-semibold text-white">Bible Audio</h2>
                    <p className="text-xs text-cyan-100/80">{offlineStatus?.available ? "Bible available offline" : "Bible audio not installed"}</p>
                  </div>
                </div>
                <div className="mb-3 rounded-md border border-white/10 bg-white/5 p-3">
                  <div className="flex items-center justify-between gap-3">
                    <div className="flex min-w-0 items-center gap-2">
                      <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-md bg-cyan-200 text-slate-950">
                        {sdReady ? <HardDrive className="h-5 w-5" /> : <Loader2 className="h-5 w-5 animate-spin" />}
                      </span>
                      <div className="min-w-0">
                        <p className="text-sm font-semibold text-white">{sdReady ? "SD Card Ready" : "Checking SD Card"}</p>
                        <p className="truncate text-xs text-cyan-100/75">
                          {sdTotalBytes > 0 ? `${formatGb(sdUsedBytes)} used of ${formatGb(sdTotalBytes)}` : sdLoading ? "Reading capacity from LULU" : "Capacity unavailable"}
                        </p>
                      </div>
                    </div>
                    <span className="shrink-0 text-xs font-semibold tabular-nums text-cyan-100">{sdTotalBytes > 0 ? `${sdUsedPercent}%` : "--"}</span>
                  </div>
                  <div className="mt-3 h-2 overflow-hidden rounded-full bg-white/10">
                    <div className="h-full rounded-full bg-cyan-300 transition-[width] duration-300" style={{ width: `${sdTotalBytes > 0 ? sdUsedPercent : 12}%` }} />
                  </div>
                </div>
                <div className="grid gap-2 text-xs sm:grid-cols-2 lg:grid-cols-4">
                  <div className="rounded-md border border-white/10 bg-white/5 p-2">
                    <p className="text-muted-foreground">Source</p>
                    <p className="font-medium">Local SD</p>
                  </div>
                  <div className="rounded-md border border-white/10 bg-white/5 p-2">
                    <p className="text-muted-foreground">Translation</p>
                    <p className="font-medium">{offlineStatus?.translation ?? bible?.translation ?? "Not installed"}</p>
                  </div>
                  <div className="rounded-md border border-white/10 bg-white/5 p-2">
                    <p className="text-muted-foreground">Storage</p>
                    <p className="font-medium">{offlineStatus?.available ? "Installed" : "Missing"}</p>
                  </div>
                  <div className="rounded-md border border-white/10 bg-white/5 p-2">
                    <p className="text-muted-foreground">Internet</p>
                    <p className="font-medium">Not required</p>
                  </div>
                  <div className="rounded-md border border-white/10 bg-white/5 p-2">
                    <p className="text-muted-foreground">Books</p>
                    <p className="font-medium">{offlineStatus?.books ?? 0}</p>
                  </div>
                  <div className="rounded-md border border-white/10 bg-white/5 p-2">
                    <p className="text-muted-foreground">Chapters</p>
                    <p className="font-medium">{offlineStatus?.chapters ?? 0}</p>
                  </div>
                  <div className="rounded-md border border-white/10 bg-white/5 p-2">
                    <p className="text-muted-foreground">SD Used</p>
                    <p className="font-medium">{sdTotalBytes > 0 ? formatGb(sdUsedBytes) : formatBytes(offlineStatus?.storage_used_bytes ?? 0)}</p>
                  </div>
                  <div className="rounded-md border border-white/10 bg-white/5 p-2">
                    <p className="text-muted-foreground">SD Total</p>
                    <p className="font-medium">{sdTotalBytes > 0 ? formatGb(sdTotalBytes) : "Checking"}</p>
                  </div>
                  <div className="rounded-md border border-white/10 bg-white/5 p-2">
                    <p className="text-muted-foreground">Format</p>
                    <p className="font-medium">{offlineStatus?.audioFormat?.toUpperCase() ?? "MP3"}</p>
                  </div>
                </div>
                <p className="mt-3 min-h-4 text-xs text-pink-100">{offlineMessage || offlineStatus?.lastError}</p>
              </div>
              <aside className="rounded-lg border border-white/10 bg-white/5 p-3">
                <div className="space-y-3 text-xs">
                  <Input
                    aria-label="LULU SD address"
                    placeholder="LULU SD address"
                    disabled={sdMode === "cloud"}
                    value={luluStorageUrl}
                    onChange={(event) => {
                      setLuluStorageUrl(event.target.value);
                      window.localStorage.setItem(LULU_STORAGE_URL_KEY, event.target.value);
                    }}
                  />
                  <div className="grid grid-cols-2 gap-2">
                    <Button
                      variant={sdMode === "cloud" ? undefined : "secondary"}
                      onClick={() => {
                        setSdMode("cloud");
                        window.localStorage.setItem(SD_CONNECTION_MODE_KEY, "cloud");
                      }}
                    >
                      Cloud
                    </Button>
                    <Button
                      variant={sdMode === "local" ? undefined : "secondary"}
                      onClick={() => {
                        setSdMode("local");
                        window.localStorage.setItem(SD_CONNECTION_MODE_KEY, "local");
                      }}
                    >
                      Local
                    </Button>
                  </div>
                  <div className="grid gap-2">
                    <Button disabled={offlineBusy} onClick={() => {
                      void loadBibleStatus();
                      void loadBibleFiles(BIBLE_ROOT_PATH);
                    }}>
                      <RefreshCw className="h-4 w-4" />
                      Refresh
                    </Button>
                  </div>
                </div>
              </aside>
            </div>

            <div className="mt-3 grid gap-3 xl:grid-cols-[21rem_minmax(0,1fr)]">
              <aside className="rounded-lg border border-white/10 bg-white/5 p-3">
                <div className="space-y-3 text-xs">
                  <div>
                    <h3 className="text-sm font-semibold text-white">Upload Bible To SD</h3>
                    <p className="mt-1 text-cyan-100/80">{sdMode === "cloud" ? "Cloud relay to /lulu/bible" : "Target: /lulu/bible"}</p>
                  </div>
                  <div className="space-y-2 rounded-md border border-white/10 bg-black/40 p-2 text-cyan-100/85">
                    <div className="flex gap-2"><CheckCircle2 className="mt-0.5 h-4 w-4 shrink-0 text-cyan-200" /><span>Prepare the ZIP with the Bible importer.</span></div>
                    <div className="flex gap-2"><CheckCircle2 className="mt-0.5 h-4 w-4 shrink-0 text-cyan-200" /><span>Select the generated lulu/bible folder.</span></div>
                    <div className="flex gap-2"><CheckCircle2 className="mt-0.5 h-4 w-4 shrink-0 text-cyan-200" /><span>Keep LULU online until SD sync completes.</span></div>
                  </div>
                  <label className="flex min-h-24 cursor-pointer flex-col items-center justify-center gap-2 rounded-md border border-dashed border-white/20 bg-black/30 p-3 text-center transition hover:bg-black/50">
                    <Upload className="h-5 w-5 text-cyan-100" />
                    <span className="font-medium text-white">{pendingBibleFiles.length ? `${pendingBibleFiles.length} file(s) selected` : "Choose Bible Folder"}</span>
                    <input
                      key={bibleInputKey}
                      className="sr-only"
                      type="file"
                      multiple
                      accept=".json,.mp3,audio/mpeg"
                      onChange={selectBibleFiles}
                      {...{ webkitdirectory: "", directory: "" }}
                    />
                  </label>
                  {pendingBibleFiles.length ? (
                    <div className="max-h-24 space-y-1 overflow-y-auto rounded-md border border-white/10 bg-black/30 p-2">
                      {pendingBibleFiles.slice(0, 20).map((file) => (
                        <div key={`${file.webkitRelativePath || file.name}-${file.size}`} className="flex items-center justify-between gap-2">
                          <span className="truncate">{file.webkitRelativePath || file.name}</span>
                          <span className="shrink-0 text-cyan-100/70">{formatBytes(file.size)}</span>
                        </div>
                      ))}
                      {pendingBibleFiles.length > 20 ? <p className="text-cyan-100/70">+{pendingBibleFiles.length - 20} more</p> : null}
                    </div>
                  ) : null}
                  <div className="grid grid-cols-[1fr_auto] gap-2">
                    <Button disabled={!pendingBibleFiles.length || uploadingBible} onClick={uploadBibleFiles}>
                      <Upload className="h-4 w-4" />
                      {uploadingBible ? "Uploading" : "Upload Bible"}
                    </Button>
                    <Button variant="secondary" className="h-9 w-9 px-0" disabled={!pendingBibleFiles.length || uploadingBible} title="Clear selected files" onClick={() => clearBibleFiles()}>
                      <X className="h-4 w-4" />
                    </Button>
                  </div>
                  {(uploadingBible || bibleUploadProgress > 0) ? (
                    <div className="space-y-2 rounded-md border border-white/10 bg-black/30 p-2">
                      <div className="flex items-center justify-between gap-3 text-cyan-100/80">
                        <span className="truncate">{bibleUploadPhase || "Uploading"}</span>
                        <span className="shrink-0 tabular-nums">{bibleUploadProgress}%</span>
                      </div>
                      <div className="h-2 overflow-hidden rounded-full bg-white/10">
                        <div
                          className="h-full rounded-full bg-cyan-300 transition-[width] duration-200"
                          style={{ width: `${Math.min(100, Math.max(0, bibleUploadProgress))}%` }}
                        />
                      </div>
                    </div>
                  ) : null}
                </div>
              </aside>

              <div className="rounded-lg border border-white/10 bg-black/60 p-3">
                <div className="mb-3 flex flex-wrap items-center justify-between gap-2">
                  <div>
                    <h3 className="text-sm font-semibold text-white">Bible Files</h3>
                    <p className="break-all text-xs text-cyan-100/80">/{biblePath}</p>
                  </div>
                  <div className="flex gap-2">
                    <Button variant="ghost" className="h-9 w-9 px-0" title="Parent folder" onClick={() => loadBibleFiles(parentBiblePath())}>
                      <Folder className="h-4 w-4" />
                    </Button>
                    <Button variant="secondary" onClick={() => loadBibleFiles(BIBLE_ROOT_PATH)}>
                      <BookOpen className="h-4 w-4" />
                      Bible
                    </Button>
                    <Button variant="secondary" disabled={offlineBusy} onClick={() => loadBibleFiles(biblePath)}>
                    <RefreshCw className="h-4 w-4" />
                    Refresh
                  </Button>
                  </div>
                </div>
                <div className="grid gap-2 text-xs md:grid-cols-2 xl:grid-cols-3">
                  {bibleFolders.map((item) => (
                    <button
                      key={item.path}
                      className="flex min-w-0 items-center gap-2 rounded-md border border-white/10 bg-white/5 px-3 py-2 text-left transition hover:bg-white/10"
                      onClick={() => openBibleItem(item)}
                    >
                      <Folder className="h-4 w-4 shrink-0 text-cyan-100" />
                      <span className="truncate">{item.name}</span>
                    </button>
                  ))}
                  {bibleFileItems.map((item) => (
                    <button
                      key={item.path}
                      className="flex min-w-0 items-center justify-between gap-2 rounded-md border border-white/10 bg-white/5 px-3 py-2 text-left transition hover:bg-white/10"
                      onClick={() => openBibleItem(item)}
                    >
                      <span className="flex min-w-0 items-center gap-2">
                        <File className="h-4 w-4 shrink-0 text-cyan-100" />
                        <span className="truncate">{item.name}</span>
                      </span>
                      <span className="shrink-0 text-cyan-100/70">{formatBytes(item.size)}</span>
                    </button>
                  ))}
                </div>
                {!bibleFiles.length ? <p className="rounded-md border border-white/10 bg-white/5 p-3 text-xs text-cyan-100/80">No Bible files found on LULU SD yet.</p> : null}
              </div>
            </div>
          </div>
        </section>
      </PageGrid>
      {duplicateBiblePrompt ? (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/70 p-4">
          <div className="w-full max-w-sm rounded-lg border border-white/10 bg-slate-950 p-4 shadow-2xl">
            <h3 className="text-sm font-semibold text-white">File Already Exists</h3>
            <p className="mt-2 text-sm font-medium text-white">{duplicateBiblePrompt.fileName}</p>
            <p className="mt-2 break-all text-xs text-cyan-100/80">{duplicateBiblePrompt.targetPath}</p>
            <p className="mt-3 text-xs text-cyan-100/80">Choose how to continue this Bible upload.</p>
            <div className="mt-4 grid grid-cols-2 gap-2">
              <Button variant="secondary" onClick={() => resolveBibleDuplicate("skip")}>
                Skip
              </Button>
              <Button onClick={() => resolveBibleDuplicate("overwrite")}>
                Overwrite
              </Button>
            </div>
          </div>
        </div>
      ) : null}
    </DashboardShell>
  );
}
