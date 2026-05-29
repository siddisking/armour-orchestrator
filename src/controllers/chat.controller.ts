import { NextResponse, NextRequest } from 'next/server';
import { ChatService } from '../services/chat.service';

export class ChatController {
  private chatService: ChatService;

  constructor() {
    this.chatService = new ChatService();
  }

  /**
   * Helper to build a readable stream response.
   * If an activeChatId is provided, it accumulates the response and commits it to PostgreSQL.
   */
  private async buildChatStreamResponse(
    message: string,
    history: any[],
    activeChatId: string | null,
    provider?: 'gemini' | 'siliconflow'
  ): Promise<Response> {
    const langChainStream = await this.chatService.streamRecommendation(message, history, provider);
    const encoder = new TextEncoder();
    const chatService = this.chatService;

    const readableStream = new ReadableStream({
      async start(controller) {
        let accumulatedResponse = '';
        try {
          for await (const chunk of langChainStream) {
            if (activeChatId) {
              accumulatedResponse += chunk;
            }
            controller.enqueue(encoder.encode(chunk));
          }
          if (activeChatId) {
            // Save model response to database upon successful completion
            await chatService.saveChatMessage(activeChatId, 'model', accumulatedResponse);
          }
          controller.close();
        } catch (err: any) {
          if (err?.message?.includes('GOOGLE_API_KEY') || err?.status === 401 || err?.message?.includes('API key')) {
            const fallback = "It looks like my Gemini API key hasn't been configured yet! I'm running in offline mode. Once you add `GOOGLE_API_KEY` to the environment variables, I'll be fully operational.";
            controller.enqueue(encoder.encode(fallback));
            if (activeChatId) {
              await chatService.saveChatMessage(activeChatId, 'model', fallback);
            }
            controller.close();
          } else {
            controller.error(err);
          }
        }
      }
    });

    const headers: Record<string, string> = {
      'Content-Type': 'text/plain; charset=utf-8',
      'Transfer-Encoding': 'chunked'
    };

    if (activeChatId) {
      headers['Access-Control-Expose-Headers'] = 'X-Chat-Id';
      headers['X-Chat-Id'] = activeChatId;
    }

    return new Response(readableStream, { headers });
  }

  /**
   * Handles POST requests for the unified chat endpoint (stateful member or stateless guest).
   */
  async handleChat(req: NextRequest, user: any | null) {
    try {
      const body = await req.json();
      const { message, history, chatId, provider } = body;

      if (!message) {
        return NextResponse.json(
          { status: 'error', message: 'Message field is required' },
          { status: 400 }
        );
      }

      // Guest Mode (No authenticated user)
      if (!user) {
        return this.buildChatStreamResponse(message, history || [], null, provider);
      }

      // Member Mode (Authenticated user)
      const userId = user.id;
      let activeChatId = chatId;
      let memberHistory: any[] = [];

      if (chatId) {
        try {
          memberHistory = await this.chatService.getConversationHistory(chatId, userId);
        } catch (err: any) {
          if (err.statusCode === 404) {
            return NextResponse.json(
              { status: 'error', message: 'Chat not found or access forbidden' },
              { status: 404 }
            );
          }
          throw err;
        }
      } else {
        const newChat = await this.chatService.createNewConversation(userId, message);
        activeChatId = newChat.id;
      }

      // Save the incoming user message to PostgreSQL
      await this.chatService.saveChatMessage(activeChatId, 'user', message);

      // Return the consolidated response stream
      return this.buildChatStreamResponse(message, memberHistory, activeChatId, provider);

    } catch (error: any) {
      console.error('Chat processing failed:', error);
      return NextResponse.json(
        { status: 'error', message: error.message || 'Internal Server Error' },
        { status: 500 }
      );
    }
  }

  /**
   * GET /api/conversations
   * Fetches all active, non-deleted chat threads belonging to the authenticated user.
   */
  async listConversations(req: NextRequest, user: any) {
    try {
      const conversations = await this.chatService.getUserConversations(user.id);
      return NextResponse.json(conversations);
    } catch (error: any) {
      console.error('Failed to list conversations:', error);
      return NextResponse.json({ error: 'Internal Server Error' }, { status: 500 });
    }
  }

  /**
   * GET /api/conversations/[id]
   * Fetches chronological message history for an active chat thread with user verification.
   */
  async getConversation(req: NextRequest, user: any, chatId: string) {
    try {
      const messages = await this.chatService.getConversationHistory(chatId, user.id);
      return NextResponse.json(messages);
    } catch (error: any) {
      if (error.statusCode === 404) {
        return NextResponse.json({ error: 'Conversation not found' }, { status: 404 });
      }
      console.error('Failed to get conversation:', error);
      return NextResponse.json({ error: 'Internal Server Error' }, { status: 500 });
    }
  }

  /**
   * PATCH /api/conversations/[id]
   * Updates an active conversation thread's title.
   */
  async renameConversation(req: NextRequest, user: any, chatId: string) {
    try {
      const { title } = await req.json();
      if (!title || !title.trim()) {
        return NextResponse.json({ error: 'Title is required' }, { status: 400 });
      }
      await this.chatService.renameConversation(chatId, user.id, title.trim());
      return NextResponse.json({ success: true });
    } catch (error: any) {
      if (error.statusCode === 404) {
        return NextResponse.json({ error: 'Conversation not found' }, { status: 404 });
      }
      console.error('Failed to rename conversation:', error);
      return NextResponse.json({ error: 'Internal Server Error' }, { status: 500 });
    }
  }

  /**
   * DELETE /api/conversations/[id]
   * Performs a logical soft delete of an active conversation thread.
   */
  async deleteConversation(req: NextRequest, user: any, chatId: string) {
    try {
      const success = await this.chatService.deleteConversation(chatId, user.id);
      if (!success) {
        return NextResponse.json({ error: 'Conversation not found' }, { status: 404 });
      }
      return NextResponse.json({ success: true });
    } catch (error: any) {
      console.error('Failed to delete conversation:', error);
      return NextResponse.json({ error: 'Internal Server Error' }, { status: 500 });
    }
  }
}
