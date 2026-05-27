import { Document } from '@langchain/core/documents';
import { PGVectorStore } from '@langchain/community/vectorstores/pgvector';
import { GoogleGenerativeAIEmbeddings } from '@langchain/google-genai';
import { PoolConfig } from 'pg';
import { pool } from '../lib/db';

export class VectorRepository {
  private vectorStore: PGVectorStore | null = null;
  private embeddings: GoogleGenerativeAIEmbeddings;

  constructor() {
    this.embeddings = new GoogleGenerativeAIEmbeddings({
      model: "gemini-embedding-2", // Reverted back to context.md specification
    });
  }



  /**
   * Initializes the PostgreSQL vector store.
   */
  private async initStore() {
    if (this.vectorStore) return;

    const config: PoolConfig = {
      connectionString: process.env.DATABASE_URL,
    };

    // Initialize the vector store. This automatically creates the extension and table if needed.
    this.vectorStore = await PGVectorStore.initialize(this.embeddings, {
      postgresConnectionOptions: config,
      tableName: "anime_documents",
      columns: {
        idColumnName: "id",
        vectorColumnName: "embedding",
        contentColumnName: "content",
        metadataColumnName: "metadata",
      },
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
    
    let skippedCount = 0;
    
    // Check which ones exist for 'update' mode
    if (uploadMode === 'update' && ids && ids.length > 0) {
      try {
        const { rows } = await pool.query('SELECT id FROM anime_documents WHERE id = ANY($1)', [ids]);
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
          console.log("All documents in batch already exist. Skipping embedding generation.");
          return { skipped: skippedCount, inserted: 0 };
        }
      } catch (e) {
        console.warn("Could not check existing documents:", e);
      }
    }

    // Perform pseudo-upsert: Delete existing rows with these IDs before inserting for 'overwrite' mode
    if (uploadMode === 'overwrite' && ids && ids.length > 0) {
      try {
        // We use raw SQL because PGVectorStore might not natively implement .delete()
        await pool.query(
          'DELETE FROM anime_documents WHERE id = ANY($1)',
          [ids]
        );
      } catch (e) {
        console.warn("Could not delete existing documents:", e);
      }
    }
    try {
      console.log("Generating embeddings for batch...");
      const texts = documents.map(doc => doc.pageContent);
      
      let embeddings: number[][] = [];
      let retries = 5; // 5 retries for Google API silent failures
      let backoff = 10000; // Start with 10 seconds

      while (retries > 0) {
        embeddings = await this.embeddings.embedDocuments(texts);
        
        if (!embeddings.some(e => e.length === 0)) {
          break; // Success!
        }
        
        console.warn(`[Google API Error] Empty embeddings returned. Retrying in ${backoff/1000}s... (${retries - 1} left)`);
        await new Promise(r => setTimeout(r, backoff));
        backoff *= 2; // Exponential backoff
        retries--;
      }
      
      console.log("Returned embedding sizes:", embeddings.map(e => e.length).join(', '));
      
      if (embeddings.some(e => e.length === 0)) {
        throw new Error("Google Generative AI returned empty embeddings [] for some documents after all retries!");
      }

      await this.vectorStore.addVectors(embeddings, documents, { ids });
      return { skipped: skippedCount, inserted: documents.length };
    } catch (e) {
      console.error("Failed to add documents to VectorStore:", e);
      throw e; // Rethrow so the caller knows the batch failed
    }
  }
}
