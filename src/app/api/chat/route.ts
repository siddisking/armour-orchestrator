import { NextRequest, NextResponse } from 'next/server';
import { ChatController } from '../../../controllers/chat.controller';
import { withRateLimit } from '../../../lib/rateLimit';
import { RATE_LIMITS } from '../../../utils/constant';
import { AuthUser } from '../../../repositories/types';
import jwt from 'jsonwebtoken';

export const POST = withRateLimit(async (req: NextRequest) => {
  const authHeader = req.headers.get('authorization');
  let user: AuthUser | null = null;

  if (authHeader && authHeader.startsWith('Bearer ')) {
    const token = authHeader.split(' ')[1];
    try {
      const secret = process.env.NEXTAUTH_SECRET || 'super-secret-key-replace-me-in-production';
      user = jwt.verify(token, secret) as unknown as AuthUser;
    } catch {
      return NextResponse.json({ error: 'Unauthorized: Invalid token' }, { status: 401 });
    }
  }

  const chatController = new ChatController();
  return chatController.handleChat(req, user);
}, { rate: RATE_LIMITS.CHAT_LIMIT, key: RATE_LIMITS.KEYS.CHAT });

