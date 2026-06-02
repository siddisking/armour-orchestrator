import { ChatGoogleGenerativeAI } from '@langchain/google-genai';
import { ChatOpenAI } from '@langchain/openai';
import { PromptTemplate } from '@langchain/core/prompts';
import { StringOutputParser } from '@langchain/core/output_parsers';
import { RunnableSequence, RunnablePassthrough } from '@langchain/core/runnables';
import { VectorRepository } from '../repositories/vector.repository';
import { ChatRepository } from '../repositories/chat.repository';
import { Chat, Message } from '../repositories/types';
import { VectorStoreRetriever } from '@langchain/core/vectorstores';

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
    this.geminiVectorRepo = new VectorRepository('gemini');
    this.siliconflowVectorRepo = new VectorRepository('qwen');
    this.chatRepo = new ChatRepository();

    // Initialize Gemini. Requires GOOGLE_API_KEY environment variable.
    this.geminiLlm = new ChatGoogleGenerativeAI({
      model: 'gemini-2.5-flash',
      temperature: 0.3,
    });

    // Initialize SiliconFlow Qwen/Qwen2.5-7B-Instruct
    this.siliconflowLlm = new ChatOpenAI({
      apiKey: process.env.SILICONFLOW_API_KEY || '',
      configuration: {
        baseURL: "https://api.siliconflow.com/v1",
        apiKey: process.env.SILICONFLOW_API_KEY || '', // Nested override
      },
      modelName: "Qwen/Qwen2.5-7B-Instruct",
      temperature: 0.3,
    });
  }

  /**
   * Private helper using selected LLM to extract structured metadata filters from a natural language query.
   */
  private async extractMetadataFilter(query: string, provider: 'gemini' | 'siliconflow' = 'gemini'): Promise<Record<string, any> | undefined> {
    try {
      const prompt = `You are a metadata extraction assistant for a vector database of anime.
Analyze the user's search query and extract filters to query metadata fields.

Available Database Metadata Fields:
- "year" (number): Release year (e.g. 2026, 2024). ONLY extract if the user is asking for content from or released in that year. Do NOT extract if the year is part of a title (e.g. "2012" the movie).
- "studios" (string): Producing studio (e.g. Madhouse, Bones).
- "type" (string): "TV", "Movie", "OVA", "Special".
- "status" (string): Airing status. Use "Finished Airing" if the user asks for completed or finished series/seasons, "Currently Airing" if they ask for ongoing/airing series, and "Not yet aired" if they ask for upcoming series.

Respond ONLY with a valid JSON object. Do not include markdown code block formatting or any other text. If no filters apply, return an empty object {}.

Examples:
Query: "animes released in 2026"
Response: {"year": 2026}

Query: "completed action series by bones studio"
Response: {"studios": "Bones", "status": "Finished Airing"}

Query: "animes like 2012"
Response: {}

Query: "${query.replace(/"/g, '\\"')}"
Response:`;

      const llm = provider === 'siliconflow' ? this.siliconflowLlm : this.geminiLlm;
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

  private async createConversationSummary(history: any[], query: string, provider: string): Promise<string> {
    try {
      const prompt = `Given the following chat history and a follow-up user query, rewrite the follow-up query to be a standalone, fully self-contained search query suitable for semantic vector database retrieval. The rewritten query should preserve the original search intent, replacing pronouns (like "them", "it", "that", "these", "those") with the specific anime titles, genres, or concepts referenced in the history.
Do not explain, do not add metadata labels, and do not answer the query. Output ONLY the rewritten search query.

**Chat History:**
${formatHistory(history)}

**Follow-up User Query:**
${query}

**Standalone Search Query:**`;

      const llm = provider === 'siliconflow' ? this.siliconflowLlm : this.geminiLlm;
      const response = await llm.invoke(prompt);
      const text = typeof response === 'string' ? response : (response as any).content;
      return text.trim();
    }
    catch (error) {
      console.warn("Failed to create conversation summary:", error);
      return query;
    }

  }

  /**
   * Generates a streamed recommendation for real-time typing effect.
   */
  async streamRecommendation(query: string, history?: any[], provider: 'gemini' | 'siliconflow' = 'gemini') {
    // 1. Generate reformulated search query if history exists (skipping first message turn)
    let reformulatedQuery = query;
    const recentHistory = history ? history.slice(-5) : [];
    if (recentHistory.length > 0) {
      reformulatedQuery = await this.createConversationSummary(recentHistory, query, provider);
      console.log(`[RAG CQR] Original Query: "${query}" | Reformulated: "${reformulatedQuery}"`);
    }


    // 2. Extract metadata filters using the reformulated query
    const filter = await this.extractMetadataFilter(reformulatedQuery, provider);
    console.log(`[RAG Search] Provider: ${provider} | Target Query: "${reformulatedQuery}" | Extracted Metadata Filter:`, filter || 'None');

    const vectorRepo = provider === 'siliconflow' ? this.siliconflowVectorRepo : this.geminiVectorRepo;
    const retriever = await vectorRepo.getRetriever(filter);
    const chatHistoryString = formatHistory(history);

    // 3. Retrieve context documents using the reformulated search query instead of the raw query
    const contextDocs = await retriever.invoke(reformulatedQuery);
    const contextString = formatDocumentsAsString(contextDocs);

    const prompt = PromptTemplate.fromTemplate(`
You are PlotArmor AI, an expert recommender of anime, movies, and TV series.
Use the following pieces of retrieved context and conversation history and conversation summary to answer the user's question and provide a recommendation.
If you don't know the answer or the context doesn't match perfectly, use your general knowledge but mention that it's a broader recommendation.
Always be conversational, enthusiastic, and helpful.

-- Formatting Instructions --
* Always output recommendations strictly inside custom ":::anime-card" block boundaries.
* For each recommended anime/movie/series, render the details block EXACTLY in the following structure (do NOT modify the keys in brackets):
:::anime-card
[Title] Anime Title Here
[Image] exact_image_url_here
[Year] Release Year Here
[Episodes] Episode Count Here (e.g. 28 episodes)
[StartDate] Airing Start Date Here (e.g. 2023-10-06)
[EndDate] Airing End Date Here (e.g. 2024-03-22)
[Studio] Producing Studio Here
[Status] Airing Status Here (Must display the actual status value from the context metadata, e.g. "Finished Airing", "Currently Airing", or "Not yet aired" - show ALL statuses as recorded!)
[Score] Score Here (numeric score from metadata, e.g., 9.1 or 8.5)
[Genres] Action, Fantasy, Comedy (comma separated genres from the context page content)
[Description] A 2-3 sentence synopsis/explanation describing the show and explaining how it fits the user's OP MC or plot query.
[MAL] exact_url_here
:::

Conversation History:
{chat_history}

Conversation Summary / Reformulated Query:
{conversationSummary}

Context:
{context}

User's Request: {question}
Answer:
    `);

    const llm = provider === 'siliconflow' ? this.siliconflowLlm : this.geminiLlm;

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
