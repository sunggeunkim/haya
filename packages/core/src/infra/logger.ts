import { Logger } from "tslog";

/**
 * Patterns that indicate a value should be redacted in logs.
 */
const SENSITIVE_KEY_PATTERNS = [
  /token/i,
  /password/i,
  /secret/i,
  /api[_-]?key/i,
  /auth/i,
  /credential/i,
  /private[_-]?key/i,
  /access[_-]?key/i,
];

/**
 * Recursively redact sensitive values from objects before logging.
 */
export function redactSensitive(obj: unknown): unknown {
  if (obj === null || obj === undefined) return obj;
  if (typeof obj === "string") return obj;
  if (typeof obj !== "object") return obj;

  if (Array.isArray(obj)) {
    return obj.map(redactSensitive);
  }

  const result: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(obj as Record<string, unknown>)) {
    if (isSensitiveKey(key) && typeof value === "string") {
      result[key] = "[REDACTED]";
    } else if (typeof value === "object" && value !== null) {
      result[key] = redactSensitive(value);
    } else {
      result[key] = value;
    }
  }
  return result;
}

function isSensitiveKey(key: string): boolean {
  return SENSITIVE_KEY_PATTERNS.some((pattern) => pattern.test(key));
}

export type LogLevel = "silly" | "trace" | "debug" | "info" | "warn" | "error" | "fatal";

const LOG_LEVEL_MAP: Record<LogLevel, number> = {
  silly: 0,
  trace: 1,
  debug: 2,
  info: 3,
  warn: 4,
  error: 5,
  fatal: 6,
};

export function createLogger(
  name: string,
  options?: { level?: LogLevel; redact?: boolean },
): Logger<unknown> {
  const level = options?.level ?? "info";
  const shouldRedact = options?.redact !== false;

  const logger = new Logger({
    name,
    minLevel: LOG_LEVEL_MAP[level],
    type: "pretty",
    ...(shouldRedact && {
      maskValuesOfKeys: [
        "token",
        "password",
        "secret",
        "apiKey",
        "api_key",
        "accessKey",
        "privateKey",
        "credential",
        "authorization",
      ],
      maskPlaceholder: "[REDACTED]",
    }),
  });

  return logger;
}
