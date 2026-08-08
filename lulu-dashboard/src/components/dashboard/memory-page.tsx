"use client";

import { Pencil, Plus, Search, Trash2 } from "lucide-react";
import { useEffect, useMemo, useState } from "react";
import { DashboardShell } from "@/components/dashboard/dashboard-shell";
import { SectionCard } from "@/components/dashboard/shared";
import { Button } from "@/components/ui/button";
import { Input, Textarea } from "@/components/ui/input";
import { Table, Td, Th } from "@/components/ui/table";
import { initialMemories } from "@/lib/mock-data";
import { loadStored, saveStored } from "@/lib/store";
import type { MemoryItem } from "@/lib/types";
import { makeId } from "@/lib/utils";

export function MemoryPage() {
  const [items, setItems] = useState<MemoryItem[]>(initialMemories);
  const [query, setQuery] = useState("");
  const [draft, setDraft] = useState({ category: "", content: "" });
  const [editingId, setEditingId] = useState("");

  useEffect(() => setItems(loadStored("lulu-memories", initialMemories)), []);
  useEffect(() => saveStored("lulu-memories", items), [items]);

  const filtered = useMemo(() => items.filter((item) => `${item.category} ${item.content}`.toLowerCase().includes(query.toLowerCase())), [items, query]);

  function saveMemory() {
    if (!draft.category || !draft.content) return;
    if (editingId) {
      setItems((current) => current.map((item) => item.id === editingId ? { ...item, category: draft.category, content: draft.content } : item));
    } else {
      setItems((current) => [{ id: makeId("mem"), category: draft.category, content: draft.content, createdDate: new Date().toISOString() }, ...current]);
    }
    setDraft({ category: "", content: "" });
    setEditingId("");
  }

  return (
    <DashboardShell title="Memory Management" subtitle="Stored user and assistant context">
      <div className="grid gap-4 xl:grid-cols-[360px_1fr]">
        <SectionCard title={editingId ? "Edit Memory" : "Add Memory"}>
          <div className="space-y-3">
            <Input placeholder="Category" value={draft.category} onChange={(event) => setDraft({ ...draft, category: event.target.value })} />
            <Textarea placeholder="Content" value={draft.content} onChange={(event) => setDraft({ ...draft, content: event.target.value })} />
            <Button className="w-full" onClick={saveMemory}><Plus className="h-4 w-4" />Save</Button>
          </div>
        </SectionCard>
        <SectionCard title="Memories">
          <div className="relative mb-4">
            <Search className="pointer-events-none absolute left-3 top-2.5 h-4 w-4 text-muted-foreground" />
            <Input className="pl-9" placeholder="Search memory" value={query} onChange={(event) => setQuery(event.target.value)} />
          </div>
          <div className="overflow-x-auto thin-scrollbar">
            <Table>
              <thead>
                <tr><Th>Memory ID</Th><Th>Category</Th><Th>Content</Th><Th>Created Date</Th><Th>Actions</Th></tr>
              </thead>
              <tbody>
                {filtered.map((item) => (
                  <tr key={item.id}>
                    <Td>{item.id}</Td>
                    <Td>{item.category}</Td>
                    <Td className="max-w-xl">{item.content}</Td>
                    <Td>{new Date(item.createdDate).toLocaleString()}</Td>
                    <Td>
                      <div className="flex gap-2">
                        <Button variant="ghost" className="h-8 w-8 px-0" title="Edit" onClick={() => { setEditingId(item.id); setDraft({ category: item.category, content: item.content }); }}><Pencil className="h-4 w-4" /></Button>
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
    </DashboardShell>
  );
}
