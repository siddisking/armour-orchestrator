import { ChatGoogleGenerativeAI } from '@langchain/google-genai';
import { PromptTemplate } from '@langchain/core/prompts';
import { StringOutputParser } from '@langchain/core/output_parsers';
import { RunnableSequence, RunnablePassthrough } from '@langchain/core/runnables';
import { VectorRepository } from '../repositories/vector.repository';
import { ChatRepository } from '../repositories/chat.repository';
import { Chat, Message } from '../repositories/types';

const formatDocumentsAsString = (documents: any[]) => 
  documents.map((doc) => doc.pageContent).join("\n\n");

const formatHistory = (history: any[] = []) => {
  return history
    .map((msg) => {
      const prefix = msg.role === 'user' ? 'User' : 'Model';
      return `${prefix}: ${msg.content}`;
    })
    .join("\n");
};

export class ChatService {
  private vectorRepo: VectorRepository;
  private chatRepo: ChatRepository;
  private llm: ChatGoogleGenerativeAI;

  constructor() {
    this.vectorRepo = new VectorRepository();
    this.chatRepo = new ChatRepository();
    
    // Initialize Gemini. Requires GOOGLE_API_KEY environment variable.
    this.llm = new ChatGoogleGenerativeAI({
      model: 'gemini-2.5-flash',
      temperature: 0.3,
    });
  }



  /**
   * Generates a streamed recommendation for real-time typing effect.
   */
  async streamRecommendation(query: string, history?: any[]) {
    const retriever = await this.vectorRepo.getRetriever();
    const chatHistoryString = formatHistory(history);

    const prompt = PromptTemplate.fromTemplate(`
You are PlotArmor AI, an expert recommender of anime, movies, and TV series.
Use the following pieces of retrieved context and conversation history to answer the user's question and provide a recommendation.
If you don't know the answer or the context doesn't match perfectly, use your general knowledge but mention that it's a broader recommendation.
Always be conversational, enthusiastic, and helpful.

Conversation History:
{chat_history}

Context:
{context}

User's Request: {question}
Answer:
    `);

    const chain = RunnableSequence.from([
      {
        context: retriever.pipe(formatDocumentsAsString),
        question: new RunnablePassthrough(),
        chat_history: () => chatHistoryString,
      },
      prompt,
      this.llm,
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
