import { describe, it, expect } from "vitest";
import { definePlugin } from "./index.js";

describe("definePlugin", () => {
  it("returns the same object reference (identity function)", () => {
    const definition = {
      id: "test-plugin",
      name: "Test Plugin",
      register: () => {},
    };

    const result = definePlugin(definition as Parameters<typeof definePlugin>[0]);
    expect(result).toBe(definition);
  });

  it("returned object has all provided fields", () => {
    const definition = {
      id: "my-plugin",
      name: "My Plugin",
      version: "1.0.0",
      permissions: { filesystem: ["/tmp"] },
      register: () => {},
    };

    const result = definePlugin(definition as Parameters<typeof definePlugin>[0]);
    expect(result.id).toBe("my-plugin");
    expect(result.name).toBe("My Plugin");
    expect(result.version).toBe("1.0.0");
    expect(result).toHaveProperty("permissions");
    expect(result).toHaveProperty("register");
  });
});
