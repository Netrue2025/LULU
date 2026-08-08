"use client";

import { Activity, Bell, BookOpen, Clock, Cpu, Database, Gauge, HardDrive, Mic, RadioTower, Server, Square, Users } from "lucide-react";
import { Area, AreaChart, CartesianGrid, ResponsiveContainer, Tooltip, XAxis, YAxis } from "recharts";
import { useState } from "react";
import { DashboardShell } from "@/components/dashboard/dashboard-shell";
import { HealthIcon, PageGrid, SectionCard, StatCard, StatusBadge } from "@/components/dashboard/shared";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { analyticsRows, initialAlerts, initialConversations, initialReminders } from "@/lib/mock-data";
import { formatBytes, formatUptime, nowTime } from "@/lib/utils";
import { useLuluRealtime } from "@/hooks/use-lulu-realtime";

export function DashboardHome() {
  const { health, events, status, lastError } = useLuluRealtime();
  const [remoteStatus, setRemoteStatus] = useState("");
  const [sendingRemote, setSendingRemote] = useState(false);
  const unreadAlerts = initialAlerts.filter((alert) => alert.unread).length + (status === "offline" || status === "error" ? 1 : 0);

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
      setRemoteStatus(action === "listen" ? "Listen command queued. Speak near LULU." : "Stop command queued.");
    } catch (error) {
      setRemoteStatus(error instanceof Error ? error.message : "Remote command failed");
    } finally {
      setSendingRemote(false);
    }
  }

  return (
    <DashboardShell title="Overview" subtitle="Live operating picture for LULU" unreadAlerts={unreadAlerts}>
      <PageGrid>
        <div className="dashboard-grid gap-4">
          <StatCard label="LULU Name" value="LULU" detail="Local voice assistant" icon={<RadioTower className="h-4 w-4" />} tone="info" />
          <StatCard label="Current Status" value={status} detail={lastError || `Last check ${health ? new Date(health.checked_at).toLocaleTimeString() : nowTime()}`} icon={<HealthIcon status={status} />} tone={status === "online" ? "good" : status === "offline" ? "bad" : "warn"} />
          <StatCard label="Server Uptime" value={formatUptime(health?.metrics.dashboard_uptime_seconds ?? 0)} detail="Dashboard wrapper process" icon={<Clock className="h-4 w-4" />} />
          <StatCard label="CPU Usage" value={`${health?.metrics.cpu_percent ?? 0}%`} detail="Host load average" icon={<Cpu className="h-4 w-4" />} tone={(health?.metrics.cpu_percent ?? 0) > 80 ? "warn" : "neutral"} />
          <StatCard label="RAM Usage" value={`${health?.metrics.ram_percent ?? 0}%`} detail={formatBytes(health?.metrics.ram_used ?? 0)} icon={<Gauge className="h-4 w-4" />} tone={(health?.metrics.ram_percent ?? 0) > 80 ? "warn" : "neutral"} />
          <StatCard label="Disk Usage" value={`${health?.metrics.disk_percent ?? 0}%`} detail={formatBytes(health?.metrics.disk_used ?? 0)} icon={<HardDrive className="h-4 w-4" />} />
          <StatCard label="Active Connections" value={`${health?.metrics.active_connections ?? 0}`} detail={health?.source ?? "Waiting for source"} icon={<Server className="h-4 w-4" />} />
          <StatCard label="API Calls Today" value={`${events.length}`} detail="Dashboard observed events" icon={<Activity className="h-4 w-4" />} tone="info" />
          <StatCard label="Total Conversations" value={`${initialConversations.length}`} detail="Local dashboard store" icon={<BookOpen className="h-4 w-4" />} />
          <StatCard label="Total Users" value="1" detail="ESP32 default user" icon={<Users className="h-4 w-4" />} />
          <StatCard label="Total Reminders" value={`${initialReminders.length}`} detail="Dashboard mirror" icon={<Bell className="h-4 w-4" />} />
          <StatCard label="Knowledge Items" value="2" detail="Local Q&A and stories" icon={<Database className="h-4 w-4" />} />
        </div>

        <div className="grid gap-4 xl:grid-cols-[1.4fr_0.8fr]">
          <SectionCard title="Remote Voice Control">
            <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
              <div>
                <p className="text-sm font-medium">Start LULU listening from the app</p>
                {remoteStatus ? <p className="mt-1 text-xs text-muted-foreground">{remoteStatus}</p> : <p className="mt-1 text-xs text-muted-foreground">LULU will pick this up while idle.</p>}
              </div>
              <div className="flex gap-2">
                <Button disabled={sendingRemote} onClick={() => sendRemoteCommand("listen")}>
                  <Mic className="h-4 w-4" />
                  Start Listening
                </Button>
                <Button variant="secondary" disabled={sendingRemote} onClick={() => sendRemoteCommand("stop")}>
                  <Square className="h-4 w-4" />
                  Stop
                </Button>
              </div>
            </div>
          </SectionCard>

          <SectionCard title="Requests Per Hour" action={<Badge tone="info">Today</Badge>}>
            <div className="h-72">
              <ResponsiveContainer width="100%" height="100%">
                <AreaChart data={analyticsRows}>
                  <defs>
                    <linearGradient id="requestsFill" x1="0" x2="0" y1="0" y2="1">
                      <stop offset="5%" stopColor="hsl(var(--primary))" stopOpacity={0.45} />
                      <stop offset="95%" stopColor="hsl(var(--primary))" stopOpacity={0.02} />
                    </linearGradient>
                  </defs>
                  <CartesianGrid strokeDasharray="3 3" stroke="hsl(var(--border))" />
                  <XAxis dataKey="hour" tick={{ fill: "hsl(var(--muted-foreground))", fontSize: 12 }} />
                  <YAxis tick={{ fill: "hsl(var(--muted-foreground))", fontSize: 12 }} />
                  <Tooltip contentStyle={{ background: "hsl(var(--card))", border: "1px solid hsl(var(--border))", borderRadius: 8 }} />
                  <Area type="monotone" dataKey="requests" stroke="hsl(var(--primary))" fill="url(#requestsFill)" />
                </AreaChart>
              </ResponsiveContainer>
            </div>
          </SectionCard>

          <SectionCard title="Service Snapshot">
            <div className="space-y-3">
              <SnapshotRow label="Whisper" value={health?.lulu?.whisper_model ?? "base"} status={status === "online" ? "online" : "offline"} />
              <SnapshotRow label="Piper" value={health?.lulu?.piper_voice?.split(/[\\/]/).pop() ?? "voice model"} status={status === "online" ? "online" : "offline"} />
              <SnapshotRow label="OpenAI" value={health?.lulu?.openai_model ?? "optional"} status={health?.lulu?.openai_enabled === "true" ? "online" : "offline"} />
              <SnapshotRow label="Radio" value={health?.lulu?.radio_stream_format ?? "PCM stream"} status={status === "online" ? "online" : "offline"} />
            </div>
          </SectionCard>
        </div>
      </PageGrid>
    </DashboardShell>
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
