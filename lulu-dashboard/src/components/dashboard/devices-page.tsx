"use client";

import { FileText, MessageSquare, Mic, Power, Radio, RotateCcw, Square, Trash2 } from "lucide-react";
import { useEffect, useState } from "react";
import { DashboardShell } from "@/components/dashboard/dashboard-shell";
import { SectionCard, StatusBadge } from "@/components/dashboard/shared";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/input";
import { Table, Td, Th } from "@/components/ui/table";
import { initialDevices } from "@/lib/mock-data";
import { loadStored, saveStored } from "@/lib/store";
import type { Device } from "@/lib/types";

export function DevicesPage() {
  const [items, setItems] = useState<Device[]>(initialDevices);
  const [remoteText, setRemoteText] = useState("Hello Jeremiah, this is LULU speaking from the dashboard.");
  const [remoteStatus, setRemoteStatus] = useState("");
  const [sending, setSending] = useState(false);

  useEffect(() => setItems(loadStored("lulu-devices", initialDevices)), []);
  useEffect(() => saveStored("lulu-devices", items), [items]);

  async function sendRemoteCommand(action: "speak" | "radio" | "stop" | "ready" | "listen") {
    setSending(true);
    setRemoteStatus("");

    try {
      const response = await fetch("/api/lulu/control", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          action,
          text: action === "speak" ? remoteText : ""
        })
      });
      const data = await response.json().catch(() => ({}));
      if (!response.ok) throw new Error(data.detail ?? "Remote command failed");
      setRemoteStatus(`Queued ${action} command for LULU.`);
    } catch (error) {
      setRemoteStatus(error instanceof Error ? error.message : "Remote command failed");
    } finally {
      setSending(false);
    }
  }

  return (
    <DashboardShell title="Device Management" subtitle="Connected ESP32 devices and actions">
      <div className="grid gap-4 xl:grid-cols-[420px_1fr]">
        <SectionCard title="Remote Control">
          <div className="space-y-3">
            <Textarea
              maxLength={240}
              value={remoteText}
              onChange={(event) => setRemoteText(event.target.value)}
              placeholder="Message LULU should speak"
            />
            <div className="grid grid-cols-2 gap-2">
              <Button variant="secondary" disabled={sending} onClick={() => sendRemoteCommand("listen")}>
                <Mic className="h-4 w-4" />
                Start Listening
              </Button>
              <Button disabled={sending || !remoteText.trim()} onClick={() => sendRemoteCommand("speak")}>
                <MessageSquare className="h-4 w-4" />
                Speak
              </Button>
              <Button variant="secondary" disabled={sending} onClick={() => sendRemoteCommand("radio")}>
                <Radio className="h-4 w-4" />
                Radio
              </Button>
              <Button variant="secondary" disabled={sending} onClick={() => sendRemoteCommand("stop")}>
                <Square className="h-4 w-4" />
                Stop
              </Button>
              <Button variant="secondary" disabled={sending} onClick={() => sendRemoteCommand("ready")}>
                <Power className="h-4 w-4" />
                Ready
              </Button>
            </div>
            {remoteStatus ? <p className="text-sm text-muted-foreground">{remoteStatus}</p> : null}
            <p className="text-xs text-muted-foreground">
              Commands are queued on the LULU server and picked up by the ESP32 while it is idle.
            </p>
          </div>
        </SectionCard>
        <SectionCard title="Connected Devices">
        <div className="overflow-x-auto thin-scrollbar">
          <Table>
            <thead>
              <tr><Th>Device Name</Th><Th>Device ID</Th><Th>IP Address</Th><Th>Last Seen</Th><Th>Status</Th><Th>Actions</Th></tr>
            </thead>
            <tbody>
              {items.map((item) => (
                <tr key={item.id}>
                  <Td>{item.name}</Td>
                  <Td>{item.id}</Td>
                  <Td>{item.ipAddress}</Td>
                  <Td>{new Date(item.lastSeen).toLocaleString()}</Td>
                  <Td><StatusBadge status={item.status} /></Td>
                  <Td>
                    <div className="flex gap-2">
                      <Button variant="ghost" className="h-8 w-8 px-0" title="Disconnect" onClick={() => setItems((current) => current.map((row) => row.id === item.id ? { ...row, status: "offline" } : row))}><Power className="h-4 w-4" /></Button>
                      <Button variant="ghost" className="h-8 w-8 px-0" title="Restart" onClick={() => setItems((current) => current.map((row) => row.id === item.id ? { ...row, status: "restarting", lastSeen: new Date().toISOString() } : row))}><RotateCcw className="h-4 w-4" /></Button>
                      <Button variant="ghost" className="h-8 w-8 px-0" title="View logs"><FileText className="h-4 w-4" /></Button>
                      <Button variant="ghost" className="h-8 w-8 px-0" title="Remove" onClick={() => setItems((current) => current.filter((row) => row.id !== item.id))}><Trash2 className="h-4 w-4" /></Button>
                    </div>
                  </Td>
                </tr>
              ))}
            </tbody>
          </Table>
        </div>
        </SectionCard>
      </div>
    </DashboardShell>
  );
}
