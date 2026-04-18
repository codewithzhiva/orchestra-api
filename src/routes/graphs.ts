import type { FastifyInstance } from "fastify";
import { nanoid } from "nanoid";
import { db } from "../db/index.js";
import { requireScopes } from "../lib/auth.js";
import { GraphSpec } from "../agents/graph.js";

interface GraphRow {
  id: string;
  name: string;
  spec: string;
  created_at: number;
  updated_at: number;
}

export async function graphsRoutes(app: FastifyInstance) {
  app.post("/graphs", { preHandler: requireScopes("graphs:write") }, async (req, reply) => {
    const parsed = GraphSpec.safeParse(req.body);
    if (!parsed.success) return reply.code(400).send({ error: parsed.error.flatten() });
    const id = "g_" + nanoid(12);
    const now = Date.now();
    db.prepare(
      `INSERT INTO graphs (id, name, spec, created_at, updated_at) VALUES (?, ?, ?, ?, ?)`,
    ).run(id, parsed.data.name, JSON.stringify(parsed.data), now, now);
    return reply.code(201).send({ id, ...parsed.data });
  });

  app.get("/graphs", { preHandler: requireScopes("graphs:read") }, async () => {
    const rows = db.prepare(`SELECT * FROM graphs ORDER BY created_at DESC`).all() as GraphRow[];
    return rows.map((r) => ({ id: r.id, name: r.name, spec: JSON.parse(r.spec) }));
  });

  app.get("/graphs/:id", { preHandler: requireScopes("graphs:read") }, async (req, reply) => {
    const { id } = req.params as { id: string };
    const row = db.prepare(`SELECT * FROM graphs WHERE id = ?`).get(id) as GraphRow | undefined;
    if (!row) return reply.code(404).send({ error: "not found" });
    return { id: row.id, name: row.name, spec: JSON.parse(row.spec) };
  });

  app.delete("/graphs/:id", { preHandler: requireScopes("graphs:write") }, async (req, reply) => {
    const { id } = req.params as { id: string };
    const r = db.prepare(`DELETE FROM graphs WHERE id = ?`).run(id);
    if (r.changes === 0) return reply.code(404).send({ error: "not found" });
    return { ok: true };
  });
}
