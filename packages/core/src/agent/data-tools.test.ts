import { describe, expect, it } from "vitest";
import { createDataTools } from "./data-tools.js";
import type { AgentTool } from "./types.js";

function getTool(tools: AgentTool[], name: string): AgentTool {
  const tool = tools.find((t) => t.name === name);
  if (!tool) throw new Error(`Tool not found: ${name}`);
  return tool;
}

// ---------------------------------------------------------------------------
// Factory tests
// ---------------------------------------------------------------------------

describe("createDataTools", () => {
  it("returns exactly 2 tools", () => {
    const tools = createDataTools();
    expect(tools).toHaveLength(2);
  });

  it("returns tools named data_convert and text_diff", () => {
    const tools = createDataTools();
    expect(tools.map((t) => t.name).sort()).toEqual([
      "data_convert",
      "text_diff",
    ]);
  });
});

// ---------------------------------------------------------------------------
// data_convert
// ---------------------------------------------------------------------------

describe("data_convert", () => {
  let tool: AgentTool;

  const setup = () => {
    tool = getTool(createDataTools(), "data_convert");
  };

  // -------------------------------------------------------------------------
  // JSON to CSV
  // -------------------------------------------------------------------------

  it("converts JSON to CSV", async () => {
    setup();
    const input = JSON.stringify([
      { name: "Alice", age: 30 },
      { name: "Bob", age: 25 },
    ]);
    const result = await tool.execute({ input, from: "json", to: "csv" });
    const lines = result.split("\n");
    expect(lines[0]).toBe("name,age");
    expect(lines[1]).toBe("Alice,30");
    expect(lines[2]).toBe("Bob,25");
  });

  // -------------------------------------------------------------------------
  // CSV to JSON
  // -------------------------------------------------------------------------

  it("converts CSV to JSON", async () => {
    setup();
    const input = "name,age\nAlice,30\nBob,25";
    const result = await tool.execute({ input, from: "csv", to: "json" });
    const data = JSON.parse(result);
    expect(data).toEqual([
      { name: "Alice", age: "30" },
      { name: "Bob", age: "25" },
    ]);
  });

  // -------------------------------------------------------------------------
  // JSON to YAML
  // -------------------------------------------------------------------------

  it("converts JSON to YAML", async () => {
    setup();
    const input = JSON.stringify({ name: "Alice", age: 30, active: true });
    const result = await tool.execute({ input, from: "json", to: "yaml" });
    expect(result).toContain("name: Alice");
    expect(result).toContain("age: 30");
    expect(result).toContain("active: true");
  });

  // -------------------------------------------------------------------------
  // YAML to JSON
  // -------------------------------------------------------------------------

  it("converts YAML to JSON", async () => {
    setup();
    const input = "name: Alice\nage: 30\nactive: true";
    const result = await tool.execute({ input, from: "yaml", to: "json" });
    const data = JSON.parse(result);
    expect(data).toEqual({ name: "Alice", age: 30, active: true });
  });

  // -------------------------------------------------------------------------
  // JSON to TOML
  // -------------------------------------------------------------------------

  it("converts JSON to TOML", async () => {
    setup();
    const input = JSON.stringify({ title: "Example", version: 1 });
    const result = await tool.execute({ input, from: "json", to: "toml" });
    expect(result).toContain('title = "Example"');
    expect(result).toContain("version = 1");
  });

  // -------------------------------------------------------------------------
  // TOML to JSON
  // -------------------------------------------------------------------------

  it("converts TOML to JSON", async () => {
    setup();
    const input = 'title = "Example"\nversion = 1';
    const result = await tool.execute({ input, from: "toml", to: "json" });
    const data = JSON.parse(result);
    expect(data).toEqual({ title: "Example", version: 1 });
  });

  // -------------------------------------------------------------------------
  // Round-trip: JSON -> CSV -> JSON
  // -------------------------------------------------------------------------

  it("round-trips JSON to CSV to JSON preserving data", async () => {
    setup();
    const original = [
      { name: "Alice", city: "NYC" },
      { name: "Bob", city: "LA" },
    ];
    const csv = await tool.execute({
      input: JSON.stringify(original),
      from: "json",
      to: "csv",
    });
    const jsonResult = await tool.execute({
      input: csv,
      from: "csv",
      to: "json",
    });
    const parsed = JSON.parse(jsonResult);
    expect(parsed).toEqual(original);
  });

  // -------------------------------------------------------------------------
  // Invalid input handling
  // -------------------------------------------------------------------------

  it("throws on invalid JSON input", async () => {
    setup();
    await expect(
      tool.execute({ input: "{not valid json", from: "json", to: "csv" }),
    ).rejects.toThrow();
  });

  // -------------------------------------------------------------------------
  // Empty input
  // -------------------------------------------------------------------------

  it("returns empty string for empty input", async () => {
    setup();
    const result = await tool.execute({ input: "", from: "json", to: "csv" });
    expect(result).toBe("");
  });

  it("returns empty string for whitespace-only input", async () => {
    setup();
    const result = await tool.execute({
      input: "   ",
      from: "json",
      to: "csv",
    });
    expect(result).toBe("");
  });

  // -------------------------------------------------------------------------
  // Same format (identity)
  // -------------------------------------------------------------------------

  it("JSON to JSON works as identity", async () => {
    setup();
    const input = JSON.stringify({ hello: "world" }, null, 2);
    const result = await tool.execute({ input, from: "json", to: "json" });
    expect(JSON.parse(result)).toEqual({ hello: "world" });
  });

  // -------------------------------------------------------------------------
  // CSV with quoted fields
  // -------------------------------------------------------------------------

  it("handles CSV with quoted fields containing commas", async () => {
    setup();
    const input = 'name,address\n"Doe, Jane","123 Main St"';
    const result = await tool.execute({ input, from: "csv", to: "json" });
    const data = JSON.parse(result);
    expect(data[0].name).toBe("Doe, Jane");
    expect(data[0].address).toBe("123 Main St");
  });

  // -------------------------------------------------------------------------
  // TOML sections
  // -------------------------------------------------------------------------

  it("parses TOML with sections", async () => {
    setup();
    const input = 'title = "Config"\n\n[database]\nhost = "localhost"\nport = 5432';
    const result = await tool.execute({ input, from: "toml", to: "json" });
    const data = JSON.parse(result);
    expect(data.title).toBe("Config");
    expect(data.database.host).toBe("localhost");
    expect(data.database.port).toBe(5432);
  });

  // -------------------------------------------------------------------------
  // Prototype pollution: YAML
  // -------------------------------------------------------------------------

  describe("prototype pollution prevention (YAML)", () => {
    for (const key of ["__proto__", "constructor", "prototype"]) {
      it(`ignores dangerous key "${key}" in YAML top-level`, async () => {
        setup();
        const input = `safe: hello\n${key}: polluted`;
        const result = await tool.execute({ input, from: "yaml", to: "json" });
        const data = JSON.parse(result);
        expect(data.safe).toBe("hello");
        expect(data).not.toHaveProperty(key);
      });

      it(`ignores dangerous key "${key}" in YAML nested object`, async () => {
        setup();
        const input = `parent:\n  ${key}: polluted\n  ok: value`;
        const result = await tool.execute({ input, from: "yaml", to: "json" });
        const data = JSON.parse(result);
        expect(data.parent.ok).toBe("value");
        expect(data.parent).not.toHaveProperty(key);
      });
    }

    it("does not pollute Object.prototype via YAML __proto__", async () => {
      setup();
      const input = "__proto__:\n  polluted: yes";
      await tool.execute({ input, from: "yaml", to: "json" });
      expect(({} as Record<string, unknown>)["polluted"]).toBeUndefined();
    });
  });

  // -------------------------------------------------------------------------
  // Prototype pollution: TOML
  // -------------------------------------------------------------------------

  describe("prototype pollution prevention (TOML)", () => {
    for (const key of ["__proto__", "constructor", "prototype"]) {
      it(`ignores dangerous key "${key}" in TOML key-value`, async () => {
        setup();
        const input = `safe = "hello"\n${key} = "polluted"`;
        const result = await tool.execute({ input, from: "toml", to: "json" });
        const data = JSON.parse(result);
        expect(data.safe).toBe("hello");
        expect(data).not.toHaveProperty(key);
      });

      it(`ignores dangerous section name "${key}" in TOML`, async () => {
        setup();
        const input = `safe = "hello"\n\n[${key}]\nfoo = "bar"`;
        const result = await tool.execute({ input, from: "toml", to: "json" });
        const data = JSON.parse(result);
        expect(data.safe).toBe("hello");
        expect(data).not.toHaveProperty(key);
      });
    }

    it("does not pollute Object.prototype via TOML __proto__ section", async () => {
      setup();
      const input = '[__proto__]\npolluted = "yes"';
      await tool.execute({ input, from: "toml", to: "json" });
      expect(({} as Record<string, unknown>)["polluted"]).toBeUndefined();
    });
  });
});

// ---------------------------------------------------------------------------
// text_diff
// ---------------------------------------------------------------------------

describe("text_diff", () => {
  let tool: AgentTool;

  const setup = () => {
    tool = getTool(createDataTools(), "text_diff");
  };

  // -------------------------------------------------------------------------
  // Identical texts
  // -------------------------------------------------------------------------

  it("returns no diff markers for identical texts", async () => {
    setup();
    const text = "line1\nline2\nline3";
    const result = await tool.execute({ text_a: text, text_b: text });
    expect(result).toBe("No differences found.");
  });

  // -------------------------------------------------------------------------
  // Added lines
  // -------------------------------------------------------------------------

  it("shows added lines with +", async () => {
    setup();
    const result = await tool.execute({
      text_a: "line1\nline2",
      text_b: "line1\nline2\nline3",
    });
    expect(result).toContain("+line3");
  });

  // -------------------------------------------------------------------------
  // Removed lines
  // -------------------------------------------------------------------------

  it("shows removed lines with -", async () => {
    setup();
    const result = await tool.execute({
      text_a: "line1\nline2\nline3",
      text_b: "line1\nline2",
    });
    expect(result).toContain("-line3");
  });

  // -------------------------------------------------------------------------
  // Mixed changes
  // -------------------------------------------------------------------------

  it("handles mixed additions and removals", async () => {
    setup();
    const result = await tool.execute({
      text_a: "aaa\nbbb\nccc",
      text_b: "aaa\nxxx\nccc",
    });
    expect(result).toContain("-bbb");
    expect(result).toContain("+xxx");
  });

  // -------------------------------------------------------------------------
  // Empty inputs
  // -------------------------------------------------------------------------

  it("handles empty text_a", async () => {
    setup();
    const result = await tool.execute({
      text_a: "",
      text_b: "hello",
    });
    expect(result).toContain("+hello");
  });

  it("handles empty text_b", async () => {
    setup();
    const result = await tool.execute({
      text_a: "hello",
      text_b: "",
    });
    expect(result).toContain("-hello");
  });

  it("handles both empty", async () => {
    setup();
    const result = await tool.execute({
      text_a: "",
      text_b: "",
    });
    expect(result).toBe("No differences found.");
  });

  // -------------------------------------------------------------------------
  // Context lines parameter
  // -------------------------------------------------------------------------

  it("respects context_lines parameter", async () => {
    setup();
    const textA = "1\n2\n3\n4\n5\n6\n7\n8\n9\n10";
    const textB = "1\n2\n3\n4\nFIVE\n6\n7\n8\n9\n10";

    // With context_lines = 1, lines far from the change should not appear
    const result = await tool.execute({
      text_a: textA,
      text_b: textB,
      context_lines: 1,
    });
    expect(result).toContain("-5");
    expect(result).toContain("+FIVE");
    // Lines 1, 2 should not be in the output with context=1
    expect(result).not.toContain(" 1");
    expect(result).not.toContain(" 2");
    // Adjacent context lines should be present
    expect(result).toContain(" 4");
    expect(result).toContain(" 6");
  });

  it("context_lines = 0 shows only changed lines", async () => {
    setup();
    const result = await tool.execute({
      text_a: "aaa\nbbb\nccc",
      text_b: "aaa\nxxx\nccc",
      context_lines: 0,
    });
    expect(result).toContain("-bbb");
    expect(result).toContain("+xxx");
    expect(result).not.toContain(" aaa");
    expect(result).not.toContain(" ccc");
  });
});
