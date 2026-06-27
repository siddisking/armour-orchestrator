import * as fs from 'fs';
import * as path from 'path';
import { QdrantClient } from '@qdrant/js-client-rest';
import * as migration0001 from './steps/0001_init_animated_series';

// Registry of all migrations in order
const MIGRATIONS = [
  { name: '0001_init_animated_series', up: migration0001.up, down: migration0001.down }
];

// Helper to load env in standalone script mode
function loadEnv() {
  const envPath = path.resolve(process.cwd(), '.env.local');
  if (fs.existsSync(envPath)) {
    const envContent = fs.readFileSync(envPath, 'utf8');
    envContent.split('\n').forEach(line => {
      const match = line.match(/^\s*([\w.-]+)\s*=\s*(.*)?\s*$/);
      if (match) {
        const key = match[1];
        let value = match[2] || '';
        if (value.startsWith('"') && value.endsWith('"')) {
          value = value.slice(1, -1);
        } else if (value.startsWith("'") && value.endsWith("'")) {
          value = value.slice(1, -1);
        }
        process.env[key] = value;
      }
    });
  }
}

export async function runMigrations() {
  // Ensure env variables are loaded if we are running as a standalone script
  if (!process.env.QDRANT_URL) {
    loadEnv();
  }

  const qdrantUrl = process.env.QDRANT_URL || 'http://127.0.0.1:6333';
  const apiKey = process.env.QDRANT_API_KEY;

  console.log(`[Migration] Connecting to Qdrant at: ${qdrantUrl}`);
  const client = new QdrantClient({ url: qdrantUrl, apiKey });

  const historyCollection = '_migrations';

  // 1. Ensure the migrations tracking collection exists
  const collections = await client.getCollections();
  const historyExists = collections.collections.some(c => c.name === historyCollection);

  if (!historyExists) {
    console.log(`[Migration] Creating tracking collection '${historyCollection}'...`);
    await client.createCollection(historyCollection, {
      vectors: { size: 1, distance: 'Cosine' } // Qdrant requires at least 1 vector dimension
    });
  }

  // 2. Fetch applied migrations
  const response = await client.scroll(historyCollection, {
    with_payload: true,
    limit: 100
  });
  
  const appliedMigrations = new Set<string>(
    response.points.map((point: any) => point.payload?.name).filter(Boolean)
  );

  console.log(`[Migration] Found ${appliedMigrations.size} previously applied migrations.`);

  // 3. Run pending migrations in sequence
  let runCount = 0;
  for (const migration of MIGRATIONS) {
    if (!appliedMigrations.has(migration.name)) {
      console.log(`[Migration] Applying migration: ${migration.name}...`);
      
      const start = Date.now();
      await migration.up(client);
      const duration = Date.now() - start;

      // Record applied migration in Qdrant with a generated UUID
      const crypto = require('crypto');
      const id = crypto.randomUUID();

      await client.upsert(historyCollection, {
        points: [
          {
            id,
            vector: [0.0],
            payload: {
              name: migration.name,
              applied_at: new Date().toISOString(),
              duration_ms: duration
            }
          }
        ]
      });

      console.log(`[Migration] Successfully applied ${migration.name} in ${duration}ms.`);
      runCount++;
    } else {
      console.log(`[Migration] Migration ${migration.name} is already applied.`);
    }
  }

  if (runCount === 0) {
    console.log('[Migration] Database is up to date. No pending migrations.');
  } else {
    console.log(`[Migration] Completed ${runCount} migrations.`);
  }
}

// Support executing directly via `ts-node src/migrations/migrate.ts`
if (require.main === module) {
  runMigrations()
    .then(() => process.exit(0))
    .catch(err => {
      console.error('[Migration] Migration run failed:', err);
      process.exit(1);
    });
}
