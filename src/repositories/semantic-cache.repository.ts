import { QdrantClient } from '@qdrant/js-client-rest';
import { GoogleGenerativeAIEmbeddings } from '@langchain/google-genai';
import { OpenAIEmbeddings } from '@langchain/openai';
import { ModelId, SUPPORTED_MODELS, MODEL_REGISTRY, PROVIDERS, CACHE_CONFIG } from '../utils/constant';
import crypto from 'crypto';

export class SemanticCacheRepository {
  private client: QdrantClient;
  private embeddings: any;
  private dimensions: number;
  private collectionName = 'anime_semantic_cache';
  private isInitialized = false;

  constructor(modelId: ModelId = SUPPORTED_MODELS.QWEN3_14B) {
    const config = MODEL_REGISTRY[modelId];
    this.dimensions = config.dimensions;

    const isQwen = config.provider === PROVIDERS.SILICONFLOW;
    if (isQwen) {
      this.embeddings = new OpenAIEmbeddings({
        apiKey: process.env.SILICONFLOW_API_KEY || '',
        openAIApiKey: process.env.SILICONFLOW_API_KEY || '',
        modelName: config.embeddingModel,
        configuration: {
          baseURL: config.baseURL,
          apiKey: process.env.SILICONFLOW_API_KEY || '',
        },
      });
    } else {
      this.embeddings = new GoogleGenerativeAIEmbeddings({
        model: config.embeddingModel,
      });
    }

    const qdrantUrl = process.env.QDRANT_URL || "http://127.0.0.1:6333";
    const apiKey = process.env.QDRANT_API_KEY;
    this.client = new QdrantClient({ url: qdrantUrl, apiKey });
  }

  /**
   * Assures that the semantic cache collection exists in Qdrant with appropriate dimensions.
   */
  private async ensureCollection() {
    if (this.isInitialized) return;

    try {
      const collections = await this.client.getCollections();
      const exists = collections.collections.some(c => c.name === this.collectionName);

      if (!exists) {
        console.log(`[SemanticCache] Creating Qdrant collection: "${this.collectionName}" with ${this.dimensions} dimensions...`);
        await this.client.createCollection(this.collectionName, {
          vectors: {
            size: this.dimensions,
            distance: 'Cosine'
          }
        });
        console.log(`[SemanticCache] Collection "${this.collectionName}" created successfully.`);
      }
      this.isInitialized = true;
    } catch (err) {
      console.error(`[SemanticCache] Failed to initialize Qdrant collection:`, err);
      throw err;
    }
  }

  /**
   * Generates a deterministic UUID based on an input string.
   * This prevents duplicate vector entries for identical queries in the cache.
   */
  private generateDeterministicId(input: string): string {
    const md5Hash = crypto.createHash('md5').update(input).digest('hex');
    return `${md5Hash.slice(0, 8)}-${md5Hash.slice(8, 12)}-${md5Hash.slice(12, 16)}-${md5Hash.slice(16, 20)}-${md5Hash.slice(20, 32)}`;
  }

  /**
   * Embeds the search query and upserts the vector along with its response payload to Qdrant.
   * If an existing semantic match with similarity >= similarityThreshold (default 0.95) exists,
   * we skip the insert to prevent duplicate semantic cache pollution.
   */
  async upsertCache(query: string, response: string, similarityThreshold = CACHE_CONFIG.DEDUPLICATION_THRESHOLD): Promise<boolean> {
    await this.ensureCollection();

    // 1. Generate query vector using embeddings
    const vector = await this.embeddings.embedQuery(query);

    // 2. Perform a semantic similarity check in Qdrant to see if we already have a close match
    try {
      const searchResults = await this.client.search(this.collectionName, {
        vector,
        limit: 1,
        score_threshold: similarityThreshold
      });

      if (searchResults.length > 0) {
        const bestMatch = searchResults[0];
        console.log(
          `[SemanticCache] Found semantic match for query "${query}" (matched existing: "${bestMatch.payload?.query}" with ${(bestMatch.score * 100).toFixed(2)}% similarity), so skipping original query.`
        );
        return false; // Skipped due to existing semantic match
      }
    } catch (searchErr) {
      // If collection is empty, search can fail or return empty. We log and proceed to insert.
      console.log(`[SemanticCache] Semantic duplicate check bypassed (empty collection or first write).`);
    }

    // 3. Generate deterministic UUID from query text hash
    const id = this.generateDeterministicId(query);

    // 4. Upsert to Qdrant
    await this.client.upsert(this.collectionName, {
      points: [
        {
          id,
          vector,
          payload: {
            query,
            response,
            created_at: new Date().toISOString()
          }
        }
      ]
    });
    console.log(`[SemanticCache] Upserted cache point for query: "${query}" (ID: ${id})`);
    return true; // Upserted successfully
  }

  /**
   * Promotes multiple cache items in bulk:
   * 1. Embeds all queries in a single OpenAI/Gemini bulk call.
   * 2. Performs a batch search in Qdrant to check for duplicate queries.
   * 3. Upserts all non-duplicate items in a single bulk Qdrant call.
   */
  async upsertCacheBulk(
    items: { query: string; response: string }[],
    similarityThreshold = CACHE_CONFIG.DEDUPLICATION_THRESHOLD
  ): Promise<{ promotedCount: number; ignoredCount: number }> {
    if (items.length === 0) {
      return { promotedCount: 0, ignoredCount: 0 };
    }

    await this.ensureCollection();

    let promotedCount = 0;
    let ignoredCount = 0;

    try {
      const queries = items.map(item => item.query);
      
      // 1. Bulk embed all queries
      console.log(`[SemanticCache] Bulk embedding ${items.length} queries...`);
      const vectors = await this.embeddings.embedDocuments(queries);

      // 2. Batch check for duplicates in Qdrant
      const searches = vectors.map((vector: number[]) => ({
        vector,
        limit: 1,
        score_threshold: similarityThreshold
      }));

      let batchResults: any[] = [];
      try {
        console.log(`[SemanticCache] Batch searching duplicates for ${items.length} vectors...`);
        const qdrantBatchRes = await this.client.searchBatch(this.collectionName, { searches });
        batchResults = qdrantBatchRes;
      } catch (searchErr) {
        console.log(`[SemanticCache] Semantic duplicate check bypassed (empty collection or first write).`);
        batchResults = Array(items.length).fill([]);
      }

      // 3. Filter out duplicates and prepare points
      const pointsToUpsert: any[] = [];

      for (let i = 0; i < items.length; i++) {
        const item = items[i];
        const vector = vectors[i];
        const searchHits = batchResults[i] || [];

        if (searchHits.length > 0) {
          const bestMatch = searchHits[0];
          console.log(
            `[SemanticCache] Found semantic match for query "${item.query}" (matched existing: "${bestMatch.payload?.query}" with ${(bestMatch.score * 100).toFixed(2)}% similarity), so skipping original query.`
          );
          ignoredCount++;
        } else {
          const id = this.generateDeterministicId(item.query);
          pointsToUpsert.push({
            id,
            vector,
            payload: {
              query: item.query,
              response: item.response,
              created_at: new Date().toISOString()
            }
          });
        }
      }

      // 4. Bulk upsert non-duplicates to Qdrant
      if (pointsToUpsert.length > 0) {
        console.log(`[SemanticCache] Bulk upserting ${pointsToUpsert.length} points to Qdrant...`);
        await this.client.upsert(this.collectionName, {
          points: pointsToUpsert
        });
        promotedCount += pointsToUpsert.length;
        console.log(`[SemanticCache] Successfully upserted ${pointsToUpsert.length} cache points.`);
      }

      return { promotedCount, ignoredCount };
    } catch (err) {
      console.error(`[SemanticCache] Bulk cache upsert failed:`, err);
      throw err;
    }
  }

  /**
   * Searches the semantic cache in Qdrant for a query similarity matching >= retrievalThreshold.
   * If a match is found, it returns the cached response string. Otherwise, returns null.
   */
  async retrieveCache(
    query: string,
    retrievalThreshold = CACHE_CONFIG.RETRIEVAL_THRESHOLD
  ): Promise<string | null> {
    const start = Date.now();
    await this.ensureCollection();

    try {
      // 1. Embed the search query
      const embedStart = Date.now();
      const vector = await this.embeddings.embedQuery(query);
      const embedDuration = Date.now() - embedStart;

      // 2. Query Qdrant for the closest vector match above the threshold
      const searchStart = Date.now();
      const searchResults = await this.client.search(this.collectionName, {
        vector,
        limit: 1,
        score_threshold: retrievalThreshold
      });
      const searchDuration = Date.now() - searchStart;
      const totalDuration = Date.now() - start;

      if (searchResults.length > 0) {
        const bestMatch = searchResults[0];
        console.log(
          `[SemanticCache] Semantic cache hit found! Match: "${bestMatch.payload?.query}" | Similarity: ${(bestMatch.score * 100).toFixed(2)}% >= ${(retrievalThreshold * 100).toFixed(2)}% | Total Time: ${totalDuration}ms (Embed: ${embedDuration}ms, Search: ${searchDuration}ms)`
        );
        return bestMatch.payload?.response as string || null;
      }
      
      console.log(`[SemanticCache] Semantic cache miss for query: "${query}" | Total Time: ${totalDuration}ms (Embed: ${embedDuration}ms, Search: ${searchDuration}ms)`);
      return null;
    } catch (err) {
      // If collection is empty or Qdrant is unavailable, fail open (log error and return null)
      console.warn(`[SemanticCache] Query retrieval failed, failing open:`, err);
      return null;
    }
  }
}
