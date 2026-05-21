import { ChatGoogleGenerativeAI } from '@langchain/google-genai';
import { PromptTemplate } from '@langchain/core/prompts';
import { StringOutputParser } from '@langchain/core/output_parsers';
import { RunnableSequence, RunnablePassthrough } from '@langchain/core/runnables';
import { VectorRepository } from '../repositories/vector.repository';

const formatDocumentsAsString = (documents: any[]) => 
  documents.map((doc) => doc.pageContent).join("\n\n");

export class ChatService {
  private vectorRepo: VectorRepository;
  private llm: ChatGoogleGenerativeAI;

  constructor() {
    this.vectorRepo = new VectorRepository();
    
    // Initialize Gemini. Requires GOOGLE_API_KEY environment variable.
    this.llm = new ChatGoogleGenerativeAI({
      model: 'gemini-2.5-flash',
      temperature: 0.7,
    });
  }

  /**
   * Generates a recommendation based on the user's query and context from the vector store.
   */
  async generateRecommendation(query: string): Promise<string> {
    try {
      const retriever = await this.vectorRepo.getRetriever();

      // Define the RAG prompt template
      const prompt = PromptTemplate.fromTemplate(`
You are PlotArmor AI, an expert recommender of anime, movies, and TV series.
Use the following pieces of retrieved context to answer the user's question and provide a recommendation.
If you don't know the answer or the context doesn't match perfectly, use your general knowledge but mention that it's a broader recommendation.
Always be conversational, enthusiastic, and helpful.

Context:
{context}

User's Request: {question}
Answer:
      `);

      // Build the LangChain RunnableSequence
      const chain = RunnableSequence.from([
        {
          context: retriever.pipe(formatDocumentsAsString),
          question: new RunnablePassthrough(),
        },
        prompt,
        this.llm,
        new StringOutputParser(),
      ]);

      return await chain.invoke(query);

    } catch (error: any) {
      console.error("Error in ChatService:", error);
      
      // Provide a fallback response if API keys aren't set up yet during development
      if (error?.message?.includes('GOOGLE_API_KEY') || error?.status === 401 || error?.message?.includes('API key')) {
         return "It looks like my Gemini API key hasn't been configured yet! I'm running in offline mode. Once you add `GOOGLE_API_KEY` to the environment variables, I'll be fully operational.";
      }

      throw error;
    }
  }

  /**
   * Generates a streamed recommendation for real-time typing effect.
   */
  async streamRecommendation(query: string) {
    const retriever = await this.vectorRepo.getRetriever();

    const prompt = PromptTemplate.fromTemplate(`
You are PlotArmor AI, an expert recommender of anime, movies, and TV series.
Use the following pieces of retrieved context to answer the user's question and provide a recommendation.
If you don't know the answer or the context doesn't match perfectly, use your general knowledge but mention that it's a broader recommendation.
Always be conversational, enthusiastic, and helpful.

Context:
{context}

User's Request: {question}
Answer:
    `);

    const chain = RunnableSequence.from([
      {
        context: retriever.pipe(formatDocumentsAsString),
        question: new RunnablePassthrough(),
      },
      prompt,
      this.llm,
      new StringOutputParser(),
    ]);

    return await chain.stream(query);
  }
}
