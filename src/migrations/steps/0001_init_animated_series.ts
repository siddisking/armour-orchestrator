import { QdrantClient } from '@qdrant/js-client-rest';

export async function up(client: QdrantClient): Promise<void> {
  const collectionName = 'animated_series';

  // Check if collection exists
  const collections = await client.getCollections();
  const exists = collections.collections.some(c => c.name === collectionName);

  if (!exists) {
    console.log(`[Migration] Creating collection '${collectionName}'...`);
    await client.createCollection(collectionName, {
      vectors: {
        size: 1024, // Qwen Embeddings size
        distance: 'Cosine'
      }
    });
  } else {
    console.log(`[Migration] Collection '${collectionName}' already exists.`);
  }

  // Create indexes
  const expectedIndexes = [
    { name: 'metadata.year', schema: 'integer' },
    { name: 'metadata.score', schema: 'float' },
    { name: 'metadata.episodes', schema: 'integer' },
    { name: 'metadata.studios', schema: 'keyword' },
    { name: 'metadata.genres', schema: 'keyword' },
    { name: 'metadata.type', schema: 'keyword' },
    { name: 'metadata.status', schema: 'keyword' }
  ] as const;

  for (const idx of expectedIndexes) {
    console.log(`[Migration] Ensuring payload index on '${idx.name}'...`);
    await client.createPayloadIndex(collectionName, {
      field_name: idx.name,
      field_schema: idx.schema,
    });
  }
}

export async function down(client: QdrantClient): Promise<void> {
  console.log("[Migration] Dropping collection 'animated_series'...");
  await client.deleteCollection('animated_series');
}
