import { NextRequest } from 'next/server';
import { ChatController } from '../../../controllers/chat.controller';

const chatController = new ChatController();

export async function POST(req: NextRequest) {
  return chatController.handleChat(req);
}
