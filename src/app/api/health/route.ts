import { HealthController } from '../../../controllers/health.controller';

export async function GET() {
  const healthController = new HealthController();
  return healthController.getHealth();
}
