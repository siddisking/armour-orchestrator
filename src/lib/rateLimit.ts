import { NextRequest, NextResponse } from 'next/server';
import { redis } from './redis';
import { RATE_LIMITS } from '../utils/constant';

export interface RateLimitResult {
  allowed: boolean;
  remainingTokens: number;
}

/**
 * Checks rate limit by incrementing a request counter in Redis.
 * @param ipOrUserId Unique identifier (IP or User ID)
 * @param limit Max requests allowed per minute (e.g. 10)
 */
export async function checkRateLimit(
  ipOrUserId: string,
  limit: number = RATE_LIMITS.DEFAULT_LIMIT
): Promise<RateLimitResult> {
  const key = `ratelimit:${ipOrUserId}`;

  try {
    // Atomically set key to "1" with 60s expiry ONLY if it does not exist
    const setCheck = await redis.set(key, '1', 'EX', 60, 'NX');
    let count = 1;

    if (setCheck !== 'OK') {
      // Key already exists, so we just increment it
      count = await redis.incr(key);
    }

    return {
      allowed: count <= limit,
      remainingTokens: Math.max(0, limit - count),
    };
  } catch (error) {
    console.error('Rate limiter execution failed, failing open:', error);
    return {
      allowed: true,
      remainingTokens: limit,
    };
  }
}

/**
 * Higher-Order function to apply rate limiting to Next.js API routes.
 */
export function withRateLimit<T extends unknown[]>(
  handler: (req: NextRequest, ...args: T) => Promise<Response> | Response,
  options?: { rate?: number }
) {
  return async (req: NextRequest, ...args: T): Promise<Response> => {
    const ip = req.ip || req.headers.get('x-forwarded-for')?.split(',')[0].trim() || '127.0.0.1';
    const identifier = `ip:${ip}`;

    const limit = options?.rate ?? RATE_LIMITS.DEFAULT_LIMIT; // Uses custom rate or default of 30

    const rateLimit = await checkRateLimit(identifier, limit);

    if (!rateLimit.allowed) {
      return NextResponse.json(
        { error: 'Too Many Requests' },
        {
          status: 429,
          headers: {
            'Retry-After': '5', // Suggest waiting 5 seconds before retrying
            'X-RateLimit-Limit': limit.toString(),
            'X-RateLimit-Remaining': rateLimit.remainingTokens.toString(),
          },
        }
      );
    }

    const response = await handler(req, ...args);
    response.headers.set('X-RateLimit-Limit', limit.toString());
    response.headers.set('X-RateLimit-Remaining', rateLimit.remainingTokens.toString());
    return response;
  };
}



