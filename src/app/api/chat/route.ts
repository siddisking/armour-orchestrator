import { NextRequest, NextResponse } from 'next/server';
import { ChatController } from '../../../controllers/chat.controller';
import jwt from 'jsonwebtoken';

export async function POST(req: NextRequest) {
  const chatController = new ChatController();
  const authHeader = req.headers.get('authorization');
  let user = null;

  if (authHeader && authHeader.startsWith('Bearer ')) {
    const token = authHeader.split(' ')[1];
    try {
      const secret = process.env.NEXTAUTH_SECRET || 'super-secret-key-replace-me-in-production';
      user = jwt.verify(token, secret) as any;
    } catch (err) {
      return NextResponse.json({ error: 'Unauthorized: Invalid token' }, { status: 401 });
    }
  }

  return chatController.handleChat(req, user);
}
