import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { createDriveTools } from "./google-drive-tools.js";
import type { AgentTool } from "./types.js";
import type { GoogleAuth } from "../google/auth.js";

// ---------------------------------------------------------------------------
// Mock auth
// ---------------------------------------------------------------------------

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

// ---------------------------------------------------------------------------
// Factory tests
// ---------------------------------------------------------------------------

describe("createDriveTools", () => {
  beforeEach(() => {
    mockAuth = createMockAuth();
  });

  it("returns exactly 5 tools", () => {
    const tools = createDriveTools(mockAuth);
    expect(tools).toHaveLength(5);
  });

  it("returns tools with expected names", () => {
    const tools = createDriveTools(mockAuth);
    const names = tools.map((t) => t.name).sort();
    expect(names).toEqual([
      "drive_create_file",
      "drive_list_folder",
      "drive_read_file",
      "drive_search",
      "drive_share_file",
    ]);
  });
});

// ---------------------------------------------------------------------------
// drive_search
// ---------------------------------------------------------------------------

describe("drive_search", () => {
  let tools: AgentTool[];
  let search: AgentTool;

  beforeEach(() => {
    mockAuth = createMockAuth();
    tools = createDriveTools(mockAuth);
    search = getTool(tools, "drive_search");
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("requires query parameter", async () => {
    await expect(search.execute({ query: "" })).rejects.toThrow(
      "query is required",
    );
  });

  it("escapes single quotes and backslashes in query", async () => {
    const fetchSpy = vi.spyOn(globalThis, "fetch").mockResolvedValueOnce(
      new Response(JSON.stringify({ files: [] })),
    );

    await search.execute({ query: "it's a \\test" });

    const calledUrl = fetchSpy.mock.calls[0][0] as string;
    expect(calledUrl).toContain("it\\'s a \\\\test");
  });

  it("returns formatted list of files", async () => {
    vi.spyOn(globalThis, "fetch").mockResolvedValueOnce(
      new Response(
        JSON.stringify({
          files: [
            {
              id: "abc123",
              name: "Report.docx",
              mimeType: "application/vnd.google-apps.document",
              modifiedTime: "2025-01-15T10:30:00Z",
              size: "12345",
              parents: ["root"],
            },
            {
              id: "def456",
              name: "Data.csv",
              mimeType: "text/csv",
              modifiedTime: "2025-01-10T08:00:00Z",
              size: "6789",
              parents: ["root"],
            },
          ],
        }),
      ),
    );

    const result = await search.execute({ query: "report" });

    expect(result).toContain("- Report.docx (abc123)");
    expect(result).toContain(
      "Type: application/vnd.google-apps.document | Modified: 2025-01-15T10:30:00Z | Size: 12345",
    );
    expect(result).toContain("- Data.csv (def456)");
    expect(result).toContain(
      "Type: text/csv | Modified: 2025-01-10T08:00:00Z | Size: 6789",
    );
  });

  it("returns 'No files found' when no results", async () => {
    vi.spyOn(globalThis, "fetch").mockResolvedValueOnce(
      new Response(JSON.stringify({ files: [] })),
    );

    const result = await search.execute({ query: "nonexistent" });
    expect(result).toBe("No files found");
  });

  it("passes maxResults to pageSize", async () => {
    const fetchSpy = vi.spyOn(globalThis, "fetch").mockResolvedValueOnce(
      new Response(JSON.stringify({ files: [] })),
    );

    await search.execute({ query: "test", maxResults: 5 });

    const calledUrl = fetchSpy.mock.calls[0][0] as string;
    expect(calledUrl).toContain("pageSize=5");
  });

  it("uses default maxResults of 10", async () => {
    const fetchSpy = vi.spyOn(globalThis, "fetch").mockResolvedValueOnce(
      new Response(JSON.stringify({ files: [] })),
    );

    await search.execute({ query: "test" });

    const calledUrl = fetchSpy.mock.calls[0][0] as string;
    expect(calledUrl).toContain("pageSize=10");
  });

  it("passes auth token in Authorization header", async () => {
    const fetchSpy = vi.spyOn(globalThis, "fetch").mockResolvedValueOnce(
      new Response(JSON.stringify({ files: [] })),
    );

    await search.execute({ query: "test" });

    const calledOptions = fetchSpy.mock.calls[0][1] as RequestInit;
    const headers = calledOptions.headers as Record<string, string>;
    expect(headers.Authorization).toBe("Bearer mock-token");
  });
});

// ---------------------------------------------------------------------------
// drive_read_file
// ---------------------------------------------------------------------------

describe("drive_read_file", () => {
  let tools: AgentTool[];
  let readFile: AgentTool;

  beforeEach(() => {
    mockAuth = createMockAuth();
    tools = createDriveTools(mockAuth);
    readFile = getTool(tools, "drive_read_file");
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("requires fileId parameter", async () => {
    await expect(readFile.execute({ fileId: "" })).rejects.toThrow(
      "fileId is required",
    );
  });

  it("exports Google Docs as markdown", async () => {
    // First call: metadata
    // Second call: export
    vi.spyOn(globalThis, "fetch")
      .mockResolvedValueOnce(
        new Response(
          JSON.stringify({
            id: "doc123",
            name: "My Document",
            mimeType: "application/vnd.google-apps.document",
            size: "0",
          }),
        ),
      )
      .mockResolvedValueOnce(
        new Response("# Hello World\n\nThis is a doc."),
      );

    const result = await readFile.execute({ fileId: "doc123" });

    expect(result).toContain("File: My Document (application/vnd.google-apps.document)");
    expect(result).toContain("# Hello World");
    expect(result).toContain("This is a doc.");
  });

  it("uses callGoogleApiText for Google Workspace exports", async () => {
    const fetchSpy = vi
      .spyOn(globalThis, "fetch")
      .mockResolvedValueOnce(
        new Response(
          JSON.stringify({
            id: "sheet123",
            name: "My Sheet",
            mimeType: "application/vnd.google-apps.spreadsheet",
            size: "0",
          }),
        ),
      )
      .mockResolvedValueOnce(new Response("a,b,c\n1,2,3"));

    const result = await readFile.execute({ fileId: "sheet123" });

    // Verify the export URL was called with text/csv
    const secondUrl = fetchSpy.mock.calls[1][0] as string;
    expect(secondUrl).toContain("/export?mimeType=text/csv");
    expect(result).toContain("a,b,c");
  });

  it("downloads text files as-is", async () => {
    vi.spyOn(globalThis, "fetch")
      .mockResolvedValueOnce(
        new Response(
          JSON.stringify({
            id: "txt123",
            name: "readme.txt",
            mimeType: "text/plain",
            size: "42",
          }),
        ),
      )
      .mockResolvedValueOnce(new Response("Hello plain text!"));

    const result = await readFile.execute({ fileId: "txt123" });

    expect(result).toContain("File: readme.txt (text/plain)");
    expect(result).toContain("Hello plain text!");
  });

  it("downloads application/json files as text", async () => {
    vi.spyOn(globalThis, "fetch")
      .mockResolvedValueOnce(
        new Response(
          JSON.stringify({
            id: "json123",
            name: "config.json",
            mimeType: "application/json",
            size: "100",
          }),
        ),
      )
      .mockResolvedValueOnce(new Response('{"key": "value"}'));

    const result = await readFile.execute({ fileId: "json123" });

    expect(result).toContain("File: config.json (application/json)");
    expect(result).toContain('{"key": "value"}');
  });

  it("rejects binary files gracefully", async () => {
    vi.spyOn(globalThis, "fetch").mockResolvedValueOnce(
      new Response(
        JSON.stringify({
          id: "bin123",
          name: "photo.png",
          mimeType: "image/png",
          size: "1048576",
        }),
      ),
    );

    const result = await readFile.execute({ fileId: "bin123" });

    expect(result).toContain("Binary file: photo.png");
    expect(result).toContain("image/png");
    expect(result).toContain("1048576 bytes");
    expect(result).toContain("Cannot display binary content");
  });

  it("wraps content with wrapExternalContent boundary markers", async () => {
    vi.spyOn(globalThis, "fetch")
      .mockResolvedValueOnce(
        new Response(
          JSON.stringify({
            id: "doc456",
            name: "Shared Doc",
            mimeType: "application/vnd.google-apps.document",
            size: "0",
          }),
        ),
      )
      .mockResolvedValueOnce(new Response("Some shared content"));

    const result = await readFile.execute({ fileId: "doc456" });

    expect(result).toContain("<<<EXTERNAL_UNTRUSTED_CONTENT>>>");
    expect(result).toContain("<<<END_EXTERNAL_UNTRUSTED_CONTENT>>>");
    expect(result).toContain("[Source: gdrive:Shared Doc]");
  });

  it("handles unsupported Google Apps type as binary", async () => {
    vi.spyOn(globalThis, "fetch").mockResolvedValueOnce(
      new Response(
        JSON.stringify({
          id: "form123",
          name: "My Form",
          mimeType: "application/vnd.google-apps.form",
          size: undefined,
        }),
      ),
    );

    const result = await readFile.execute({ fileId: "form123" });

    expect(result).toContain("Binary file: My Form");
    expect(result).toContain("Cannot display binary content");
  });
});

// ---------------------------------------------------------------------------
// drive_list_folder
// ---------------------------------------------------------------------------

describe("drive_list_folder", () => {
  let tools: AgentTool[];
  let listFolder: AgentTool;

  beforeEach(() => {
    mockAuth = createMockAuth();
    tools = createDriveTools(mockAuth);
    listFolder = getTool(tools, "drive_list_folder");
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("lists files with [DIR] and [FILE] prefixes", async () => {
    vi.spyOn(globalThis, "fetch").mockResolvedValueOnce(
      new Response(
        JSON.stringify({
          files: [
            {
              id: "folder1",
              name: "Documents",
              mimeType: "application/vnd.google-apps.folder",
              modifiedTime: "2025-01-15T10:30:00Z",
              size: null,
              parents: ["root"],
            },
            {
              id: "file1",
              name: "notes.txt",
              mimeType: "text/plain",
              modifiedTime: "2025-01-14T09:00:00Z",
              size: "512",
              parents: ["root"],
            },
          ],
        }),
      ),
    );

    const result = await listFolder.execute({});

    expect(result).toContain("[DIR] Documents (folder1)");
    expect(result).toContain("[FILE] notes.txt (file1) - text/plain, 512");
  });

  it("defaults to root folder", async () => {
    const fetchSpy = vi.spyOn(globalThis, "fetch").mockResolvedValueOnce(
      new Response(JSON.stringify({ files: [] })),
    );

    await listFolder.execute({});

    const calledUrl = fetchSpy.mock.calls[0][0] as string;
    expect(calledUrl).toContain("'root' in parents");
  });

  it("uses provided folderId", async () => {
    const fetchSpy = vi.spyOn(globalThis, "fetch").mockResolvedValueOnce(
      new Response(JSON.stringify({ files: [] })),
    );

    await listFolder.execute({ folderId: "custom-folder-id" });

    const calledUrl = fetchSpy.mock.calls[0][0] as string;
    expect(calledUrl).toContain("'custom-folder-id' in parents");
  });

  it("returns 'Folder is empty' when no files", async () => {
    vi.spyOn(globalThis, "fetch").mockResolvedValueOnce(
      new Response(JSON.stringify({ files: [] })),
    );

    const result = await listFolder.execute({});
    expect(result).toBe("Folder is empty");
  });
});

// ---------------------------------------------------------------------------
// drive_create_file
// ---------------------------------------------------------------------------

describe("drive_create_file", () => {
  let tools: AgentTool[];
  let createFile: AgentTool;

  beforeEach(() => {
    mockAuth = createMockAuth();
    tools = createDriveTools(mockAuth);
    createFile = getTool(tools, "drive_create_file");
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("requires name parameter", async () => {
    await expect(
      createFile.execute({ name: "", content: "hello" }),
    ).rejects.toThrow("name is required");
  });

  it("requires content parameter", async () => {
    await expect(
      createFile.execute({ name: "test.txt" }),
    ).rejects.toThrow("content is required");
  });

  it("sends multipart body and returns file ID", async () => {
    const fetchSpy = vi.spyOn(globalThis, "fetch").mockResolvedValueOnce(
      new Response(JSON.stringify({ id: "new-file-123", name: "test.txt" })),
    );

    const result = await createFile.execute({
      name: "test.txt",
      content: "Hello World",
    });

    expect(result).toBe("File created: test.txt (new-file-123)");

    // Verify the URL
    const calledUrl = fetchSpy.mock.calls[0][0] as string;
    expect(calledUrl).toContain("upload/drive/v3/files?uploadType=multipart");

    // Verify the request body is multipart
    const calledOptions = fetchSpy.mock.calls[0][1] as RequestInit;
    const headers = calledOptions.headers as Record<string, string>;
    expect(headers["Content-Type"]).toContain("multipart/related");
    expect(headers["Content-Type"]).toContain("boundary=");

    const body = calledOptions.body as string;
    expect(body).toContain('"name":"test.txt"');
    expect(body).toContain("Hello World");
    expect(body).toContain("Content-Type: text/plain");
    expect(body).toContain("Content-Type: application/json");
  });

  it("includes folderId as parents in metadata", async () => {
    const fetchSpy = vi.spyOn(globalThis, "fetch").mockResolvedValueOnce(
      new Response(JSON.stringify({ id: "new-file-456" })),
    );

    await createFile.execute({
      name: "test.txt",
      content: "hello",
      folderId: "parent-folder-id",
    });

    const body = (fetchSpy.mock.calls[0][1] as RequestInit).body as string;
    expect(body).toContain('"parents":["parent-folder-id"]');
  });

  it("uses provided mimeType", async () => {
    const fetchSpy = vi.spyOn(globalThis, "fetch").mockResolvedValueOnce(
      new Response(JSON.stringify({ id: "new-file-789" })),
    );

    await createFile.execute({
      name: "data.json",
      content: '{"key":"value"}',
      mimeType: "application/json",
    });

    const body = (fetchSpy.mock.calls[0][1] as RequestInit).body as string;
    expect(body).toContain("Content-Type: application/json");
    expect(body).toContain('"mimeType":"application/json"');
  });

  it("defaults mimeType to text/plain", async () => {
    const fetchSpy = vi.spyOn(globalThis, "fetch").mockResolvedValueOnce(
      new Response(JSON.stringify({ id: "new-file-000" })),
    );

    await createFile.execute({ name: "note.txt", content: "hi" });

    const body = (fetchSpy.mock.calls[0][1] as RequestInit).body as string;
    expect(body).toContain('"mimeType":"text/plain"');
  });
});

// ---------------------------------------------------------------------------
// drive_share_file
// ---------------------------------------------------------------------------

describe("drive_share_file", () => {
  let tools: AgentTool[];
  let shareFile: AgentTool;

  beforeEach(() => {
    mockAuth = createMockAuth();
    tools = createDriveTools(mockAuth);
    shareFile = getTool(tools, "drive_share_file");
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("requires fileId parameter", async () => {
    await expect(
      shareFile.execute({ fileId: "", email: "a@b.com", role: "reader" }),
    ).rejects.toThrow("fileId is required");
  });

  it("requires email parameter", async () => {
    await expect(
      shareFile.execute({ fileId: "abc", email: "", role: "reader" }),
    ).rejects.toThrow("email is required");
  });

  it("requires role parameter", async () => {
    await expect(
      shareFile.execute({ fileId: "abc", email: "a@b.com", role: "" }),
    ).rejects.toThrow("role is required");
  });

  it("sends permission request and returns confirmation", async () => {
    const fetchSpy = vi.spyOn(globalThis, "fetch").mockResolvedValueOnce(
      new Response(JSON.stringify({ id: "perm-123", role: "reader" })),
    );

    const result = await shareFile.execute({
      fileId: "file-abc",
      email: "user@example.com",
      role: "reader",
    });

    expect(result).toBe("Shared file-abc with user@example.com as reader");

    // Verify the URL
    const calledUrl = fetchSpy.mock.calls[0][0] as string;
    expect(calledUrl).toContain("/files/file-abc/permissions");

    // Verify the request body
    const calledOptions = fetchSpy.mock.calls[0][1] as RequestInit;
    expect(calledOptions.method).toBe("POST");

    const body = JSON.parse(calledOptions.body as string);
    expect(body).toEqual({
      type: "user",
      role: "reader",
      emailAddress: "user@example.com",
    });
  });

  it("supports writer role", async () => {
    const fetchSpy = vi.spyOn(globalThis, "fetch").mockResolvedValueOnce(
      new Response(JSON.stringify({ id: "perm-456", role: "writer" })),
    );

    const result = await shareFile.execute({
      fileId: "file-xyz",
      email: "writer@example.com",
      role: "writer",
    });

    expect(result).toBe("Shared file-xyz with writer@example.com as writer");

    const body = JSON.parse(
      (fetchSpy.mock.calls[0][1] as RequestInit).body as string,
    );
    expect(body.role).toBe("writer");
  });

  it("supports commenter role", async () => {
    vi.spyOn(globalThis, "fetch").mockResolvedValueOnce(
      new Response(JSON.stringify({ id: "perm-789", role: "commenter" })),
    );

    const result = await shareFile.execute({
      fileId: "file-xyz",
      email: "commenter@example.com",
      role: "commenter",
    });

    expect(result).toBe(
      "Shared file-xyz with commenter@example.com as commenter",
    );
  });
});

// ---------------------------------------------------------------------------
// Shared behavior
// ---------------------------------------------------------------------------

describe("drive tools shared behavior", () => {
  beforeEach(() => {
    mockAuth = createMockAuth();
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("truncates very large responses", async () => {
    // Create a response with many files that will exceed 16000 chars
    const manyFiles = Array.from({ length: 200 }, (_, i) => ({
      id: `file-${i}`,
      name: `${"X".repeat(80)}-${i}.txt`,
      mimeType: "text/plain",
      modifiedTime: "2025-01-01T00:00:00Z",
      size: "999999",
      parents: ["root"],
    }));

    vi.spyOn(globalThis, "fetch").mockResolvedValueOnce(
      new Response(JSON.stringify({ files: manyFiles })),
    );

    const tools = createDriveTools(mockAuth);
    const search = getTool(tools, "drive_search");
    const result = await search.execute({ query: "test" });

    expect(result).toContain("[Truncated");
    expect(result).toContain("chars total");
  });

  it("passes auth token in headers for all tools", async () => {
    const fetchSpy = vi.spyOn(globalThis, "fetch").mockResolvedValueOnce(
      new Response(JSON.stringify({ files: [] })),
    );

    const tools = createDriveTools(mockAuth);
    const listFolder = getTool(tools, "drive_list_folder");
    await listFolder.execute({});

    const calledOptions = fetchSpy.mock.calls[0][1] as RequestInit;
    const headers = calledOptions.headers as Record<string, string>;
    expect(headers.Authorization).toBe("Bearer mock-token");
  });

  it("throws on HTTP error response", async () => {
    vi.spyOn(globalThis, "fetch").mockResolvedValueOnce(
      new Response("Forbidden", { status: 403, statusText: "Forbidden" }),
    );

    const tools = createDriveTools(mockAuth);
    const search = getTool(tools, "drive_search");

    await expect(search.execute({ query: "test" })).rejects.toThrow(
      "Google API 403",
    );
  });
});
