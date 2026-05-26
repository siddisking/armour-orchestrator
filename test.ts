import { PGVectorStore } from '@langchain/community/vectorstores/pgvector';
import { GoogleGenerativeAIEmbeddings } from '@langchain/google-genai';

async function main() {
  const embeddings = new GoogleGenerativeAIEmbeddings({ model: "gemini-embedding-2" });
  const store = await PGVectorStore.initialize(embeddings, {
    postgresConnectionOptions: { connectionString: "postgresql://postgres:postgres@localhost:5432/postgres" },
    tableName: "anime_documents",
    columns: { idColumnName: "id", vectorColumnName: "embedding", contentColumnName: "content", metadataColumnName: "metadata" },
  });
  console.log("Pool exists?", !!(store as any).pool);
}
main().catch(console.error);
