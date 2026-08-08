"use client";

import { Bell, CheckCheck, Trash2 } from "lucide-react";
import { useEffect, useMemo, useState } from "react";
import { DashboardShell } from "@/components/dashboard/dashboard-shell";
import { SectionCard, StatusBadge } from "@/components/dashboard/shared";
import { Button } from "@/components/ui/button";
import { initialAlerts } from "@/lib/mock-data";
import { loadStored, saveStored } from "@/lib/store";
import type { AlertItem } from "@/lib/types";
import { useLuluRealtime } from "@/hooks/use-lulu-realtime";

export function AlertsPage() {
  const { status, health } = useLuluRealtime();
  const [items, setItems] = useState<AlertItem[]>(initialAlerts);

  useEffect(() => setItems(loadStored("lulu-alerts", initialAlerts)), []);
  useEffect(() => saveStored("lulu-alerts", items), [items]);

  const generated = useMemo(() => {
    const alerts: AlertItem[] = [];
    if (status === "offline" || status === "error") {
      alerts.push({ id: "generated-server-down", title: "Server down", message: "The LULU backend health endpoint is unreachable.", severity: "critical", unread: true, createdAt: new Date().toISOString() });
    }
    if ((health?.metrics.ram_percent ?? 0) > 80) {
      alerts.push({ id: "generated-high-ram", title: "High RAM", message: "Host memory usage is above 80 percent.", severity: "warning", unread: true, createdAt: new Date().toISOString() });
    }
    if ((health?.metrics.cpu_percent ?? 0) > 80) {
      alerts.push({ id: "generated-high-cpu", title: "High CPU", message: "Host CPU load is above 80 percent.", severity: "warning", unread: true, createdAt: new Date().toISOString() });
    }
    return alerts;
  }, [health?.metrics.cpu_percent, health?.metrics.ram_percent, status]);

  const allAlerts = [...generated, ...items];
  const unread = allAlerts.filter((item) => item.unread).length;

  return (
    <DashboardShell title="Alerts" subtitle="Notification center and unread alerts" unreadAlerts={unread}>
      <SectionCard title="Notification Center" action={<Button variant="secondary" onClick={() => setItems((current) => current.map((item) => ({ ...item, unread: false })))}><CheckCheck className="h-4 w-4" />Mark Read</Button>}>
        <div className="space-y-3">
          {allAlerts.map((item) => (
            <div key={item.id} className="flex items-start justify-between gap-3 rounded-md border px-3 py-3">
              <div className="flex min-w-0 gap-3">
                <div className="mt-0.5 rounded-md bg-muted p-2"><Bell className="h-4 w-4" /></div>
                <div>
                  <div className="flex flex-wrap items-center gap-2">
                    <p className="font-medium">{item.title}</p>
                    <StatusBadge status={item.severity === "critical" ? "error" : item.severity === "warning" ? "pending" : "online"} />
                    {item.unread ? <span className="h-2 w-2 rounded-full bg-primary" /> : null}
                  </div>
                  <p className="mt-1 text-sm text-muted-foreground">{item.message}</p>
                  <p className="mt-1 text-xs text-muted-foreground">{new Date(item.createdAt).toLocaleString()}</p>
                </div>
              </div>
              {!item.id.startsWith("generated") ? (
                <Button variant="ghost" className="h-8 w-8 px-0" title="Delete" onClick={() => setItems((current) => current.filter((row) => row.id !== item.id))}><Trash2 className="h-4 w-4" /></Button>
              ) : null}
            </div>
          ))}
        </div>
      </SectionCard>
    </DashboardShell>
  );
}
