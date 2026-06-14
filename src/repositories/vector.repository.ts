import { Document } from '@langchain/core/documents';
import { PGVectorStore } from '@langchain/community/vectorstores/pgvector';
import { GoogleGenerativeAIEmbeddings } from '@langchain/google-genai';
import { OpenAIEmbeddings } from '@langchain/openai';
import { PoolConfig } from 'pg';
import { pool } from '../lib/db';
import { SUPPORTED_MODELS, ModelId, MODEL_REGISTRY, PROVIDERS, MEDIA_TYPES, MediaType, MEDIA_TABLES } from '../utils/constant';

export class VectorRepository {
  private vectorStore: PGVectorStore | null = null;
  private embeddings: any;
  private modelId: ModelId;
  private tableName: string;

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
    this.tableName = MEDIA_TABLES[mediaType][config.provider];

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
   * Initializes the PostgreSQL vector store.
   */
  private async initStore() {
    if (this.vectorStore) return;

    const config: PoolConfig = {
      connectionString: process.env.DATABASE_URL,
    };

    const tableName = this.tableName;

    // Initialize the vector store. This automatically creates the extension and table if needed.
    this.vectorStore = await PGVectorStore.initialize(this.embeddings, {
      postgresConnectionOptions: config,
      tableName: tableName,
      columns: {
        idColumnName: "id",
        vectorColumnName: "embedding",
        contentColumnName: "content",
        metadataColumnName: "metadata",
      },
      dimensions: MODEL_REGISTRY[this.modelId].dimensions,
    });
  }

  /**
   * Retrieves the LangChain retriever object connected to PostgreSQL.
   */
  async getRetriever(filter?: Record<string, any>) {
    await this.initStore();
    if (!this.vectorStore) throw new Error("PGVectorStore failed to initialize.");
    
    // Return top 4 matching documents with optional metadata filtering
    return this.vectorStore.asRetriever({
      searchType: "similarity",
      k: 4,
      filter: filter,
    });
  }

  /**
   * Adds an array of documents to the vector store.
   * If ids are provided, it honors the uploadMode:
   *  - 'overwrite': deletes existing rows and replaces them
   *  - 'update': skips embedding and inserting for any IDs that already exist
   */
  async addDocuments(documents: Document[], ids?: string[], uploadMode: 'overwrite' | 'update' = 'overwrite'): Promise<{ skipped: number, inserted: number }> {
    await this.initStore();
    if (!this.vectorStore) throw new Error("PGVectorStore failed to initialize.");
    
    const tableName = this.tableName;
    let skippedCount = 0;
    
    // Check which ones exist for 'update' mode
    if (uploadMode === 'update' && ids && ids.length > 0) {
      try {
        const { rows } = await pool.query(`SELECT id FROM ${tableName} WHERE id = ANY($1)`, [ids]);
        const existingIds = new Set(rows.map((r: any) => r.id));
        
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

        if (documents.length === 0) {
          console.log(`All documents in batch already exist in ${tableName}. Skipping embedding generation.`);
          return { skipped: skippedCount, inserted: 0 };
        }
      } catch (e) {
        console.warn(`Could not check existing documents in ${tableName}:`, e);
      }
    }

    // Perform pseudo-upsert: Delete existing rows with these IDs before inserting for 'overwrite' mode
    if (uploadMode === 'overwrite' && ids && ids.length > 0) {
      try {
        // We use raw SQL because PGVectorStore might not natively implement .delete()
        await pool.query(
          `DELETE FROM ${tableName} WHERE id = ANY($1)`,
          [ids]
        );
      } catch (e) {
        console.warn(`Could not delete existing documents in ${tableName}:`, e);
      }
    }
    try {
      console.log(`Generating embeddings using ${this.modelId} for batch...`);
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
      
      console.log("Returned embedding sizes:", embeddings.map(e => e.length).join(', '));
      
      if (embeddings.some(e => e.length === 0)) {
        throw new Error(`Embedding model returned empty embeddings [] for some documents after all retries!`);
      }

      await this.vectorStore.addVectors(embeddings, documents, { ids });
      return { skipped: skippedCount, inserted: documents.length };
    } catch (e) {
      console.error(`Failed to add documents to VectorStore (${tableName}):`, e);
      throw e; // Rethrow so the caller knows the batch failed
    }
  }
}
