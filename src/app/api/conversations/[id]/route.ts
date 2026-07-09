import { NextRequest, NextResponse } from 'next/server';
import { ChatController } from '../../../../controllers/chat.controller';
import { withRateLimit } from '../../../../lib/rateLimit';
import { AuthUser } from '../../../../repositories/types';
import { RATE_LIMITS } from '../../../../utils/constant';
import jwt from 'jsonwebtoken';

function getUserFromReq(req: NextRequest): AuthUser | null {
  const authHeader = req.headers.get('authorization');
  if (!authHeader || !authHeader.startsWith('Bearer ')) {
    return null;
  }
  const token = authHeader.split(' ')[1];
  try {
    const secret = process.env.NEXTAUTH_SECRET || 'super-secret-key-replace-me-in-production';
    return jwt.verify(token, secret) as unknown as AuthUser;
  } catch {
    return null;
  }
}

export const GET = withRateLimit(async (
  req: NextRequest,
  context: { params: { id: string } }
) => {
  const user = getUserFromReq(req);
  if (!user) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  const { id } = context.params;
  const chatController = new ChatController();
  return chatController.getConversation(req, user, id);
}, { key: RATE_LIMITS.KEYS.CONVERSATIONS_DETAIL });

export const PATCH = withRateLimit(async (
  req: NextRequest,
  context: { params: { id: string } }
) => {
  const user = getUserFromReq(req);
  if (!user) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  const { id } = context.params;
  const chatController = new ChatController();
  return chatController.renameConversation(req, user, id);
}, { key: RATE_LIMITS.KEYS.CONVERSATIONS_DETAIL });

export const DELETE = withRateLimit(async (
  req: NextRequest,
  context: { params: { id: string } }
) => {
  const user = getUserFromReq(req);
  if (!user) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  const { id } = context.params;
  const chatController = new ChatController();
  return chatController.deleteConversation(req, user, id);
}, { key: RATE_LIMITS.KEYS.CONVERSATIONS_DETAIL });

