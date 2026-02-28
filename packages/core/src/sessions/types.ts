import type { Message } from "../agent/types.js";

export interface Session {
  id: string;
  title?: string;
  createdAt: number;
  updatedAt: number;
  model?: string;
  messageCount: number;
}

export interface SessionEntry {
  type: "message" | "meta" | "compaction";
  timestamp: number;
  data: Message | SessionMeta | CompactionMeta;
}

export interface SessionMeta {
  title?: string;
  model?: string;
  createdAt: number;
}

export interface CompactionMeta {
  summary: string;
  droppedMessageCount: number;
}

export interface SessionListItem {
  id: string;
  title?: string;
  createdAt: number;
  updatedAt: number;
  messageCount: number;
}
