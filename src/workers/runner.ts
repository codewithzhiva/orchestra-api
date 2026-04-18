import { Worker } from "bullmq";
import { connection } from "../lib/queue.js";
import { db } from "../db/index.js";
import { buildGraph, GraphSpec } from "../agents/graph.js";
import { emitRunEvent } from "../lib/events.js";

interface RunRow {
  id: string;
  graph_id: string;
  input: string;
}

interface GraphRow {
  id: string;
  spec: string;
}

const worker = new Worker(
  "orchestra-runs",
  async (job) => {
    const { runId } = job.data as { runId: string };
    const run = db.prepare(`SELECT id, graph_id, input FROM runs WHERE id = ?`).get(runId) as
      | RunRow
      | undefined;
    if (!run) throw new Error(`run ${runId} not found`);

    const graphRow = db
      .prepare(`SELECT id, spec FROM graphs WHERE id = ?`)
      .get(run.graph_id) as GraphRow | undefined;
    if (!graphRow) throw new Error(`graph ${run.graph_id} not found`);

    db.prepare(`UPDATE runs SET status = 'running', updated_at = ? WHERE id = ?`).run(
      Date.now(),
      runId,
    );
    emitRunEvent({ type: "run.started", runId });

    try {
      const spec = GraphSpec.parse(JSON.parse(graphRow.spec));
      const graph = buildGraph(spec, runId);
      const result = await graph.invoke({ input: run.input });
      db.prepare(
        `UPDATE runs SET status = 'finished', output = ?, updated_at = ? WHERE id = ?`,
      ).run(JSON.stringify(result), Date.now(), runId);
      emitRunEvent({ type: "run.finished", runId, output: result });
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      db.prepare(
        `UPDATE runs SET status = 'failed', error = ?, updated_at = ? WHERE id = ?`,
      ).run(msg, Date.now(), runId);
      emitRunEvent({ type: "run.failed", runId, error: msg });
      throw err;
    }
  },
  { connection, concurrency: 4 },
);

worker.on("ready", () => console.log("[worker] ready"));
worker.on("failed", (job, err) => console.error("[worker] failed", job?.id, err.message));

process.on("SIGTERM", async () => {
  await worker.close();
  process.exit(0);
});
