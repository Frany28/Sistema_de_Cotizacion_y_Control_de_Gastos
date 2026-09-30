// src/config/redisClient.js
import { createClient } from "redis";
import dotenv from "dotenv";
import path from "path";
import { fileURLToPath } from "url";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

dotenv.config({ path: path.join(__dirname, ".env") });
dotenv.config();

function normalizeRedisUrl(value) {
  const redisUrl = value?.trim();

  if (!redisUrl) {
    throw new Error("REDIS_URL no esta configurada");
  }

  if (redisUrl.startsWith("redis-cli ")) {
    const urlMatch = redisUrl.match(/(?:^|\s)-u\s+(\S+)/);

    if (!urlMatch) {
      throw new Error("REDIS_URL contiene un comando redis-cli sin una URL valida");
    }

    const cliUrl = urlMatch[1];
    return redisUrl.includes("--tls") && cliUrl.startsWith("redis://")
      ? cliUrl.replace(/^redis:\/\//, "rediss://")
      : cliUrl;
  }

  return redisUrl;
}

const redisUrl = normalizeRedisUrl(process.env.REDIS_URL);

const redisClient = createClient({
  url: redisUrl,
});

redisClient.connect().catch((error) => {
  console.error("Redis connection error:", error);
});

redisClient.on("ready", () => console.log("Redis client ready"));
redisClient.on("error", (error) => console.error("Redis error:", error));

export default redisClient;
