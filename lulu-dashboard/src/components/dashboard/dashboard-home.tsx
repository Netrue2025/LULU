"use client";

import {
  Activity,
  ChevronDown,
  Clock,
  Cpu,
  Gauge,
  HardDrive,
  Mic,
  RadioTower,
  Server,
  Sparkles,
  Square
} from "lucide-react";
import { Area, AreaChart, CartesianGrid, ResponsiveContainer, Tooltip, XAxis, YAxis } from "recharts";
import { useMemo, useState } from "react";
import type { ReactNode } from "react";
import { DashboardShell } from "@/components/dashboard/dashboard-shell";
import { HealthIcon, PageGrid, SectionCard, StatCard, StatusBadge } from "@/components/dashboard/shared";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { analyticsRows, initialAlerts } from "@/lib/mock-data";
import { formatBytes, formatUptime, nowTime } from "@/lib/utils";
import { useLuluRealtime } from "@/hooks/use-lulu-realtime";
import { cn } from "@/lib/utils";

const keyActivityPattern = /radio|music|song|bible|scripture|reading|story|playing|listen|speaking|recording|weather|volume|stop/i;

export function DashboardHome() {
  const { health, overview, events, status, lastError } = useLuluRealtime();
  const [remoteStatus, setRemoteStatus] = useState("");
  const [sendingRemote, setSendingRemote] = useState(false);
  const [showMore, setShowMore] = useState(false);
  const unreadAlerts = initialAlerts.filter((alert) => alert.unread).length + (status === "offline" || status === "error" ? 1 : 0);

  const userPhrase = overview?.conversation.user?.text ?? "Waiting for Jeremiah...";
  const assistantResponse = overview?.conversation.lulu?.text ?? "LULU is ready.";
  const keyActivities = useMemo(() => {
    const live = overview?.activities ?? [];
    if (live.length > 0) return live.slice(0, 5);
    return events
      .filter((event) => keyActivityPattern.test(event.description))
      .slice(0, 3)
      .map((event) => ({ id: event.id, timestamp: event.timestamp, description: event.description }));
  }, [events, overview?.activities]);

  async function sendRemoteCommand(action: "listen" | "stop") {
    setSendingRemote(true);
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
      setSendingRemote(false);
    }
  }

  return (
    <DashboardShell title="Overview" subtitle="LULU live room" unreadAlerts={unreadAlerts}>
      <PageGrid>
        <section className="lulu-baby-panel overflow-hidden rounded-lg border border-white/10">
          <div className="lulu-rainbow-bar" />
          <div className="grid gap-4 p-3 sm:p-4 lg:grid-cols-[minmax(0,1fr)_18rem]">
            <div className="min-w-0 rounded-lg border border-white/10 bg-black/70 p-3 shadow-[inset_0_0_0_1px_rgba(255,255,255,0.06)] sm:p-4">
              <div className="mb-3 flex items-center justify-between gap-2">
                <div className="flex min-w-0 items-center gap-2">
                  <span className="flex h-8 w-8 shrink-0 items-center justify-center rounded-md bg-pink-400 text-slate-950">
                    <Sparkles className="h-4 w-4" />
                  </span>
                  <div className="min-w-0">
                    <h2 className="truncate text-sm font-semibold text-white">LULU terminal</h2>
                    <p className="truncate text-xs text-cyan-100/80">{overview?.checked_at ? `Updated ${new Date(overview.checked_at).toLocaleTimeString()}` : "Waiting for live feed"}</p>
                  </div>
                </div>
                <StatusBadge status={status} />
              </div>

              <div className="space-y-2 font-mono">
                <TerminalLine label="You say" text={userPhrase} tone="cyan" />
                <TerminalLine label="LULU" text={assistantResponse} tone="pink" />
              </div>

              <div className="mt-3 rounded-md border border-white/10 bg-slate-950/80 p-3">
                <div className="mb-2 flex items-center justify-between gap-2">
                  <p className="text-xs font-semibold uppercase text-yellow-200">Key activity</p>
                  <RadioTower className="h-4 w-4 text-green-300" />
                </div>
                {keyActivities.length > 0 ? (
                  <div className="space-y-2">
                    {keyActivities.map((activity) => (
                      <div key={activity.id} className="grid grid-cols-[4.5rem_1fr] gap-2 rounded-md border border-white/10 bg-white/5 px-2 py-2 text-xs text-slate-100">
                        <span className="text-cyan-200">{new Date(activity.timestamp).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" })}</span>
                        <span className="min-w-0 break-words">{activity.description}</span>
                      </div>
                    ))}
                  </div>
                ) : (
                  <p className="text-xs text-slate-400">No key action is active right now.</p>
                )}
              </div>
            </div>

            <aside className="grid content-start gap-3">
              <div className="rounded-lg border border-white/10 bg-white/10 p-3">
                <p className="text-xs font-semibold uppercase text-yellow-100">Voice control</p>
                <div className="mt-3 grid grid-cols-2 gap-2 lg:grid-cols-1">
                  <Button className="h-11 bg-cyan-300 text-slate-950 hover:bg-cyan-200" disabled={sendingRemote} onClick={() => sendRemoteCommand("listen")}>
                    <Mic className="h-4 w-4" />
                    Listen
                  </Button>
                  <Button className="h-11 bg-red-400 text-white hover:bg-red-300" disabled={sendingRemote} onClick={() => sendRemoteCommand("stop")}>
                    <Square className="h-4 w-4" />
                    Stop
                  </Button>
                </div>
                <p className="mt-3 min-h-4 text-xs text-pink-100">{remoteStatus || "Ready for remote action."}</p>
              </div>

              <div className="grid grid-cols-2 gap-2 lg:grid-cols-1">
                <MiniStatus label="Backend" value={status} tone={status === "online" ? "green" : "red"} icon={<HealthIcon status={status} />} />
                <MiniStatus label="Last check" value={health ? new Date(health.checked_at).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" }) : nowTime()} tone="yellow" icon={<Clock className="h-4 w-4" />} />
              </div>
            </aside>
          </div>
        </section>

        <div className="flex items-center justify-between gap-3 rounded-lg border border-white/10 bg-card/70 px-3 py-2">
          <div className="min-w-0">
            <p className="truncate text-sm font-medium">Overview is showing only live essentials.</p>
            <p className="truncate text-xs text-muted-foreground">More admin containers are tucked away.</p>
          </div>
          <Button variant="secondary" className="h-9 w-9 shrink-0 px-0" onClick={() => setShowMore(!showMore)} title={showMore ? "Hide more" : "See more"}>
            <ChevronDown className={cn("h-4 w-4 transition-transform", showMore ? "rotate-180" : "")} />
          </Button>
        </div>

        {showMore ? (
          <div className="grid gap-4">
            <SectionCard title="Quick Health">
              <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
                <StatCard label="Status" value={status} detail={lastError || `Source ${health?.source ?? "waiting"}`} icon={<HealthIcon status={status} />} tone={status === "online" ? "good" : status === "offline" ? "bad" : "warn"} />
                <StatCard label="Uptime" value={formatUptime(health?.metrics.dashboard_uptime_seconds ?? 0)} detail="Dashboard service" icon={<Clock className="h-4 w-4" />} />
                <StatCard label="Connections" value={`${health?.metrics.active_connections ?? 0}`} detail="Backend proxy" icon={<Server className="h-4 w-4" />} />
                <StatCard label="Key Events" value={`${keyActivities.length}`} detail="Terminal actions" icon={<Activity className="h-4 w-4" />} tone="info" />
              </div>
            </SectionCard>

            <SectionCard title="Performance" action={<Badge tone="info">Hidden</Badge>}>
              <div className="grid gap-3 sm:grid-cols-3">
                <StatCard label="CPU" value={`${health?.metrics.cpu_percent ?? 0}%`} detail="Dashboard host" icon={<Cpu className="h-4 w-4" />} tone={(health?.metrics.cpu_percent ?? 0) > 80 ? "warn" : "neutral"} />
                <StatCard label="RAM" value={`${health?.metrics.ram_percent ?? 0}%`} detail={formatBytes(health?.metrics.ram_used ?? 0)} icon={<Gauge className="h-4 w-4" />} tone={(health?.metrics.ram_percent ?? 0) > 80 ? "warn" : "neutral"} />
                <StatCard label="Disk" value={`${health?.metrics.disk_percent ?? 0}%`} detail={formatBytes(health?.metrics.disk_used ?? 0)} icon={<HardDrive className="h-4 w-4" />} />
              </div>
            </SectionCard>

            <SectionCard title="Request Trend">
              <div className="h-64">
                <ResponsiveContainer width="100%" height="100%">
                  <AreaChart data={analyticsRows}>
                    <defs>
                      <linearGradient id="requestsFillHidden" x1="0" x2="0" y1="0" y2="1">
                        <stop offset="5%" stopColor="hsl(var(--primary))" stopOpacity={0.5} />
                        <stop offset="95%" stopColor="hsl(var(--primary))" stopOpacity={0.02} />
                      </linearGradient>
                    </defs>
                    <CartesianGrid strokeDasharray="3 3" stroke="hsl(var(--border))" />
                    <XAxis dataKey="hour" tick={{ fill: "hsl(var(--muted-foreground))", fontSize: 12 }} />
                    <YAxis tick={{ fill: "hsl(var(--muted-foreground))", fontSize: 12 }} />
                    <Tooltip contentStyle={{ background: "hsl(var(--card))", border: "1px solid hsl(var(--border))", borderRadius: 8 }} />
                    <Area type="monotone" dataKey="requests" stroke="hsl(var(--primary))" fill="url(#requestsFillHidden)" />
                  </AreaChart>
                </ResponsiveContainer>
              </div>
            </SectionCard>

            <SectionCard title="Services">
              <div className="space-y-3">
                <SnapshotRow label="Whisper" value={health?.lulu?.whisper_model ?? "base"} status={status === "online" ? "online" : "offline"} />
                <SnapshotRow label="Piper" value={health?.lulu?.piper_voice?.split(/[\\/]/).pop() ?? "voice model"} status={status === "online" ? "online" : "offline"} />
                <SnapshotRow label="OpenAI" value={health?.lulu?.openai_model ?? "optional"} status={health?.lulu?.openai_enabled === "true" ? "online" : "offline"} />
                <SnapshotRow label="Radio" value={health?.lulu?.radio_stream_format ?? "PCM stream"} status={status === "online" ? "online" : "offline"} />
              </div>
            </SectionCard>
          </div>
        ) : null}
      </PageGrid>
    </DashboardShell>
  );
}

function TerminalLine({ label, text, tone }: { label: string; text: string; tone: "cyan" | "pink" }) {
  return (
    <div className="rounded-md border border-white/10 bg-slate-950/90 px-3 py-3">
      <p className={cn("text-xs font-semibold uppercase", tone === "cyan" ? "text-cyan-200" : "text-pink-200")}>{label}:</p>
      <p className="mt-1 break-words text-sm leading-6 text-white">{text}</p>
    </div>
  );
}

function MiniStatus({ label, value, icon, tone }: { label: string; value: string; icon: ReactNode; tone: "green" | "red" | "yellow" }) {
  return (
    <div className={cn("rounded-lg border p-3", tone === "green" && "border-green-300/30 bg-green-300/15", tone === "red" && "border-red-300/30 bg-red-400/15", tone === "yellow" && "border-yellow-200/30 bg-yellow-200/15")}>
      <div className="flex items-center gap-2 text-white">
        {icon}
        <p className="text-xs font-semibold uppercase">{label}</p>
      </div>
      <p className="mt-2 truncate text-sm text-white/90">{value}</p>
    </div>
  );
}

function SnapshotRow({ label, value, status }: { label: string; value: string; status: "online" | "offline" }) {
  return (
    <div className="flex items-center justify-between gap-3 rounded-md border px-3 py-3">
      <div className="min-w-0">
        <p className="text-sm font-medium">{label}</p>
        <p className="truncate text-xs text-muted-foreground">{value}</p>
      </div>
      <StatusBadge status={status} />
    </div>
  );
}
