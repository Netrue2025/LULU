"use client";

import { Database, RefreshCw, Trash2, Upload } from "lucide-react";
import { useEffect, useState } from "react";
import { DashboardShell } from "@/components/dashboard/dashboard-shell";
import { SectionCard, StatusBadge } from "@/components/dashboard/shared";
import { Button } from "@/components/ui/button";
import { Input, Select } from "@/components/ui/input";
import { Table, Td, Th } from "@/components/ui/table";
import { initialKnowledge } from "@/lib/mock-data";
import { loadStored, saveStored } from "@/lib/store";
import type { KnowledgeItem } from "@/lib/types";
import { makeId } from "@/lib/utils";

export function KnowledgePage() {
  const [items, setItems] = useState<KnowledgeItem[]>(initialKnowledge);
  const [draft, setDraft] = useState({ name: "", type: "document", metadata: "" });

  useEffect(() => setItems(loadStored("lulu-knowledge", initialKnowledge)), []);
  useEffect(() => saveStored("lulu-knowledge", items), [items]);

  function addItem() {
    if (!draft.name) return;
    setItems((current) => [{ id: makeId("kb"), name: draft.name, type: draft.type as KnowledgeItem["type"], metadata: draft.metadata, status: "pending", updatedAt: new Date().toISOString() }, ...current]);
    setDraft({ name: "", type: "document", metadata: "" });
  }

  return (
    <DashboardShell title="Knowledge Base" subtitle="Documents, embeddings, uploads, and references">
      <div className="grid gap-4 xl:grid-cols-[360px_1fr]">
        <SectionCard title="Upload File">
          <div className="space-y-3">
            <Input placeholder="File or document name" value={draft.name} onChange={(event) => setDraft({ ...draft, name: event.target.value })} />
            <Select value={draft.type} onChange={(event) => setDraft({ ...draft, type: event.target.value })}>
              <option value="document">Document</option>
              <option value="embedding">Embedding</option>
              <option value="upload">Uploaded File</option>
              <option value="reference">Reference Data</option>
            </Select>
            <Input placeholder="Metadata" value={draft.metadata} onChange={(event) => setDraft({ ...draft, metadata: event.target.value })} />
            <Button className="w-full" onClick={addItem}><Upload className="h-4 w-4" />Upload</Button>
          </div>
        </SectionCard>
        <SectionCard title="Knowledge Items" action={<Button variant="secondary" onClick={() => setItems((current) => current.map((item) => ({ ...item, status: "indexed", updatedAt: new Date().toISOString() })))}><RefreshCw className="h-4 w-4" />Reindex</Button>}>
          <div className="overflow-x-auto thin-scrollbar">
            <Table>
              <thead>
                <tr><Th>Name</Th><Th>Type</Th><Th>Status</Th><Th>Updated</Th><Th>Metadata</Th><Th>Actions</Th></tr>
              </thead>
              <tbody>
                {items.map((item) => (
                  <tr key={item.id}>
                    <Td><div className="flex items-center gap-2"><Database className="h-4 w-4 text-muted-foreground" />{item.name}</div></Td>
                    <Td>{item.type}</Td>
                    <Td><StatusBadge status={item.status} /></Td>
                    <Td>{new Date(item.updatedAt).toLocaleString()}</Td>
                    <Td>{item.metadata}</Td>
                    <Td><Button variant="ghost" className="h-8 w-8 px-0" title="Delete" onClick={() => setItems((current) => current.filter((row) => row.id !== item.id))}><Trash2 className="h-4 w-4" /></Button></Td>
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
