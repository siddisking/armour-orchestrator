import { NextResponse, NextRequest } from 'next/server';
import { ChatService } from '../services/chat.service';
import { RedisService } from '../services/redis.service';
import { ModelId, normalizeModelId, CHAT_INTENTS, ChatIntent, MEDIA_TYPES, MediaType } from '../utils/constant';
import { normalizeQuery, isTemporalQuery } from '../utils/helpers';
import { AuthUser } from '../repositories/types';

export class ChatController {
  private chatService: ChatService;
  private redisService: RedisService;

  constructor() {
    this.chatService = new ChatService();
    this.redisService = new RedisService();
  }

  /**
   * Helper to build a readable stream response.
   * If an activeChatId is provided, it accumulates the response and commits it to PostgreSQL.
   */
  private async buildChatStreamResponse(
    message: string,
    history: any[],
    activeChatId: string | null,
    modelId: ModelId,
    intent: ChatIntent,
    mediaType: MediaType = MEDIA_TYPES.ANIME,
    reformulatedQuery?: string
  ): Promise<Response> {
    const langChainStream = intent === CHAT_INTENTS.DIRECT_CHAT
      ? await this.chatService.streamDirectChat(message, history, modelId)
      : await this.chatService.streamRecommendation(message, history, modelId, mediaType, reformulatedQuery);
    const encoder = new TextEncoder();
    const chatService = this.chatService;
    const redisService = this.redisService;

    const readableStream = new ReadableStream({
      async start(controller) {
        let accumulatedResponse = '';
        try {
          for await (const chunk of langChainStream) {
            accumulatedResponse += chunk;
            controller.enqueue(encoder.encode(chunk));
          }
          if (activeChatId) {
            // Save model response to database upon successful completion with intent in metadata
            await chatService.saveChatMessage(activeChatId, 'model', accumulatedResponse, { intent });
          }

          // If this is a stateless recommendation (no conversation history) and non-temporal, cache the response in Redis
          const isCacheableQuery = !isTemporalQuery(message);
          console.log(`[L1 Cache Write Check] intent: ${intent}, history length: ${history?.length || 0}, isCacheable: ${isCacheableQuery}`);
          if (intent === CHAT_INTENTS.VECTOR_SEARCH && (!history || history.length === 0) && isCacheableQuery) {
            try {
              console.log(`[L1 Cache Write] Writing key for query: "${message}"`);
              // Cache the result in Redis via the service
              await redisService.setExactRecommendationCache(message, accumulatedResponse);
              console.log(`[L1 Cache Write] Successfully set key for query: "${message}". Length: ${accumulatedResponse.length}`);
              // Track popularity of queries via the service
              await redisService.incrementQueryLeaderboard(message);
              console.log(`[L1 Cache Write] Successfully incremented leaderboard for query: "${message}"`);
            } catch (cacheErr) {
              console.warn("[Cache Error] Failed to write response to L1 cache:", cacheErr);
            }
          }

          controller.close();
        } catch (err: any) {
          if (err?.message?.includes('GOOGLE_API_KEY') || err?.status === 401 || err?.message?.includes('API key')) {
            const fallback = "It looks like my Gemini API key hasn't been configured yet! I'm running in offline mode. Once you add `GOOGLE_API_KEY` to the environment variables, I'll be fully operational.";
            controller.enqueue(encoder.encode(fallback));
            if (activeChatId) {
              await chatService.saveChatMessage(activeChatId, 'model', fallback, { intent });
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
      'Transfer-Encoding': 'chunked',
      'X-Cache': 'MISS'
    };

    if (activeChatId) {
      headers['Access-Control-Expose-Headers'] = 'X-Chat-Id';
      headers['X-Chat-Id'] = activeChatId;
    }

    return new Response(readableStream, { headers });
  }

  /**
   * Helper to build a readable stream response from a cached Redis response.
   */
  private buildCachedStreamResponse(
    cachedText: string,
    activeChatId: string | null,
    intent: ChatIntent
  ): Response {
    const encoder = new TextEncoder();
    const chatService = this.chatService;

    const readableStream = new ReadableStream({
      async start(controller) {
        try {
          // Stream the entire pre-saved response as a single chunk instantly
          controller.enqueue(encoder.encode(cachedText));
          if (activeChatId) {
            // Save model response to PostgreSQL database
            await chatService.saveChatMessage(activeChatId, 'model', cachedText, { intent });
          }
          controller.close();
        } catch (err: any) {
          controller.error(err);
        }
      }
    });

    const headers: Record<string, string> = {
      'Content-Type': 'text/plain; charset=utf-8',
      'Transfer-Encoding': 'chunked',
      'X-Cache': 'HIT'
    };

    if (activeChatId) {
      headers['Access-Control-Expose-Headers'] = 'X-Chat-Id';
      headers['X-Chat-Id'] = activeChatId;
    }

    return new Response(readableStream, { headers });
  }

  /**
   * Helper to build a readable stream response for under-development features.
   */
  private async buildUnderDevelopmentResponse(
    activeChatId: string | null,
    intent: ChatIntent
  ): Promise<Response> {
    const encoder = new TextEncoder();
    const chatService = this.chatService;
    const reply = "This feature is still under development, please check with us later, meanwhile look for any animated series (anime) on our platform";

    const readableStream = new ReadableStream({
      async start(controller) {
        try {
          controller.enqueue(encoder.encode(reply));
          if (activeChatId) {
            await chatService.saveChatMessage(activeChatId, 'model', reply, { intent });
          }
          controller.close();
        } catch (err: any) {
          controller.error(err);
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
  async handleChat(req: NextRequest, user: AuthUser | null) {
    try {
      const body = await req.json();
      const { message, history, chatId, provider, model, mediaType: rawMediaType } = body;
      const mediaType: MediaType = (rawMediaType === MEDIA_TYPES.MOVIES)
        ? MEDIA_TYPES.MOVIES
        : ((rawMediaType === MEDIA_TYPES.SERIES) ? MEDIA_TYPES.SERIES : MEDIA_TYPES.ANIME);

      if (!message) {
        return NextResponse.json(
          { status: 'error', message: 'Message field is required' },
          { status: 400 }
        );
      }

      const requestedModel = model || provider || '';
      const modelId = normalizeModelId(requestedModel);
      const normalizedQuery = normalizeQuery(message);

      // Determine the conversation history array
      let activeHistory: any[] = [];
      let activeChatId = chatId;

      if (user) {
        if (chatId) {
          try {
            activeHistory = await this.chatService.getConversationHistory(chatId, user.id);
          } catch (err: any) {
            if (err.statusCode === 404) {
              return NextResponse.json(
                { status: 'error', message: 'Chat not found or access forbidden' },
                { status: 404 }
              );
            }
            throw err;
          }
        }
      } else {
        activeHistory = history || [];
      }

      // Route the intent first
      const { intent, reformulatedQuery } = await this.chatService.routeIntent(normalizedQuery, activeHistory, mediaType, modelId);

      // L1 Cache Check: Only cache stateless recommendation searches (no history) and non-temporal queries
      const isCacheableQuery = !isTemporalQuery(normalizedQuery);
      console.log(`[L1 Cache Check] query: "${normalizedQuery}", intent: ${intent}, activeHistory length: ${activeHistory.length}, isCacheable: ${isCacheableQuery}`);
      if (intent === CHAT_INTENTS.VECTOR_SEARCH && activeHistory.length === 0 && isCacheableQuery) {
        try {
          const cachedResponse = await this.redisService.getExactRecommendationCache(normalizedQuery);
          if (cachedResponse) {
            console.log(`[Cache Hit] L1 exact cache hit for query: "${normalizedQuery}"`);

            // Increment popularity of queries on hits too
            await this.redisService.incrementQueryLeaderboard(normalizedQuery);

            if (user) {
              // Create chat thread if guest started a conversation
              if (!activeChatId) {
                const newChat = await this.chatService.createNewConversation(user.id, message);
                activeChatId = newChat.id;
              }
              // Save user message to PostgreSQL (with original user formatting)
              await this.chatService.saveChatMessage(activeChatId, 'user', message, { intent });
              return this.buildCachedStreamResponse(cachedResponse, activeChatId, intent);
            } else {
              return this.buildCachedStreamResponse(cachedResponse, null, intent);
            }
          } else {
            console.log(`[L1 Cache Check] Cache miss for query: "${normalizedQuery}"`);
          }
        } catch (cacheErr) {
          console.warn("[Cache Error] Redis lookup failed, failing open:", cacheErr);
        }
      }

      // Guest Mode (No authenticated user) - Cache Miss path
      if (!user) {
        if (intent === CHAT_INTENTS.UNSUPPORTED) {
          return this.buildUnderDevelopmentResponse(null, intent);
        }
        return this.buildChatStreamResponse(normalizedQuery, activeHistory, null, modelId, intent, mediaType, reformulatedQuery);
      }

      // Member Mode (Authenticated user) - Cache Miss path
      if (!activeChatId) {
        const newChat = await this.chatService.createNewConversation(user.id, message);
        activeChatId = newChat.id;
      }

      // Save the incoming user message to PostgreSQL with the deduced intent metadata (original casing preserved)
      await this.chatService.saveChatMessage(activeChatId, 'user', message, { intent });

      if (intent === CHAT_INTENTS.UNSUPPORTED) {
        return this.buildUnderDevelopmentResponse(activeChatId, intent);
      }

      // Return the consolidated response stream
      return this.buildChatStreamResponse(normalizedQuery, activeHistory, activeChatId, modelId, intent, mediaType, reformulatedQuery);

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
  async listConversations(req: NextRequest, user: AuthUser) {
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
  async getConversation(req: NextRequest, user: AuthUser, chatId: string) {
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
  async renameConversation(req: NextRequest, user: AuthUser, chatId: string) {
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
  async deleteConversation(req: NextRequest, user: AuthUser, chatId: string) {
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
