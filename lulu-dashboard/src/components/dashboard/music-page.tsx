"use client";

import { ChangeEvent, useEffect, useState } from "react";
import { Mic, Music, RefreshCw, Square, Upload } from "lucide-react";
import { DashboardShell } from "@/components/dashboard/dashboard-shell";
import { PageGrid, StatusBadge } from "@/components/dashboard/shared";
import { Button } from "@/components/ui/button";
import { useLuluRealtime } from "@/hooks/use-lulu-realtime";

type MusicItem = {
  name: string;
  path: string;
  type: "file" | "directory";
  size?: number;
};

export function MusicPage() {
  const { overview, status } = useLuluRealtime();
  const [files, setFiles] = useState<MusicItem[]>([]);
  const [pendingFiles, setPendingFiles] = useState<File[]>([]);
  const [pageStatus, setPageStatus] = useState("");
  const [uploading, setUploading] = useState(false);
  const [sending, setSending] = useState(false);
  const musicActivities = (overview?.activities ?? []).filter((item) => /music|song|playing/i.test(item.description)).slice(0, 5);

  useEffect(() => {
    void loadMusic();
  }, []);

  async function loadMusic() {
    try {
      const response = await fetch("/api/lulu/storage?action=files&path=Music", { cache: "no-store" });
      const data = await response.json().catch(() => ({}));
      if (!response.ok) throw new Error(data.detail ?? "Could not load music");
      setFiles(Array.isArray(data.items) ? data.items : []);
      setPageStatus(data.sdcard_active ? "Music folder loaded from SD storage." : "Music folder loaded from server storage.");
    } catch (error) {
      setPageStatus(error instanceof Error ? error.message : "Could not load music");
    }
  }

  function selectFiles(event: ChangeEvent<HTMLInputElement>) {
    setPendingFiles(Array.from(event.target.files ?? []));
  }

  async function uploadMusic() {
    if (!pendingFiles.length) {
      setPageStatus("Choose music files first.");
      return;
    }

    setUploading(true);
    setPageStatus("Uploading music...");
    try {
      const formData = new FormData();
      formData.append("path", "Music");
      pendingFiles.forEach((file) => formData.append("files", file));
      const response = await fetch("/api/lulu/storage", { method: "POST", body: formData });
      const data = await response.json().catch(() => ({}));
      if (!response.ok) throw new Error(data.detail ?? "Music upload failed");
      setPendingFiles([]);
      setPageStatus(`Uploaded ${pendingFiles.length} file(s) to Music.`);
      await loadMusic();
    } catch (error) {
      setPageStatus(error instanceof Error ? error.message : "Music upload failed");
    } finally {
      setUploading(false);
    }
  }

  async function sendRemoteCommand(action: "listen" | "stop") {
    setSending(true);
    setPageStatus("");
    try {
      const response = await fetch("/api/lulu/control", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action })
      });
      const data = await response.json().catch(() => ({}));
      if (!response.ok) throw new Error(data.detail ?? "Remote command failed");
      setPageStatus(action === "listen" ? "Listening command sent." : "Stop command sent.");
    } catch (error) {
      setPageStatus(error instanceof Error ? error.message : "Remote command failed");
    } finally {
      setSending(false);
    }
  }

  return (
    <DashboardShell title="Music" subtitle="Songs and uploads">
      <PageGrid>
        <section className="lulu-baby-panel mx-auto w-full max-w-5xl overflow-hidden rounded-lg border border-white/10">
          <div className="lulu-rainbow-bar" />
          <div className="grid gap-4 p-3 sm:p-4 lg:grid-cols-[minmax(0,1fr)_18rem]">
            <div className="rounded-lg border border-white/10 bg-black/70 p-3 sm:p-4">
              <div className="mb-3 flex items-center justify-between gap-3">
                <div className="flex items-center gap-2">
                  <span className="flex h-8 w-8 items-center justify-center rounded-md bg-pink-400 text-slate-950">
                    <Music className="h-4 w-4" />
                  </span>
                  <div>
                    <h2 className="text-sm font-semibold text-white">Music</h2>
                    <p className="text-xs text-cyan-100/80">{files.length} item(s)</p>
                  </div>
                </div>
                <StatusBadge status={status} />
              </div>

              <div className="rounded-md border border-white/10 bg-white/5 p-3">
                <input className="block w-full text-xs text-muted-foreground file:mr-3 file:rounded-md file:border-0 file:bg-cyan-300 file:px-3 file:py-2 file:text-xs file:font-semibold file:text-slate-950" multiple onChange={selectFiles} type="file" />
                <div className="mt-3 grid grid-cols-2 gap-2">
                  <Button disabled={uploading} onClick={uploadMusic}>
                    <Upload className="h-4 w-4" />
                    Upload
                  </Button>
                  <Button variant="secondary" onClick={loadMusic}>
                    <RefreshCw className="h-4 w-4" />
                    Refresh
                  </Button>
                </div>
              </div>

              <div className="mt-3 max-h-64 overflow-y-auto rounded-md border border-white/10 bg-slate-950 p-3 font-mono text-xs text-cyan-100 thin-scrollbar">
                {files.length > 0 ? files.map((item) => <p key={item.path} className="truncate py-1">{item.name}</p>) : <p>No music files listed yet.</p>}
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
              <div className="mt-3 rounded-md border border-white/10 bg-black/50 p-3 text-xs">
                {musicActivities.length > 0 ? musicActivities.map((item) => <p key={item.id} className="truncate py-1">{item.description}</p>) : <p>No music activity yet.</p>}
              </div>
              <p className="mt-3 min-h-4 text-xs text-pink-100">{pageStatus || "Say play music after tapping Listen."}</p>
            </aside>
          </div>
        </section>
      </PageGrid>
    </DashboardShell>
  );
}
