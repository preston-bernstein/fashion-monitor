import type { FastifyReply } from "fastify";
import type { z } from "zod";

/**
 * Parse a request body with a Zod schema. On failure, send the standard
 * `400 { error: "invalid_input", issues }` response and return `undefined`;
 * callers should `return reply` when this returns `undefined`.
 */
export function parseBody<S extends z.ZodTypeAny>(
  schema: S,
  body: unknown,
  reply: FastifyReply,
): z.infer<S> | undefined {
  const parsed = schema.safeParse(body ?? {});
  if (!parsed.success) {
    reply.code(400).send({ error: "invalid_input", issues: parsed.error.issues });
    return undefined;
  }
  return parsed.data;
}
