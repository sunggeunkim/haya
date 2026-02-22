import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { createGatewayTools } from "./gateway-tools.js";
import type { GatewayToolContext } from "./gateway-tools.js";
import type { AgentTool } from "./types.js";

vi.mock("../infra/logger.js", () => ({
  redactSensitive: vi.fn((obj: unknown) => obj),
}));

function getTool(tools: AgentTool[], name: string): AgentTool {
  const tool = tools.find((t) => t.name === name);
  if (!tool) throw new Error(`Tool not found: ${name}`);
  return tool;
}

function createMockContext(
  overrides?: Partial<GatewayToolContext>,
): GatewayToolContext {
  return {
    config: {
      agent: { defaultProvider: "openai", defaultModel: "gpt-4o" },
      gateway: { port: 18789 },
    } as GatewayToolContext["config"],
    uptime: () => 3661000, // 1h 1m 1s
    channelRegistry: {
      list: vi.fn().mockReturnValue([]),
    } as unknown as GatewayToolContext["channelRegistry"],
    cronService: {
      listJobs: vi.fn().mockReturnValue([]),
    } as unknown as GatewayToolContext["cronService"],
    ...overrides,
  };
}

// ---------------------------------------------------------------------------
// Factory tests
// ---------------------------------------------------------------------------

describe("createGatewayTools", () => {
  it("returns 2 tools: gateway_status and gateway_config", () => {
    const ctx = createMockContext();
    const tools = createGatewayTools(ctx);
    expect(tools).toHaveLength(2);
    const names = tools.map((t) => t.name).sort();
    expect(names).toEqual(["gateway_config", "gateway_status"]);
  });
});

// ---------------------------------------------------------------------------
// gateway_status
// ---------------------------------------------------------------------------

describe("gateway_status", () => {
  let ctx: GatewayToolContext;
  let tool: AgentTool;

  beforeEach(() => {
    ctx = createMockContext();
    tool = getTool(createGatewayTools(ctx), "gateway_status");
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("includes uptime, provider, model, and port", async () => {
    const result = await tool.execute({});

    expect(result).toContain("Uptime: 1h 1m 1s");
    expect(result).toContain("Provider: openai");
    expect(result).toContain("Model: gpt-4o");
    expect(result).toContain("Port: 18789");
  });

  it("lists channels when present", async () => {
    const mockChannel = {
      id: "slack",
      name: "Slack",
      status: vi.fn().mockReturnValue({ connected: true }),
    };
    ctx = createMockContext({
      channelRegistry: {
        list: vi.fn().mockReturnValue([mockChannel]),
      } as unknown as GatewayToolContext["channelRegistry"],
    });
    tool = getTool(createGatewayTools(ctx), "gateway_status");

    const result = await tool.execute({});

    expect(result).toContain("Channels (1):");
    expect(result).toContain("- slack (Slack): connected");
  });

  it("shows (none) when no channels", async () => {
    const result = await tool.execute({});

    expect(result).toContain("Channels (0):");
    expect(result).toContain("(none)");
  });

  it("shows cron job counts", async () => {
    ctx = createMockContext({
      cronService: {
        listJobs: vi.fn().mockReturnValue([
          { id: "1", enabled: true },
          { id: "2", enabled: false },
          { id: "3", enabled: true },
        ]),
      } as unknown as GatewayToolContext["cronService"],
    });
    tool = getTool(createGatewayTools(ctx), "gateway_status");

    const result = await tool.execute({});

    expect(result).toContain("Cron jobs: 2 active / 3 total");
  });
});

// ---------------------------------------------------------------------------
// gateway_config
// ---------------------------------------------------------------------------

describe("gateway_config", () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("returns JSON config", async () => {
    const ctx = createMockContext();
    const tool = getTool(createGatewayTools(ctx), "gateway_config");

    const result = await tool.execute({});
    const parsed = JSON.parse(result);

    expect(parsed.agent.defaultProvider).toBe("openai");
    expect(parsed.agent.defaultModel).toBe("gpt-4o");
    expect(parsed.gateway.port).toBe(18789);
  });
});
