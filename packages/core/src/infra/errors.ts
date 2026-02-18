export class AppError extends Error {
  constructor(
    message: string,
    public readonly code: string,
    public readonly statusCode: number = 500,
    public readonly cause?: unknown,
  ) {
    super(message);
    this.name = "AppError";
  }
}

export class ConfigError extends AppError {
  constructor(message: string, cause?: unknown) {
    super(message, "CONFIG_ERROR", 500, cause);
    this.name = "ConfigError";
  }
}

export class AuthError extends AppError {
  constructor(message: string, cause?: unknown) {
    super(message, "AUTH_ERROR", 401, cause);
    this.name = "AuthError";
  }
}

export class ValidationError extends AppError {
  constructor(message: string, cause?: unknown) {
    super(message, "VALIDATION_ERROR", 400, cause);
    this.name = "ValidationError";
  }
}

export class NotFoundError extends AppError {
  constructor(message: string, cause?: unknown) {
    super(message, "NOT_FOUND", 404, cause);
    this.name = "NotFoundError";
  }
}

export class RateLimitError extends AppError {
  constructor(message: string = "Too many requests", cause?: unknown) {
    super(message, "RATE_LIMIT", 429, cause);
    this.name = "RateLimitError";
  }
}
