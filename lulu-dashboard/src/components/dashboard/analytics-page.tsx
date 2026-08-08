"use client";

import { useState } from "react";
import { Area, AreaChart, Bar, BarChart, CartesianGrid, Line, LineChart, ResponsiveContainer, Tooltip, XAxis, YAxis } from "recharts";
import { DashboardShell } from "@/components/dashboard/dashboard-shell";
import { SectionCard } from "@/components/dashboard/shared";
import { Button } from "@/components/ui/button";
import { analyticsRows } from "@/lib/mock-data";

export function AnalyticsPage() {
  const [range, setRange] = useState("Today");

  return (
    <DashboardShell title="AI Performance" subtitle="Latency, volume, tokens, success, and error trends">
      <div className="mb-4 flex flex-wrap gap-2">
        {["Today", "7 Days", "30 Days", "Custom"].map((item) => (
          <Button key={item} variant={range === item ? "primary" : "secondary"} onClick={() => setRange(item)}>{item}</Button>
        ))}
      </div>
      <div className="grid gap-4 xl:grid-cols-2">
        <ChartCard title={`Requests Per Hour - ${range}`}>
          <BarChart data={analyticsRows}>
            <CartesianGrid strokeDasharray="3 3" stroke="hsl(var(--border))" />
            <XAxis dataKey="hour" tick={{ fill: "hsl(var(--muted-foreground))", fontSize: 12 }} />
            <YAxis tick={{ fill: "hsl(var(--muted-foreground))", fontSize: 12 }} />
            <Tooltip contentStyle={tooltipStyle} />
            <Bar dataKey="requests" fill="hsl(var(--primary))" radius={[4, 4, 0, 0]} />
          </BarChart>
        </ChartCard>
        <ChartCard title="Average Response Latency">
          <LineChart data={analyticsRows}>
            <CartesianGrid strokeDasharray="3 3" stroke="hsl(var(--border))" />
            <XAxis dataKey="hour" tick={{ fill: "hsl(var(--muted-foreground))", fontSize: 12 }} />
            <YAxis tick={{ fill: "hsl(var(--muted-foreground))", fontSize: 12 }} />
            <Tooltip contentStyle={tooltipStyle} />
            <Line type="monotone" dataKey="latency" stroke="#eab308" strokeWidth={2} dot={false} />
          </LineChart>
        </ChartCard>
        <ChartCard title="Tokens Consumed">
          <AreaChart data={analyticsRows}>
            <CartesianGrid strokeDasharray="3 3" stroke="hsl(var(--border))" />
            <XAxis dataKey="hour" tick={{ fill: "hsl(var(--muted-foreground))", fontSize: 12 }} />
            <YAxis tick={{ fill: "hsl(var(--muted-foreground))", fontSize: 12 }} />
            <Tooltip contentStyle={tooltipStyle} />
            <Area type="monotone" dataKey="tokens" stroke="#38bdf8" fill="#38bdf833" />
          </AreaChart>
        </ChartCard>
        <ChartCard title="Success And Error Rate">
          <LineChart data={analyticsRows}>
            <CartesianGrid strokeDasharray="3 3" stroke="hsl(var(--border))" />
            <XAxis dataKey="hour" tick={{ fill: "hsl(var(--muted-foreground))", fontSize: 12 }} />
            <YAxis tick={{ fill: "hsl(var(--muted-foreground))", fontSize: 12 }} />
            <Tooltip contentStyle={tooltipStyle} />
            <Line type="monotone" dataKey="success" stroke="#22c55e" strokeWidth={2} dot={false} />
            <Line type="monotone" dataKey="errors" stroke="#f43f5e" strokeWidth={2} dot={false} />
          </LineChart>
        </ChartCard>
      </div>
    </DashboardShell>
  );
}

function ChartCard({ title, children }: { title: string; children: React.ReactElement }) {
  return (
    <SectionCard title={title}>
      <div className="h-72">
        <ResponsiveContainer width="100%" height="100%">
          {children}
        </ResponsiveContainer>
      </div>
    </SectionCard>
  );
}

const tooltipStyle = {
  background: "hsl(var(--card))",
  border: "1px solid hsl(var(--border))",
  borderRadius: 8
};
