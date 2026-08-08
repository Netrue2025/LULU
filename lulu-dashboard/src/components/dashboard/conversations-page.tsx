"use client";

import { Download, Eye, Search, Trash2 } from "lucide-react";
import { useEffect, useMemo, useState } from "react";
import { DashboardShell } from "@/components/dashboard/dashboard-shell";
import { SectionCard } from "@/components/dashboard/shared";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Table, Td, Th } from "@/components/ui/table";
import { initialConversations } from "@/lib/mock-data";
import { loadStored, saveStored } from "@/lib/store";
import type { Conversation } from "@/lib/types";
import { exportJson } from "@/lib/utils";

export function ConversationsPage() {
  const [items, setItems] = useState<Conversation[]>(initialConversations);
  const [query, setQuery] = useState("");
  const [selected, setSelected] = useState<Conversation | null>(null);
  const [page, setPage] = useState(1);
  const pageSize = 8;

  useEffect(() => setItems(loadStored("lulu-conversations", initialConversations)), []);
  useEffect(() => saveStored("lulu-conversations", items), [items]);

  const filtered = useMemo(
    () => items.filter((item) => `${item.userId} ${item.question} ${item.response}`.toLowerCase().includes(query.toLowerCase())),
    [items, query]
  );
  const paged = filtered.slice((page - 1) * pageSize, page * pageSize);
  const totalPages = Math.max(1, Math.ceil(filtered.length / pageSize));

  return (
    <DashboardShell title="Conversation History" subtitle="Questions, responses, latency, and exports">
      <SectionCard title="Conversations" action={<Button variant="secondary" onClick={() => exportJson("lulu-conversations.json", filtered)}><Download className="h-4 w-4" />Export</Button>}>
        <div className="relative mb-4">
          <Search className="pointer-events-none absolute left-3 top-2.5 h-4 w-4 text-muted-foreground" />
          <Input className="pl-9" placeholder="Search conversations" value={query} onChange={(event) => setQuery(event.target.value)} />
        </div>
        <div className="overflow-x-auto thin-scrollbar">
          <Table>
            <thead>
              <tr>
                <Th>User ID</Th>
                <Th>Timestamp</Th>
                <Th>Question</Th>
                <Th>Response</Th>
                <Th>Latency</Th>
                <Th>Actions</Th>
              </tr>
            </thead>
            <tbody>
              {paged.map((item) => (
                <tr key={item.id}>
                  <Td>{item.userId}</Td>
                  <Td>{new Date(item.timestamp).toLocaleString()}</Td>
                  <Td className="max-w-xs">{item.question}</Td>
                  <Td className="max-w-sm">{item.response}</Td>
                  <Td>{item.latencyMs}ms</Td>
                  <Td>
                    <div className="flex gap-2">
                      <Button variant="ghost" className="h-8 w-8 px-0" onClick={() => setSelected(item)} title="View conversation"><Eye className="h-4 w-4" /></Button>
                      <Button variant="ghost" className="h-8 w-8 px-0" onClick={() => setItems((current) => current.filter((row) => row.id !== item.id))} title="Delete conversation"><Trash2 className="h-4 w-4" /></Button>
                    </div>
                  </Td>
                </tr>
              ))}
            </tbody>
          </Table>
        </div>
        <div className="mt-4 flex items-center justify-between">
          <p className="text-sm text-muted-foreground">Page {page} of {totalPages}</p>
          <div className="flex gap-2">
            <Button variant="secondary" disabled={page === 1} onClick={() => setPage((current) => current - 1)}>Prev</Button>
            <Button variant="secondary" disabled={page === totalPages} onClick={() => setPage((current) => current + 1)}>Next</Button>
          </div>
        </div>
      </SectionCard>
      {selected ? (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-background/80 p-4 backdrop-blur">
          <div className="w-full max-w-2xl rounded-lg border bg-card p-5 shadow-panel">
            <h2 className="mb-3 text-lg font-semibold">Conversation Detail</h2>
            <p className="text-sm text-muted-foreground">{selected.userId} at {new Date(selected.timestamp).toLocaleString()}</p>
            <div className="mt-4 space-y-3 text-sm">
              <p><span className="font-medium">Question:</span> {selected.question}</p>
              <p><span className="font-medium">Response:</span> {selected.response}</p>
              <p><span className="font-medium">Latency:</span> {selected.latencyMs}ms</p>
            </div>
            <div className="mt-5 flex justify-end gap-2">
              <Button variant="secondary" onClick={() => exportJson(`${selected.id}.json`, selected)}>Export</Button>
              <Button onClick={() => setSelected(null)}>Close</Button>
            </div>
          </div>
        </div>
      ) : null}
    </DashboardShell>
  );
}
