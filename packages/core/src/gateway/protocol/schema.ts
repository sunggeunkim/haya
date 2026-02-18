import { z } from "zod";

/**
 * Zod-validated protocol frame schemas for the gateway JSON-RPC protocol.
 */

export const GatewayRequestSchema = z.object({
  id: z.string().min(1).max(128),
  method: z.string().min(1).max(256),
  params: z.record(z.unknown()).optional(),
});

export const GatewayResponseSchema = z.object({
  id: z.string().min(1).max(128),
  result: z.unknown().optional(),
  error: z
    .object({
      code: z.number().int(),
      message: z.string(),
    })
    .optional(),
});

export const GatewayEventSchema = z.object({
  event: z.string().min(1).max(256),
  data: z.unknown(),
});

/** Union schema that accepts any valid gateway frame. */
export const GatewayFrameSchema = z.union([
  GatewayRequestSchema,
  GatewayResponseSchema,
  GatewayEventSchema,
]);
