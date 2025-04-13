const { createClient } = require("redis");
const CustomError = require("../errors");

let client;
let isConnected = false;

const connectRedis = async () => {
  if (isConnected) return;

  try {
    client = createClient({
      url: process.env.REDIS_URL || "redis://localhost:6379",
      socket: {
        reconnectStrategy: (retries) => Math.min(retries * 100, 5000),
      },
    });

    client.on("error", (err) => {
      console.error("Redis Client Error", err);
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
    throw new CustomError.ServiceUnavailableError("Cache service unavailable");
  }
};

const getFromCache = async (key) => {
  if (!isConnected) return null;

  try {
    const data = await client.get(key);
    return data ? JSON.parse(data) : null;
  } catch (error) {
    console.error("Cache read error:", error);
    return null; // Fail gracefully instead of throwing
  }
};

const setInCache = async (key, value, ttl = 3600) => {
  if (!isConnected) return;

  try {
    await client.set(key, JSON.stringify(value), {
      EX: ttl,
    });
  } catch (error) {
    console.error("Cache write error:", error);
  }
};

const clearCache = async (key) => {
  if (!isConnected) return;

  try {
    if (key.endsWith("*")) {
      const keys = await client.keys(key);
      if (keys.length) await client.del(keys);
    } else {
      await client.del(key);
    }
  } catch (error) {
    console.error("Cache clear error:", error);
  }
};

const flushAll = async () => {
  if (!isConnected) return;

  try {
    await client.flushAll();
  } catch (error) {
    console.error("Cache flush error:", error);
  }
};

module.exports = {
  connectRedis,
  getFromCache,
  setInCache,
  clearCache,
  flushAll,
  client,
  isConnected,
};
