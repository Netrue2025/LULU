"use client";

import { BookOpenText } from "lucide-react";
import { DashboardShell } from "@/components/dashboard/dashboard-shell";
import { PageGrid } from "@/components/dashboard/shared";
import { SdMediaManager } from "@/components/dashboard/sd-media-manager";

export function StoriesPage() {
  return (
    <DashboardShell title="Stories" subtitle="SD story library">
      <PageGrid>
        <section className="lulu-baby-panel mx-auto w-full max-w-6xl overflow-hidden rounded-lg border border-white/10">
          <div className="lulu-rainbow-bar" />
          <div className="p-3 sm:p-4">
            <SdMediaManager
              title="Stories"
              subtitle="Manage stories on LULU SD"
              rootPath="Stories"
              accept=".txt,.json,.wav,.mp3,audio/*,application/json,text/plain"
              emptyText="No story files found on LULU SD yet."
              uploadLabel="Choose story files"
              icon={<BookOpenText className="h-4 w-4" />}
            />
          </div>
        </section>
      </PageGrid>
    </DashboardShell>
  );
}
