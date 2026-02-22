// Type stubs for optional peer dependencies that are dynamically imported.
// These prevent TypeScript errors when the packages are not installed.

declare module "playwright" {
  export const chromium: {
    launch: () => Promise<{
      newPage: () => Promise<Record<string, unknown>>;
      close: () => Promise<void>;
    }>;
  };
}

declare module "sharp" {
  interface SharpInstance {
    resize(
      width: number,
      height: number,
      options?: { fit?: string; withoutEnlargement?: boolean },
    ): SharpInstance;
    toBuffer(): Promise<Buffer>;
  }
  function sharp(input: Buffer): SharpInstance;
  export default sharp;
}

declare module "@haya/discord" {
  import type { ChannelPlugin } from "./channels/types.js";
  export function createDiscordChannel(): ChannelPlugin;
}

declare module "@haya/telegram" {
  import type { ChannelPlugin } from "./channels/types.js";
  export function createTelegramChannel(): ChannelPlugin;
}
