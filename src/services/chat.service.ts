import { ChatOpenAI } from '@langchain/openai';
import { PromptTemplate } from '@langchain/core/prompts';
import { StringOutputParser } from '@langchain/core/output_parsers';
import { RunnableSequence, RunnablePassthrough } from '@langchain/core/runnables';
import { z } from 'zod';
import { tool } from '@langchain/core/tools';
import { VectorRepository } from '../repositories/vector.repository';
import { ChatRepository } from '../repositories/chat.repository';
import { Chat, Message } from '../repositories/types';
import { VectorStoreRetriever } from '@langchain/core/vectorstores';
import {
  SUPPORTED_MODELS,
  ModelId,
  MODEL_REGISTRY,
  PROVIDERS,
  CHAT_INTENTS,
  ChatIntent,
  ROUTER_TOOL_NAMES,
  getMetadataFilterPrompt,
  getConversationSummaryPrompt,
  RECOMMENDATION_PROMPT_TEMPLATE,
  DIRECT_CHAT_PROMPT_TEMPLATE,
  MEDIA_TYPES,
  MediaType,
} from '../utils/constant';

// Custom helper: Format contextual documents retrieved from Vector DB into a clean markdown structure
const formatDocumentsAsString = (documents: any[]): string => {
  return documents
    .map((doc, idx) => {
      const yearStr = doc.metadata.year ? `\nYear: ${doc.metadata.year}` : '';
      const studiosStr = doc.metadata.studios ? `\nStudios: ${doc.metadata.studios}` : '';
      const statusStr = doc.metadata.status ? `\nStatus: ${doc.metadata.status}` : '';
      const ratingStr = doc.metadata.rating ? `\nRating: ${doc.metadata.rating}` : '';
      const scoreStr = doc.metadata.score ? `\nScore: ${doc.metadata.score}` : '';
      const imageStr = doc.metadata.image_url ? `\nImage URL: ${doc.metadata.image_url}` : '';
      const urlStr = doc.metadata.url ? `\nURL: ${doc.metadata.url}` : '';
      const episodesStr = doc.metadata.episodes ? `\nEpisodes: ${doc.metadata.episodes}` : '';
      const startStr = doc.metadata.start_date ? `\nStart Date: ${doc.metadata.start_date}` : '';
      const endStr = doc.metadata.end_date ? `\nEnd Date: ${doc.metadata.end_date}` : '';

      const metadataPrefix = "\nMetadata:";
      const metadataContent = `${yearStr}${studiosStr}${statusStr}${ratingStr}${scoreStr}${imageStr}${urlStr}${episodesStr}${startStr}${endStr}`;

      return `${doc.pageContent}${metadataContent ? metadataPrefix + metadataContent : ''}`;
    })
    .join("\n\n");
};

const formatHistory = (history: any[] = []) => {
  return history
    .map((msg) => {
      const prefix = msg.role === 'user' ? 'User' : 'Model';
      return `${prefix}: ${msg.content}`;
    })
    .join("\n");
};

const directChatTool = tool(
  async () => { },
  {
    name: ROUTER_TOOL_NAMES.DIRECT_CHAT,
    description: 'Use this tool for greetings, general casual conversations, definitions, explaining anime concepts, and subjective opinions (e.g. hello, who are you, what is isekai, is Naruto good).',
    schema: z.object({
      message: z.string().describe("The casual message input from the user")
    })
  }
);

const factualLookupTool = tool(
  async () => { },
  {
    name: ROUTER_TOOL_NAMES.FACTUAL_LOOKUP,
    description: 'Use this tool ONLY for specific, direct queries that request factual, exact database metadata lookup without recommendations (e.g., list all anime produced by Madhouse studio, find anime rated R, find all action anime released in the year 2022).',
    schema: z.object({
      filterFields: z.object({
        genres: z.array(z.string()).optional().describe("Array of genre names"),
        studios: z.array(z.string()).optional().describe("Array of studio names"),
        year: z.number().optional().describe("The release year"),
        rating: z.string().optional().describe("The age rating"),
        episodes: z.number().optional().describe("Number of episodes"),
        status: z.string().optional().describe("E.g., Finished Airing, Currently Airing"),
        minScore: z.number().optional().describe("Minimum score threshold out of 100")
      }).describe("The exact search filters extracted from the user query")
    })
  }
);

const recommendAnimeTool = tool(
  async () => { },
  {
    name: ROUTER_TOOL_NAMES.RECOMMEND_ANIME,
    description: 'Use this tool for open recommendation queries seeking recommendations, matching themes, plots, keywords, or preferences (e.g., recommend me a dark fantasy anime like Attack on Titan, suggest action comedy anime, what should I watch if I like psychological thrillers).',
    schema: z.object({
      plotKeywords: z.string().optional().describe("Extracted keywords representing themes, mood, plot elements or genres"),
      genres: z.array(z.string()).optional().describe("Array of genre names"),
      limit: z.number().default(5).describe("Max recommendations to fetch")
    })
  }
);

const unsupportedContentTool = tool(
  async () => { },
  {
    name: ROUTER_TOOL_NAMES.UNSUPPORTED,
    description: 'Use this tool ONLY when the user is asking about live-action movies, live-action TV series, Hollywood films, non-anime video games, books, or any other content/features we do NOT support (we only support animated TV series/anime search & recommendation).',
    schema: z.object({
      category: z.string().describe("The type of unsupported content (e.g. live-action movies, video games, general query)")
    })
  }
);

export const ROUTER_TOOLS = [directChatTool, factualLookupTool, recommendAnimeTool, unsupportedContentTool];

export interface RouterOutput {
  intent: ChatIntent;
  toolCall?: {
    name: string;
    args: any;
  };
  reformulatedQuery: string;
}

export class ChatService {
  private huggingfaceVectorRepo: VectorRepository;
  private chatRepo: ChatRepository;
  private chatLlm: ChatOpenAI;

  constructor() {
    this.huggingfaceVectorRepo = new VectorRepository(SUPPORTED_MODELS.QWEN3_14B);
    this.chatRepo = new ChatRepository();

    // Initialize Chat LLM
    const config = MODEL_REGISTRY[SUPPORTED_MODELS.QWEN3_14B];
    const apiKey = config.provider === PROVIDERS.HUGGINGFACE
      ? (process.env.HF_TOKEN || '')
      : (process.env.SILICONFLOW_API_KEY || '');

    this.chatLlm = new ChatOpenAI({
      apiKey: apiKey,
      configuration: {
        baseURL: config.baseURL,
        apiKey: apiKey,
      },
      modelName: config.textModel,
      temperature: 0.7,
      frequencyPenalty: 0.2,
    });
  }

  /**
   * Private helper using selected LLM to extract structured metadata filters from a natural language query.
   */
  private async extractMetadataFilter(query: string, modelId: ModelId = SUPPORTED_MODELS.QWEN3_14B): Promise<Record<string, any> | undefined> {
    try {
      const prompt = getMetadataFilterPrompt(query);
      const llm = this.chatLlm;
      const response = await llm.invoke(prompt);
      const text = typeof response === 'string' ? response : (response as any).content;

      const cleanJson = text.trim().replace(/^```json\s*/i, '').replace(/```$/, '').trim();
      const filter = JSON.parse(cleanJson);

      if (filter && Object.keys(filter).length > 0) {
        return filter;
      }
    } catch (error) {
      console.warn("Failed to extract metadata filter:", error);
    }
    return undefined;
  }

  private async createConversationSummary(history: any[], query: string, modelId: ModelId = SUPPORTED_MODELS.QWEN3_14B): Promise<string> {
    try {
      const prompt = getConversationSummaryPrompt(formatHistory(history), query);
      const llm = this.chatLlm;
      const response = await llm.invoke(prompt);
      const text = typeof response === 'string' ? response : (response as any).content;
      return text.trim();
    }
    catch (error) {
      console.warn("Failed to create conversation summary:", error);
      return query;
    }
  }

  async routeAndParseQuery(
    query: string,
    history: any[] = [],
    mediaType: MediaType = MEDIA_TYPES.ANIME,
    modelId: ModelId = SUPPORTED_MODELS.QWEN3_14B
  ): Promise<RouterOutput> {
    const config = MODEL_REGISTRY[modelId];
    if (mediaType === MEDIA_TYPES.MOVIES || mediaType === MEDIA_TYPES.SERIES) {
      console.log(`Step 1: ChatService.routeAndParseQuery (CQR) - Skipped (Unsupported MediaType) | Model: ${config.textModel} | Total time: 0ms`);
      return { intent: CHAT_INTENTS.UNSUPPORTED, reformulatedQuery: query };
    }

    // Reformulate query using CQR if history exists to resolve context for follow-up query classification
    let classificationQuery = query;
    const recentHistory = history ? history.slice(-5) : [];
    if (recentHistory.length > 0) {
      const cqrStart = Date.now();
      classificationQuery = await this.createConversationSummary(recentHistory, query, modelId);
      console.log(`Step 1: ChatService.routeAndParseQuery (CQR) - Model: ${config.textModel} | Total time: ${Date.now() - cqrStart}ms`);
    } else {
      console.log(`Step 1: ChatService.routeAndParseQuery (CQR) - Skipped | Model: ${config.textModel} | Total time: 0ms`);
    }

    const classificationStart = Date.now();
    try {
      const llm = this.chatLlm;

      // Bind tools to the model
      const llmWithTools = llm.bindTools(ROUTER_TOOLS);

      const response = await llmWithTools.invoke(
        `Analyze the query and select the appropriate tool.
         Query: "${classificationQuery}"`
      );

      const routeTime = Date.now() - classificationStart;

      if (response.tool_calls && response.tool_calls.length > 0) {
        const toolCall = response.tool_calls[0];
        let intent: ChatIntent = CHAT_INTENTS.DIRECT_CHAT;

        if (toolCall.name === ROUTER_TOOL_NAMES.RECOMMEND_ANIME) {
          intent = CHAT_INTENTS.VECTOR_SEARCH;
        } else if (toolCall.name === ROUTER_TOOL_NAMES.FACTUAL_LOOKUP) {
          intent = CHAT_INTENTS.FACTUAL_LOOKUP;
        } else if (toolCall.name === ROUTER_TOOL_NAMES.UNSUPPORTED) {
          intent = CHAT_INTENTS.UNSUPPORTED;
        }

        console.log(`Step 3: ChatService.routeAndParseQuery (Tool Call) - Tool: ${toolCall.name} - Total time: ${routeTime}ms`);
        console.log(`Step 3: ChatService.routeAndParseQuery (Tool Router classification) - Intent: ${intent} | Model: ${config.textModel} | Total time: ${routeTime}ms`);

        return {
          intent,
          toolCall: {
            name: toolCall.name,
            args: toolCall.args
          },
          reformulatedQuery: classificationQuery
        };
      }

      const routeTimeFallback = Date.now() - classificationStart;
      console.log(`Step 3: ChatService.routeAndParseQuery (Text Fallback) - Direct Chat - Total time: ${routeTimeFallback}ms`);
      console.log(`Step 3: ChatService.routeAndParseQuery (Tool Router classification) - Intent: ${CHAT_INTENTS.DIRECT_CHAT} | Model: ${config.textModel} | Total time: ${routeTimeFallback}ms`);

      return {
        intent: CHAT_INTENTS.DIRECT_CHAT,
        reformulatedQuery: classificationQuery
      };

    } catch (error) {
      console.warn("Failed to route and parse query:", error);
    }

    return {
      intent: CHAT_INTENTS.DIRECT_CHAT,
      toolCall: {
        name: ROUTER_TOOL_NAMES.DIRECT_CHAT,
        args: { message: query }
      },
      reformulatedQuery: query
    };
  }

  /**
   * Generates a streamed recommendation for real-time typing effect.
   */
  async streamRecommendation(
    query: string,
    history?: any[],
    modelId: ModelId = SUPPORTED_MODELS.QWEN3_14B,
    mediaType: MediaType = MEDIA_TYPES.ANIME,
    reformulatedQuery?: string,
    preExtractedFilter?: Record<string, any>
  ) {
    const config = MODEL_REGISTRY[modelId];

    // Use passed reformulatedQuery if available, otherwise fallback
    let finalQuery = reformulatedQuery;
    if (!finalQuery) {
      finalQuery = query;
      const recentHistory = history ? history.slice(-5) : [];
      if (recentHistory.length > 0) {
        finalQuery = await this.createConversationSummary(recentHistory, query, modelId);
      }
    }

    // 5. Extract or use pre-extracted metadata filters
    let filter = preExtractedFilter;
    if (!filter) {
      const filterStart = Date.now();
      filter = await this.extractMetadataFilter(finalQuery, modelId);
      console.log(`Step 5: ChatService.extractMetadataFilter - Filter Extracted: ${JSON.stringify(filter || {})} - Total time: ${Date.now() - filterStart}ms`);
    } else {
      console.log(`Step 5: ChatService.routeAndParseQuery - Filter already extracted: ${JSON.stringify(filter)}`);
    }

    const vectorRepo = new VectorRepository(modelId, mediaType);
    const retrieverStart = Date.now();
    const retriever = await vectorRepo.getRetriever(filter);
    console.log(`Step 6: VectorRepository.getRetriever - Total time: ${Date.now() - retrieverStart}ms`);
    const chatHistoryString = formatHistory(history);

    // 7. Retrieve context documents using the reformulated search query instead of the raw query
    const docRetrievalStart = Date.now();
    const contextDocs = await retriever.invoke(finalQuery);
    const contextString = formatDocumentsAsString(contextDocs);
    console.log(`Step 7: VectorStoreRetriever.invoke (Vector DB Query) - Total time: ${Date.now() - docRetrievalStart}ms`);

    const chainSetupStart = Date.now();
    const prompt = PromptTemplate.fromTemplate(RECOMMENDATION_PROMPT_TEMPLATE);

    const llm = this.chatLlm;

    const chain = RunnableSequence.from([
      {
        context: () => contextString,
        question: new RunnablePassthrough(),
        chat_history: () => chatHistoryString,
        conversationSummary: () => finalQuery,
      },
      prompt,
      llm,
      new StringOutputParser(),
    ]);

    console.log(`Step 8: RunnableSequence.stream (Chain Construction) - Total time: ${Date.now() - chainSetupStart}ms`);
    return await chain.stream(query);
  }

  /**
   * Streams a direct reply for casual conversations or non-vector searches.
   */
  async streamDirectChat(query: string, history?: any[], modelId: ModelId = SUPPORTED_MODELS.QWEN3_14B) {
    const totalStart = Date.now();
    const chatHistoryString = formatHistory(history);
    const prompt = PromptTemplate.fromTemplate(DIRECT_CHAT_PROMPT_TEMPLATE);
    const llm = this.chatLlm;

    const chain = RunnableSequence.from([
      {
        question: new RunnablePassthrough(),
        chat_history: () => chatHistoryString,
      },
      prompt,
      llm,
      new StringOutputParser(),
    ]);

    console.log(`Step 5: RunnableSequence.stream (Direct Chat Chain Construction) - Total time: ${Date.now() - totalStart}ms`);
    return await chain.stream(query);
  }

  /**
   * 1. Fetches all active chat sessions created by a specific user.
   */
  async getUserConversations(userId: string): Promise<Chat[]> {
    return this.chatRepo.getUserChats(userId);
  }

  /**
   * 2. Retrieves full message history for a specific active chat session with direct database ownership check.
   */
  async getConversationHistory(chatId: string, userId: string): Promise<Message[]> {
    const chat = await this.chatRepo.getUserChat(chatId, userId);
    if (!chat) {
      const error = new Error("Conversation not found.");
      (error as any).statusCode = 404;
      throw error;
    }

    return this.chatRepo.getChatMessages(chatId);
  }

  /**
   * 3. Creates a new conversation thread, auto-generating a title from the first message.
   */
  async createNewConversation(userId: string, firstMessage: string): Promise<Chat> {
    // Generate a clean title by slicing the first 35 chars
    const title = firstMessage.length > 35
      ? firstMessage.substring(0, 35).trim() + "..."
      : firstMessage.trim();

    return this.chatRepo.createChat(userId, title || 'New Chat');
  }

  /**
   * 4. Saves a user or model message to a specific conversation thread.
   */
  async saveChatMessage(
    chatId: string,
    role: 'user' | 'model' | 'system',
    content: string,
    metadata: Record<string, any> = {}
  ): Promise<Message> {
    return this.chatRepo.saveMessage(chatId, role, content, metadata);
  }

  /**
   * 5. Updates an active conversation thread's title dynamically with direct database ownership check.
   */
  async renameConversation(chatId: string, userId: string, newTitle: string): Promise<boolean> {
    const chat = await this.chatRepo.getUserChat(chatId, userId);
    if (!chat) {
      const error = new Error("Conversation not found.");
      (error as any).statusCode = 404;
      throw error;
    }

    await this.chatRepo.updateChatTitle(chatId, newTitle);
    return true;
  }

  /**
   * 6. Logically deletes a conversation thread and all its messages.
   */
  async deleteConversation(chatId: string, userId: string): Promise<boolean> {
    return this.chatRepo.deleteChat(chatId, userId);
  }
}
