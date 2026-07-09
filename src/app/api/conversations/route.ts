import { NextRequest, NextResponse } from 'next/server';
import { ChatController } from '../../../controllers/chat.controller';
import { withRateLimit } from '../../../lib/rateLimit';
import jwt from 'jsonwebtoken';

const chatController = new ChatController();

function getUserFromReq(req: NextRequest) {
  const authHeader = req.headers.get('authorization');
  if (!authHeader || !authHeader.startsWith('Bearer ')) {
    return null;
  }
  const token = authHeader.split(' ')[1];
  try {
    const secret = process.env.NEXTAUTH_SECRET || 'super-secret-key-replace-me-in-production';
    return jwt.verify(token, secret) as jwt.JwtPayload;
  } catch (_err) {
    return null;
  }
}

export const GET = withRateLimit(async (req: NextRequest) => {
  const user = getUserFromReq(req);
  if (!user) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  return chatController.listConversations(req, user);
});

