"use client";

import { RefreshCw, RotateCcw } from "lucide-react";
import { DashboardShell } from "@/components/dashboard/dashboard-shell";
import { SectionCard, StatCard, StatusBadge } from "@/components/dashboard/shared";
import { Button } from "@/components/ui/button";
import { useLuluRealtime } from "@/hooks/use-lulu-realtime";

export function SpeechPage() {
  const { health, status } = useLuluRealtime();
  const voice = health?.lulu?.piper_voice?.split(/[\\/]/).pop() ?? "Unknown voice";

  return (
    <DashboardShell title="Speech Services" subtitle="Whisper and Piper service status">
      <div className="grid gap-4 xl:grid-cols-2">
        <SectionCard title="Whisper" action={<StatusBadge status={status} />}>
          <div className="dashboard-grid gap-4">
            <StatCard label="Service Status" value={status} icon={<RefreshCw className="h-4 w-4" />} tone={status === "online" ? "good" : "bad"} />
            <StatCard label="Model Name" value={health?.lulu?.whisper_model ?? "base"} detail={`Beam ${health?.lulu?.whisper_beam_size ?? "5"}`} icon={<RefreshCw className="h-4 w-4" />} />
            <StatCard label="Queue Length" value="0" detail="No queue endpoint yet" icon={<RefreshCw className="h-4 w-4" />} />
            <StatCard label="Average Processing" value="1.2s" detail="Dashboard estimate" icon={<RefreshCw className="h-4 w-4" />} />
          </div>
          <div className="mt-4 flex gap-2">
            <Button variant="secondary"><RotateCcw className="h-4 w-4" />Restart Service</Button>
            <Button><RefreshCw className="h-4 w-4" />Refresh Status</Button>
          </div>
        </SectionCard>
        <SectionCard title="Piper" action={<StatusBadge status={status} />}>
          <div className="dashboard-grid gap-4">
            <StatCard label="Service Status" value={status} icon={<RefreshCw className="h-4 w-4" />} tone={status === "online" ? "good" : "bad"} />
            <StatCard label="Voice Name" value={voice} detail={health?.lulu?.piper_length_scale ? `Length ${health.lulu.piper_length_scale}` : "Voice path"} icon={<RefreshCw className="h-4 w-4" />} />
            <StatCard label="Queue Length" value="0" detail="Synthesis lock is backend-side" icon={<RefreshCw className="h-4 w-4" />} />
            <StatCard label="Average Synthesis" value="1.8s" detail="Dashboard estimate" icon={<RefreshCw className="h-4 w-4" />} />
          </div>
          <div className="mt-4 flex gap-2">
            <Button variant="secondary"><RotateCcw className="h-4 w-4" />Restart Service</Button>
            <Button><RefreshCw className="h-4 w-4" />Refresh Status</Button>
          </div>
        </SectionCard>
      </div>
    </DashboardShell>
  );
}
