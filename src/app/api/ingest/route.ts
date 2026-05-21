import { NextRequest } from 'next/server';
import { IngestController } from '../../../controllers/ingest.controller';

const ingestController = new IngestController();

export async function POST(req: NextRequest) {
  return ingestController.handleIngest(req);
}
