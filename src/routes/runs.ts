import type { FastifyInstance } from "fastify";
import { nanoid } from "nanoid";
import { z } from "zod";
import { db } from "../db/index.js";
import { requireScopes } from "../lib/auth.js";
import { runQueue } from "../lib/queue.js";
import { loadHistory, subscribe } from "../lib/events.js";

const CreateRun = z.object({
  graphId: z.string(),
  input: z.string(),
});

interface RunRow {
  id: string;
  graph_id: string;
  status: string;
  input: string;
  output: string | null;
  error: string | null;
  created_at: number;
  updated_at: number;
}

export async function runsRoutes(app: FastifyInstance) {
  app.post("/runs", { preHandler: requireScopes("runs:write") }, async (req, reply) => {
    const parsed = CreateRun.safeParse(req.body);
    if (!parsed.success) return reply.code(400).send({ error: parsed.error.flatten() });
    const graph = db.prepare(`SELECT id FROM graphs WHERE id = ?`).get(parsed.data.graphId);
    if (!graph) return reply.code(404).send({ error: "graph not found" });

    const id = "r_" + nanoid(12);
    const now = Date.now();
    db.prepare(
      `INSERT INTO runs (id, graph_id, status, input, created_at, updated_at) VALUES (?, ?, 'queued', ?, ?, ?)`,
    ).run(id, parsed.data.graphId, parsed.data.input, now, now);

    await runQueue.add("run", { runId: id });
    return reply.code(202).send({ id, status: "queued" });
  });

  app.get("/runs/:id", { preHandler: requireScopes("runs:read") }, async (req, reply) => {
    const { id } = req.params as { id: string };
    const row = db.prepare(`SELECT * FROM runs WHERE id = ?`).get(id) as RunRow | undefined;
    if (!row) return reply.code(404).send({ error: "not found" });
    return {
      id: row.id,
      graphId: row.graph_id,
      status: row.status,
      input: row.input,
      output: row.output ? JSON.parse(row.output) : null,
      error: row.error,
      createdAt: row.created_at,
      updatedAt: row.updated_at,
    };
  });

  app.get("/runs/:id/events", { preHandler: requireScopes("runs:read") }, async (req, reply) => {
    const { id } = req.params as { id: string };
    const row = db.prepare(`SELECT id, status FROM runs WHERE id = ?`).get(id) as
      | { id: string; status: string }
      | undefined;
    if (!row) return reply.code(404).send({ error: "not found" });

    reply.raw.writeHead(200, {
      "Content-Type": "text/event-stream",
      "Cache-Control": "no-cache",
      Connection: "keep-alive",
      "X-Accel-Buffering": "no",
    });

    const write = (data: unknown) => {
      reply.raw.write(`data: ${JSON.stringify(data)}\n\n`);
    };

    let lastSeq = 0;
    for (const h of loadHistory(id, 0)) {
      write(JSON.parse(h.payload));
      lastSeq = h.seq;
    }

    const unsub = subscribe(id, (ev) => {
      if (ev.seq <= lastSeq) return;
      lastSeq = ev.seq;
      write(ev);
      if (ev.type === "run.finished" || ev.type === "run.failed") {
        reply.raw.end();
      }
    });

    const current = db.prepare(`SELECT status FROM runs WHERE id = ?`).get(id) as
      | { status: string }
      | undefined;
    if (current && (current.status === "finished" || current.status === "failed")) {
      reply.raw.end();
    }

    req.raw.on("close", () => unsub());
  });
}
