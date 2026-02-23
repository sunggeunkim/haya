/**
 * KakaoTalk channel configuration.
 * Kakao i Open Builder connects outbound to our skill server —
 * no API key needed; authentication is handled by Kakao's platform.
 */
export interface KakaoConfig {
  /** HTTP server port (default: 9091) */
  port: number;
  /** Skill server endpoint path (default: "/kakao/skill") */
  path: string;
  /** Display name for this bot (default: "kakao-bot") */
  botName: string;
  /** Maximum request body size in bytes (default: 1048576 = 1 MB) */
  maxPayloadBytes: number;
}

const DEFAULT_KAKAO_CONFIG: KakaoConfig = {
  port: 9091,
  path: "/kakao/skill",
  botName: "kakao-bot",
  maxPayloadBytes: 1_048_576,
};

/**
 * Resolve KakaoTalk config from channel settings, falling back to defaults.
 */
export function resolveKakaoConfig(
  settings: Record<string, unknown>,
): KakaoConfig {
  return {
    port:
      typeof settings.port === "number"
        ? settings.port
        : DEFAULT_KAKAO_CONFIG.port,
    path:
      typeof settings.path === "string"
        ? settings.path
        : DEFAULT_KAKAO_CONFIG.path,
    botName:
      typeof settings.botName === "string"
        ? settings.botName
        : DEFAULT_KAKAO_CONFIG.botName,
    maxPayloadBytes:
      typeof settings.maxPayloadBytes === "number"
        ? settings.maxPayloadBytes
        : DEFAULT_KAKAO_CONFIG.maxPayloadBytes,
  };
}
