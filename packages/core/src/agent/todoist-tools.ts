import { requireSecret } from "../config/secrets.js";
import type { BuiltinTool } from "./builtin-tools.js";

const TODOIST_API_URL = "https://api.todoist.com/rest/v2";
const REQUEST_TIMEOUT_MS = 10_000;

/** Configuration for Todoist integration. */
export interface TodoistConfig {
  apiKeyEnvVar: string;
}

/** Shared helper to call the Todoist REST API v2. */
async function callTodoistApi(
  apiKeyEnvVar: string,
  method: string,
  path: string,
  body?: Record<string, unknown>,
): Promise<{ status: number; data: unknown }> {
  const token = requireSecret(apiKeyEnvVar);
  const url = `${TODOIST_API_URL}${path}`;

  const headers: Record<string, string> = {
    Authorization: `Bearer ${token}`,
  };
  if (body) {
    headers["Content-Type"] = "application/json";
  }

  const response = await fetch(url, {
    method,
    headers,
    body: body ? JSON.stringify(body) : undefined,
    signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
  });

  if (!response.ok) {
    const text = await response.text().catch(() => response.statusText);
    throw new Error(`Todoist API HTTP ${response.status}: ${text}`);
  }

  // 204 No Content (e.g. complete, reopen, delete)
  if (response.status === 204) {
    return { status: 204, data: null };
  }

  const data: unknown = await response.json();
  return { status: response.status, data };
}

// --- Response interfaces ---

interface TodoistTask {
  id: string;
  content: string;
  description: string;
  is_completed: boolean;
  due?: { string: string; date: string } | null;
  priority: number;
  labels: string[];
  project_id: string;
  url: string;
}

interface TodoistProject {
  id: string;
  name: string;
  color: string;
  is_favorite: boolean;
  url: string;
}

interface TodoistLabel {
  id: string;
  name: string;
  color: string;
}

// --- Formatters ---

function formatTask(task: TodoistTask): string {
  const lines: string[] = [];
  lines.push(`Task: ${task.content} (ID: ${task.id})`);
  if (task.description) {
    lines.push(`  Description: ${task.description}`);
  }
  if (task.due) {
    lines.push(`  Due: ${task.due.string || task.due.date}`);
  }
  if (task.priority > 1) {
    lines.push(`  Priority: ${task.priority}`);
  }
  if (task.labels.length > 0) {
    lines.push(`  Labels: ${task.labels.join(", ")}`);
  }
  lines.push(`  Project: ${task.project_id}`);
  return lines.join("\n");
}

function formatProject(project: TodoistProject): string {
  return `Project: ${project.name} (ID: ${project.id}, color: ${project.color})`;
}

function formatLabel(label: TodoistLabel): string {
  return `Label: ${label.name} (ID: ${label.id}, color: ${label.color})`;
}

/**
 * Create Todoist tools for task management via chat.
 * Returns 4 tools: todoist_tasks, todoist_projects, todoist_task_search, todoist_labels.
 */
export function createTodoistTools(config: TodoistConfig): BuiltinTool[] {
  const { apiKeyEnvVar } = config;

  return [
    // -----------------------------------------------------------------------
    // todoist_tasks — CRUD operations on tasks
    // -----------------------------------------------------------------------
    {
      name: "todoist_tasks",
      description:
        "Manage Todoist tasks. Actions: list (all active tasks), create (new task), " +
        "complete (mark done), reopen (mark undone), delete (remove task).",
      defaultPolicy: "confirm",
      parameters: {
        type: "object",
        properties: {
          action: {
            type: "string",
            enum: ["list", "create", "complete", "reopen", "delete"],
            description: "The action to perform",
          },
          content: {
            type: "string",
            description: "Task title (for create)",
          },
          description: {
            type: "string",
            description: "Task body (for create)",
          },
          due_string: {
            type: "string",
            description: 'Natural language due date like "tomorrow" (for create)',
          },
          priority: {
            type: "number",
            description: "Priority 1-4, where 4 is urgent (for create)",
          },
          labels: {
            type: "array",
            items: { type: "string" },
            description: "Label names (for create)",
          },
          project_id: {
            type: "string",
            description: "Project ID to filter by (list) or assign to (create)",
          },
          task_id: {
            type: "string",
            description: "Target task ID (for complete/reopen/delete)",
          },
        },
        required: ["action"],
      },
      async execute(args: Record<string, unknown>): Promise<string> {
        const action = args.action as string;
        if (!action) throw new Error("action is required");

        switch (action) {
          case "list": {
            const projectId = args.project_id as string | undefined;
            const path = projectId
              ? `/tasks?project_id=${encodeURIComponent(projectId)}`
              : "/tasks";
            const { data } = await callTodoistApi(apiKeyEnvVar, "GET", path);
            const tasks = data as TodoistTask[];
            if (tasks.length === 0) return "No active tasks found.";
            return tasks.map(formatTask).join("\n\n");
          }

          case "create": {
            const content = args.content as string;
            if (!content) throw new Error("content is required for create");
            const body: Record<string, unknown> = { content };
            if (args.description) body.description = args.description;
            if (args.due_string) body.due_string = args.due_string;
            if (args.priority) body.priority = args.priority;
            if (args.labels) body.labels = args.labels;
            if (args.project_id) body.project_id = args.project_id;
            const { data } = await callTodoistApi(apiKeyEnvVar, "POST", "/tasks", body);
            const task = data as TodoistTask;
            return `Created task:\n${formatTask(task)}`;
          }

          case "complete": {
            const taskId = args.task_id as string;
            if (!taskId) throw new Error("task_id is required for complete");
            await callTodoistApi(apiKeyEnvVar, "POST", `/tasks/${encodeURIComponent(taskId)}/close`);
            return `Task ${taskId} marked as complete.`;
          }

          case "reopen": {
            const taskId = args.task_id as string;
            if (!taskId) throw new Error("task_id is required for reopen");
            await callTodoistApi(apiKeyEnvVar, "POST", `/tasks/${encodeURIComponent(taskId)}/reopen`);
            return `Task ${taskId} reopened.`;
          }

          case "delete": {
            const taskId = args.task_id as string;
            if (!taskId) throw new Error("task_id is required for delete");
            await callTodoistApi(apiKeyEnvVar, "DELETE", `/tasks/${encodeURIComponent(taskId)}`);
            return `Task ${taskId} deleted.`;
          }

          default:
            throw new Error(`Unknown action: ${action}`);
        }
      },
    },

    // -----------------------------------------------------------------------
    // todoist_projects — list and create projects
    // -----------------------------------------------------------------------
    {
      name: "todoist_projects",
      description:
        "Manage Todoist projects. Actions: list (all projects), create (new project).",
      defaultPolicy: "confirm",
      parameters: {
        type: "object",
        properties: {
          action: {
            type: "string",
            enum: ["list", "create"],
            description: "The action to perform",
          },
          name: {
            type: "string",
            description: "Project name (for create)",
          },
          color: {
            type: "string",
            description: "Project color (for create)",
          },
        },
        required: ["action"],
      },
      async execute(args: Record<string, unknown>): Promise<string> {
        const action = args.action as string;
        if (!action) throw new Error("action is required");

        switch (action) {
          case "list": {
            const { data } = await callTodoistApi(apiKeyEnvVar, "GET", "/projects");
            const projects = data as TodoistProject[];
            if (projects.length === 0) return "No projects found.";
            return projects.map(formatProject).join("\n");
          }

          case "create": {
            const name = args.name as string;
            if (!name) throw new Error("name is required for create");
            const body: Record<string, unknown> = { name };
            if (args.color) body.color = args.color;
            const { data } = await callTodoistApi(apiKeyEnvVar, "POST", "/projects", body);
            const project = data as TodoistProject;
            return `Created project:\n${formatProject(project)}`;
          }

          default:
            throw new Error(`Unknown action: ${action}`);
        }
      },
    },

    // -----------------------------------------------------------------------
    // todoist_task_search — get a task by ID
    // -----------------------------------------------------------------------
    {
      name: "todoist_task_search",
      description: "Look up a Todoist task by its ID to get full details.",
      defaultPolicy: "allow",
      parameters: {
        type: "object",
        properties: {
          task_id: {
            type: "string",
            description: "The task ID to look up",
          },
        },
        required: ["task_id"],
      },
      async execute(args: Record<string, unknown>): Promise<string> {
        const taskId = args.task_id as string;
        if (!taskId) throw new Error("task_id is required");
        const { data } = await callTodoistApi(
          apiKeyEnvVar,
          "GET",
          `/tasks/${encodeURIComponent(taskId)}`,
        );
        const task = data as TodoistTask;
        return formatTask(task);
      },
    },

    // -----------------------------------------------------------------------
    // todoist_labels — list all labels
    // -----------------------------------------------------------------------
    {
      name: "todoist_labels",
      description: "List all available Todoist labels.",
      defaultPolicy: "allow",
      parameters: {
        type: "object",
        properties: {},
      },
      async execute(): Promise<string> {
        const { data } = await callTodoistApi(apiKeyEnvVar, "GET", "/labels");
        const labels = data as TodoistLabel[];
        if (labels.length === 0) return "No labels found.";
        return labels.map(formatLabel).join("\n");
      },
    },
  ];
}
