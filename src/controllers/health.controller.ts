import { NextResponse } from 'next/server';
import { HealthService } from '../services/health.service';

export class HealthController {
  private healthService: HealthService;

  constructor() {
    this.healthService = new HealthService();
  }

  /**
   * Handles GET requests for the health endpoint.
   */
  async getHealth() {
    try {
      const healthData = await this.healthService.checkHealth();
      return NextResponse.json(healthData, { status: 200 });
    } catch (error) {
      console.error('Healthcheck failed:', error);
      return NextResponse.json(
        { status: 'error', message: 'Internal Server Error' },
        { status: 500 }
      );
    }
  }
}
