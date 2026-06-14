import { ChatGoogleGenerativeAI } from '@langchain/google-genai';
import { ChatOpenAI } from '@langchain/openai';
import { PromptTemplate } from '@langchain/core/prompts';
import { StringOutputParser } from '@langchain/core/output_parsers';
import { RunnableSequence, RunnablePassthrough } from '@langchain/core/runnables';
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
  getRouteIntentPrompt,
  getMetadataFilterPrompt,
  getConversationSummaryPrompt,
  RECOMMENDATION_PROMPT_TEMPLATE,
  DIRECT_CHAT_PROMPT_TEMPLATE,
  MEDIA_TYPES,
  MediaType,
} from '../utils/constant';

const formatDocumentsAsString = (documents: any[]) =>
  documents.map((doc) => {
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
  }).join("\n\n");

const formatHistory = (history: any[] = []) => {
  return history
    .map((msg) => {
      const prefix = msg.role === 'user' ? 'User' : 'Model';
      return `${prefix}: ${msg.content}`;
    })
    .join("\n");
};

export class ChatService {
  private geminiVectorRepo: VectorRepository;
  private siliconflowVectorRepo: VectorRepository;
  private chatRepo: ChatRepository;
  private geminiLlm: ChatGoogleGenerativeAI;
  private siliconflowLlm: ChatOpenAI;

  constructor() {
    this.geminiVectorRepo = new VectorRepository(SUPPORTED_MODELS.GEMINI_FLASH);
    this.siliconflowVectorRepo = new VectorRepository(SUPPORTED_MODELS.QWEN_7B);
    this.chatRepo = new ChatRepository();

    // Initialize Gemini. Requires GOOGLE_API_KEY environment variable.
    const geminiConfig = MODEL_REGISTRY[SUPPORTED_MODELS.GEMINI_FLASH];
    this.geminiLlm = new ChatGoogleGenerativeAI({
      model: geminiConfig.textModel,
      temperature: 0.3,
    });


    // Initialize SiliconFlow Qwen/Qwen2.5-72B-Instruct
    const config = MODEL_REGISTRY[SUPPORTED_MODELS.QWEN_7B];
    this.siliconflowLlm = new ChatOpenAI({
      apiKey: process.env.SILICONFLOW_API_KEY || '',
      configuration: {
        baseURL: config.baseURL,
        apiKey: process.env.SILICONFLOW_API_KEY || '', // Nested override
      },
      modelName: config.textModel,
      temperature: 0.7,
      frequencyPenalty: 0.2,
    });
  }

  /**
   * Private helper using selected LLM to extract structured metadata filters from a natural language query.
   */
  private async extractMetadataFilter(query: string, modelId: ModelId = SUPPORTED_MODELS.GEMINI_FLASH): Promise<Record<string, any> | undefined> {
    try {
      const prompt = getMetadataFilterPrompt(query);
      const config = MODEL_REGISTRY[modelId];

      const llm = config.provider === PROVIDERS.SILICONFLOW ? this.siliconflowLlm : this.geminiLlm;
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

  private async createConversationSummary(history: any[], query: string, modelId: ModelId): Promise<string> {
    try {
      const prompt = getConversationSummaryPrompt(formatHistory(history), query);
      const config = MODEL_REGISTRY[modelId];

      const llm = config.provider === PROVIDERS.SILICONFLOW ? this.siliconflowLlm : this.geminiLlm;
      const response = await llm.invoke(prompt);
      const text = typeof response === 'string' ? response : (response as any).content;
      return text.trim();
    }
    catch (error) {
      console.warn("Failed to create conversation summary:", error);
      return query;
    }

  }

  async routeIntent(query: string, modelId: ModelId = SUPPORTED_MODELS.GEMINI_FLASH): Promise<ChatIntent> {
    try {
      const prompt = getRouteIntentPrompt(query);
      const config = MODEL_REGISTRY[modelId];

      const llm = config.provider === PROVIDERS.SILICONFLOW ? this.siliconflowLlm : this.geminiLlm;
      const response = await llm.invoke(prompt);
      const text = (typeof response === 'string' ? response : (response as any).content).trim();
      const cleaned = text.replace(/^```[a-z]*\s*/i, '').replace(/```$/, '').trim();

      if (cleaned.includes(CHAT_INTENTS.VECTOR_SEARCH)) {
        console.log(`[Route Intent] Deduced intent: "${CHAT_INTENTS.VECTOR_SEARCH}" for query: "${query}"`);
        return CHAT_INTENTS.VECTOR_SEARCH;
      }
      if (cleaned.includes(CHAT_INTENTS.DIRECT_CHAT)) {
        console.log(`[Route Intent] Deduced intent: "${CHAT_INTENTS.DIRECT_CHAT}" for query: "${query}"`);
        return CHAT_INTENTS.DIRECT_CHAT;
      }
      console.log(`[Route Intent] Deduced fallback intent: "${CHAT_INTENTS.DIRECT_CHAT}" (unrecognized intent format: "${cleaned}") for query: "${query}"`);
      return CHAT_INTENTS.DIRECT_CHAT;
    } catch (error) {
      console.warn("Failed to route intent:", error);
    }
    return CHAT_INTENTS.DIRECT_CHAT;
  }

  /**
   * Generates a streamed recommendation for real-time typing effect.
   */
  async streamRecommendation(
    query: string, 
    history?: any[], 
    modelId: ModelId = SUPPORTED_MODELS.GEMINI_FLASH,
    mediaType: MediaType = MEDIA_TYPES.ANIME
  ) {
    const config = MODEL_REGISTRY[modelId];

    // 1. Generate reformulated search query if history exists (skipping first message turn)
    let reformulatedQuery = query;
    const recentHistory = history ? history.slice(-5) : [];
    if (recentHistory.length > 0) {
      reformulatedQuery = await this.createConversationSummary(recentHistory, query, modelId);
      console.log(`[RAG CQR] Original Query: "${query}" | Reformulated: "${reformulatedQuery}"`);
    }


    // 2. Extract metadata filters using the reformulated query
    const filter = await this.extractMetadataFilter(reformulatedQuery, modelId);
    console.log(`[RAG Search] Model: ${modelId} | Target Query: "${reformulatedQuery}" | Extracted Metadata Filter:`, filter || 'None');

    const vectorRepo = new VectorRepository(modelId, mediaType);
    const retriever = await vectorRepo.getRetriever(filter);
    const chatHistoryString = formatHistory(history);

    // 3. Retrieve context documents using the reformulated search query instead of the raw query
    const contextDocs = await retriever.invoke(reformulatedQuery);
    const contextString = formatDocumentsAsString(contextDocs);

    const prompt = PromptTemplate.fromTemplate(RECOMMENDATION_PROMPT_TEMPLATE);

    const llm = config.provider === PROVIDERS.SILICONFLOW ? this.siliconflowLlm : this.geminiLlm;

    const chain = RunnableSequence.from([
      {
        context: () => contextString,
        question: new RunnablePassthrough(),
        chat_history: () => chatHistoryString,
        conversationSummary: () => reformulatedQuery,
      },
      prompt,
      llm,
      new StringOutputParser(),
    ]);

    return await chain.stream(query);
  }

  /**
   * Streams a direct reply for casual conversations or non-vector searches.
   */
  async streamDirectChat(query: string, history?: any[], modelId: ModelId = SUPPORTED_MODELS.GEMINI_FLASH) {
    const config = MODEL_REGISTRY[modelId];
    const chatHistoryString = formatHistory(history);
    const prompt = PromptTemplate.fromTemplate(DIRECT_CHAT_PROMPT_TEMPLATE);
    const llm = config.provider === PROVIDERS.SILICONFLOW ? this.siliconflowLlm : this.geminiLlm;

    const chain = RunnableSequence.from([
      {
        question: new RunnablePassthrough(),
        chat_history: () => chatHistoryString,
      },
      prompt,
      llm,
      new StringOutputParser(),
    ]);

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
