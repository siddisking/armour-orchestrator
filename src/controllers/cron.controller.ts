import { NextResponse, NextRequest } from 'next/server';
import { PromotionService } from '../services/promotion.service';
import { normalizeModelId, SUPPORTED_MODELS } from '../utils/constant';

export class CronController {
  private promotionService: PromotionService;

  constructor() {
    this.promotionService = new PromotionService();
  }

  /**
   * Securely handles triggering the weekly L1 to L2 cache promotion pipeline.
   * Validates query/header secrets before executing.
   */
  async handlePromote(req: NextRequest) {
    try {
      const { searchParams } = new URL(req.url);

      // Extract secret from query params, custom header, or Bearer auth header
      const querySecret = searchParams.get('secret');
      const customHeaderSecret = req.headers.get('x-cron-secret');
      
      let bearerSecret = '';
      const authHeader = req.headers.get('authorization');
      if (authHeader && authHeader.startsWith('Bearer ')) {
        bearerSecret = authHeader.split(' ')[1];
      }

      const requestSecret = querySecret || customHeaderSecret || bearerSecret;
      const expectedSecret = process.env.CRON_SECRET || 'super-secret-cron-token';

      if (!requestSecret || requestSecret !== expectedSecret) {
        console.warn(`[CronController] Unauthorized cache promotion attempt.`);
        return NextResponse.json(
          { status: 'error', message: 'Unauthorized' },
          { status: 401 }
        );
      }

      const model = searchParams.get('model') || SUPPORTED_MODELS.QWEN3_14B;
      const modelId = normalizeModelId(model);

      const result = await this.promotionService.promotePopularQueries(modelId);

      return NextResponse.json({
        status: 'success',
        message: 'Cache promotion completed successfully',
        data: result
      });
    } catch (error: any) {
      console.error('[CronController] Promotion trigger failed:', error);
      return NextResponse.json(
        { status: 'error', message: error.message || 'Internal Server Error' },
        { status: 500 }
      );
    }
  }
}
