import argon2 from "argon2";
import { nanoid } from "nanoid";
import type { FastifyReply, FastifyRequest } from "fastify";
import { db } from "../db/index.js";
import { config } from "../config.js";

export type Scope = "graphs:read" | "graphs:write" | "runs:read" | "runs:write";

export interface ApiKeyRow {
  id: string;
  hash: string;
  name: string;
  scopes: string;
  created_at: number;
  last_used_at: number | null;
}

export async function createApiKey(name: string, scopes: Scope[]) {
  const id = "ok_" + nanoid(12);
  const secret = nanoid(40);
  const token = `${id}.${secret}`;
  const hash = await argon2.hash(secret);
  db.prepare(
    `INSERT INTO api_keys (id, hash, name, scopes, created_at) VALUES (?, ?, ?, ?, ?)`,
  ).run(id, hash, name, scopes.join(","), Date.now());
  return { id, token, name, scopes };
}

export async function verifyToken(token: string): Promise<ApiKeyRow | null> {
  const [id, secret] = token.split(".");
  if (!id || !secret) return null;
  const row = db
    .prepare(`SELECT * FROM api_keys WHERE id = ?`)
    .get(id) as ApiKeyRow | undefined;
  if (!row) return null;
  const ok = await argon2.verify(row.hash, secret);
  if (!ok) return null;
  db.prepare(`UPDATE api_keys SET last_used_at = ? WHERE id = ?`).run(
    Date.now(),
    id,
  );
  return row;
}

function extractBearer(req: FastifyRequest): string | null {
  const h = req.headers["authorization"];
  if (!h || typeof h !== "string") return null;
  const m = h.match(/^Bearer\s+(.+)$/i);
  return m ? m[1].trim() : null;
}

export function requireScopes(...needed: Scope[]) {
  return async (req: FastifyRequest, reply: FastifyReply) => {
    const token = extractBearer(req);
    if (!token) return reply.code(401).send({ error: "missing bearer token" });
    const row = await verifyToken(token);
    if (!row) return reply.code(401).send({ error: "invalid token" });
    const have = new Set(row.scopes.split(","));
    for (const s of needed) {
      if (!have.has(s)) return reply.code(403).send({ error: `missing scope ${s}` });
    }
    (req as FastifyRequest & { apiKey: ApiKeyRow }).apiKey = row;
  };
}

export function requireAdminToken(req: FastifyRequest, reply: FastifyReply) {
  const token = extractBearer(req);
  if (!token || token !== config.ADMIN_TOKEN) {
    return reply.code(401).send({ error: "admin token required" });
  }
}
