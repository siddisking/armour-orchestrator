import { RedisService } from './redis.service';
import { SemanticCacheRepository } from '../repositories/semantic-cache.repository';
import { ModelId, SUPPORTED_MODELS, CACHE_CONFIG } from '../utils/constant';

export class PromotionService {
  private redisService: RedisService;

  constructor() {
    this.redisService = new RedisService();
  }

  /**
   * Promotes popular queries (score >= minScore) from Redis L1 cache to Qdrant L2 semantic cache.
   * Resets the leaderboard sorted set at the end of the promotion run.
   */
  async promotePopularQueries(
    modelId: ModelId = SUPPORTED_MODELS.QWEN_7B
  ): Promise<{ promotedCount: number; ignoredCount: number; errorsCount: number }> {
    console.log(`[PromotionService] Starting cache promotion cycle with model "${modelId}"...`);
    
    const cacheRepo = new SemanticCacheRepository(modelId);
    
    let promotedCount = 0;
    let ignoredCount = 0;
    let errorsCount = 0;

    try {
      // 1. Fetch ALL leaderboard queries (score >= 1)
      const allEntries = await this.redisService.getLeaderboardEntries(1);
      console.log(`[PromotionService] Found ${allEntries.length} total leaderboard entries.`);

      if (allEntries.length > 0) {
        // 2. Calculate average score of all searches
        const totalScore = allEntries.reduce((sum, entry) => sum + entry.score, 0);
        const averageScore = totalScore / allEntries.length;
        
        // Dynamic threshold is the max of the average score or the configured MIN_PROMOTION_THRESHOLD (5)
        const dynamicThreshold = Math.max(averageScore, CACHE_CONFIG.MIN_PROMOTION_THRESHOLD);
        
        console.log(
          `[PromotionService] Calculated average search score: ${averageScore.toFixed(2)}. ` +
          `Using dynamic promotion threshold: ${dynamicThreshold.toFixed(2)} (Min required: ${CACHE_CONFIG.MIN_PROMOTION_THRESHOLD}).`
        );

        // 3. Filter candidates that meet the dynamic threshold
        const eligibleEntries = allEntries.filter(entry => entry.score >= dynamicThreshold);
        console.log(`[PromotionService] ${eligibleEntries.length} of ${allEntries.length} entries meet the threshold.`);

        if (eligibleEntries.length > 0) {
          // 4. Fetch exact cached responses from Redis in a single bulk query
          console.log(`[PromotionService] Fetching Redis cached answers for ${eligibleEntries.length} queries in a bulk MGET call...`);
          const queries = eligibleEntries.map(entry => entry.query);
          const cachedResponses = await this.redisService.getExactRecommendationCacheBulk(queries);

          // 5. Prepare pairs that actually exist in Redis
          const validItems: { query: string; response: string }[] = [];
          for (let i = 0; i < eligibleEntries.length; i++) {
            const entry = eligibleEntries[i];
            const response = cachedResponses[i];
            if (response) {
              validItems.push({ query: entry.query, response });
            } else {
              console.warn(`[PromotionService] Cached response not found for query "${entry.query}" despite being on leaderboard. Bypassing.`);
              ignoredCount++;
            }
          }

          // 6. Bulk upsert to Qdrant (performs bulk embed and batch duplicate checking)
          if (validItems.length > 0) {
            const bulkResult = await cacheRepo.upsertCacheBulk(validItems);
            promotedCount = bulkResult.promotedCount;
            ignoredCount += bulkResult.ignoredCount;
          }
        } else {
          console.log(`[PromotionService] No entries met the dynamic threshold. Skipping upsert.`);
        }

        // 7. Clean up/delete the leaderboard sorted set to start the next week fresh
        await this.redisService.deleteLeaderboard();
        console.log(`[PromotionService] Reset query popularity leaderboard.`);
      }

      console.log(`[PromotionService] Cache promotion complete. Promoted: ${promotedCount}, Ignored: ${ignoredCount}, Errors: ${errorsCount}.`);
    } catch (err) {
      console.error(`[PromotionService] Cache promotion pipeline failed:`, err);
      throw err;
    }

    return { promotedCount, ignoredCount, errorsCount };
  }
}
