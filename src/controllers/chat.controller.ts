import { NextResponse, NextRequest } from 'next/server';
import { ChatService } from '../services/chat.service';
import { RedisService } from '../services/redis.service';
import { ModelId, normalizeModelId, CHAT_INTENTS, ChatIntent, ROUTER_TOOL_NAMES, MEDIA_TYPES, MediaType, MODEL_REGISTRY, DEFAULT_MODEL_ID } from '../utils/constant';
import { normalizeQuery, isTemporalQuery } from '../utils/helpers';
import { SemanticCacheRepository } from '../repositories/semantic-cache.repository';
import { AnimeDocumentRepository } from '../repositories/anime-document.repository';
import { AuthUser } from '../repositories/types';
import { compiledChatGraph } from '../services/chat.graph';

const extractTitleFromContent = (content: string): string => {
  const match = content.match(/^Title:\s*(.*)$/m);
  return match ? match[1].trim() : '';
};

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
    langChainStream: any,
    message: string,
    history: any[],
    activeChatId: string | null,
    resolvedModelName: string,
    intent: ChatIntent,
    requestStart?: number
  ): Promise<Response> {
    const encoder = new TextEncoder();
    const chatService = this.chatService;
    const redisService = this.redisService;

    const readableStream = new ReadableStream({
      async start(controller) {
        let accumulatedResponse = '';
        let isFirstToken = true;
        try {
          for await (const chunk of langChainStream) {
            if (isFirstToken && requestStart) {
              const textModel = MODEL_REGISTRY[resolvedModelName as ModelId]?.textModel || resolvedModelName;
              const latencySec = ((Date.now() - requestStart) / 1000).toFixed(2);
              console.log(`[TTFT] Time to First Token (Total latency): ${latencySec}s | Model: ${textModel}`);
              isFirstToken = false;
            }
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
    const requestStart = Date.now();
    try {
      const body = await req.json();
      const { message, history, chatId, mediaType: rawMediaType } = body;
      const mediaType: MediaType = (rawMediaType === MEDIA_TYPES.MOVIES)
        ? MEDIA_TYPES.MOVIES
        : ((rawMediaType === MEDIA_TYPES.SERIES) ? MEDIA_TYPES.SERIES : MEDIA_TYPES.ANIME);

      if (mediaType === MEDIA_TYPES.MOVIES || mediaType === MEDIA_TYPES.SERIES) {
        console.log(`Step 1 & 2: Skipped (Unsupported MediaType: ${mediaType})`);
        return this.buildUnderDevelopmentResponse(chatId, CHAT_INTENTS.UNSUPPORTED);
      }

      if (!message) {
        return NextResponse.json(
          { status: 'error', message: 'Message field is required' },
          { status: 400 }
        );
      }

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

      // 1. Execute the LangGraph workflow
      const isCacheableQuery = !isTemporalQuery(normalizedQuery) && activeHistory.length === 0;
      const resultState = await compiledChatGraph.invoke(
        {
          message,
          history: activeHistory,
          chatId: activeChatId,
          mediaType,
          isCacheable: isCacheableQuery,
          normalizedQuery,
          requestStart
        }
      );

      const intent = resultState.intent || CHAT_INTENTS.DIRECT_CHAT;

      // Handle L1/L2 Cache Hit from graph state
      if (resultState.cachedResponse) {
        if (user) {
          if (!activeChatId) {
            const newChat = await this.chatService.createNewConversation(user.id, message);
            activeChatId = newChat.id;
          }
          await this.chatService.saveChatMessage(activeChatId, 'user', message, { intent: CHAT_INTENTS.VECTOR_SEARCH });
          return this.buildCachedStreamResponse(resultState.cachedResponse, activeChatId, CHAT_INTENTS.VECTOR_SEARCH);
        } else {
          return this.buildCachedStreamResponse(resultState.cachedResponse, null, CHAT_INTENTS.VECTOR_SEARCH);
        }
      }

      // Guest Mode (No authenticated user) - Cache Miss path
      if (!user) {
        if (intent === CHAT_INTENTS.UNSUPPORTED) {
          return this.buildUnderDevelopmentResponse(null, intent);
        }
        return this.buildChatStreamResponse(
          resultState.responseStream,
          normalizedQuery,
          activeHistory,
          null,
          resultState.safetyModelId || resultState.modelId,
          intent,
          requestStart
        );
      }

      // Member Mode (Authenticated user) - Cache Miss path
      if (!activeChatId) {
        const newChat = await this.chatService.createNewConversation(user.id, message);
        activeChatId = newChat.id;
      }

      // Save user message (and model reply if factual lookup) to database
      await this.chatService.saveChatMessage(
        activeChatId, 
        'user', 
        message, 
        { intent: intent === CHAT_INTENTS.FACTUAL_LOOKUP ? CHAT_INTENTS.VECTOR_SEARCH : intent }
      );

      if (intent === CHAT_INTENTS.UNSUPPORTED) {
        return this.buildUnderDevelopmentResponse(activeChatId, intent);
      }

      if (intent === CHAT_INTENTS.FACTUAL_LOOKUP) {
        // Collect factual lookup plain text from the async generator to write model reply to chat DB
        let replyText = "";
        for await (const chunk of resultState.responseStream) {
          replyText += chunk;
        }
        await this.chatService.saveChatMessage(activeChatId, 'model', replyText, { intent: CHAT_INTENTS.VECTOR_SEARCH });
        return new Response(new TextEncoder().encode(replyText), {
          headers: {
            'Content-Type': 'text/plain; charset=utf-8',
            'X-Cache': 'MISS',
            ...(activeChatId ? { 'X-Chat-Id': activeChatId, 'Access-Control-Expose-Headers': 'X-Chat-Id' } : {})
          }
        });
      }

      // Return the consolidated response stream
      return this.buildChatStreamResponse(
        resultState.responseStream,
        normalizedQuery,
        activeHistory,
        activeChatId,
        resultState.safetyModelId || resultState.modelId,
        intent,
        requestStart
      );

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
