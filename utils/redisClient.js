const { createClient } = require("redis");
const CustomError = require("../errors");

let client;
let isConnected = false;

const connectRedis = async () => {
  if (isConnected && client?.isReady) return;

  try {
    client = createClient({
      url: process.env.REDIS_URL || "redis://localhost:6379",
      socket: {
        reconnectStrategy: (retries) => Math.min(retries * 100, 5000),
      },
    });

    client.on("error", (err) => {
      console.error("Redis Client Error", err);
      isConnected = false;
    });

    client.on("connect", () => {
      console.log("Redis connection established");
      isConnected = true;
    });

    client.on("reconnecting", () => {
      console.log("Redis reconnecting...");
      isConnected = false;
    });

    await client.connect();
  } catch (error) {
    console.error("Redis connection failed:", error);
    // Don't throw - just log, cache is optional
    isConnected = false;
  }
};

const getFromCache = async (key) => {
  if (!isConnected || !client?.isReady) {
    console.log("[CACHE] Skipping get - Redis not ready");
    return null;
  }

  try {
    const data = await client.get(key);
    return data ? JSON.parse(data) : null;
  } catch (error) {
    console.error("Cache read error:", error);
    return null;
  }
};

const setInCache = async (key, value, ttl = 3600) => {
  if (!isConnected || !client?.isReady) {
    console.log("[CACHE] Skipping set - Redis not ready");
    return false;
  }

  try {
    await client.set(key, JSON.stringify(value), {
      EX: ttl,
    });
    return true;
  } catch (error) {
    console.error("Cache write error:", error);
    return false;
  }
};

// ✅ FIXED: Returns number of deleted keys
const clearCache = async (pattern) => {
  if (!isConnected || !client?.isReady) {
    console.log("[CACHE] Skipping clear - Redis not ready");
    return 0;
  }

  try {
    let deletedCount = 0;

    console.log(`[CACHE] Clearing pattern: "${pattern}"`);

    if (pattern.includes("*")) {
      // Use SCAN for better performance with wildcards
      const keys = [];
      let cursor = 0;

      do {
        const result = await client.scan(cursor, {
          MATCH: pattern,
          COUNT: 100,
        });
        cursor = result.cursor;
        keys.push(...result.keys);
      } while (cursor !== 0);

      console.log(`[CACHE] Found ${keys.length} keys matching "${pattern}"`);

      if (keys.length > 0) {
        // Delete in batches to avoid blocking
        const batchSize = 100;
        for (let i = 0; i < keys.length; i += batchSize) {
          const batch = keys.slice(i, i + batchSize);
          const deleted = await client.del(batch);
          deletedCount += deleted;
        }
        console.log(`[CACHE] Deleted ${deletedCount} keys`);
      }
    } else {
      // Exact key match
      const deleted = await client.del(pattern);
      deletedCount = deleted > 0 ? 1 : 0;
      console.log(`[CACHE] Deleted exact key: "${pattern}"`);
    }

    return deletedCount;
  } catch (error) {
    console.error("[CACHE] Clear error:", error);
    return -1;
  }
};

const flushAll = async () => {
  if (!isConnected || !client?.isReady) {
    console.log("[CACHE] Skipping flush - Redis not ready");
    return false;
  }

  try {
    await client.flushAll();
    console.log("[CACHE] Flushed all cache");
    return true;
  } catch (error) {
    console.error("Cache flush error:", error);
    return false;
  }
};

// Export for direct access if needed
const getRedisClient = () => client;
const getRedisStatus = () => ({
  isConnected,
  isReady: client?.isReady || false,
});

module.exports = {
  connectRedis,
  getFromCache,
  setInCache,
  clearCache,
  flushAll,
  getRedisClient,
  getRedisStatus,
  client,
  isConnected,
};
