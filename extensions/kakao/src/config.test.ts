import { describe, it, expect } from "vitest";
import { resolveKakaoConfig } from "./config.js";

describe("resolveKakaoConfig", () => {
  it("returns defaults when settings is empty", () => {
    const config = resolveKakaoConfig({});

    expect(config.port).toBe(9091);
    expect(config.path).toBe("/kakao/skill");
    expect(config.botName).toBe("kakao-bot");
    expect(config.maxPayloadBytes).toBe(1_048_576);
  });

  it("uses custom values from settings", () => {
    const config = resolveKakaoConfig({
      port: 8080,
      path: "/custom/skill",
      botName: "my-kakao",
      maxPayloadBytes: 512_000,
    });

    expect(config.port).toBe(8080);
    expect(config.path).toBe("/custom/skill");
    expect(config.botName).toBe("my-kakao");
    expect(config.maxPayloadBytes).toBe(512_000);
  });

  it("ignores invalid setting types", () => {
    const config = resolveKakaoConfig({
      port: "not-a-number",
      path: 42,
      botName: true,
      maxPayloadBytes: "big",
    });

    expect(config.port).toBe(9091);
    expect(config.path).toBe("/kakao/skill");
    expect(config.botName).toBe("kakao-bot");
    expect(config.maxPayloadBytes).toBe(1_048_576);
  });
});
