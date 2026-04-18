import type { FastifyInstance } from "fastify";
import { z } from "zod";
import { createApiKey, requireAdminToken, type Scope } from "../lib/auth.js";

const Body = z.object({
  name: z.string().min(1),
  scopes: z
    .array(z.enum(["graphs:read", "graphs:write", "runs:read", "runs:write"]))
    .min(1),
});

export async function keysRoutes(app: FastifyInstance) {
  app.post("/keys", { preHandler: requireAdminToken }, async (req, reply) => {
    const parsed = Body.safeParse(req.body);
    if (!parsed.success) return reply.code(400).send({ error: parsed.error.flatten() });
    const key = await createApiKey(parsed.data.name, parsed.data.scopes as Scope[]);
    return reply.code(201).send(key);
  });
}
