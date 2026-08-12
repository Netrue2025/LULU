"use client";

import { ReactNode } from "react";
import { AlertTriangle, CheckCircle2, Circle, ServerCrash } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { cn } from "@/lib/utils";
import type { LuluStatus } from "@/lib/types";

export function PageGrid({ children }: { children: ReactNode }) {
  return <div className="grid gap-4">{children}</div>;
}

export function StatCard({
  label,
  value,
  detail,
  icon,
  tone = "neutral"
}: {
  label: string;
  value: string;
  detail?: string;
  icon: ReactNode;
  tone?: "neutral" | "good" | "warn" | "bad" | "info";
}) {
  return (
    <Card>
      <CardContent className="flex min-h-32 flex-col justify-between">
        <div className="flex items-start justify-between gap-4">
          <p className="text-sm text-muted-foreground">{label}</p>
          <span className={cn("rounded-md p-2", toneClass(tone))}>{icon}</span>
        </div>
        <div>
          <p className="mt-4 text-2xl font-semibold">{value}</p>
          {detail ? <p className="mt-1 text-xs text-muted-foreground">{detail}</p> : null}
        </div>
      </CardContent>
    </Card>
  );
}

export function StatusBadge({ status }: { status: LuluStatus | string }) {
  const tone = status === "online" || status === "scheduled" || status === "indexed" ? "good" : status === "error" || status === "offline" ? "bad" : status === "paused" || status === "pending" ? "warn" : "info";
  return <Badge tone={tone}>{status}</Badge>;
}

export function SectionCard({ title, children, action, className }: { title: string; children: ReactNode; action?: ReactNode; className?: string }) {
  return (
    <Card className={className}>
      <CardHeader className="flex flex-row items-center justify-between gap-3 space-y-0">
        <CardTitle>{title}</CardTitle>
        {action}
      </CardHeader>
      <CardContent>{children}</CardContent>
    </Card>
  );
}

export function HealthIcon({ status }: { status: LuluStatus }) {
  if (status === "online") return <CheckCircle2 className="h-4 w-4" />;
  if (status === "error") return <AlertTriangle className="h-4 w-4" />;
  if (status === "offline") return <ServerCrash className="h-4 w-4" />;
  return <Circle className="h-4 w-4" />;
}

function toneClass(tone: "neutral" | "good" | "warn" | "bad" | "info") {
  return {
    neutral: "bg-muted text-muted-foreground",
    good: "bg-emerald-500/15 text-emerald-700 dark:text-emerald-300",
    warn: "bg-amber-500/15 text-amber-700 dark:text-amber-300",
    bad: "bg-rose-500/15 text-rose-700 dark:text-rose-300",
    info: "bg-sky-500/15 text-sky-700 dark:text-sky-300"
  }[tone];
}
