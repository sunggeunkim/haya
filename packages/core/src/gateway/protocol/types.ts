/**
 * Gateway JSON-RPC protocol types.
 * All messages between clients and the gateway use this format.
 */

export type GatewayRequest = {
  id: string;
  method: string;
  params?: Record<string, unknown>;
};

export type GatewayResponse = {
  id: string;
  result?: unknown;
  error?: GatewayError;
};

export type GatewayError = {
  code: number;
  message: string;
};

export type GatewayEvent = {
  event: string;
  data: unknown;
};

/** Standard JSON-RPC-style error codes. */
export const ErrorCodes = {
  PARSE_ERROR: -32700,
  INVALID_REQUEST: -32600,
  METHOD_NOT_FOUND: -32601,
  INVALID_PARAMS: -32602,
  INTERNAL_ERROR: -32603,
  AUTH_REQUIRED: -32000,
  RATE_LIMITED: -32001,
} as const;
