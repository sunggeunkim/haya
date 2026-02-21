import type { HookHandler } from "./types.js";
import { createLogger } from "../infra/logger.js";

const log = createLogger("hooks");

interface RegisteredHandler {
  handler: HookHandler;
  pluginId?: string;
}

/**
 * Hook dispatch system. Plugins register handlers for named events.
 * When an event is dispatched, all registered handlers are called in order.
 */
export class HookRegistry {
  private readonly handlers = new Map<string, RegisteredHandler[]>();

  /**
   * Register a handler for the given event name.
   * Optionally associate it with a pluginId for scoped cleanup.
   */
  register(event: string, handler: HookHandler, pluginId?: string): void {
    const entry: RegisteredHandler = { handler, pluginId };
    const list = this.handlers.get(event);
    if (list) {
      list.push(entry);
    } else {
      this.handlers.set(event, [entry]);
    }
  }

  /**
   * Unregister all handlers for the given event.
   */
  unregisterAll(event: string): void {
    this.handlers.delete(event);
  }

  /**
   * Unregister all handlers registered by a specific plugin.
   */
  unregisterByPlugin(pluginId: string): void {
    for (const [event, list] of this.handlers.entries()) {
      const filtered = list.filter((entry) => entry.pluginId !== pluginId);
      if (filtered.length === 0) {
        this.handlers.delete(event);
      } else {
        this.handlers.set(event, filtered);
      }
    }
  }

  /**
   * Dispatch an event to all registered handlers.
   * Handlers are called sequentially. If a handler throws,
   * the error is logged and remaining handlers still execute.
   */
  async dispatch(
    event: string,
    payload: Record<string, unknown>,
  ): Promise<void> {
    const list = this.handlers.get(event);
    if (!list || list.length === 0) return;

    for (const entry of list) {
      try {
        await entry.handler(payload);
      } catch (err) {
        log.warn(
          `Hook handler for "${event}" threw: ${err instanceof Error ? err.message : String(err)}`,
        );
      }
    }
  }

  /**
   * Get the number of handlers registered for an event.
   */
  handlerCount(event: string): number {
    return this.handlers.get(event)?.length ?? 0;
  }

  /**
   * Get all registered event names.
   */
  events(): string[] {
    return Array.from(this.handlers.keys());
  }

  /**
   * Remove all handlers for all events.
   */
  clear(): void {
    this.handlers.clear();
  }
}
