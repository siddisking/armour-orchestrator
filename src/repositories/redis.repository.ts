import { redis } from '../lib/redis';

export class RedisRepository {
  /**
   * Retrieves a string value by key.
   */
  async get(key: string): Promise<string | null> {
    return await redis.get(key);
  }

  /**
   * Sets a string value with optional expiration mode and TTL.
   */
  async set(
    key: string,
    value: string,
    mode?: 'EX',
    ttlSeconds?: number
  ): Promise<string> {
    if (mode === 'EX' && ttlSeconds !== undefined) {
      return await redis.set(key, value, 'EX', ttlSeconds);
    }
    return await redis.set(key, value);
  }

  /**
   * Increments the score of a member in a Sorted Set.
   */
  async zincrby(key: string, increment: number, member: string): Promise<string> {
    return await redis.zincrby(key, increment, member);
  }

  /**
   * Deletes a key from Redis.
   */
  async del(key: string): Promise<number> {
    return await redis.del(key);
  }

  /**
   * Retrieves elements from a sorted set within a score range.
   */
  async zrangebyscore(
    key: string,
    min: string | number,
    max: string | number,
    withScores?: 'WITHSCORES'
  ): Promise<string[]> {
    if (withScores === 'WITHSCORES') {
      return await redis.zrangebyscore(key, min, max, 'WITHSCORES');
    }
    return await redis.zrangebyscore(key, min, max);
  }

  /**
   * Retrieves the values of all specified keys in a single operation.
   */
  async mget(keys: string[]): Promise<(string | null)[]> {
    if (keys.length === 0) return [];
    return await redis.mget(keys);
  }
}
