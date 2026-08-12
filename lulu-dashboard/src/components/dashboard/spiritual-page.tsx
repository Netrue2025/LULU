"use client";

import { BookOpen, Database, Mic, RefreshCw, Square } from "lucide-react";
import { useEffect, useMemo, useState } from "react";
import { DashboardShell } from "@/components/dashboard/dashboard-shell";
import { PageGrid, StatusBadge } from "@/components/dashboard/shared";
import { Button } from "@/components/ui/button";
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
  const bible = overview?.bible;
  const bibleActivities = useMemo(
    () => (overview?.activities ?? events).filter((item) => /bible|scripture|reading|verse|psalm|proverb/i.test(item.description)).slice(0, 5),
    [events, overview?.activities]
  );

  useEffect(() => {
    void loadBibleStatus();
  }, []);

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
      const response = await fetch("/api/lulu/sd?action=bible_status", { cache: "no-store" });
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
            <div className="grid gap-3 md:grid-cols-[minmax(0,1fr)_16rem]">
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
                <div className="grid gap-2">
                  <Button disabled={offlineBusy} onClick={loadBibleStatus}>
                    <RefreshCw className="h-4 w-4" />
                    Refresh
                  </Button>
                </div>
              </aside>
            </div>
          </div>
        </section>
      </PageGrid>
    </DashboardShell>
  );
}
