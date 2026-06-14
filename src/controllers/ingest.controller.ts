import { NextRequest, NextResponse } from 'next/server';
import { IngestService } from '../services/ingest.service';
import { SUPPORTED_MODELS, INGESTION_TARGETS, MEDIA_TYPES, MediaType } from '../utils/constant';

export class IngestController {
  private ingestService: IngestService;

  constructor() {
    this.ingestService = new IngestService();
  }

  async handleIngest(req: NextRequest) {
    try {
      const formData = await req.formData();
      const file = formData.get('file') as File;
      const rawMediaType = formData.get('mediaType') as string;
      const mediaType: MediaType = (rawMediaType === MEDIA_TYPES.MOVIES) ? MEDIA_TYPES.MOVIES : ((rawMediaType === MEDIA_TYPES.SERIES) ? MEDIA_TYPES.SERIES : MEDIA_TYPES.ANIME);
      const uploadMode = (formData.get('uploadMode') as 'overwrite' | 'update') || 'update';
      const rawProvider = (formData.get('vectorProvider') as string) || INGESTION_TARGETS.GEMINI;
      const vectorProvider =
        rawProvider === SUPPORTED_MODELS.QWEN_7B || rawProvider === INGESTION_TARGETS.QWEN
          ? INGESTION_TARGETS.QWEN
          : (rawProvider === INGESTION_TARGETS.BOTH ? INGESTION_TARGETS.BOTH : INGESTION_TARGETS.GEMINI);

      if (!file) {
        return NextResponse.json(
          { status: 'error', message: 'No file uploaded' },
          { status: 400 }
        );
      }

      // Read file into an ArrayBuffer and convert to Node Buffer
      const arrayBuffer = await file.arrayBuffer();
      const buffer = Buffer.from(arrayBuffer);

      const encoder = new TextEncoder();
      const service = this.ingestService; // Capture context

      const readableStream = new ReadableStream({
        async start(controller) {
          try {
            controller.enqueue(encoder.encode('data: {"status":"started","message":"Ingestion started"}\n\n'));

            if (mediaType === MEDIA_TYPES.ANIME) {
              await service.processTVAnimeCSVStream(buffer, uploadMode, vectorProvider, (count) => {
                const progressData = JSON.stringify({ status: 'progress', count });
                controller.enqueue(encoder.encode(`data: ${progressData}\n\n`));
              }, (msg) => {
                const logData = JSON.stringify({ status: 'log', message: msg });
                controller.enqueue(encoder.encode(`data: ${logData}\n\n`));
              });
            } else if (mediaType === MEDIA_TYPES.SERIES) {
              await service.processTVSeriesCSVStream(buffer, uploadMode, (count) => {
                const progressData = JSON.stringify({ status: 'progress', count });
                controller.enqueue(encoder.encode(`data: ${progressData}\n\n`));
              });
            } else if (mediaType === MEDIA_TYPES.MOVIES) {
              await service.processMovieCSVStream(buffer, uploadMode, vectorProvider, (count) => {
                const progressData = JSON.stringify({ status: 'progress', count });
                controller.enqueue(encoder.encode(`data: ${progressData}\n\n`));
              }, (msg) => {
                const logData = JSON.stringify({ status: 'log', message: msg });
                controller.enqueue(encoder.encode(`data: ${logData}\n\n`));
              });
            } else {
              throw new Error(`Media type '${mediaType}' is not supported.`);
            }

            // Final completion message
            controller.enqueue(encoder.encode('data: {"status":"complete","message":"Ingestion finished successfully!"}\n\n'));
            controller.close();
          } catch (err: any) {
            console.error("Ingestion stream error:", err);
            const errorData = JSON.stringify({ status: 'error', message: err.message });
            controller.enqueue(encoder.encode(`data: ${errorData}\n\n`));
            controller.close();
          }
        }
      });

      return new Response(readableStream, {
        headers: {
          'Content-Type': 'text/event-stream',
          'Cache-Control': 'no-cache',
          'Connection': 'keep-alive',
        },
      });

    } catch (error: any) {
      console.error('Ingest processing failed:', error);
      return NextResponse.json(
        { status: 'error', message: error.message || 'Internal Server Error' },
        { status: 500 }
      );
    }
  }
}
