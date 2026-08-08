"use client";

import { CalendarDays, Pause, Play, Plus, Trash2 } from "lucide-react";
import { useEffect, useState } from "react";
import { DashboardShell } from "@/components/dashboard/dashboard-shell";
import { SectionCard, StatusBadge } from "@/components/dashboard/shared";
import { Button } from "@/components/ui/button";
import { Input, Textarea } from "@/components/ui/input";
import { Table, Td, Th } from "@/components/ui/table";
import { initialReminders } from "@/lib/mock-data";
import { loadStored, saveStored } from "@/lib/store";
import type { Reminder } from "@/lib/types";
import { makeId } from "@/lib/utils";

export function RemindersPage() {
  const [items, setItems] = useState<Reminder[]>(initialReminders);
  const [draft, setDraft] = useState({ title: "", message: "", scheduleTime: "" });

  useEffect(() => setItems(loadStored("lulu-reminders", initialReminders)), []);
  useEffect(() => saveStored("lulu-reminders", items), [items]);

  function addReminder() {
    if (!draft.title || !draft.scheduleTime) return;
    setItems((current) => [
      { id: makeId("rem"), title: draft.title, message: draft.message, scheduleTime: new Date(draft.scheduleTime).toISOString(), status: "scheduled" },
      ...current
    ]);
    setDraft({ title: "", message: "", scheduleTime: "" });
  }

  const upcoming = items.filter((item) => item.status !== "completed").sort((a, b) => +new Date(a.scheduleTime) - +new Date(b.scheduleTime));

  return (
    <DashboardShell title="Reminder Management" subtitle="Create, pause, resume, and inspect reminders">
      <div className="grid gap-4 xl:grid-cols-[360px_1fr]">
        <SectionCard title="Create Reminder">
          <div className="space-y-3">
            <Input placeholder="Title" value={draft.title} onChange={(event) => setDraft({ ...draft, title: event.target.value })} />
            <Textarea placeholder="Message" value={draft.message} onChange={(event) => setDraft({ ...draft, message: event.target.value })} />
            <Input type="datetime-local" value={draft.scheduleTime} onChange={(event) => setDraft({ ...draft, scheduleTime: event.target.value })} />
            <Button className="w-full" onClick={addReminder}><Plus className="h-4 w-4" />Create</Button>
          </div>
        </SectionCard>
        <SectionCard title="All Reminders">
          <div className="overflow-x-auto thin-scrollbar">
            <Table>
              <thead>
                <tr>
                  <Th>Reminder ID</Th>
                  <Th>Title</Th>
                  <Th>Message</Th>
                  <Th>Schedule Time</Th>
                  <Th>Status</Th>
                  <Th>Actions</Th>
                </tr>
              </thead>
              <tbody>
                {items.map((item) => (
                  <tr key={item.id}>
                    <Td>{item.id}</Td>
                    <Td>{item.title}</Td>
                    <Td>{item.message}</Td>
                    <Td>{new Date(item.scheduleTime).toLocaleString()}</Td>
                    <Td><StatusBadge status={item.status} /></Td>
                    <Td>
                      <div className="flex gap-2">
                        <Button variant="ghost" className="h-8 w-8 px-0" title={item.status === "paused" ? "Resume" : "Pause"} onClick={() => setItems((current) => current.map((row) => row.id === item.id ? { ...row, status: row.status === "paused" ? "scheduled" : "paused" } : row))}>
                          {item.status === "paused" ? <Play className="h-4 w-4" /> : <Pause className="h-4 w-4" />}
                        </Button>
                        <Button variant="ghost" className="h-8 w-8 px-0" title="Delete" onClick={() => setItems((current) => current.filter((row) => row.id !== item.id))}><Trash2 className="h-4 w-4" /></Button>
                      </div>
                    </Td>
                  </tr>
                ))}
              </tbody>
            </Table>
          </div>
        </SectionCard>
      </div>
      <div className="mt-4 grid gap-4 xl:grid-cols-2">
        <SectionCard title="Upcoming Reminders">
          <div className="space-y-2">
            {upcoming.map((item) => (
              <div key={item.id} className="flex items-center justify-between gap-3 rounded-md border px-3 py-3">
                <div>
                  <p className="text-sm font-medium">{item.title}</p>
                  <p className="text-xs text-muted-foreground">{new Date(item.scheduleTime).toLocaleString()}</p>
                </div>
                <StatusBadge status={item.status} />
              </div>
            ))}
          </div>
        </SectionCard>
        <SectionCard title="Calendar View" action={<CalendarDays className="h-4 w-4 text-muted-foreground" />}>
          <div className="grid grid-cols-7 gap-2 text-center text-xs">
            {Array.from({ length: 35 }, (_, index) => (
              <div key={index} className="flex aspect-square items-center justify-center rounded-md border bg-background">
                {index + 1 <= 31 ? index + 1 : ""}
              </div>
            ))}
          </div>
        </SectionCard>
      </div>
    </DashboardShell>
  );
}
