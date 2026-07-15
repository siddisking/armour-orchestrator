import { pool } from '../lib/db';
import { ModelId, MODEL_REGISTRY } from '../utils/constant';

export interface AnimeDocument {
  id: string;
  content: string;
  metadata: Record<string, any>;
}

export interface AnimeFilters {
  studios?: string;
  genres?: string[];
  year?: number;
  type?: string;
  status?: string;
  minScore?: number;
  minEpisodes?: number;
  limit?: number;
}

export class AnimeDocumentRepository {
  /**
   * Finds an anime document by matching title (English or Japanese) inside the content field.
   * Resolves the target table dynamically based on modelId (e.g. anime_documents vs. anime_documents_qwen).
   */
  async findAnimeByTitle(title: string, modelId: ModelId): Promise<AnimeDocument | null> {
    const config = MODEL_REGISTRY[modelId];
    if (!config) {
      throw new Error(`Unsupported model ID: ${modelId}`);
    }
    const tableName = config.tableName;

    // Matches using pg_trgm similarity with a case-insensitive fallback.
    // Result is sorted by the highest title similarity.
    const query = `
      SELECT id, content, metadata
      FROM "${tableName}"
      WHERE split_part(content, E'\n', 1) % ('Title: ' || $1)
         OR split_part(content, E'\n', 2) % ('Japanese Title: ' || $1)
         OR content ILIKE '%Title: %' || $1 || '%'
      ORDER BY GREATEST(
        similarity(split_part(content, E'\n', 1), 'Title: ' || $1),
        similarity(split_part(content, E'\n', 2), 'Japanese Title: ' || $1)
      ) DESC
      LIMIT 1;
    `;

    const { rows } = await pool.query(query, [title]);
    if (rows.length === 0) {
      return null;
    }

    const row = rows[0];
    let parsedMetadata = row.metadata;
    if (typeof parsedMetadata === 'string') {
      try {
        parsedMetadata = JSON.parse(parsedMetadata);
      } catch (err) {
        console.warn("Failed to parse metadata JSON:", err);
      }
    }

    return {
      id: row.id,
      content: row.content,
      metadata: parsedMetadata || {}
    };
  }

  /**
   * Finds anime documents matching dynamic metadata filters and text-based genres.
   * Resolves the target table dynamically based on modelId (e.g. anime_documents vs. anime_documents_qwen).
   * Matches 'genres' inside the content column, and other filters inside the JSONB metadata column.
   * Results are sorted by popularity descending to prioritize high-quality matches.
   */
  async findAnimeByFilters(filters: AnimeFilters, modelId: ModelId): Promise<AnimeDocument[]> {
    const config = MODEL_REGISTRY[modelId];
    if (!config) {
      throw new Error(`Unsupported model ID: ${modelId}`);
    }
    const tableName = config.tableName;

    const conditions: string[] = [];
    const values: any[] = [];
    let paramIndex = 1;

    // Filter by Studio (JSONB)
    if (filters.studios) {
      conditions.push(`metadata->>'studios' ILIKE $${paramIndex}`);
      values.push(`%${filters.studios}%`);
      paramIndex++;
    }

    // Filter by multiple Genres (Content text match since genres is not in JSONB metadata keys)
    if (filters.genres && filters.genres.length > 0) {
      for (const genre of filters.genres) {
        conditions.push(`content ILIKE $${paramIndex}`);
        values.push(`%Genres: %${genre}%`);
        paramIndex++;
      }
    }

    // Filter by Release Year (JSONB)
    if (filters.year) {
      conditions.push(`(metadata->>'year')::int = $${paramIndex}`);
      values.push(filters.year);
      paramIndex++;
    }

    // Filter by Type (JSONB)
    if (filters.type) {
      conditions.push(`metadata->>'type' = $${paramIndex}`);
      values.push(filters.type);
      paramIndex++;
    }

    // Filter by Status (JSONB)
    if (filters.status) {
      conditions.push(`metadata->>'status' = $${paramIndex}`);
      values.push(filters.status);
      paramIndex++;
    }

    // Filter by Minimum Rating Score (JSONB)
    if (filters.minScore !== undefined) {
      conditions.push(`(metadata->>'score')::float >= $${paramIndex}`);
      values.push(filters.minScore);
      paramIndex++;
    }

    // Filter by Minimum Episode Count (JSONB)
    if (filters.minEpisodes !== undefined) {
      conditions.push(`(metadata->>'episodes')::int >= $${paramIndex}`);
      values.push(filters.minEpisodes);
      paramIndex++;
    }

    const whereClause = conditions.length > 0 ? `WHERE ${conditions.join(' AND ')}` : '';
    const limit = filters.limit || 20;

    const query = `
      SELECT id, content, metadata
      FROM "${tableName}"
      ${whereClause}
      ORDER BY (metadata->>'popularity')::float DESC
      LIMIT $${paramIndex};
    `;
    values.push(limit);

    const { rows } = await pool.query(query, values);

    return rows.map(row => {
      let parsedMetadata = row.metadata;
      if (typeof parsedMetadata === 'string') {
        try {
          parsedMetadata = JSON.parse(parsedMetadata);
        } catch (err) {
          console.warn("Failed to parse metadata JSON:", err);
        }
      }
      return {
        id: row.id,
        content: row.content,
        metadata: parsedMetadata || {}
      };
    });
  }
}
