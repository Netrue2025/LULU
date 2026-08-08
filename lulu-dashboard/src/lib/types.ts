export type LuluStatus = "online" | "offline" | "listening" | "thinking" | "speaking" | "error";

export type ActivityEvent = {
  id: string;
  timestamp: string;
  type: "connection" | "audio" | "whisper" | "llm" | "piper" | "reminder" | "device" | "error" | "heartbeat";
  description: string;
};

export type Conversation = {
  id: string;
  userId: string;
  timestamp: string;
  question: string;
  response: string;
  latencyMs: number;
};

export type Reminder = {
  id: string;
  title: string;
  message: string;
  scheduleTime: string;
  status: "scheduled" | "paused" | "completed";
};

export type MemoryItem = {
  id: string;
  category: string;
  content: string;
  createdDate: string;
};

export type KnowledgeItem = {
  id: string;
  name: string;
  type: "document" | "embedding" | "upload" | "reference";
  status: "indexed" | "pending" | "error";
  updatedAt: string;
  metadata: string;
};

export type Device = {
  id: string;
  name: string;
  ipAddress: string;
  lastSeen: string;
  status: "online" | "offline" | "restarting";
};

export type AlertItem = {
  id: string;
  title: string;
  message: string;
  severity: "info" | "warning" | "critical";
  unread: boolean;
  createdAt: string;
};

export type LuluHealth = {
  status: "online" | "offline";
  lulu: Record<string, string> | null;
  metrics: {
    dashboard_uptime_seconds: number;
    cpu_percent: number;
    ram_percent: number;
    ram_used: number;
    ram_total: number;
    disk_percent: number;
    disk_used: number;
    disk_total: number;
    active_connections: number;
  };
  source: string;
  checked_at: string;
};
