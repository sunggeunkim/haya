import { describe, expect, it } from "vitest";
import {
  AppError,
  AuthError,
  ConfigError,
  NotFoundError,
  RateLimitError,
  ValidationError,
} from "./errors.js";

describe("Error types", () => {
  it("AppError has correct properties", () => {
    const err = new AppError("test error", "TEST_CODE", 500);
    expect(err.message).toBe("test error");
    expect(err.code).toBe("TEST_CODE");
    expect(err.statusCode).toBe(500);
    expect(err.name).toBe("AppError");
    expect(err).toBeInstanceOf(Error);
    expect(err).toBeInstanceOf(AppError);
  });

  it("AppError supports cause", () => {
    const cause = new Error("root cause");
    const err = new AppError("wrapper", "WRAP", 500, cause);
    expect(err.cause).toBe(cause);
  });

  it("ConfigError defaults to 500", () => {
    const err = new ConfigError("bad config");
    expect(err.code).toBe("CONFIG_ERROR");
    expect(err.statusCode).toBe(500);
    expect(err.name).toBe("ConfigError");
    expect(err).toBeInstanceOf(AppError);
  });

  it("AuthError defaults to 401", () => {
    const err = new AuthError("unauthorized");
    expect(err.code).toBe("AUTH_ERROR");
    expect(err.statusCode).toBe(401);
    expect(err.name).toBe("AuthError");
  });

  it("ValidationError defaults to 400", () => {
    const err = new ValidationError("invalid input");
    expect(err.code).toBe("VALIDATION_ERROR");
    expect(err.statusCode).toBe(400);
    expect(err.name).toBe("ValidationError");
  });

  it("NotFoundError defaults to 404", () => {
    const err = new NotFoundError("not found");
    expect(err.code).toBe("NOT_FOUND");
    expect(err.statusCode).toBe(404);
    expect(err.name).toBe("NotFoundError");
  });

  it("RateLimitError defaults to 429", () => {
    const err = new RateLimitError();
    expect(err.code).toBe("RATE_LIMIT");
    expect(err.statusCode).toBe(429);
    expect(err.message).toBe("Too many requests");
    expect(err.name).toBe("RateLimitError");
  });

  it("RateLimitError accepts custom message", () => {
    const err = new RateLimitError("Slow down");
    expect(err.message).toBe("Slow down");
  });
});
