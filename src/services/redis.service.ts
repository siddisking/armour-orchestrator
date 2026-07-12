import { RedisRepository } from '../repositories/redis.repository';
import { generateQueryHash } from '../utils/helpers';

export class RedisService {
  private redisRepo: RedisRepository;

  constructor() {
    this.redisRepo = new RedisRepository();
  }

  /**
   * Retrieves the cached exact recommendation response if available.
   */
  async getExactRecommendationCache(normalizedQuery: string): Promise<string | null> {
    const queryHash = generateQueryHash(normalizedQuery);
    const cacheKey = `cache:exact:${queryHash}`;
    return await this.redisRepo.get(cacheKey);
  }

  /**
   * Caches the recommendation response in Redis with a 7-day TTL (604800 seconds).
   */
  async setExactRecommendationCache(normalizedQuery: string, responseText: string): Promise<void> {
    const queryHash = generateQueryHash(normalizedQuery);
    const cacheKey = `cache:exact:${queryHash}`;
    await this.redisRepo.set(cacheKey, responseText, 'EX', 604800);
  }

  /**
   * Increments the query search popularity leaderboard using a sorted set.
   */
  async incrementQueryLeaderboard(normalizedQuery: string): Promise<void> {
    await this.redisRepo.zincrby('query_leaderboard', 1, normalizedQuery);
  }
}
