import { NextRequest } from 'next/server';
import { CronController } from '../../../../controllers/cron.controller';

export const dynamic = 'force-dynamic';

const cronController = new CronController();

export async function GET(req: NextRequest) {
  return await cronController.handlePromote(req);
}
