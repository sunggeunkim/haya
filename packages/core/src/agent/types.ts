/**
 * Core types for the agent runtime.
 */

export type MessageRole = "system" | "user" | "assistant" | "tool";

export interface Message {
  role: MessageRole;
  content: string;
  name?: string;
  toolCallId?: string;
  toolCalls?: ToolCall[];
  timestamp?: number;
}

export interface ToolCall {
  id: string;
  name: string;
  arguments: string;
}

export interface ToolResult {
  toolCallId: string;
  content: string;
  isError?: boolean;
}

export interface AgentTool {
  name: string;
  description: string;
  parameters: Record<string, unknown>;
  execute: (args: Record<string, unknown>) => Promise<string>;
}

export interface ChatRequest {
  sessionId: string;
  message: string;
  model?: string;
  systemPrompt?: string;
}

export interface ChatResponse {
  sessionId: string;
  message: Message;
  usage?: TokenUsage;
}

export interface ChatChunkEvent {
  sessionId: string;
  delta: string;
  done: boolean;
}

export interface TokenUsage {
  promptTokens: number;
  completionTokens: number;
  totalTokens: number;
}

export interface ProviderConfig {
  provider: string;
  model: string;
  apiKeyEnvVar: string;
  baseUrl?: string;
  maxTokens?: number;
  temperature?: number;
}

export interface CompletionRequest {
  model: string;
  messages: Message[];
  tools?: AgentTool[];
  maxTokens?: number;
  temperature?: number;
  stream?: boolean;
}

export interface CompletionResponse {
  message: Message;
  usage?: TokenUsage;
  finishReason: "stop" | "tool_calls" | "length" | "error";
}

export type StreamCallback = (chunk: ChatChunkEvent) => void;
