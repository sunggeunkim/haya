import { safeExecSync } from "../security/command-exec.js";
import type { BuiltinTool } from "./builtin-tools.js";

const MAX_RESPONSE_LENGTH = 16_000;

/**
 * Escape double quotes and backslashes for safe inclusion in AppleScript strings.
 */
function escapeForAppleScript(str: string): string {
  return str.replace(/\\/g, "\\\\").replace(/"/g, '\\"');
}

/**
 * Format bytes into a human-readable string (e.g. "4.2 GB").
 */
function formatBytes(bytes: number): string {
  const gb = bytes / (1024 * 1024 * 1024);
  return `${gb.toFixed(1)} GB`;
}

/**
 * Format seconds into a human-readable uptime string (e.g. "3d 14h 22m").
 */
function formatUptime(seconds: number): string {
  const days = Math.floor(seconds / 86400);
  const hours = Math.floor((seconds % 86400) / 3600);
  const minutes = Math.floor((seconds % 3600) / 60);

  const parts: string[] = [];
  if (days > 0) parts.push(`${days}d`);
  if (hours > 0) parts.push(`${hours}h`);
  parts.push(`${minutes}m`);
  return parts.join(" ");
}

/**
 * Create system integration tools for clipboard, screenshots, notifications,
 * and system information.
 */
export function createSystemTools(): BuiltinTool[] {
  return [
    // -----------------------------------------------------------------------
    // clipboard_read
    // -----------------------------------------------------------------------
    {
      name: "clipboard_read",
      description: "Read the current system clipboard contents.",
      defaultPolicy: "confirm",
      parameters: {
        type: "object",
        properties: {},
      },
      async execute(): Promise<string> {
        const platform = process.platform;
        let text: string;

        try {
          if (platform === "darwin") {
            text = safeExecSync("pbpaste", []);
          } else if (platform === "linux") {
            try {
              text = safeExecSync("xclip", [
                "-selection",
                "clipboard",
                "-o",
              ]);
            } catch {
              text = safeExecSync("xsel", ["--clipboard", "--output"]);
            }
          } else if (platform === "win32") {
            text = safeExecSync("powershell.exe", [
              "-Command",
              "Get-Clipboard",
            ]);
          } else {
            throw new Error(`Unsupported platform: ${platform}`);
          }
        } catch (err) {
          const message =
            err instanceof Error ? err.message : String(err);
          throw new Error(`Failed to read clipboard: ${message}`);
        }

        if (text.length > MAX_RESPONSE_LENGTH) {
          return `${text.slice(0, MAX_RESPONSE_LENGTH)}\n\n[Truncated — ${text.length} chars total]`;
        }
        return text;
      },
    },

    // -----------------------------------------------------------------------
    // clipboard_write
    // -----------------------------------------------------------------------
    {
      name: "clipboard_write",
      description: "Write text to the system clipboard.",
      defaultPolicy: "confirm",
      parameters: {
        type: "object",
        properties: {
          text: {
            type: "string",
            description: "The text to copy to the clipboard",
          },
        },
        required: ["text"],
      },
      async execute(args: Record<string, unknown>): Promise<string> {
        const text = args.text as string;
        if (!text && text !== "") throw new Error("text is required");

        const { execFileSync } = await import("node:child_process");
        const platform = process.platform;

        try {
          if (platform === "darwin") {
            execFileSync("pbcopy", [], { input: text, shell: false });
          } else if (platform === "linux") {
            execFileSync("xclip", ["-selection", "clipboard"], {
              input: text,
              shell: false,
            });
          } else if (platform === "win32") {
            execFileSync("powershell.exe", ["-Command", "Set-Clipboard"], {
              input: text,
              shell: false,
            });
          } else {
            throw new Error(`Unsupported platform: ${platform}`);
          }
        } catch (err) {
          const message =
            err instanceof Error ? err.message : String(err);
          throw new Error(`Failed to write to clipboard: ${message}`);
        }

        return `Copied ${text.length} characters to clipboard`;
      },
    },

    // -----------------------------------------------------------------------
    // screenshot
    // -----------------------------------------------------------------------
    {
      name: "screenshot",
      description:
        "Capture a screenshot of the screen. Returns the file path of the saved screenshot.",
      defaultPolicy: "confirm",
      parameters: {
        type: "object",
        properties: {
          output_path: {
            type: "string",
            description:
              "File path for the screenshot (default: /tmp/haya-screenshot-{timestamp}.png)",
          },
        },
      },
      async execute(args: Record<string, unknown>): Promise<string> {
        const outputPath =
          (args.output_path as string) ||
          `/tmp/haya-screenshot-${Date.now()}.png`;
        const platform = process.platform;

        try {
          if (platform === "darwin") {
            safeExecSync("screencapture", ["-x", outputPath]);
          } else if (platform === "linux") {
            try {
              safeExecSync("scrot", [outputPath]);
            } catch {
              safeExecSync("gnome-screenshot", ["-f", outputPath]);
            }
          } else if (platform === "win32") {
            const { execFileSync } = await import("node:child_process");
            const script = [
              "Add-Type -AssemblyName System.Windows.Forms;",
              "$bmp = [System.Windows.Forms.Screen]::PrimaryScreen;",
              "$bounds = $bmp.Bounds;",
              "$bitmap = New-Object System.Drawing.Bitmap($bounds.Width, $bounds.Height);",
              "$graphics = [System.Drawing.Graphics]::FromImage($bitmap);",
              "$graphics.CopyFromScreen($bounds.Location, [System.Drawing.Point]::Empty, $bounds.Size);",
              `$bitmap.Save('${outputPath.replace(/'/g, "''")}');`,
              "$graphics.Dispose();",
              "$bitmap.Dispose();",
            ].join(" ");
            execFileSync("powershell.exe", ["-Command", script], {
              shell: false,
            });
          } else {
            throw new Error(`Unsupported platform: ${platform}`);
          }
        } catch (err) {
          const message =
            err instanceof Error ? err.message : String(err);
          throw new Error(`Failed to capture screenshot: ${message}`);
        }

        return `Screenshot saved to ${outputPath}`;
      },
    },

    // -----------------------------------------------------------------------
    // notify
    // -----------------------------------------------------------------------
    {
      name: "notify",
      description:
        "Send a desktop notification with a title and message.",
      defaultPolicy: "allow",
      parameters: {
        type: "object",
        properties: {
          title: {
            type: "string",
            description: "The notification title",
          },
          message: {
            type: "string",
            description: "The notification message body",
          },
        },
        required: ["title", "message"],
      },
      async execute(args: Record<string, unknown>): Promise<string> {
        const title = args.title as string;
        const message = args.message as string;
        if (!title) throw new Error("title is required");
        if (!message) throw new Error("message is required");

        const platform = process.platform;

        try {
          if (platform === "darwin") {
            const escapedTitle = escapeForAppleScript(title);
            const escapedMsg = escapeForAppleScript(message);
            safeExecSync("osascript", [
              "-e",
              `display notification "${escapedMsg}" with title "${escapedTitle}"`,
            ]);
          } else if (platform === "linux") {
            safeExecSync("notify-send", [title, message]);
          } else if (platform === "win32") {
            const { execFileSync } = await import("node:child_process");
            const escapedTitle = title.replace(/'/g, "''");
            const escapedMsg = message.replace(/'/g, "''");
            const script = [
              "Add-Type -AssemblyName System.Windows.Forms;",
              "$n = New-Object System.Windows.Forms.NotifyIcon;",
              "$n.Icon = [System.Drawing.SystemIcons]::Information;",
              "$n.Visible = $true;",
              `$n.ShowBalloonTip(5000, '${escapedTitle}', '${escapedMsg}', 'Info');`,
            ].join(" ");
            execFileSync("powershell.exe", ["-Command", script], {
              shell: false,
            });
          } else {
            throw new Error(`Unsupported platform: ${platform}`);
          }
        } catch (err) {
          const message_ =
            err instanceof Error ? err.message : String(err);
          throw new Error(`Failed to send notification: ${message_}`);
        }

        return `Notification sent: ${title}`;
      },
    },

    // -----------------------------------------------------------------------
    // system_info
    // -----------------------------------------------------------------------
    {
      name: "system_info",
      description:
        "Get system information: OS, CPU, memory, disk usage, uptime.",
      defaultPolicy: "allow",
      parameters: {
        type: "object",
        properties: {},
      },
      async execute(): Promise<string> {
        const os = await import("node:os");

        const hostname = os.hostname();
        const platform = os.platform();
        const arch = os.arch();
        const cpus = os.cpus();
        const totalMem = os.totalmem();
        const freeMem = os.freemem();
        const uptime = os.uptime();

        const usedMem = totalMem - freeMem;
        const memPercent = Math.round((usedMem / totalMem) * 100);

        const cpuModel = cpus.length > 0 ? cpus[0].model.trim() : "Unknown";
        const cpuSpeed =
          cpus.length > 0
            ? `${(cpus[0].speed / 1000).toFixed(2)}GHz`
            : "Unknown";

        const lines = [
          "System Information:",
          `  Hostname: ${hostname}`,
          `  OS: ${platform} ${arch}`,
          `  CPUs: ${cpus.length} \u00d7 ${cpuModel} @ ${cpuSpeed}`,
          `  Memory: ${formatBytes(usedMem)} / ${formatBytes(totalMem)} (${memPercent}% used)`,
          `  Uptime: ${formatUptime(uptime)}`,
        ];

        return lines.join("\n");
      },
    },
  ];
}
