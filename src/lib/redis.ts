import Redis from 'ioredis';

const globalForRedis = global as unknown as { redis: Redis | undefined };

export const redis = new Proxy({} as Redis, {
  get(target, prop, receiver) {
    if (!globalForRedis.redis) {
      const redisUrl = process.env.REDIS_URL || 'redis://127.0.0.1:6379';
      
      // Fallback to default if the environment URL is invalid or empty during build
      let parsedUrl = redisUrl.trim();
      if (!parsedUrl.startsWith('redis://') && !parsedUrl.startsWith('rediss://')) {
        parsedUrl = 'redis://127.0.0.1:6379';
      }

      globalForRedis.redis = new Redis(parsedUrl, {
        maxRetriesPerRequest: null,
      });
    }
    
    const value = Reflect.get(globalForRedis.redis, prop);
    if (typeof value === 'function') {
      return value.bind(globalForRedis.redis);
    }
    return value;
  }
});

