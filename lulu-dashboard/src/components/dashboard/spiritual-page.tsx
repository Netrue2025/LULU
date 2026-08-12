"use client";

import { BookOpen, CheckCircle2, Database, File, Folder, Mic, RefreshCw, Square, Upload, X } from "lucide-react";
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

const DEFAULT_LULU_STORAGE_URL = process.env.NEXT_PUBLIC_LULU_SD_URL ?? "http://192.168.43.73";
const LULU_STORAGE_URL_KEY = "lulu-storage-url";
const BIBLE_ROOT_PATH = "lulu/bible";

function formatBytes(value = 0) {
  if (value < 1024) return `${value} B`;
  if (value < 1024 * 1024) return `${(value / 1024).toFixed(1)} KB`;
  return `${(value / 1024 / 1024).toFixed(1)} MB`;
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
  const [bibleFiles, setBibleFiles] = useState<BibleSdItem[]>([]);
  const [biblePath, setBiblePath] = useState(BIBLE_ROOT_PATH);
  const [pendingBibleFiles, setPendingBibleFiles] = useState<File[]>([]);
  const [bibleInputKey, setBibleInputKey] = useState(0);
  const [uploadingBible, setUploadingBible] = useState(false);
  const [bibleUploadProgress, setBibleUploadProgress] = useState(0);
  const [bibleUploadPhase, setBibleUploadPhase] = useState("");
  const bible = overview?.bible;
  const bibleActivities = useMemo(
    () => (overview?.activities ?? events).filter((item) => /bible|scripture|reading|verse|psalm|proverb/i.test(item.description)).slice(0, 5),
    [events, overview?.activities]
  );
  const bibleFolders = bibleFiles.filter((item) => item.type === "directory");
  const bibleFileItems = bibleFiles.filter((item) => item.type === "file");

  useEffect(() => {
    void loadBibleStatus();
    void loadBibleFiles(BIBLE_ROOT_PATH);
  }, []);

  function directStorageUrl() {
    return luluStorageUrl.trim().replace(/\/$/, "");
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
      const response = await fetch(`/api/lulu/sd?action=bible_status&baseUrl=${encodeURIComponent(baseUrl)}`, { cache: "no-store" });
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
        `/api/lulu/sd?action=list&baseUrl=${encodeURIComponent(directStorageUrl())}&path=${encodeURIComponent(path)}`,
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

  async function uploadBibleFiles() {
    if (!pendingBibleFiles.length) {
      setOfflineMessage("Choose the prepared lulu/bible folder first.");
      return;
    }

    setUploadingBible(true);
    setBibleUploadProgress(0);
    setBibleUploadPhase("Preparing Bible upload");
    setOfflineMessage("");

    try {
      let uploaded = 0;
      for (const file of pendingBibleFiles) {
        const formData = new FormData();
        formData.append("baseUrl", directStorageUrl());
        formData.append("path", BIBLE_ROOT_PATH);
        formData.append("files", file, file.webkitRelativePath || file.name);

        setBibleUploadProgress(Math.round((uploaded / pendingBibleFiles.length) * 100));
        setBibleUploadPhase(`Uploading ${uploaded + 1} of ${pendingBibleFiles.length}`);
        const response = await uploadFormDataWithProgress(formData);
        if (!response.ok) throw new Error(response.data.detail ?? `Bible upload failed at ${file.name}`);
        uploaded += response.data.count ?? 1;
        setBibleUploadProgress(Math.round((uploaded / pendingBibleFiles.length) * 100));
      }

      setOfflineMessage(`Uploaded ${uploaded} Bible file(s) to LULU SD.`);
      setBibleUploadProgress(100);
      setBibleUploadPhase("Upload complete");
      clearBibleFiles(false);
      await loadBibleStatus();
      await loadBibleFiles(BIBLE_ROOT_PATH);
    } catch (error) {
      setOfflineMessage(error instanceof Error ? error.message : "Bible upload failed");
    } finally {
      setUploadingBible(false);
    }
  }

  async function openBibleItem(item: BibleSdItem) {
    if (item.type === "directory") {
      await loadBibleFiles(item.path);
      return;
    }
    window.open(`/api/lulu/sd?action=download&baseUrl=${encodeURIComponent(directStorageUrl())}&path=${encodeURIComponent(item.path)}`, "_blank");
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
                    <p className="font-medium">{formatBytes(offlineStatus?.storage_used_bytes ?? 0)}</p>
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
                    value={luluStorageUrl}
                    onChange={(event) => {
                      setLuluStorageUrl(event.target.value);
                      window.localStorage.setItem(LULU_STORAGE_URL_KEY, event.target.value);
                    }}
                  />
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
                    <p className="mt-1 text-cyan-100/80">Target: /lulu/bible</p>
                  </div>
                  <div className="space-y-2 rounded-md border border-white/10 bg-black/40 p-2 text-cyan-100/85">
                    <div className="flex gap-2"><CheckCircle2 className="mt-0.5 h-4 w-4 shrink-0 text-cyan-200" /><span>Prepare the ZIP with the Bible importer.</span></div>
                    <div className="flex gap-2"><CheckCircle2 className="mt-0.5 h-4 w-4 shrink-0 text-cyan-200" /><span>Select the generated lulu/bible folder.</span></div>
                    <div className="flex gap-2"><CheckCircle2 className="mt-0.5 h-4 w-4 shrink-0 text-cyan-200" /><span>Keep LULU powered on until upload completes.</span></div>
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
    </DashboardShell>
  );
}
