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
}
