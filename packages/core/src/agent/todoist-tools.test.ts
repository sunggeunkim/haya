import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { createTodoistTools } from "./todoist-tools.js";

vi.mock("../config/secrets.js", () => ({
  requireSecret: vi.fn().mockReturnValue("test-todoist-token"),
}));

describe("createTodoistTools", () => {
  it("returns 4 tools", () => {
    const tools = createTodoistTools({ apiKeyEnvVar: "TODOIST_API_TOKEN" });
    expect(tools).toHaveLength(4);
    expect(tools.map((t) => t.name)).toEqual([
      "todoist_tasks",
      "todoist_projects",
      "todoist_task_search",
      "todoist_labels",
    ]);
  });

  it("tools have required fields", () => {
    const tools = createTodoistTools({ apiKeyEnvVar: "TODOIST_API_TOKEN" });
    for (const tool of tools) {
      expect(tool.description).toBeTruthy();
      expect(tool.defaultPolicy).toBeTruthy();
      expect(tool.parameters).toBeTruthy();
      expect(typeof tool.execute).toBe("function");
    }
  });

  it("todoist_tasks and todoist_projects have confirm policy", () => {
    const tools = createTodoistTools({ apiKeyEnvVar: "TODOIST_API_TOKEN" });
    const tasks = tools.find((t) => t.name === "todoist_tasks")!;
    const projects = tools.find((t) => t.name === "todoist_projects")!;
    expect(tasks.defaultPolicy).toBe("confirm");
    expect(projects.defaultPolicy).toBe("confirm");
  });

  it("todoist_task_search and todoist_labels have allow policy", () => {
    const tools = createTodoistTools({ apiKeyEnvVar: "TODOIST_API_TOKEN" });
    const search = tools.find((t) => t.name === "todoist_task_search")!;
    const labels = tools.find((t) => t.name === "todoist_labels")!;
    expect(search.defaultPolicy).toBe("allow");
    expect(labels.defaultPolicy).toBe("allow");
  });
});

describe("todoist_tasks", () => {
  const originalFetch = globalThis.fetch;

  beforeEach(() => {
    globalThis.fetch = vi.fn();
  });

  afterEach(() => {
    globalThis.fetch = originalFetch;
  });

  const jsonResponse = (body: unknown, status = 200) => ({
    ok: true,
    status,
    json: vi.fn().mockResolvedValue(body),
    text: vi.fn().mockResolvedValue(JSON.stringify(body)),
  });

  const noContentResponse = () => ({
    ok: true,
    status: 204,
    json: vi.fn(),
    text: vi.fn().mockResolvedValue(""),
  });

  function getTool() {
    const tools = createTodoistTools({ apiKeyEnvVar: "TODOIST_API_TOKEN" });
    return tools.find((t) => t.name === "todoist_tasks")!;
  }

  it("lists tasks", async () => {
    (globalThis.fetch as ReturnType<typeof vi.fn>).mockResolvedValue(
      jsonResponse([
        {
          id: "123",
          content: "Buy groceries",
          description: "",
          is_completed: false,
          due: { string: "tomorrow", date: "2026-02-24" },
          priority: 1,
          labels: [],
          project_id: "456",
          url: "https://todoist.com/showTask?id=123",
        },
      ]),
    );

    const tool = getTool();
    const result = await tool.execute({ action: "list" });

    expect(result).toContain("Buy groceries");
    expect(result).toContain("ID: 123");
    expect(result).toContain("Due: tomorrow");

    const callUrl = (globalThis.fetch as ReturnType<typeof vi.fn>).mock
      .calls[0][0] as string;
    expect(callUrl).toContain("/rest/v2/tasks");
  });

  it("lists tasks filtered by project_id", async () => {
    (globalThis.fetch as ReturnType<typeof vi.fn>).mockResolvedValue(
      jsonResponse([]),
    );

    const tool = getTool();
    const result = await tool.execute({ action: "list", project_id: "789" });

    expect(result).toBe("No active tasks found.");

    const callUrl = (globalThis.fetch as ReturnType<typeof vi.fn>).mock
      .calls[0][0] as string;
    expect(callUrl).toContain("project_id=789");
  });

  it("creates a task", async () => {
    (globalThis.fetch as ReturnType<typeof vi.fn>).mockResolvedValue(
      jsonResponse({
        id: "999",
        content: "Walk the dog",
        description: "At the park",
        is_completed: false,
        due: { string: "today", date: "2026-02-23" },
        priority: 3,
        labels: ["pets"],
        project_id: "456",
        url: "https://todoist.com/showTask?id=999",
      }),
    );

    const tool = getTool();
    const result = await tool.execute({
      action: "create",
      content: "Walk the dog",
      description: "At the park",
      due_string: "today",
      priority: 3,
      labels: ["pets"],
    });

    expect(result).toContain("Created task:");
    expect(result).toContain("Walk the dog");
    expect(result).toContain("Description: At the park");
    expect(result).toContain("Priority: 3");
    expect(result).toContain("Labels: pets");

    const fetchCall = (globalThis.fetch as ReturnType<typeof vi.fn>).mock.calls[0];
    expect(fetchCall[1].method).toBe("POST");
    const body = JSON.parse(fetchCall[1].body as string);
    expect(body.content).toBe("Walk the dog");
    expect(body.due_string).toBe("today");
    expect(body.priority).toBe(3);
  });

  it("throws if content is missing for create", async () => {
    const tool = getTool();
    await expect(tool.execute({ action: "create" })).rejects.toThrow(
      "content is required for create",
    );
  });

  it("completes a task", async () => {
    (globalThis.fetch as ReturnType<typeof vi.fn>).mockResolvedValue(
      noContentResponse(),
    );

    const tool = getTool();
    const result = await tool.execute({ action: "complete", task_id: "123" });

    expect(result).toContain("Task 123 marked as complete");

    const callUrl = (globalThis.fetch as ReturnType<typeof vi.fn>).mock
      .calls[0][0] as string;
    expect(callUrl).toContain("/tasks/123/close");
  });

  it("throws if task_id is missing for complete", async () => {
    const tool = getTool();
    await expect(tool.execute({ action: "complete" })).rejects.toThrow(
      "task_id is required for complete",
    );
  });

  it("reopens a task", async () => {
    (globalThis.fetch as ReturnType<typeof vi.fn>).mockResolvedValue(
      noContentResponse(),
    );

    const tool = getTool();
    const result = await tool.execute({ action: "reopen", task_id: "123" });

    expect(result).toContain("Task 123 reopened");

    const callUrl = (globalThis.fetch as ReturnType<typeof vi.fn>).mock
      .calls[0][0] as string;
    expect(callUrl).toContain("/tasks/123/reopen");
  });

  it("throws if task_id is missing for reopen", async () => {
    const tool = getTool();
    await expect(tool.execute({ action: "reopen" })).rejects.toThrow(
      "task_id is required for reopen",
    );
  });

  it("deletes a task", async () => {
    (globalThis.fetch as ReturnType<typeof vi.fn>).mockResolvedValue(
      noContentResponse(),
    );

    const tool = getTool();
    const result = await tool.execute({ action: "delete", task_id: "123" });

    expect(result).toContain("Task 123 deleted");

    const fetchCall = (globalThis.fetch as ReturnType<typeof vi.fn>).mock.calls[0];
    expect(fetchCall[1].method).toBe("DELETE");
  });

  it("throws if task_id is missing for delete", async () => {
    const tool = getTool();
    await expect(tool.execute({ action: "delete" })).rejects.toThrow(
      "task_id is required for delete",
    );
  });

  it("throws on unknown action", async () => {
    const tool = getTool();
    await expect(tool.execute({ action: "unknown" })).rejects.toThrow(
      "Unknown action: unknown",
    );
  });

  it("throws if action is missing", async () => {
    const tool = getTool();
    await expect(tool.execute({})).rejects.toThrow("action is required");
  });

  it("throws on API error", async () => {
    (globalThis.fetch as ReturnType<typeof vi.fn>).mockResolvedValue({
      ok: false,
      status: 403,
      statusText: "Forbidden",
      text: vi.fn().mockResolvedValue("Forbidden"),
    });

    const tool = getTool();
    await expect(tool.execute({ action: "list" })).rejects.toThrow(
      "Todoist API HTTP 403",
    );
  });

  it("sends Bearer token in Authorization header", async () => {
    (globalThis.fetch as ReturnType<typeof vi.fn>).mockResolvedValue(
      jsonResponse([]),
    );

    const tool = getTool();
    await tool.execute({ action: "list" });

    const fetchCall = (globalThis.fetch as ReturnType<typeof vi.fn>).mock.calls[0];
    expect(fetchCall[1].headers.Authorization).toBe("Bearer test-todoist-token");
  });
});

describe("todoist_projects", () => {
  const originalFetch = globalThis.fetch;

  beforeEach(() => {
    globalThis.fetch = vi.fn();
  });

  afterEach(() => {
    globalThis.fetch = originalFetch;
  });

  const jsonResponse = (body: unknown) => ({
    ok: true,
    status: 200,
    json: vi.fn().mockResolvedValue(body),
    text: vi.fn().mockResolvedValue(JSON.stringify(body)),
  });

  function getTool() {
    const tools = createTodoistTools({ apiKeyEnvVar: "TODOIST_API_TOKEN" });
    return tools.find((t) => t.name === "todoist_projects")!;
  }

  it("lists projects", async () => {
    (globalThis.fetch as ReturnType<typeof vi.fn>).mockResolvedValue(
      jsonResponse([
        {
          id: "100",
          name: "Work",
          color: "blue",
          is_favorite: false,
          url: "https://todoist.com/showProject?id=100",
        },
        {
          id: "200",
          name: "Personal",
          color: "green",
          is_favorite: true,
          url: "https://todoist.com/showProject?id=200",
        },
      ]),
    );

    const tool = getTool();
    const result = await tool.execute({ action: "list" });

    expect(result).toContain("Project: Work (ID: 100");
    expect(result).toContain("Project: Personal (ID: 200");
  });

  it("returns message for empty projects", async () => {
    (globalThis.fetch as ReturnType<typeof vi.fn>).mockResolvedValue(
      jsonResponse([]),
    );

    const tool = getTool();
    const result = await tool.execute({ action: "list" });
    expect(result).toBe("No projects found.");
  });

  it("creates a project", async () => {
    (globalThis.fetch as ReturnType<typeof vi.fn>).mockResolvedValue(
      jsonResponse({
        id: "300",
        name: "Shopping",
        color: "red",
        is_favorite: false,
        url: "https://todoist.com/showProject?id=300",
      }),
    );

    const tool = getTool();
    const result = await tool.execute({
      action: "create",
      name: "Shopping",
      color: "red",
    });

    expect(result).toContain("Created project:");
    expect(result).toContain("Shopping");

    const fetchCall = (globalThis.fetch as ReturnType<typeof vi.fn>).mock.calls[0];
    const body = JSON.parse(fetchCall[1].body as string);
    expect(body.name).toBe("Shopping");
    expect(body.color).toBe("red");
  });

  it("throws if name is missing for create", async () => {
    const tool = getTool();
    await expect(tool.execute({ action: "create" })).rejects.toThrow(
      "name is required for create",
    );
  });

  it("throws on unknown action", async () => {
    const tool = getTool();
    await expect(tool.execute({ action: "delete" })).rejects.toThrow(
      "Unknown action: delete",
    );
  });
});

describe("todoist_task_search", () => {
  const originalFetch = globalThis.fetch;

  beforeEach(() => {
    globalThis.fetch = vi.fn();
  });

  afterEach(() => {
    globalThis.fetch = originalFetch;
  });

  function getTool() {
    const tools = createTodoistTools({ apiKeyEnvVar: "TODOIST_API_TOKEN" });
    return tools.find((t) => t.name === "todoist_task_search")!;
  }

  it("gets a task by ID", async () => {
    (globalThis.fetch as ReturnType<typeof vi.fn>).mockResolvedValue({
      ok: true,
      status: 200,
      json: vi.fn().mockResolvedValue({
        id: "555",
        content: "Review PR",
        description: "Check the tests",
        is_completed: false,
        due: null,
        priority: 4,
        labels: ["code"],
        project_id: "100",
        url: "https://todoist.com/showTask?id=555",
      }),
      text: vi.fn().mockResolvedValue(""),
    });

    const tool = getTool();
    const result = await tool.execute({ task_id: "555" });

    expect(result).toContain("Task: Review PR (ID: 555)");
    expect(result).toContain("Description: Check the tests");
    expect(result).toContain("Priority: 4");
    expect(result).toContain("Labels: code");

    const callUrl = (globalThis.fetch as ReturnType<typeof vi.fn>).mock
      .calls[0][0] as string;
    expect(callUrl).toContain("/tasks/555");
  });

  it("throws if task_id is missing", async () => {
    const tool = getTool();
    await expect(tool.execute({})).rejects.toThrow("task_id is required");
  });

  it("throws on API error", async () => {
    (globalThis.fetch as ReturnType<typeof vi.fn>).mockResolvedValue({
      ok: false,
      status: 404,
      statusText: "Not Found",
      text: vi.fn().mockResolvedValue("Not Found"),
    });

    const tool = getTool();
    await expect(tool.execute({ task_id: "999" })).rejects.toThrow(
      "Todoist API HTTP 404",
    );
  });
});

describe("todoist_labels", () => {
  const originalFetch = globalThis.fetch;

  beforeEach(() => {
    globalThis.fetch = vi.fn();
  });

  afterEach(() => {
    globalThis.fetch = originalFetch;
  });

  function getTool() {
    const tools = createTodoistTools({ apiKeyEnvVar: "TODOIST_API_TOKEN" });
    return tools.find((t) => t.name === "todoist_labels")!;
  }

  it("lists labels", async () => {
    (globalThis.fetch as ReturnType<typeof vi.fn>).mockResolvedValue({
      ok: true,
      status: 200,
      json: vi.fn().mockResolvedValue([
        { id: "10", name: "urgent", color: "red" },
        { id: "20", name: "work", color: "blue" },
      ]),
      text: vi.fn().mockResolvedValue(""),
    });

    const tool = getTool();
    const result = await tool.execute({});

    expect(result).toContain("Label: urgent (ID: 10");
    expect(result).toContain("Label: work (ID: 20");
  });

  it("returns message for empty labels", async () => {
    (globalThis.fetch as ReturnType<typeof vi.fn>).mockResolvedValue({
      ok: true,
      status: 200,
      json: vi.fn().mockResolvedValue([]),
      text: vi.fn().mockResolvedValue(""),
    });

    const tool = getTool();
    const result = await tool.execute({});
    expect(result).toBe("No labels found.");
  });

  it("throws on API error", async () => {
    (globalThis.fetch as ReturnType<typeof vi.fn>).mockResolvedValue({
      ok: false,
      status: 401,
      statusText: "Unauthorized",
      text: vi.fn().mockResolvedValue("Unauthorized"),
    });

    const tool = getTool();
    await expect(tool.execute({})).rejects.toThrow("Todoist API HTTP 401");
  });
});
