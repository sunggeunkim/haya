import type { AgentTool } from "./types.js";
import type { GoogleAuth } from "../google/auth.js";
import { callGoogleApi, callGoogleApiText } from "../google/auth.js";
import { wrapExternalContent } from "../security/external-content.js";

const MAX_RESPONSE_LENGTH = 16_000;
const DRIVE_API_BASE = "https://www.googleapis.com/drive/v3";
const FIELDS_LIST = "files(id,name,mimeType,modifiedTime,size,parents)";

const EXPORT_MIME_MAP: Record<string, string> = {
  "application/vnd.google-apps.document": "text/markdown",
  "application/vnd.google-apps.spreadsheet": "text/csv",
  "application/vnd.google-apps.presentation": "text/plain",
  "application/vnd.google-apps.drawing": "image/png",
};

// ---------------------------------------------------------------------------
// Shared helpers
// ---------------------------------------------------------------------------

function truncate(text: string): string {
  if (text.length > MAX_RESPONSE_LENGTH) {
    return `${text.slice(0, MAX_RESPONSE_LENGTH)}\n\n[Truncated — ${text.length} chars total]`;
  }
  return text;
}

function isTextMimeType(mimeType: string): boolean {
  if (mimeType.startsWith("text/")) return true;
  const textTypes = [
    "application/json",
    "application/xml",
    "application/javascript",
    "application/typescript",
    "application/x-yaml",
    "application/toml",
  ];
  return textTypes.includes(mimeType);
}

// ---------------------------------------------------------------------------
// drive_search
// ---------------------------------------------------------------------------

function createSearchTool(auth: GoogleAuth): AgentTool {
  return {
    name: "drive_search",
    description:
      "Search for files in Google Drive by text content or file name. " +
      "Returns a list of matching files with their IDs, types, and modification dates.",
    parameters: {
      type: "object",
      properties: {
        query: {
          type: "string",
          description: "Search query (searches file names and content)",
        },
        maxResults: {
          type: "number",
          description: "Maximum number of results to return (default: 10)",
        },
      },
      required: ["query"],
    },
    async execute(args: Record<string, unknown>): Promise<string> {
      const query = args.query as string;
      if (!query) throw new Error("query is required");

      const maxResults = (args.maxResults as number) ?? 10;

      // Escape backslashes and single quotes for Drive query syntax
      const escapedQuery = query.replace(/\\/g, "\\\\").replace(/'/g, "\\'");

      const url = `${DRIVE_API_BASE}/files?q=fullText contains '${escapedQuery}'&fields=${FIELDS_LIST}&pageSize=${maxResults}`;
      const data = await callGoogleApi(url, auth);

      const files = data.files as Array<Record<string, unknown>> | undefined;
      if (!files || files.length === 0) {
        return "No files found";
      }

      const lines: string[] = [];
      for (const file of files) {
        lines.push(
          `- ${file.name} (${file.id})\n  Type: ${file.mimeType} | Modified: ${file.modifiedTime} | Size: ${file.size}`,
        );
      }

      return truncate(lines.join("\n"));
    },
  };
}

// ---------------------------------------------------------------------------
// drive_read_file
// ---------------------------------------------------------------------------

function createReadFileTool(auth: GoogleAuth): AgentTool {
  return {
    name: "drive_read_file",
    description:
      "Read the content of a file from Google Drive. " +
      "Supports Google Docs (exported as markdown), Sheets (exported as CSV), " +
      "Slides (exported as plain text), and plain text files.",
    parameters: {
      type: "object",
      properties: {
        fileId: {
          type: "string",
          description: "The Google Drive file ID",
        },
      },
      required: ["fileId"],
    },
    async execute(args: Record<string, unknown>): Promise<string> {
      const fileId = args.fileId as string;
      if (!fileId) throw new Error("fileId is required");

      // Get file metadata
      const metaUrl = `${DRIVE_API_BASE}/files/${fileId}?fields=id,name,mimeType,size`;
      const meta = await callGoogleApi(metaUrl, auth);

      const fileName = meta.name as string;
      const mimeType = meta.mimeType as string;
      const size = meta.size as string | undefined;

      let content: string;

      if (mimeType.startsWith("application/vnd.google-apps.")) {
        // Google Workspace file — export
        const exportMime = EXPORT_MIME_MAP[mimeType];
        if (!exportMime) {
          return `Binary file: ${fileName} (${mimeType}, ${size ?? "unknown"} bytes). Cannot display binary content.`;
        }
        const exportUrl = `${DRIVE_API_BASE}/files/${fileId}/export?mimeType=${exportMime}`;
        content = await callGoogleApiText(exportUrl, auth);
      } else if (isTextMimeType(mimeType)) {
        // Text-like file — download directly
        const downloadUrl = `${DRIVE_API_BASE}/files/${fileId}?alt=media`;
        content = await callGoogleApiText(downloadUrl, auth);
      } else {
        // Binary file
        return `Binary file: ${fileName} (${mimeType}, ${size ?? "unknown"} bytes). Cannot display binary content.`;
      }

      const wrapped = wrapExternalContent(content, `gdrive:${fileName}`);
      return truncate(`File: ${fileName} (${mimeType})\n\n${wrapped.text}`);
    },
  };
}

// ---------------------------------------------------------------------------
// drive_list_folder
// ---------------------------------------------------------------------------

function createListFolderTool(auth: GoogleAuth): AgentTool {
  return {
    name: "drive_list_folder",
    description:
      "List files and folders inside a Google Drive folder. " +
      "Defaults to the root folder if no folder ID is provided.",
    parameters: {
      type: "object",
      properties: {
        folderId: {
          type: "string",
          description:
            "The folder ID to list (default: root)",
        },
      },
    },
    async execute(args: Record<string, unknown>): Promise<string> {
      const folderId = (args.folderId as string) || "root";

      const url = `${DRIVE_API_BASE}/files?q='${folderId}' in parents and trashed=false&fields=${FIELDS_LIST}&pageSize=50&orderBy=folder,name`;
      const data = await callGoogleApi(url, auth);

      const files = data.files as Array<Record<string, unknown>> | undefined;
      if (!files || files.length === 0) {
        return "Folder is empty";
      }

      const lines: string[] = [];
      for (const file of files) {
        const mimeType = file.mimeType as string;
        if (mimeType === "application/vnd.google-apps.folder") {
          lines.push(`[DIR] ${file.name} (${file.id})`);
        } else {
          lines.push(
            `[FILE] ${file.name} (${file.id}) - ${mimeType}, ${file.size}`,
          );
        }
      }

      return truncate(lines.join("\n"));
    },
  };
}

// ---------------------------------------------------------------------------
// drive_create_file
// ---------------------------------------------------------------------------

function createCreateFileTool(auth: GoogleAuth): AgentTool {
  return {
    name: "drive_create_file",
    description:
      "Create a new file in Google Drive with the given name and content. " +
      "Optionally specify a parent folder and MIME type.",
    parameters: {
      type: "object",
      properties: {
        name: {
          type: "string",
          description: "File name (e.g. 'notes.txt')",
        },
        content: {
          type: "string",
          description: "The file content",
        },
        folderId: {
          type: "string",
          description: "Parent folder ID (optional)",
        },
        mimeType: {
          type: "string",
          description: "MIME type of the file (default: text/plain)",
        },
      },
      required: ["name", "content"],
    },
    async execute(args: Record<string, unknown>): Promise<string> {
      const name = args.name as string;
      const content = args.content as string;
      if (!name) throw new Error("name is required");
      if (content === undefined || content === null) throw new Error("content is required");

      const folderId = args.folderId as string | undefined;
      const mimeType = (args.mimeType as string) ?? "text/plain";

      const boundary = "haya_multipart_boundary";

      const metadata: Record<string, unknown> = { name, mimeType };
      if (folderId) {
        metadata.parents = [folderId];
      }

      const body = [
        `--${boundary}`,
        "Content-Type: application/json",
        "",
        JSON.stringify(metadata),
        `--${boundary}`,
        `Content-Type: ${mimeType}`,
        "",
        content,
        `--${boundary}--`,
      ].join("\r\n");

      const url = "https://www.googleapis.com/upload/drive/v3/files?uploadType=multipart";
      const data = await callGoogleApi(url, auth, {
        method: "POST",
        headers: {
          "Content-Type": `multipart/related; boundary=${boundary}`,
        },
        body,
      });

      const fileId = data.id as string;
      return `File created: ${name} (${fileId})`;
    },
  };
}

// ---------------------------------------------------------------------------
// drive_share_file
// ---------------------------------------------------------------------------

function createShareFileTool(auth: GoogleAuth): AgentTool {
  return {
    name: "drive_share_file",
    description:
      "Share a Google Drive file with a specific user by email. " +
      "Supports reader, writer, and commenter roles.",
    parameters: {
      type: "object",
      properties: {
        fileId: {
          type: "string",
          description: "The Google Drive file ID",
        },
        email: {
          type: "string",
          description: "Email address of the user to share with",
        },
        role: {
          type: "string",
          enum: ["reader", "writer", "commenter"],
          description: "Permission role to grant",
        },
      },
      required: ["fileId", "email", "role"],
    },
    async execute(args: Record<string, unknown>): Promise<string> {
      const fileId = args.fileId as string;
      const email = args.email as string;
      const role = args.role as string;
      if (!fileId) throw new Error("fileId is required");
      if (!email) throw new Error("email is required");
      if (!role) throw new Error("role is required");

      const url = `${DRIVE_API_BASE}/files/${fileId}/permissions`;
      await callGoogleApi(url, auth, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          type: "user",
          role,
          emailAddress: email,
        }),
      });

      return `Shared ${fileId} with ${email} as ${role}`;
    },
  };
}

// ---------------------------------------------------------------------------
// Public factory
// ---------------------------------------------------------------------------

export function createDriveTools(auth: GoogleAuth): AgentTool[] {
  return [
    createSearchTool(auth),
    createReadFileTool(auth),
    createListFolderTool(auth),
    createCreateFileTool(auth),
    createShareFileTool(auth),
  ];
}
