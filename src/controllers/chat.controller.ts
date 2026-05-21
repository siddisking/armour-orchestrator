import { NextResponse, NextRequest } from 'next/server';
import { ChatService } from '../services/chat.service';

export class ChatController {
  private chatService: ChatService;

  constructor() {
    this.chatService = new ChatService();
  }

  /**
   * Handles POST requests for the chat endpoint.
   */
  async handleChat(req: NextRequest) {
    try {
      const body = await req.json();
      const { message } = body;

      if (!message) {
        return NextResponse.json(
          { status: 'error', message: 'Message field is required' },
          { status: 400 }
        );
      }


      // Handle streaming response
      const langChainStream = await this.chatService.streamRecommendation(message);
      const encoder = new TextEncoder();

      const readableStream = new ReadableStream({
        async start(controller) {
          try {
            for await (const chunk of langChainStream) {
              controller.enqueue(encoder.encode(chunk));
            }
            controller.close();
          } catch (err: any) {
            // Handle offline fallback during stream if API key is missing
            if (err?.message?.includes('GOOGLE_API_KEY') || err?.status === 401 || err?.message?.includes('API key')) {
              controller.enqueue(encoder.encode("It looks like my Gemini API key hasn't been configured yet! I'm running in offline mode. Once you add `GOOGLE_API_KEY` to the environment variables, I'll be fully operational."));
              controller.close();
            } else {
              controller.error(err);
            }
          }
        }
      });

      return new Response(readableStream, {
        headers: {
          'Content-Type': 'text/plain; charset=utf-8',
          'Transfer-Encoding': 'chunked'
        },
      });


      // Handle standard JSON response
      const response = await this.chatService.generateRecommendation(message);

      return NextResponse.json({
        status: 'success',
        data: { reply: response }
      }, { status: 200 });

    } catch (error: any) {
      console.error('Chat processing failed:', error);
      return NextResponse.json(
        { status: 'error', message: error.message || 'Internal Server Error' },
        { status: 500 }
      );
    }
  }
}
