import { Document } from '@langchain/core/documents';
import { QdrantVectorStore } from '@langchain/qdrant';
import { GoogleGenerativeAIEmbeddings } from '@langchain/google-genai';
import { OpenAIEmbeddings } from '@langchain/openai';
import { SUPPORTED_MODELS, ModelId, MODEL_REGISTRY, PROVIDERS, MEDIA_TYPES, MediaType, MEDIA_COLLECTIONS } from '../utils/constant';

export class VectorRepository {
  private vectorStore: QdrantVectorStore | null = null;
  private embeddings: any;
  private modelId: ModelId;
  private collectionName: string;

  get model(): ModelId {
    return this.modelId;
  }

  get provider(): string {
    return MODEL_REGISTRY[this.modelId].provider;
  }

  constructor(
    modelId: ModelId = SUPPORTED_MODELS.GEMINI_FLASH,
    mediaType: MediaType = MEDIA_TYPES.ANIME
  ) {
    this.modelId = modelId;
    const config = MODEL_REGISTRY[modelId];
    
    const isQwen = config.provider === PROVIDERS.SILICONFLOW;
    this.collectionName = MEDIA_COLLECTIONS[mediaType];

    if (isQwen) {
      this.embeddings = new OpenAIEmbeddings({
        apiKey: process.env.SILICONFLOW_API_KEY || '',
        openAIApiKey: process.env.SILICONFLOW_API_KEY || '', // Compatibility fallback
        modelName: config.embeddingModel,
        configuration: {
          baseURL: config.baseURL,
          apiKey: process.env.SILICONFLOW_API_KEY || '', // Nested override to prevent SDK fallback to OPENAI_API_KEY
        },
      });
    } else {
      this.embeddings = new GoogleGenerativeAIEmbeddings({
        model: config.embeddingModel,
      });
    }
  }

  /**
   * Initializes the Qdrant vector store.
   */
  private async initStore() {
    if (this.vectorStore) return;

    const qdrantUrl = process.env.QDRANT_URL || "http://127.0.0.1:6333";
    const apiKey = process.env.QDRANT_API_KEY;

    this.vectorStore = await QdrantVectorStore.fromExistingCollection(this.embeddings, {
      url: qdrantUrl,
      collectionName: this.collectionName,
      apiKey,
    });
  }

  /**
   * Translates simple key-value/comparison filter to Qdrant's REST filter schema.
   */
  private mapToQdrantFilter(filter: Record<string, any>): any {
    const normalizedFilter: Record<string, any> = {};

    // 1. Process and translate keys
    for (const [key, value] of Object.entries(filter)) {
      if (value === null || value === undefined) continue;

      if (key === 'minScore') {
        normalizedFilter.score = { ...normalizedFilter.score, gte: value };
      } else if (key === 'minEpisodes') {
        normalizedFilter.episodes = { ...normalizedFilter.episodes, gte: value };
      } else if (key === 'score' || key === 'episodes') {
        normalizedFilter[key] = { ...normalizedFilter[key], ...value };
      } else if (['year', 'studios', 'type', 'status'].includes(key)) {
        normalizedFilter[key] = value;
      }
      // Skip 'plot_keywords', 'limit', and 'genres' because they are either search params
      // or not ingested in the Qdrant metadata schema.
    }

    const mustConditions: any[] = [];

    // 2. Build must conditions
    for (const [key, value] of Object.entries(normalizedFilter)) {
      const fieldKey = `metadata.${key}`;

      if (Array.isArray(value)) {
        value.forEach(val => {
          mustConditions.push({
            key: fieldKey,
            match: { value: val }
          });
        });
      } else if (typeof value === 'object') {
        const rangeCond: Record<string, any> = {};
        if ('gte' in value) rangeCond.gte = value.gte;
        if ('gt' in value) rangeCond.gt = value.gt;
        if ('lte' in value) rangeCond.lte = value.lte;
        if ('lt' in value) rangeCond.lt = value.lt;

        mustConditions.push({
          key: fieldKey,
          range: rangeCond
        });
      } else {
        mustConditions.push({
          key: fieldKey,
          match: { value: value }
        });
      }
    }

    if (mustConditions.length === 0) return undefined;
    return { must: mustConditions };
  }

  /**
   * Retrieves the LangChain retriever object connected to Qdrant.
   */
  async getRetriever(filter?: Record<string, any>) {
    await this.initStore();
    if (!this.vectorStore) throw new Error("QdrantVectorStore failed to initialize.");
    
    const qdrantFilter = filter ? this.mapToQdrantFilter(filter) : undefined;

    // Return top 4 matching documents with optional metadata filtering
    return this.vectorStore.asRetriever({
      searchType: "similarity",
      k: 4,
      filter: qdrantFilter,
    });
  }

  /**
   * Adds an array of documents to the vector store.
   * If ids are provided, it honors the uploadMode:
   *  - 'overwrite': inserts (upserts) the documents, replacing existing ones with same IDs
   *  - 'update': skips embedding and inserting for any IDs that already exist
   */
  async addDocuments(documents: Document[], ids?: string[], uploadMode: 'overwrite' | 'update' = 'overwrite'): Promise<{ skipped: number, inserted: number }> {
    const totalStart = Date.now();
    const initStart = Date.now();
    await this.initStore();
    if (!this.vectorStore) throw new Error("QdrantVectorStore failed to initialize.");
    console.log(`[Qdrant AddDocs] Vector store initialized | Time: ${Date.now() - initStart}ms`);
    
    const collectionName = this.collectionName;
    const qdrantUrl = process.env.QDRANT_URL || "http://127.0.0.1:6333";
    let skippedCount = 0;
    
    // Check which ones exist for 'update' mode
    if (uploadMode === 'update' && ids && ids.length > 0) {
      const checkStart = Date.now();
      try {
        const response = await fetch(`${qdrantUrl}/collections/${collectionName}/points`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ ids, with_payload: false, with_vector: false })
        });
        
        if (response.ok) {
          const data = await response.json();
          const existingIds = new Set((data.result || []).map((r: any) => r.id));
          
          const newDocs: Document[] = [];
          const newIds: string[] = [];
          for (let i = 0; i < ids.length; i++) {
            if (!existingIds.has(ids[i])) {
              newDocs.push(documents[i]);
              newIds.push(ids[i]);
            }
          }
          skippedCount = ids.length - newIds.length;
          documents = newDocs;
          ids = newIds;
          console.log(`[Qdrant AddDocs] Checked existing documents in ${Date.now() - checkStart}ms | Skipped: ${skippedCount}, Remaining: ${documents.length}`);

          if (documents.length === 0) {
            console.log(`All documents in batch already exist in Qdrant collection ${collectionName}. Skipping embedding generation.`);
            return { skipped: skippedCount, inserted: 0 };
          }
        }
      } catch (e) {
        console.warn(`Could not check existing documents in Qdrant collection ${collectionName}:`, e);
      }
    }

    try {
      const embeddingStart = Date.now();
      console.log(`Generating embeddings using ${this.modelId} for batch of size ${documents.length}...`);
      const texts = documents.map(doc => doc.pageContent);
      
      let embeddings: number[][] = [];
      let retries = 5; // 5 retries for API silent failures
      let backoff = 10000; // Start with 10 seconds

      while (retries > 0) {
        embeddings = await this.embeddings.embedDocuments(texts);
        
        if (!embeddings.some(e => e.length === 0)) {
          break; // Success!
        }
        
        console.warn(`[API Error] Empty embeddings returned. Retrying in ${backoff/1000}s... (${retries - 1} left)`);
        await new Promise(r => setTimeout(r, backoff));
        backoff *= 2; // Exponential backoff
        retries--;
      }
      
      console.log(`Returned embedding sizes: ${embeddings.map(e => e.length).join(', ')} | Embedding Time: ${Date.now() - embeddingStart}ms`);
      
      if (embeddings.some(e => e.length === 0)) {
        throw new Error(`Embedding model returned empty embeddings [] for some documents after all retries!`);
      }

      const qdrantUpsertStart = Date.now();
      await this.vectorStore.addVectors(embeddings, documents, { ids });
      console.log(`[Qdrant AddDocs] Upserted vectors into Qdrant | Time: ${Date.now() - qdrantUpsertStart}ms | Total Time: ${Date.now() - totalStart}ms`);
      return { skipped: skippedCount, inserted: documents.length };
    } catch (e) {
      console.error(`Failed to add documents to Qdrant collection (${collectionName}):`, e);
      throw e; // Rethrow so the caller knows the batch failed
    }
  }
}
