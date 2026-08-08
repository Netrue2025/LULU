"use client";

import { Download, Filter, Search } from "lucide-react";
import { useMemo, useState } from "react";
import { DashboardShell } from "@/components/dashboard/dashboard-shell";
import { SectionCard, StatusBadge } from "@/components/dashboard/shared";
import { Button } from "@/components/ui/button";
import { Input, Select } from "@/components/ui/input";
import { Table, Td, Th } from "@/components/ui/table";
import { useLuluRealtime } from "@/hooks/use-lulu-realtime";
import { exportJson } from "@/lib/utils";

export function ActivityPage() {
  const { events, status } = useLuluRealtime();
  const [query, setQuery] = useState("");
  const [type, setType] = useState("all");
  const filtered = useMemo(
    () =>
      events.filter((event) => {
        const matchesQuery = `${event.description} ${event.type}`.toLowerCase().includes(query.toLowerCase());
        const matchesType = type === "all" || event.type === type;
        return matchesQuery && matchesType;
      }),
    [events, query, type]
  );

  return (
    <DashboardShell title="Live Activity" subtitle="Realtime event stream from dashboard adapters">
      <SectionCard
        title="Event Stream"
        action={
          <Button variant="secondary" onClick={() => exportJson("lulu-activity.json", filtered)}>
            <Download className="h-4 w-4" />
            Export
          </Button>
        }
      >
        <div className="mb-4 grid gap-3 md:grid-cols-[1fr_220px]">
          <div className="relative">
            <Search className="pointer-events-none absolute left-3 top-2.5 h-4 w-4 text-muted-foreground" />
            <Input className="pl-9" placeholder="Search activity" value={query} onChange={(event) => setQuery(event.target.value)} />
          </div>
          <div className="relative">
            <Filter className="pointer-events-none absolute left-3 top-2.5 h-4 w-4 text-muted-foreground" />
            <Select className="pl-9" value={type} onChange={(event) => setType(event.target.value)}>
              <option value="all">All event types</option>
              <option value="connection">Connection</option>
              <option value="audio">Audio</option>
              <option value="whisper">Whisper</option>
              <option value="llm">LLM</option>
              <option value="piper">Piper</option>
              <option value="heartbeat">Heartbeat</option>
              <option value="error">Error</option>
            </Select>
          </div>
        </div>
        <div className="overflow-x-auto thin-scrollbar">
          <Table>
            <thead>
              <tr>
                <Th>Timestamp</Th>
                <Th>Event Type</Th>
                <Th>Description</Th>
              </tr>
            </thead>
            <tbody>
              {filtered.map((event) => (
                <tr key={event.id}>
                  <Td>{new Date(event.timestamp).toLocaleTimeString()}</Td>
                  <Td><StatusBadge status={event.type === "error" ? "error" : status} /></Td>
                  <Td>{event.description}</Td>
                </tr>
              ))}
            </tbody>
          </Table>
        </div>
      </SectionCard>
    </DashboardShell>
  );
}
