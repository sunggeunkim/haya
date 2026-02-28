import type { BuiltinTool } from "./builtin-tools.js";
import type { SenderProfileStore } from "../sessions/profile-store.js";

/**
 * Create agent tools for managing per-sender user profiles.
 *
 * Returns the tool array plus a `setSenderId` callback that the caller
 * must invoke before each `agentRuntime.chat()` call so that the tools
 * operate on the correct sender.
 */
export function createProfileTools(store: SenderProfileStore): {
  tools: BuiltinTool[];
  setSenderId: (id: string) => void;
} {
  let currentSenderId = "";

  const setSenderId = (id: string): void => {
    currentSenderId = id;
  };

  const ensureSender = (): string => {
    if (!currentSenderId) {
      throw new Error("No sender context — cannot access user profile");
    }
    return currentSenderId;
  };

  const tools: BuiltinTool[] = [
    // -----------------------------------------------------------------
    // user_profile_set
    // -----------------------------------------------------------------
    {
      name: "user_profile_set",
      description:
        "Save a fact about the current user to their profile (e.g. name, location, preferences). " +
        "Use this when the user shares personal information or asks you to remember something about them.",
      defaultPolicy: "allow",
      parameters: {
        type: "object",
        properties: {
          key: {
            type: "string",
            description:
              "A short label for the fact (e.g. 'name', 'location', 'favorite_food')",
          },
          value: {
            type: "string",
            description: "The value to store",
          },
        },
        required: ["key", "value"],
      },
      async execute(args: Record<string, unknown>): Promise<string> {
        const senderId = ensureSender();
        const key = args.key as string;
        const value = args.value as string;
        if (!key) throw new Error("key is required");
        if (!value) throw new Error("value is required");
        await store.set(senderId, key, value);
        return `Saved ${key} for user.`;
      },
    },

    // -----------------------------------------------------------------
    // user_profile_get
    // -----------------------------------------------------------------
    {
      name: "user_profile_get",
      description:
        "Retrieve a specific fact from the current user's profile.",
      defaultPolicy: "allow",
      parameters: {
        type: "object",
        properties: {
          key: {
            type: "string",
            description: "The profile key to look up (e.g. 'name', 'location')",
          },
        },
        required: ["key"],
      },
      async execute(args: Record<string, unknown>): Promise<string> {
        const senderId = ensureSender();
        const key = args.key as string;
        if (!key) throw new Error("key is required");
        const value = await store.get(senderId, key);
        if (value === undefined) {
          return `No value found for "${key}" in user profile.`;
        }
        return value;
      },
    },

    // -----------------------------------------------------------------
    // user_profile_list
    // -----------------------------------------------------------------
    {
      name: "user_profile_list",
      description:
        "List all stored facts in the current user's profile.",
      defaultPolicy: "allow",
      parameters: {
        type: "object",
        properties: {},
      },
      async execute(): Promise<string> {
        const senderId = ensureSender();
        const profile = await store.list(senderId);
        const entries = Object.entries(profile);
        if (entries.length === 0) {
          return "No profile data stored for this user.";
        }
        return entries.map(([k, v]) => `${k}: ${v}`).join("\n");
      },
    },

    // -----------------------------------------------------------------
    // user_profile_delete
    // -----------------------------------------------------------------
    {
      name: "user_profile_delete",
      description:
        "Remove a specific fact from the current user's profile.",
      defaultPolicy: "confirm",
      parameters: {
        type: "object",
        properties: {
          key: {
            type: "string",
            description: "The profile key to remove",
          },
        },
        required: ["key"],
      },
      async execute(args: Record<string, unknown>): Promise<string> {
        const senderId = ensureSender();
        const key = args.key as string;
        if (!key) throw new Error("key is required");
        const deleted = await store.delete(senderId, key);
        if (!deleted) {
          return `No value found for "${key}" — nothing to delete.`;
        }
        return `Removed "${key}" from user profile.`;
      },
    },
  ];

  return { tools, setSenderId };
}
