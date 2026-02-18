import type { HookHandler } from "./types.js";
import { createLogger } from "../infra/logger.js";

const log = createLogger("hooks");

/**
 * Hook dispatch system. Plugins register handlers for named events.
 * When an event is dispatched, all registered handlers are called in order.
 */
export class HookRegistry {
  private readonly handlers = new Map<string, HookHandler[]>();

  /**
   * Register a handler for the given event name.
   */
  register(event: string, handler: HookHandler): void {
    const list = this.handlers.get(event);
    if (list) {
      list.push(handler);
    } else {
      this.handlers.set(event, [handler]);
    }
  }

  /**
   * Unregister all handlers for the given event.
   */
  unregisterAll(event: string): void {
    this.handlers.delete(event);
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

    for (const handler of list) {
      try {
        await handler(payload);
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
