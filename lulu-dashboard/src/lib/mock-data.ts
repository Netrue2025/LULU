import type {
  ActivityEvent,
  AlertItem,
  Conversation,
  Device,
  KnowledgeItem,
  MemoryItem,
  Reminder
} from "@/lib/types";

export const initialEvents: ActivityEvent[] = [
  { id: "evt-1", timestamp: new Date().toISOString(), type: "connection", description: "Dashboard connected" },
  { id: "evt-2", timestamp: new Date().toISOString(), type: "audio", description: "Playing radio 88.5FM" },
  { id: "evt-3", timestamp: new Date().toISOString(), type: "audio", description: "Playing music \"Forever\"" },
  { id: "evt-4", timestamp: new Date().toISOString(), type: "llm", description: "Reading Bible verses" }
];

export const initialConversations: Conversation[] = [
  {
    id: "conv-1",
    userId: "esp32-lulu",
    timestamp: new Date(Date.now() - 1000 * 60 * 24).toISOString(),
    question: "What is the weather?",
    response: "The weather in Lagos is ready from the local weather service.",
    latencyMs: 1280
  },
  {
    id: "conv-2",
    userId: "esp32-lulu",
    timestamp: new Date(Date.now() - 1000 * 60 * 52).toISOString(),
    question: "Read John 3:16",
    response: "Reading the exact requested Bible verse.",
    latencyMs: 1640
  }
];

export const initialReminders: Reminder[] = [
  {
    id: "rem-1",
    title: "Drink water",
    message: "Please drink water now.",
    scheduleTime: new Date(Date.now() + 1000 * 60 * 30).toISOString(),
    status: "scheduled"
  },
  {
    id: "rem-2",
    title: "Prayer time",
    message: "It is time to pray.",
    scheduleTime: new Date(Date.now() + 1000 * 60 * 90).toISOString(),
    status: "paused"
  }
];

export const initialMemories: MemoryItem[] = [
  {
    id: "mem-1",
    category: "identity",
    content: "LULU belongs to Jeremiah and runs local-first when possible.",
    createdDate: new Date(Date.now() - 1000 * 60 * 60 * 12).toISOString()
  },
  {
    id: "mem-2",
    category: "voice",
    content: "Prefer a warm, friendly voice style.",
    createdDate: new Date(Date.now() - 1000 * 60 * 60 * 36).toISOString()
  }
];

export const initialKnowledge: KnowledgeItem[] = [
  {
    id: "kb-1",
    name: "local_qa.txt",
    type: "reference",
    status: "indexed",
    updatedAt: new Date().toISOString(),
    metadata: "Local Q&A pairs"
  },
  {
    id: "kb-2",
    name: "stories.txt",
    type: "document",
    status: "indexed",
    updatedAt: new Date(Date.now() - 1000 * 60 * 45).toISOString(),
    metadata: "Local story library"
  }
];

export const initialDevices: Device[] = [
  {
    id: "dev-1",
    name: "LULU ESP32-S3",
    ipAddress: "192.168.1.100",
    lastSeen: new Date().toISOString(),
    status: "online"
  }
];

export const initialAlerts: AlertItem[] = [
  {
    id: "alert-1",
    title: "Monitoring active",
    message: "Dashboard event stream is watching the LULU server health endpoint.",
    severity: "info",
    unread: true,
    createdAt: new Date().toISOString()
  }
];

export const analyticsRows = Array.from({ length: 12 }, (_, index) => ({
  hour: `${String(index + 8).padStart(2, "0")}:00`,
  requests: 12 + index * 3 + (index % 2) * 7,
  latency: 900 + index * 35,
  tokens: 120 + index * 22,
  success: 96 - (index % 3),
  errors: index % 4
}));
