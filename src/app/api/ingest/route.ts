import { NextRequest } from 'next/server';
import { IngestController } from '../../../controllers/ingest.controller';
import { withAuth } from '../../../lib/authWrapper';

const ingestController = new IngestController();

// Wrap the route handler, explicitly requiring the 'SuperAdmin' role.
export const POST = withAuth('SuperAdmin', async (req: NextRequest) => {
  return ingestController.handleIngest(req);
});
