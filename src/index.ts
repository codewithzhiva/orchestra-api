import Fastify from "fastify";
import sensible from "@fastify/sensible";
import { config } from "./config.js";
import "./db/index.js";
import { keysRoutes } from "./routes/keys.js";
import { graphsRoutes } from "./routes/graphs.js";
import { runsRoutes } from "./routes/runs.js";

const app = Fastify({
  logger: {
    level: config.LOG_LEVEL,
    transport: { target: "pino-pretty", options: { colorize: true } },
  },
});

await app.register(sensible);

app.get("/health", async () => ({ ok: true, service: "orchestra-api" }));

await app.register(keysRoutes);
await app.register(graphsRoutes);
await app.register(runsRoutes);

try {
  await app.listen({ port: config.PORT, host: config.HOST });
} catch (err) {
  app.log.error(err);
  process.exit(1);
}
