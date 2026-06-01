import { NextRequest, NextResponse } from 'next/server';
import { ChatController } from '../../../../controllers/chat.controller';
import jwt from 'jsonwebtoken';

function getUserFromReq(req: NextRequest) {
  const authHeader = req.headers.get('authorization');
  if (!authHeader || !authHeader.startsWith('Bearer ')) {
    return null;
  }
  const token = authHeader.split(' ')[1];
  try {
    const secret = process.env.NEXTAUTH_SECRET || 'super-secret-key-replace-me-in-production';
    return jwt.verify(token, secret) as any;
  } catch (err) {
    return null;
  }
}

export async function GET(
  req: NextRequest,
  context: { params: { id: string } }
) {
  const user = getUserFromReq(req);
  if (!user) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  const { id } = context.params;
  const chatController = new ChatController();
  return chatController.getConversation(req, user, id);
}

export async function PATCH(
  req: NextRequest,
  context: { params: { id: string } }
) {
  const user = getUserFromReq(req);
  if (!user) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  const { id } = context.params;
  const chatController = new ChatController();
  return chatController.renameConversation(req, user, id);
}

export async function DELETE(
  req: NextRequest,
  context: { params: { id: string } }
) {
  const user = getUserFromReq(req);
  if (!user) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  const { id } = context.params;
  const chatController = new ChatController();
  return chatController.deleteConversation(req, user, id);
}
