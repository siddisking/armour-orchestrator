import { Document } from '@langchain/core/documents';
import { parse } from 'csv-parse';
import { v5 as uuidv5 } from 'uuid';
import { VectorRepository } from '../repositories/vector.repository';
import { SUPPORTED_MODELS, INGESTION_TARGETS } from '../utils/constant';

// We use a custom namespace for our PlotArmour AI anime dataset
const ANIME_NAMESPACE = '1b671a64-40d5-491e-99b0-da01ff1f3341';

export class IngestService {
  private vectorRepo: VectorRepository;

  constructor() {
    this.vectorRepo = new VectorRepository();
  }

  /**
   * Processes an Anime CSV buffer, parses it, creates LangChain Documents, and streams batches to PGVectorStore.
   * Calls onProgress with the total count of documents processed so far.
   */
  async processTVAnimeCSVStream(
    buffer: Buffer, 
    uploadMode: 'overwrite' | 'update', 
    vectorProvider: 'gemini' | 'qwen' | 'both',
    onProgress: (count: number) => void,
    onLog?: (msg: string) => void
  ): Promise<void> {
    return new Promise((resolve, reject) => {
      let count = 0;
      let batch: Document[] = [];
      let batchIds: string[] = [];
      const BATCH_SIZE = 1000; // Increased batch size for Pay-As-You-Go speed
      
      const delay = (ms: number) => new Promise(resolve => setTimeout(resolve, ms));

      const repos: VectorRepository[] = [];
      if (vectorProvider === INGESTION_TARGETS.GEMINI || vectorProvider === INGESTION_TARGETS.BOTH) {
        repos.push(new VectorRepository(SUPPORTED_MODELS.GEMINI_FLASH));
      }
      if (vectorProvider === INGESTION_TARGETS.QWEN || vectorProvider === INGESTION_TARGETS.BOTH) {
        repos.push(new VectorRepository(SUPPORTED_MODELS.QWEN_7B));
      }
      
      const parser = parse({
        columns: true,
        skip_empty_lines: true,
        relax_quotes: true,
      });

      parser.on('readable', async () => {
        let record;
        console.log("Readable event fired!");
        // When we read a record, if we hit the batch size, we must pause the parser to wait for the async DB insertion
        while ((record = parser.read()) !== null) {
          // 1. Filter only for 'TV' type
          if (record.type !== 'TV') {
            continue;
          }

          console.log("Read record:", record.title);

          // Helper function to clean Python list strings like "['Action']" -> "Action"
          const cleanListString = (str: string) => {
            if (!str || str === '[]') return '';
            return str.replace(/[\[\]']/g, '').split(',').map((s: string) => s.trim()).filter(Boolean).join(', ');
          };

          const cleanedGenres = cleanListString(record.genres);
          const cleanedThemes = cleanListString(record.themes);
          const cleanedDemographics = cleanListString(record.demographics);
          const cleanedStudios = cleanListString(record.studios);

          const pageContent = `Title: ${record.title}
Japanese Title: ${record.title_japanese}
Genres: ${cleanedGenres}
Themes: ${cleanedThemes}
Demographics: ${cleanedDemographics}
Synopsis: ${record.synopsis}`;

          const metadata = {
            mal_id: record.mal_id,
            url: record.url,
            image_url: record.image_url,
            rating: record.rating,
            score: parseFloat(record.score) || 0,
            scored_by: parseInt(record.scored_by) || 0,
            rank: parseInt(record.rank) || 0,
            popularity: parseInt(record.popularity) || 0,
            type: record.type,
            status: record.status,
            episodes: parseInt(record.episodes) || null,
            year: parseInt(record.year) || null,
            studios: cleanedStudios,
            start_date: record.start_date || null,
            end_date: record.end_date || null,
          };

          const docId = uuidv5(record.mal_id.toString(), ANIME_NAMESPACE);

          batch.push(new Document({ pageContent, metadata }));
          batchIds.push(docId);

          if (batch.length >= BATCH_SIZE) {
            parser.pause();

            // 🚨 FIX: Extract current batch and immediately clear the global arrays 
            // BEFORE awaiting, so the 'end' event doesn't accidentally process them again!
            const currentBatch = batch;
            const currentBatchIds = batchIds;
            batch = [];
            batchIds = [];

            try {
              const prevLength = currentBatch.length;
              let totalInserted = 0;
              let totalSkipped = 0;

              for (const repo of repos) {
                const result = await repo.addDocuments(currentBatch, currentBatchIds, uploadMode);
                totalInserted += result.inserted;
                totalSkipped += result.skipped;

                if (onLog && result.skipped > 0) {
                  onLog(`[${repo.provider}] Skipped ${result.skipped} existing records.`);
                }
                if (onLog && result.inserted > 0) {
                  onLog(`[${repo.provider}] Embedded and inserted ${result.inserted} new records.`);
                }
              }
              
              count += prevLength; // Approximate progress based on parsed count
              onProgress(count);
              
              if (totalInserted > 0) {
                await delay(1000); // Small 1-second breather between giant batches
              }
              
              parser.resume();
            } catch (err) {
              parser.destroy(err as Error);
            }
          }
        }
      });

      parser.on('end', async () => {
        console.log("End event fired. Batch length:", batch.length);
        // Process any remaining documents in the final batch
        if (batch.length > 0) {
          try {
            for (const repo of repos) {
              const result = await repo.addDocuments(batch, batchIds, uploadMode);
              if (onLog && result.skipped > 0) {
                onLog(`[${repo.provider}] Skipped ${result.skipped} existing records.`);
              }
              if (onLog && result.inserted > 0) {
                onLog(`[${repo.provider}] Embedded and inserted ${result.inserted} new records.`);
              }
            }
            count += batch.length;
            onProgress(count);
          } catch (err) {
            reject(err);
            return;
          }
        }
        resolve();
      });

      parser.on('error', (err) => {
        reject(err);
      });

      // Feed the buffer into the stream AFTER listeners are attached
      parser.write(buffer);
      parser.end();
    });
  }

  /**
   * Processes a TV Series CSV buffer (Hollywood format).
   * TODO: Implement specific parsing logic for TV Series.
   */
  async processTVSeriesCSVStream(buffer: Buffer, uploadMode: 'overwrite' | 'update', onProgress: (count: number) => void): Promise<void> {
    throw new Error("processTVSeriesCSVStream is not yet implemented.");
  }

  /**
   * Processes a Movies CSV buffer (Hollywood format).
   * TODO: Implement specific parsing logic for Movies.
   */
  async processMovieCSVStream(buffer: Buffer, uploadMode: 'overwrite' | 'update', onProgress: (count: number) => void): Promise<void> {
    throw new Error("processMovieCSVStream is not yet implemented.");
  }
}
