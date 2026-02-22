import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { createGmailTools } from "./google-gmail-tools.js";
import type { AgentTool } from "./types.js";
import type { GoogleAuth } from "../google/auth.js";

// Create a fresh mock GoogleAuth for each test suite
function createMockAuth(): GoogleAuth {
  return {
    getAccessToken: vi.fn().mockResolvedValue("mock-token"),
    isAuthorized: vi.fn().mockReturnValue(true),
    authorize: vi.fn(),
    revokeTokens: vi.fn(),
    config: {
      clientIdEnvVar: "GOOGLE_CLIENT_ID",
      clientSecretEnvVar: "GOOGLE_CLIENT_SECRET",
      scopes: [],
    },
  } as unknown as GoogleAuth;
}

let mockAuth: GoogleAuth;

// Helper to get a tool by name
function getTool(tools: AgentTool[], name: string): AgentTool {
  const tool = tools.find((t) => t.name === name);
  if (!tool) throw new Error(`Tool not found: ${name}`);
  return tool;
}

// Helper to base64url encode a string (mirrors the implementation)
function toBase64Url(str: string): string {
  return Buffer.from(str, "utf-8")
    .toString("base64")
    .replace(/\+/g, "-")
    .replace(/\//g, "_")
    .replace(/=+$/, "");
}

// ---------------------------------------------------------------------------
// Factory tests
// ---------------------------------------------------------------------------

describe("createGmailTools", () => {
  beforeEach(() => {
    mockAuth = createMockAuth();
  });

  it("returns exactly 6 tools", () => {
    const tools = createGmailTools(mockAuth);
    expect(tools).toHaveLength(6);
  });

  it("returns tools with expected names", () => {
    const tools = createGmailTools(mockAuth);
    const names = tools.map((t) => t.name).sort();
    expect(names).toEqual([
      "gmail_create_draft",
      "gmail_get_thread",
      "gmail_list_labels",
      "gmail_read_email",
      "gmail_search",
      "gmail_send_draft",
    ]);
  });
});

// ---------------------------------------------------------------------------
// gmail_search
// ---------------------------------------------------------------------------

describe("gmail_search", () => {
  let tools: AgentTool[];
  let search: AgentTool;

  beforeEach(() => {
    mockAuth = createMockAuth();
    tools = createGmailTools(mockAuth);
    search = getTool(tools, "gmail_search");
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("requires query parameter", async () => {
    await expect(search.execute({ query: "" })).rejects.toThrow(
      "query is required",
    );
  });

  it("returns 'No messages found' when no results", async () => {
    vi.spyOn(globalThis, "fetch").mockResolvedValueOnce(
      new Response(JSON.stringify({ resultSizeEstimate: 0 })),
    );

    const result = await search.execute({ query: "from:nobody" });
    expect(result).toBe("No messages found.");
  });

  it("returns formatted message list", async () => {
    // First call: list message IDs
    const listResponse = {
      messages: [
        { id: "msg1", threadId: "thread1" },
        { id: "msg2", threadId: "thread2" },
      ],
    };

    // Metadata responses for each message
    const meta1 = {
      id: "msg1",
      snippet: "Hey, are we meeting tomorrow?",
      payload: {
        headers: [
          { name: "From", value: "bob@example.com" },
          { name: "Subject", value: "Meeting tomorrow" },
          { name: "Date", value: "Mon, 10 Feb 2026 09:00:00 -0800" },
        ],
      },
    };

    const meta2 = {
      id: "msg2",
      snippet: "Please review the attached document",
      payload: {
        headers: [
          { name: "From", value: "alice@example.com" },
          { name: "Subject", value: "Document review" },
          { name: "Date", value: "Sun, 9 Feb 2026 15:30:00 -0800" },
        ],
      },
    };

    vi.spyOn(globalThis, "fetch")
      .mockResolvedValueOnce(new Response(JSON.stringify(listResponse)))
      .mockResolvedValueOnce(new Response(JSON.stringify(meta1)))
      .mockResolvedValueOnce(new Response(JSON.stringify(meta2)));

    const result = await search.execute({
      query: "is:unread",
      maxResults: 5,
    });

    expect(result).toContain("[msg1]");
    expect(result).toContain("From: bob@example.com");
    expect(result).toContain("Subject: Meeting tomorrow");
    expect(result).toContain("Snippet: Hey, are we meeting tomorrow?");
    expect(result).toContain("[msg2]");
    expect(result).toContain("From: alice@example.com");
    expect(result).toContain("Subject: Document review");
  });

  it("passes auth header in API calls", async () => {
    const fetchSpy = vi
      .spyOn(globalThis, "fetch")
      .mockResolvedValueOnce(
        new Response(JSON.stringify({ messages: [{ id: "msg1", threadId: "t1" }] })),
      )
      .mockResolvedValueOnce(
        new Response(
          JSON.stringify({
            id: "msg1",
            snippet: "test",
            payload: {
              headers: [
                { name: "From", value: "test@example.com" },
                { name: "Subject", value: "Test" },
                { name: "Date", value: "Mon, 10 Feb 2026 09:00:00" },
              ],
            },
          }),
        ),
      );

    await search.execute({ query: "test" });

    // Check Authorization header on the first call
    const firstCallOptions = fetchSpy.mock.calls[0][1] as RequestInit;
    const headers = firstCallOptions.headers as Record<string, string>;
    expect(headers.Authorization).toBe("Bearer mock-token");
  });
});

// ---------------------------------------------------------------------------
// gmail_read_email
// ---------------------------------------------------------------------------

describe("gmail_read_email", () => {
  let tools: AgentTool[];
  let readEmail: AgentTool;

  beforeEach(() => {
    mockAuth = createMockAuth();
    tools = createGmailTools(mockAuth);
    readEmail = getTool(tools, "gmail_read_email");
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("requires messageId parameter", async () => {
    await expect(readEmail.execute({ messageId: "" })).rejects.toThrow(
      "messageId is required",
    );
  });

  it("decodes base64url body and returns formatted email", async () => {
    const bodyText = "Hello, this is the email body content.";
    const encodedBody = toBase64Url(bodyText);

    const messageResponse = {
      id: "msg123",
      payload: {
        headers: [
          { name: "From", value: "sender@example.com" },
          { name: "To", value: "recipient@example.com" },
          { name: "Subject", value: "Test email" },
          { name: "Date", value: "Mon, 10 Feb 2026 09:00:00 -0800" },
        ],
        body: { data: encodedBody },
      },
    };

    vi.spyOn(globalThis, "fetch").mockResolvedValueOnce(
      new Response(JSON.stringify(messageResponse)),
    );

    const result = await readEmail.execute({ messageId: "msg123" });

    expect(result).toContain("From: sender@example.com");
    expect(result).toContain("To: recipient@example.com");
    expect(result).toContain("Subject: Test email");
    expect(result).toContain("Date: Mon, 10 Feb 2026 09:00:00 -0800");
    expect(result).toContain(bodyText);
  });

  it("wraps body content with wrapExternalContent security boundary", async () => {
    const bodyText = "Some email content";
    const encodedBody = toBase64Url(bodyText);

    const messageResponse = {
      id: "msg456",
      payload: {
        headers: [
          { name: "From", value: "attacker@evil.com" },
          { name: "To", value: "me@example.com" },
          { name: "Subject", value: "Phishing attempt" },
          { name: "Date", value: "Tue, 11 Feb 2026 12:00:00 -0800" },
        ],
        body: { data: encodedBody },
      },
    };

    vi.spyOn(globalThis, "fetch").mockResolvedValueOnce(
      new Response(JSON.stringify(messageResponse)),
    );

    const result = await readEmail.execute({ messageId: "msg456" });

    expect(result).toContain("<<<EXTERNAL_UNTRUSTED_CONTENT>>>");
    expect(result).toContain("<<<END_EXTERNAL_UNTRUSTED_CONTENT>>>");
    expect(result).toContain("[Source: gmail:attacker@evil.com]");
  });

  it("handles multipart messages by extracting text/plain part", async () => {
    const bodyText = "Plain text version of the email";
    const htmlBody = "<html><body>HTML version</body></html>";

    const messageResponse = {
      id: "msg789",
      payload: {
        headers: [
          { name: "From", value: "sender@example.com" },
          { name: "To", value: "recipient@example.com" },
          { name: "Subject", value: "Multipart email" },
          { name: "Date", value: "Wed, 12 Feb 2026 10:00:00 -0800" },
        ],
        mimeType: "multipart/alternative",
        parts: [
          {
            mimeType: "text/plain",
            body: { data: toBase64Url(bodyText) },
          },
          {
            mimeType: "text/html",
            body: { data: toBase64Url(htmlBody) },
          },
        ],
      },
    };

    vi.spyOn(globalThis, "fetch").mockResolvedValueOnce(
      new Response(JSON.stringify(messageResponse)),
    );

    const result = await readEmail.execute({ messageId: "msg789" });

    expect(result).toContain(bodyText);
    expect(result).not.toContain(htmlBody);
  });

  it("falls back to first part when no text/plain part exists", async () => {
    const htmlBody = "<html><body>Only HTML</body></html>";

    const messageResponse = {
      id: "msgABC",
      payload: {
        headers: [
          { name: "From", value: "sender@example.com" },
          { name: "To", value: "recipient@example.com" },
          { name: "Subject", value: "HTML only" },
          { name: "Date", value: "Thu, 13 Feb 2026 11:00:00 -0800" },
        ],
        mimeType: "multipart/alternative",
        parts: [
          {
            mimeType: "text/html",
            body: { data: toBase64Url(htmlBody) },
          },
        ],
      },
    };

    vi.spyOn(globalThis, "fetch").mockResolvedValueOnce(
      new Response(JSON.stringify(messageResponse)),
    );

    const result = await readEmail.execute({ messageId: "msgABC" });

    expect(result).toContain(htmlBody);
  });
});

// ---------------------------------------------------------------------------
// gmail_get_thread
// ---------------------------------------------------------------------------

describe("gmail_get_thread", () => {
  let tools: AgentTool[];
  let getThread: AgentTool;

  beforeEach(() => {
    mockAuth = createMockAuth();
    tools = createGmailTools(mockAuth);
    getThread = getTool(tools, "gmail_get_thread");
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("requires threadId parameter", async () => {
    await expect(getThread.execute({ threadId: "" })).rejects.toThrow(
      "threadId is required",
    );
  });

  it("returns formatted thread with multiple messages", async () => {
    const body1 = "First message in thread";
    const body2 = "Reply to first message";

    const threadResponse = {
      id: "thread123",
      messages: [
        {
          id: "msg1",
          payload: {
            headers: [
              { name: "From", value: "alice@example.com" },
              { name: "To", value: "bob@example.com" },
              { name: "Subject", value: "Project update" },
              { name: "Date", value: "Mon, 10 Feb 2026 09:00:00 -0800" },
            ],
            body: { data: toBase64Url(body1) },
          },
        },
        {
          id: "msg2",
          payload: {
            headers: [
              { name: "From", value: "bob@example.com" },
              { name: "To", value: "alice@example.com" },
              { name: "Subject", value: "Re: Project update" },
              { name: "Date", value: "Mon, 10 Feb 2026 10:00:00 -0800" },
            ],
            body: { data: toBase64Url(body2) },
          },
        },
      ],
    };

    vi.spyOn(globalThis, "fetch").mockResolvedValueOnce(
      new Response(JSON.stringify(threadResponse)),
    );

    const result = await getThread.execute({ threadId: "thread123" });

    expect(result).toContain("--- Message 1 ---");
    expect(result).toContain("From: alice@example.com");
    expect(result).toContain(body1);
    expect(result).toContain("--- Message 2 ---");
    expect(result).toContain("From: bob@example.com");
    expect(result).toContain(body2);
  });

  it("wraps each message body with wrapExternalContent", async () => {
    const threadResponse = {
      id: "thread456",
      messages: [
        {
          id: "msg1",
          payload: {
            headers: [
              { name: "From", value: "user1@example.com" },
              { name: "To", value: "user2@example.com" },
              { name: "Subject", value: "Thread test" },
              { name: "Date", value: "Mon, 10 Feb 2026 09:00:00" },
            ],
            body: { data: toBase64Url("Message one") },
          },
        },
        {
          id: "msg2",
          payload: {
            headers: [
              { name: "From", value: "user2@example.com" },
              { name: "To", value: "user1@example.com" },
              { name: "Subject", value: "Re: Thread test" },
              { name: "Date", value: "Mon, 10 Feb 2026 10:00:00" },
            ],
            body: { data: toBase64Url("Message two") },
          },
        },
      ],
    };

    vi.spyOn(globalThis, "fetch").mockResolvedValueOnce(
      new Response(JSON.stringify(threadResponse)),
    );

    const result = await getThread.execute({ threadId: "thread456" });

    // Each message should have boundary markers
    const startMarkers = result.match(/<<<EXTERNAL_UNTRUSTED_CONTENT>>>/g);
    const endMarkers = result.match(/<<<END_EXTERNAL_UNTRUSTED_CONTENT>>>/g);
    expect(startMarkers).toHaveLength(2);
    expect(endMarkers).toHaveLength(2);
    expect(result).toContain("[Source: gmail:user1@example.com]");
    expect(result).toContain("[Source: gmail:user2@example.com]");
  });

  it("returns message when thread is empty", async () => {
    vi.spyOn(globalThis, "fetch").mockResolvedValueOnce(
      new Response(JSON.stringify({ id: "thread789", messages: [] })),
    );

    const result = await getThread.execute({ threadId: "thread789" });
    expect(result).toBe("No messages in thread.");
  });
});

// ---------------------------------------------------------------------------
// gmail_list_labels
// ---------------------------------------------------------------------------

describe("gmail_list_labels", () => {
  let tools: AgentTool[];
  let listLabels: AgentTool;

  beforeEach(() => {
    mockAuth = createMockAuth();
    tools = createGmailTools(mockAuth);
    listLabels = getTool(tools, "gmail_list_labels");
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("returns formatted label list", async () => {
    const labelsResponse = {
      labels: [
        { id: "INBOX", name: "INBOX", type: "system" },
        { id: "SENT", name: "SENT", type: "system" },
        { id: "Label_1", name: "Work", type: "user" },
        { id: "Label_2", name: "Personal", type: "user" },
      ],
    };

    vi.spyOn(globalThis, "fetch").mockResolvedValueOnce(
      new Response(JSON.stringify(labelsResponse)),
    );

    const result = await listLabels.execute({});

    expect(result).toContain("- INBOX (INBOX) [system]");
    expect(result).toContain("- SENT (SENT) [system]");
    expect(result).toContain("- Work (Label_1) [user]");
    expect(result).toContain("- Personal (Label_2) [user]");
  });

  it("returns message when no labels found", async () => {
    vi.spyOn(globalThis, "fetch").mockResolvedValueOnce(
      new Response(JSON.stringify({ labels: [] })),
    );

    const result = await listLabels.execute({});
    expect(result).toBe("No labels found.");
  });
});

// ---------------------------------------------------------------------------
// gmail_create_draft
// ---------------------------------------------------------------------------

describe("gmail_create_draft", () => {
  let tools: AgentTool[];
  let createDraft: AgentTool;

  beforeEach(() => {
    mockAuth = createMockAuth();
    tools = createGmailTools(mockAuth);
    createDraft = getTool(tools, "gmail_create_draft");
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("requires to parameter", async () => {
    await expect(
      createDraft.execute({ to: "", subject: "Test", body: "Hello" }),
    ).rejects.toThrow("to is required");
  });

  it("requires subject parameter", async () => {
    await expect(
      createDraft.execute({
        to: "test@example.com",
        subject: "",
        body: "Hello",
      }),
    ).rejects.toThrow("subject is required");
  });

  it("requires body parameter", async () => {
    await expect(
      createDraft.execute({
        to: "test@example.com",
        subject: "Test",
        body: "",
      }),
    ).rejects.toThrow("body is required");
  });

  it("creates a draft and returns confirmation", async () => {
    const draftResponse = {
      id: "draft123",
      message: { id: "msg123", threadId: "thread123" },
    };

    vi.spyOn(globalThis, "fetch").mockResolvedValueOnce(
      new Response(JSON.stringify(draftResponse)),
    );

    const result = await createDraft.execute({
      to: "recipient@example.com",
      subject: "Important message",
      body: "Hello, this is a draft.",
    });

    expect(result).toContain("Draft created (ID: draft123)");
    expect(result).toContain("To: recipient@example.com");
    expect(result).toContain("Subject: Important message");
    expect(result).toContain("Review and send from Gmail, or use gmail_send_draft tool.");
  });

  it("sends base64url encoded RFC 2822 message in request body", async () => {
    const fetchSpy = vi.spyOn(globalThis, "fetch").mockResolvedValueOnce(
      new Response(
        JSON.stringify({ id: "draft456", message: { id: "msg456" } }),
      ),
    );

    await createDraft.execute({
      to: "bob@example.com",
      subject: "Hello Bob",
      body: "How are you?",
    });

    const requestBody = JSON.parse(
      fetchSpy.mock.calls[0][1]?.body as string,
    ) as { message: { raw: string } };

    // Decode the base64url raw message
    const raw = requestBody.message.raw;
    const padded = raw.replace(/-/g, "+").replace(/_/g, "/");
    const decoded = Buffer.from(padded, "base64").toString("utf-8");

    expect(decoded).toContain("From: me");
    expect(decoded).toContain("To: bob@example.com");
    expect(decoded).toContain("Subject: Hello Bob");
    expect(decoded).toContain("How are you?");
  });

  it("includes optional cc, bcc, and inReplyTo headers", async () => {
    const fetchSpy = vi.spyOn(globalThis, "fetch").mockResolvedValueOnce(
      new Response(
        JSON.stringify({ id: "draft789", message: { id: "msg789" } }),
      ),
    );

    await createDraft.execute({
      to: "bob@example.com",
      subject: "Reply",
      body: "Thanks!",
      cc: "carol@example.com",
      bcc: "dave@example.com",
      inReplyTo: "<original-msg-id@example.com>",
      threadId: "thread999",
    });

    const requestBody = JSON.parse(
      fetchSpy.mock.calls[0][1]?.body as string,
    ) as { message: { raw: string; threadId?: string } };

    // Decode the raw message
    const raw = requestBody.message.raw;
    const padded = raw.replace(/-/g, "+").replace(/_/g, "/");
    const decoded = Buffer.from(padded, "base64").toString("utf-8");

    expect(decoded).toContain("Cc: carol@example.com");
    expect(decoded).toContain("Bcc: dave@example.com");
    expect(decoded).toContain("In-Reply-To: <original-msg-id@example.com>");
    expect(decoded).toContain("References: <original-msg-id@example.com>");
    expect(requestBody.message.threadId).toBe("thread999");
  });

  it("omits optional headers when not provided", async () => {
    const fetchSpy = vi.spyOn(globalThis, "fetch").mockResolvedValueOnce(
      new Response(
        JSON.stringify({ id: "draftSimple", message: { id: "msgSimple" } }),
      ),
    );

    await createDraft.execute({
      to: "bob@example.com",
      subject: "Simple",
      body: "No extras",
    });

    const requestBody = JSON.parse(
      fetchSpy.mock.calls[0][1]?.body as string,
    ) as { message: { raw: string; threadId?: string } };

    const raw = requestBody.message.raw;
    const padded = raw.replace(/-/g, "+").replace(/_/g, "/");
    const decoded = Buffer.from(padded, "base64").toString("utf-8");

    expect(decoded).not.toContain("Cc:");
    expect(decoded).not.toContain("Bcc:");
    expect(decoded).not.toContain("In-Reply-To:");
    expect(decoded).not.toContain("References:");
    expect(requestBody.message.threadId).toBeUndefined();
  });
});

// ---------------------------------------------------------------------------
// gmail_send_draft
// ---------------------------------------------------------------------------

describe("gmail_send_draft", () => {
  let tools: AgentTool[];
  let sendDraft: AgentTool;

  beforeEach(() => {
    mockAuth = createMockAuth();
    tools = createGmailTools(mockAuth);
    sendDraft = getTool(tools, "gmail_send_draft");
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("requires draftId parameter", async () => {
    await expect(sendDraft.execute({ draftId: "" })).rejects.toThrow(
      "draftId is required",
    );
  });

  it("sends draft and returns confirmation with message ID", async () => {
    const sendResponse = {
      id: "sentMsg123",
      threadId: "thread123",
      labelIds: ["SENT"],
    };

    vi.spyOn(globalThis, "fetch").mockResolvedValueOnce(
      new Response(JSON.stringify(sendResponse)),
    );

    const result = await sendDraft.execute({ draftId: "draft123" });

    expect(result).toBe("Draft sent successfully (Message ID: sentMsg123)");
  });

  it("sends correct request body", async () => {
    const fetchSpy = vi.spyOn(globalThis, "fetch").mockResolvedValueOnce(
      new Response(JSON.stringify({ id: "sentMsg456" })),
    );

    await sendDraft.execute({ draftId: "draft456" });

    const calledUrl = fetchSpy.mock.calls[0][0] as string;
    expect(calledUrl).toContain("/drafts/send");

    const requestBody = JSON.parse(
      fetchSpy.mock.calls[0][1]?.body as string,
    ) as { id: string };
    expect(requestBody.id).toBe("draft456");
  });
});

// ---------------------------------------------------------------------------
// Shared behavior
// ---------------------------------------------------------------------------

describe("gmail tools shared behavior", () => {
  beforeEach(() => {
    mockAuth = createMockAuth();
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("truncates very large responses", async () => {
    // Create a labels response that will exceed 16000 chars
    const manyLabels = Array.from({ length: 500 }, (_, i) => ({
      id: `Label_${i}`,
      name: `${"X".repeat(50)}_Label_${i}`,
      type: "user",
    }));

    vi.spyOn(globalThis, "fetch").mockResolvedValueOnce(
      new Response(JSON.stringify({ labels: manyLabels })),
    );

    const tools = createGmailTools(mockAuth);
    const listLabels = getTool(tools, "gmail_list_labels");
    const result = await listLabels.execute({});

    expect(result).toContain("[Truncated");
    expect(result).toContain("chars total");
  });

  it("throws on HTTP error response", async () => {
    vi.spyOn(globalThis, "fetch").mockResolvedValueOnce(
      new Response("Unauthorized", { status: 401, statusText: "Unauthorized" }),
    );

    const tools = createGmailTools(mockAuth);
    const listLabels = getTool(tools, "gmail_list_labels");

    await expect(listLabels.execute({})).rejects.toThrow("Google API 401");
  });
});
