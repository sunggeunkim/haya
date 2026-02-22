import type { AgentTool } from "./types.js";
import type { GoogleAuth } from "../google/auth.js";
import { callGoogleApi } from "../google/auth.js";
import { wrapExternalContent } from "../security/external-content.js";

const MAX_RESPONSE_LENGTH = 16_000;
const GMAIL_API_BASE = "https://gmail.googleapis.com/gmail/v1/users/me";

// ---------------------------------------------------------------------------
// Shared helpers
// ---------------------------------------------------------------------------

function truncate(text: string): string {
  if (text.length > MAX_RESPONSE_LENGTH) {
    return `${text.slice(0, MAX_RESPONSE_LENGTH)}\n\n[Truncated — ${text.length} chars total]`;
  }
  return text;
}

function toBase64Url(str: string): string {
  return Buffer.from(str, "utf-8")
    .toString("base64")
    .replace(/\+/g, "-")
    .replace(/\//g, "_")
    .replace(/=+$/, "");
}

function fromBase64Url(b64: string): string {
  const padded = b64.replace(/-/g, "+").replace(/_/g, "/");
  return Buffer.from(padded, "base64").toString("utf-8");
}

function getHeader(
  headers: Array<{ name: string; value: string }>,
  name: string,
): string {
  return (
    headers.find((h) => h.name.toLowerCase() === name.toLowerCase())?.value ??
    ""
  );
}

function extractBody(payload: Record<string, unknown>): string {
  // Simple message (no parts)
  const body = payload.body as { data?: string } | undefined;
  if (body?.data) return fromBase64Url(body.data);

  // Multipart — find text/plain part
  const parts = payload.parts as Array<Record<string, unknown>> | undefined;
  if (parts) {
    for (const part of parts) {
      if ((part.mimeType as string) === "text/plain") {
        const partBody = part.body as { data?: string } | undefined;
        if (partBody?.data) return fromBase64Url(partBody.data);
      }
    }
    // Fallback: first part with data
    for (const part of parts) {
      const partBody = part.body as { data?: string } | undefined;
      if (partBody?.data) return fromBase64Url(partBody.data);
    }
  }
  return "(no body)";
}

// ---------------------------------------------------------------------------
// gmail_search
// ---------------------------------------------------------------------------

function createSearchTool(auth: GoogleAuth): AgentTool {
  return {
    name: "gmail_search",
    description:
      "Search Gmail messages using Gmail search syntax (e.g. 'from:bob subject:meeting'). " +
      "Returns a list of matching messages with sender, subject, date, and snippet.",
    parameters: {
      type: "object",
      properties: {
        query: {
          type: "string",
          description:
            "Gmail search query (e.g. 'from:bob subject:meeting', 'is:unread', 'newer_than:1d')",
        },
        maxResults: {
          type: "number",
          description: "Maximum number of messages to return (default: 10)",
        },
      },
      required: ["query"],
    },
    async execute(args: Record<string, unknown>): Promise<string> {
      const query = args.query as string;
      if (!query) throw new Error("query is required");
      const maxResults = (args.maxResults as number) ?? 10;

      // List message IDs
      const listUrl = `${GMAIL_API_BASE}/messages?q=${encodeURIComponent(query)}&maxResults=${maxResults}`;
      const listData = await callGoogleApi(listUrl, auth);

      const messages = listData.messages as
        | Array<{ id: string; threadId: string }>
        | undefined;
      if (!messages || messages.length === 0) {
        return "No messages found.";
      }

      // Fetch metadata for each message (limit to maxResults)
      const toFetch = messages.slice(0, maxResults);
      const lines: string[] = [];

      for (const msg of toFetch) {
        const metaUrl = `${GMAIL_API_BASE}/messages/${msg.id}?format=metadata&metadataHeaders=From&metadataHeaders=Subject&metadataHeaders=Date`;
        const metaData = await callGoogleApi(metaUrl, auth);

        const headers = (metaData.payload as Record<string, unknown>)
          ?.headers as Array<{ name: string; value: string }> | undefined;
        const from = headers ? getHeader(headers, "From") : "";
        const subject = headers ? getHeader(headers, "Subject") : "";
        const date = headers ? getHeader(headers, "Date") : "";
        const snippet = (metaData.snippet as string) ?? "";

        lines.push(
          `- [${msg.id}] From: ${from} | Subject: ${subject} | Date: ${date}\n  Snippet: ${snippet}`,
        );
      }

      return truncate(lines.join("\n"));
    },
  };
}

// ---------------------------------------------------------------------------
// gmail_read_email
// ---------------------------------------------------------------------------

function createReadEmailTool(auth: GoogleAuth): AgentTool {
  return {
    name: "gmail_read_email",
    description:
      "Read the full content of a Gmail message by its ID. " +
      "Returns headers (From, To, Subject, Date) and the plain-text body.",
    parameters: {
      type: "object",
      properties: {
        messageId: {
          type: "string",
          description: "The Gmail message ID to read",
        },
      },
      required: ["messageId"],
    },
    async execute(args: Record<string, unknown>): Promise<string> {
      const messageId = args.messageId as string;
      if (!messageId) throw new Error("messageId is required");

      const url = `${GMAIL_API_BASE}/messages/${messageId}?format=full`;
      const data = await callGoogleApi(url, auth);

      const payload = data.payload as Record<string, unknown>;
      const headers = payload.headers as Array<{
        name: string;
        value: string;
      }>;
      const from = getHeader(headers, "From");
      const to = getHeader(headers, "To");
      const subject = getHeader(headers, "Subject");
      const date = getHeader(headers, "Date");

      const body = extractBody(payload);
      const wrapped = wrapExternalContent(body, `gmail:${from}`);

      return truncate(
        `From: ${from}\nTo: ${to}\nSubject: ${subject}\nDate: ${date}\n\n${wrapped.text}`,
      );
    },
  };
}

// ---------------------------------------------------------------------------
// gmail_get_thread
// ---------------------------------------------------------------------------

function createGetThreadTool(auth: GoogleAuth): AgentTool {
  return {
    name: "gmail_get_thread",
    description:
      "Get all messages in a Gmail thread by thread ID. " +
      "Returns each message with headers and body, useful for reading full conversations.",
    parameters: {
      type: "object",
      properties: {
        threadId: {
          type: "string",
          description: "The Gmail thread ID to retrieve",
        },
      },
      required: ["threadId"],
    },
    async execute(args: Record<string, unknown>): Promise<string> {
      const threadId = args.threadId as string;
      if (!threadId) throw new Error("threadId is required");

      const url = `${GMAIL_API_BASE}/threads/${threadId}?format=full`;
      const data = await callGoogleApi(url, auth);

      const messages = data.messages as Array<Record<string, unknown>>;
      if (!messages || messages.length === 0) {
        return "No messages in thread.";
      }

      const parts: string[] = [];
      for (let i = 0; i < messages.length; i++) {
        const msg = messages[i];
        const payload = msg.payload as Record<string, unknown>;
        const headers = payload.headers as Array<{
          name: string;
          value: string;
        }>;
        const from = getHeader(headers, "From");
        const to = getHeader(headers, "To");
        const subject = getHeader(headers, "Subject");
        const date = getHeader(headers, "Date");

        const body = extractBody(payload);
        const wrapped = wrapExternalContent(body, `gmail:${from}`);

        parts.push(
          `--- Message ${i + 1} ---\nFrom: ${from}\nTo: ${to}\nSubject: ${subject}\nDate: ${date}\n\n${wrapped.text}`,
        );
      }

      return truncate(parts.join("\n\n"));
    },
  };
}

// ---------------------------------------------------------------------------
// gmail_list_labels
// ---------------------------------------------------------------------------

function createListLabelsTool(auth: GoogleAuth): AgentTool {
  return {
    name: "gmail_list_labels",
    description:
      "List all Gmail labels (folders/categories) in the user's mailbox. " +
      "Returns label name, ID, and type (system or user).",
    parameters: {
      type: "object",
      properties: {},
    },
    async execute(): Promise<string> {
      const url = `${GMAIL_API_BASE}/labels`;
      const data = await callGoogleApi(url, auth);

      const labels = data.labels as
        | Array<{ id: string; name: string; type: string }>
        | undefined;
      if (!labels || labels.length === 0) {
        return "No labels found.";
      }

      const lines = labels.map(
        (label) => `- ${label.name} (${label.id}) [${label.type}]`,
      );
      return truncate(lines.join("\n"));
    },
  };
}

// ---------------------------------------------------------------------------
// gmail_create_draft
// ---------------------------------------------------------------------------

function createCreateDraftTool(auth: GoogleAuth): AgentTool {
  return {
    name: "gmail_create_draft",
    description:
      "Create a Gmail draft email. The draft is saved but NOT sent. " +
      "Use gmail_send_draft to send it after review.",
    parameters: {
      type: "object",
      properties: {
        to: {
          type: "string",
          description: "Recipient email address",
        },
        subject: {
          type: "string",
          description: "Email subject line",
        },
        body: {
          type: "string",
          description: "Email body text",
        },
        cc: {
          type: "string",
          description: "CC recipients (comma-separated email addresses)",
        },
        bcc: {
          type: "string",
          description: "BCC recipients (comma-separated email addresses)",
        },
        threadId: {
          type: "string",
          description: "Thread ID to attach this draft to (for replies)",
        },
        inReplyTo: {
          type: "string",
          description: "Message-ID header of the email being replied to",
        },
      },
      required: ["to", "subject", "body"],
    },
    async execute(args: Record<string, unknown>): Promise<string> {
      const to = args.to as string;
      const subject = args.subject as string;
      const body = args.body as string;
      if (!to) throw new Error("to is required");
      if (!subject) throw new Error("subject is required");
      if (!body) throw new Error("body is required");

      const cc = args.cc as string | undefined;
      const bcc = args.bcc as string | undefined;
      const threadId = args.threadId as string | undefined;
      const inReplyTo = args.inReplyTo as string | undefined;

      // Build RFC 2822 message
      const headerLines: string[] = ["From: me", `To: ${to}`];
      if (cc) headerLines.push(`Cc: ${cc}`);
      if (bcc) headerLines.push(`Bcc: ${bcc}`);
      headerLines.push(`Subject: ${subject}`);
      if (inReplyTo) {
        headerLines.push(`In-Reply-To: ${inReplyTo}`);
        headerLines.push(`References: ${inReplyTo}`);
      }

      const rawMessage = `${headerLines.join("\n")}\n\n${body}`;
      const encoded = toBase64Url(rawMessage);

      const requestBody: Record<string, unknown> = {
        message: { raw: encoded },
      };
      if (threadId) {
        (requestBody.message as Record<string, unknown>).threadId = threadId;
      }

      const url = `${GMAIL_API_BASE}/drafts`;
      const data = await callGoogleApi(url, auth, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(requestBody),
      });

      const draftId = (data.id as string) ?? "unknown";

      return `Draft created (ID: ${draftId})\nTo: ${to}\nSubject: ${subject}\n\nReview and send from Gmail, or use gmail_send_draft tool.`;
    },
  };
}

// ---------------------------------------------------------------------------
// gmail_send_draft
// ---------------------------------------------------------------------------

function createSendDraftTool(auth: GoogleAuth): AgentTool {
  return {
    name: "gmail_send_draft",
    description:
      "Send a previously created Gmail draft by its draft ID. " +
      "The draft must exist in the user's drafts folder.",
    parameters: {
      type: "object",
      properties: {
        draftId: {
          type: "string",
          description: "The draft ID to send",
        },
      },
      required: ["draftId"],
    },
    async execute(args: Record<string, unknown>): Promise<string> {
      const draftId = args.draftId as string;
      if (!draftId) throw new Error("draftId is required");

      const url = `${GMAIL_API_BASE}/drafts/send`;
      const data = await callGoogleApi(url, auth, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ id: draftId }),
      });

      const messageId = (data.id as string) ?? "unknown";
      return `Draft sent successfully (Message ID: ${messageId})`;
    },
  };
}

// ---------------------------------------------------------------------------
// Public factory
// ---------------------------------------------------------------------------

export function createGmailTools(auth: GoogleAuth): AgentTool[] {
  return [
    createSearchTool(auth),
    createReadEmailTool(auth),
    createGetThreadTool(auth),
    createListLabelsTool(auth),
    createCreateDraftTool(auth),
    createSendDraftTool(auth),
  ];
}
