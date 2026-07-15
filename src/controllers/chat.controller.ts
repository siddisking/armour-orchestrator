import { NextResponse, NextRequest } from 'next/server';
import { ChatService } from '../services/chat.service';
import { RedisService } from '../services/redis.service';
import { ModelId, normalizeModelId, CHAT_INTENTS, ChatIntent, ROUTER_TOOL_NAMES, MEDIA_TYPES, MediaType, MODEL_REGISTRY } from '../utils/constant';
import { normalizeQuery, isTemporalQuery } from '../utils/helpers';
import { SemanticCacheRepository } from '../repositories/semantic-cache.repository';
import { AnimeDocumentRepository } from '../repositories/anime-document.repository';
import { AuthUser } from '../repositories/types';

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
    message: string,
    history: any[],
    activeChatId: string | null,
    modelId: ModelId,
    intent: ChatIntent,
    mediaType: MediaType = MEDIA_TYPES.ANIME,
    reformulatedQuery?: string,
    preExtractedFilter?: Record<string, any>,
    requestStart?: number
  ): Promise<Response> {
    const langChainStream = intent === CHAT_INTENTS.DIRECT_CHAT
      ? await this.chatService.streamDirectChat(message, history, modelId)
      : await this.chatService.streamRecommendation(message, history, modelId, mediaType, reformulatedQuery, preExtractedFilter);
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
              const textModel = MODEL_REGISTRY[modelId]?.textModel || modelId;
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
      const { message, history, chatId, provider, model, mediaType: rawMediaType } = body;
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

      const requestedModel = model || provider || '';
      const modelId = normalizeModelId(requestedModel);
      const textModel = MODEL_REGISTRY[modelId]?.textModel || modelId;
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

      // 1 & 2. L1 (Redis) and L2 (Qdrant) Cache Checks BEFORE any LLM tool call to avoid router latency
      const cacheCheckStart = Date.now();
      const isCacheableQuery = !isTemporalQuery(normalizedQuery) && activeHistory.length === 0;
      if (isCacheableQuery) {
        // L1 Cache Check
        try {
          const cachedResponse = await this.redisService.getExactRecommendationCache(normalizedQuery);
          if (cachedResponse) {
            console.log(`Step 1: L1 exact cache check - Hit! (Bypassed router) | Total time: ${Date.now() - cacheCheckStart}ms`);

            // Increment popularity of queries on hits too
            await this.redisService.incrementQueryLeaderboard(normalizedQuery);

            if (user) {
              // Create chat thread if guest started a conversation
              if (!activeChatId) {
                const newChat = await this.chatService.createNewConversation(user.id, message);
                activeChatId = newChat.id;
              }
              // Save user message to PostgreSQL
              await this.chatService.saveChatMessage(activeChatId, 'user', message, { intent: CHAT_INTENTS.VECTOR_SEARCH });
              return this.buildCachedStreamResponse(cachedResponse, activeChatId, CHAT_INTENTS.VECTOR_SEARCH);
            } else {
              return this.buildCachedStreamResponse(cachedResponse, null, CHAT_INTENTS.VECTOR_SEARCH);
            }
          }
        } catch (cacheErr) {
          console.warn("[Cache Error] L1 exact cache check failed, falling back:", cacheErr);
        }
        console.log(`Step 1: L1 exact cache check - Miss | Total time: ${Date.now() - cacheCheckStart}ms`);

        // L2 Cache Check
        const l2Start = Date.now();
        try {
          console.log(`[L2 Cache Check] Trying L2 semantic cache for query: "${normalizedQuery}"...`);
          const semanticCacheRepo = new SemanticCacheRepository(modelId);
          const cachedResponse = await semanticCacheRepo.retrieveCache(normalizedQuery);
          if (cachedResponse) {
            console.log(`Step 2: L2 semantic cache check - Hit! (Bypassed router) | Model: ${textModel} | Total time: ${Date.now() - l2Start}ms`);

            // Increment popularity of queries on hits too
            await this.redisService.incrementQueryLeaderboard(normalizedQuery);

            if (user) {
              // Create chat thread if guest started a conversation
              if (!activeChatId) {
                const newChat = await this.chatService.createNewConversation(user.id, message);
                activeChatId = newChat.id;
              }
              // Save user message to PostgreSQL
              await this.chatService.saveChatMessage(activeChatId, 'user', message, { intent: CHAT_INTENTS.VECTOR_SEARCH });
              return this.buildCachedStreamResponse(cachedResponse, activeChatId, CHAT_INTENTS.VECTOR_SEARCH);
            } else {
              return this.buildCachedStreamResponse(cachedResponse, null, CHAT_INTENTS.VECTOR_SEARCH);
            }
          } else {
            console.log(`Step 2: L2 semantic cache check - Miss | Model: ${textModel} | Total time: ${Date.now() - l2Start}ms`);
          }
        } catch (cacheErr) {
          console.warn("[Cache Error] L2 semantic cache check failed, falling back:", cacheErr);
        }
      } else {
        console.log(`Step 1: L1 exact cache check - Miss | Total time: 0ms`);
        console.log(`Step 2: L2 semantic cache check - Skipped | Model: ${textModel} | Total time: 0ms`);
      }

      // 3. Route the intent and extract metadata filters in a single hop using tool calling
      const routerStart = Date.now();
      const { intent, toolCall, reformulatedQuery } = await this.chatService.routeAndParseQuery(
        normalizedQuery,
        activeHistory,
        mediaType,
        modelId
      );
      console.log(`Step 3: ChatService.routeAndParseQuery (Tool Router classification) - Intent: ${intent} | Model: ${textModel} | Total time: ${Date.now() - routerStart}ms`);

      // Handle direct PostgreSQL factual database lookup bypassing vector store completely
      if (intent === CHAT_INTENTS.FACTUAL_LOOKUP && toolCall && toolCall.name === ROUTER_TOOL_NAMES.FACTUAL_LOOKUP) {
        const factualStart = Date.now();
        const { anime_title, attribute } = toolCall.args;
        console.log(`[Factual Lookup] Title: "${anime_title}", Attribute: "${attribute}"`);
        
        const animeRepo = new AnimeDocumentRepository();
        const doc = await animeRepo.findAnimeByTitle(anime_title, modelId);
        
        let replyText = '';
        if (doc) {
          const matchedTitle = extractTitleFromContent(doc.content) || anime_title;
          const val = attribute === 'all' 
            ? JSON.stringify(doc.metadata) 
            : doc.metadata[attribute];

          if (val !== undefined && val !== null && val !== '') {
            const attrLabel = attribute.charAt(0).toUpperCase() + attribute.slice(1);
            replyText = `**${matchedTitle}** ${attrLabel}: ${val}`;
          } else {
            replyText = `I found **${matchedTitle}** in the database, but no "${attribute}" field was recorded in its metadata.`;
          }
        } else {
          replyText = `I couldn't find any anime in the database matching title **"${anime_title}"**.`;
        }

        console.log(`Step 4: PostgreSQL Factual Search - Completed lookup | Model: ${textModel} | Total time: ${Date.now() - factualStart}ms`);

        // Save messages if authenticated
        if (user) {
          if (!activeChatId) {
            const newChat = await this.chatService.createNewConversation(user.id, message);
            activeChatId = newChat.id;
          }
          // Cast intent as 'VECTOR_SEARCH' for chat DB schema compatibility constraints
          await this.chatService.saveChatMessage(activeChatId, 'user', message, { intent: CHAT_INTENTS.VECTOR_SEARCH });
          await this.chatService.saveChatMessage(activeChatId, 'model', replyText, { intent: CHAT_INTENTS.VECTOR_SEARCH });
        }

        return new Response(new TextEncoder().encode(replyText), {
          headers: {
            'Content-Type': 'text/plain; charset=utf-8',
            'X-Cache': 'MISS',
            ...(activeChatId ? { 'X-Chat-Id': activeChatId, 'Access-Control-Expose-Headers': 'X-Chat-Id' } : {})
          }
        });
      }

      // Guest Mode (No authenticated user) - Cache Miss path
      if (!user) {
        if (intent === CHAT_INTENTS.UNSUPPORTED) {
          console.log(`Step 4: Unsupported - Initiating under-development fallback response... | Model: ${textModel}`);
          return this.buildUnderDevelopmentResponse(null, intent);
        }
        if (intent === CHAT_INTENTS.DIRECT_CHAT) {
          console.log(`Step 4: Direct Chat - Initiating direct conversational streaming... | Model: ${textModel}`);
        } else if (intent === CHAT_INTENTS.VECTOR_SEARCH) {
          console.log(`Step 4: Vector Search RAG - Initiating recommendation streaming... | Model: ${textModel}`);
        }
        return this.buildChatStreamResponse(normalizedQuery, activeHistory, null, modelId, intent, mediaType, reformulatedQuery, toolCall?.args, requestStart);
      }

      // Member Mode (Authenticated user) - Cache Miss path
      if (!activeChatId) {
        const newChat = await this.chatService.createNewConversation(user.id, message);
        activeChatId = newChat.id;
      }

      // Save the incoming user message to PostgreSQL with the deduced intent metadata (original casing preserved)
      await this.chatService.saveChatMessage(activeChatId, 'user', message, { intent: intent === CHAT_INTENTS.FACTUAL_LOOKUP ? CHAT_INTENTS.VECTOR_SEARCH : intent });

      if (intent === CHAT_INTENTS.UNSUPPORTED) {
        console.log(`Step 4: Unsupported - Initiating under-development fallback response... | Model: ${textModel}`);
        return this.buildUnderDevelopmentResponse(activeChatId, intent);
      }

      if (intent === CHAT_INTENTS.DIRECT_CHAT) {
        console.log(`Step 4: Direct Chat - Initiating direct conversational streaming... | Model: ${textModel}`);
      } else if (intent === CHAT_INTENTS.VECTOR_SEARCH) {
        console.log(`Step 4: Vector Search RAG - Initiating recommendation streaming... | Model: ${textModel}`);
      }

      // Return the consolidated response stream
      return this.buildChatStreamResponse(normalizedQuery, activeHistory, activeChatId, modelId, intent, mediaType, reformulatedQuery, toolCall?.args, requestStart);

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
