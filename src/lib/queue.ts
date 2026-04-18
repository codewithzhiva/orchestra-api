import { Queue, QueueEvents } from "bullmq";
import IORedis from "ioredis";
import { config } from "../config.js";

export const connection = new IORedis(config.REDIS_URL, {
  maxRetriesPerRequest: null,
});

export const runQueue = new Queue("orchestra-runs", { connection });
export const runEvents = new QueueEvents("orchestra-runs", { connection });
