import { NextRequest } from 'next/server';
import { IngestController } from '../../../controllers/ingest.controller';
import { withAuth } from '../../../lib/authWrapper';

// Wrap the route handler, explicitly requiring the 'SuperAdmin' role.
export const POST = withAuth('SuperAdmin', async (req: NextRequest) => {
  const ingestController = new IngestController();
  return ingestController.handleIngest(req);
});
