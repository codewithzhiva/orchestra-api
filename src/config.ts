import "dotenv/config";
import { z } from "zod";

const schema = z.object({
  PORT: z.coerce.number().default(3030),
  HOST: z.string().default("0.0.0.0"),
  LOG_LEVEL: z.string().default("info"),
  ADMIN_TOKEN: z.string().min(16, "ADMIN_TOKEN must be >=16 chars"),
  DB_PATH: z.string().default("./data/orchestra.db"),
  REDIS_URL: z.string().default("redis://localhost:6379"),
  OLLAMA_BASE_URL: z.string().default("http://localhost:11434"),
  OLLAMA_DEFAULT_MODEL: z.string().default("llama3.1"),
});

export const config = schema.parse(process.env);
export type Config = z.infer<typeof schema>;
