import { HealthController } from '../../../controllers/health.controller';

// Initialize the controller once
const healthController = new HealthController();

export async function GET() {
  return healthController.getHealth();
}
