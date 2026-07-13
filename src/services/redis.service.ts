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

  /**
   * Retrieves leaderboard queries with a score greater than or equal to minScore.
   */
  async getLeaderboardEntries(minScore: number): Promise<{ query: string; score: number }[]> {
    const raw = await this.redisRepo.zrangebyscore('query_leaderboard', minScore, '+inf', 'WITHSCORES');
    const result: { query: string; score: number }[] = [];
    for (let i = 0; i < raw.length; i += 2) {
      if (raw[i] && raw[i + 1]) {
        result.push({
          query: raw[i],
          score: parseInt(raw[i + 1], 10),
        });
      }
    }
    return result;
  }

  /**
   * Deletes the entire query popularity leaderboard.
   */
  async deleteLeaderboard(): Promise<void> {
    await this.redisRepo.del('query_leaderboard');
  }

  /**
   * Deletes the cached exact response for a normalized query.
   */
  async deleteExactCache(normalizedQuery: string): Promise<void> {
    const queryHash = generateQueryHash(normalizedQuery);
    const cacheKey = `cache:exact:${queryHash}`;
    await this.redisRepo.del(cacheKey);
  }

  /**
   * Retrieves the cached exact recommendation responses for multiple queries in a single MGET call.
   */
  async getExactRecommendationCacheBulk(normalizedQueries: string[]): Promise<(string | null)[]> {
    if (normalizedQueries.length === 0) return [];
    const keys = normalizedQueries.map(query => {
      const queryHash = generateQueryHash(query);
      return `cache:exact:${queryHash}`;
    });
    return await this.redisRepo.mget(keys);
  }
}
