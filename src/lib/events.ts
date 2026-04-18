import { EventEmitter } from "node:events";
import { db } from "../db/index.js";

export type RunEvent =
  | { type: "run.started"; runId: string }
  | { type: "node.started"; runId: string; node: string }
  | { type: "node.finished"; runId: string; node: string; output: unknown }
  | { type: "token"; runId: string; node: string; text: string }
  | { type: "run.finished"; runId: string; output: unknown }
  | { type: "run.failed"; runId: string; error: string };

const bus = new EventEmitter();
bus.setMaxListeners(0);

const seqCounters = new Map<string, number>();

export function emitRunEvent(ev: RunEvent) {
  const seq = (seqCounters.get(ev.runId) ?? 0) + 1;
  seqCounters.set(ev.runId, seq);
  db.prepare(
    `INSERT INTO run_events (run_id, seq, type, payload, created_at) VALUES (?, ?, ?, ?, ?)`,
  ).run(ev.runId, seq, ev.type, JSON.stringify(ev), Date.now());
  bus.emit(ev.runId, { seq, ...ev });
  bus.emit("*", { seq, ...ev });
}

export function subscribe(runId: string, cb: (ev: RunEvent & { seq: number }) => void) {
  bus.on(runId, cb);
  return () => bus.off(runId, cb);
}

export function loadHistory(runId: string, afterSeq = 0) {
  return db
    .prepare(
      `SELECT seq, type, payload FROM run_events WHERE run_id = ? AND seq > ? ORDER BY seq ASC`,
    )
    .all(runId, afterSeq) as Array<{ seq: number; type: string; payload: string }>;
}
