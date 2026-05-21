import { Document } from '@langchain/core/documents';
import { PGVectorStore } from '@langchain/community/vectorstores/pgvector';
import { GoogleGenerativeAIEmbeddings } from '@langchain/google-genai';
import { PoolConfig } from 'pg';

export class VectorRepository {
  private vectorStore: PGVectorStore | null = null;
  private embeddings: GoogleGenerativeAIEmbeddings;

  constructor() {
    this.embeddings = new GoogleGenerativeAIEmbeddings({
      model: "gemini-embedding-2",
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
  async getRetriever() {
    await this.initStore();
    if (!this.vectorStore) throw new Error("PGVectorStore failed to initialize.");
    
    // Return top 2 matching documents
    return this.vectorStore.asRetriever(2);
  }

  /**
   * Adds an array of documents to the vector store.
   * If ids are provided, it deletes existing rows first to perform an upsert.
   */
  async addDocuments(documents: Document[], ids?: string[]) {
    await this.initStore();
    if (!this.vectorStore) throw new Error("PGVectorStore failed to initialize.");
    
    // Perform pseudo-upsert: Delete existing rows with these IDs before inserting
    if (ids && ids.length > 0) {
      try {
        // We use raw SQL because PGVectorStore might not natively implement .delete()
        await this.vectorStore.pool.query(
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
      const embeddings = await this.embeddings.embedDocuments(texts);
      
      console.log("Returned embedding sizes:", embeddings.map(e => e.length).join(', '));
      
      if (embeddings.some(e => e.length === 0)) {
        throw new Error("Google Generative AI returned empty embeddings [] for some documents!");
      }

      await this.vectorStore.addVectors(embeddings, documents, { ids });
    } catch (e) {
      console.error("Failed to add documents to VectorStore:", e);
      throw e; // Rethrow so the caller knows the batch failed
    }
  }
}
