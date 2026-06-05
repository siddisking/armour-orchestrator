export const PROVIDERS = {
  GEMINI: 'gemini',
  SILICONFLOW: 'siliconflow',
} as const;

export const SUPPORTED_MODELS = {
  GEMINI_FLASH: 'gemini-2.5-flash',
  QWEN_7B: 'qwen-2.5-7b',
} as const;

export type ModelId = typeof SUPPORTED_MODELS[keyof typeof SUPPORTED_MODELS];

export interface ModelMetadata {
  id: ModelId;
  provider: typeof PROVIDERS[keyof typeof PROVIDERS];
  textModel: string;
  embeddingModel: string;
  tableName: string;
  baseURL?: string;
}

export const MODEL_REGISTRY: Record<ModelId, ModelMetadata> = {
  [SUPPORTED_MODELS.GEMINI_FLASH]: {
    id: SUPPORTED_MODELS.GEMINI_FLASH,
    provider: PROVIDERS.GEMINI,
    textModel: 'gemini-2.5-flash',
    embeddingModel: 'gemini-embedding-2',
    tableName: 'anime_documents',
  },
  [SUPPORTED_MODELS.QWEN_7B]: {
    id: SUPPORTED_MODELS.QWEN_7B,
    provider: PROVIDERS.SILICONFLOW,
    textModel: 'Qwen/Qwen2.5-7B-Instruct',
    embeddingModel: 'Qwen/Qwen3-Embedding-0.6B',
    tableName: 'anime_documents_qwen',
    baseURL: 'https://api.siliconflow.com/v1',
  },
};

export const CHAT_INTENTS = {
  DIRECT_CHAT: 'DIRECT_CHAT',
  VECTOR_SEARCH: 'VECTOR_SEARCH',
} as const;

export type ChatIntent = typeof CHAT_INTENTS[keyof typeof CHAT_INTENTS];

export const INGESTION_TARGETS = {
  GEMINI: 'gemini',
  QWEN: 'qwen',
  BOTH: 'both',
} as const;

export const normalizeModelId = (input: string): ModelId => {
  const normalized = input.toLowerCase();
  if (normalized === 'gemini' || normalized === 'gemini-2.5-flash') {
    return SUPPORTED_MODELS.GEMINI_FLASH;
  }
  if (normalized === 'siliconflow' || normalized === 'qwen' || normalized === 'qwen-2.5-7b') {
    return SUPPORTED_MODELS.QWEN_7B;
  }
  return SUPPORTED_MODELS.GEMINI_FLASH;
};

/**
 * Generates the prompt template for intent classification routing.
 */
export const getRouteIntentPrompt = (query: string): string => {
  const sanitizedQuery = query.replace(/"/g, '\\"');
  return `You are a query classifier for an anime recommendation assistant.
Analyze the user's search query and classify it into one of these two intents:
- "DIRECT_CHAT": General questions, definitions of concepts, explanations, greetings, or casual talk (e.g. "What is an Isekai anime?", "Who are you?", "Explain what is Shonen").
- "VECTOR_SEARCH": Queries seeking anime recommendations, suggestions based on plots, themes, characters, or similarities (e.g. "Recommend a dark fantasy anime", "Suggest an anime with OP MC").

Respond with ONLY the string "DIRECT_CHAT" or "VECTOR_SEARCH". Do not include markdown formatting, punctuation, or any other explanation.

Query: "${sanitizedQuery}"
Response:`;
};

export const getMetadataFilterPrompt = (query: string): string => {
  const sanitizedQuery = query.replace(/"/g, '\\"');
  return `You are a metadata extraction assistant for a vector database of anime.
Analyze the user's search query and extract filters to query metadata fields.

Available Database Metadata Fields:
- "year" (number): Release year (e.g. 2026, 2024). ONLY extract if the user is asking for content from or released in that year. Do NOT extract if the year is part of a title (e.g. "2012" the movie).
- "studios" (string): Producing studio (e.g. Madhouse, Bones).
- "type" (string): "TV", "Movie", "OVA", "Special".
- "status" (string): Airing status. Use "Finished Airing" if the user asks for completed or finished series/seasons, "Currently Airing" if they ask for ongoing/airing series, and "Not yet aired" if they ask for upcoming series.
- "score" (object): Numeric rating score of the anime (0 to 10 scale). Supported comparison operators are:
  - "gte" (greater than or equal to, e.g. for "high rated", "best rated", "highest rated" use {"score": {"gte": 8.0}})
  - "gt" (greater than)
  - "lte" (less than or equal to)
  - "lt" (less than)

Respond ONLY with a valid JSON object. Do not include markdown code block formatting or any other text. If no filters apply, return an empty object {}.

Examples:
Query: "animes released in 2026"
Response: {"year": 2026}

Query: "completed action series by bones studio"
Response: {"studios": "Bones", "status": "Finished Airing"}

Query: "Some high rated anime ?"
Response: {"score": {"gte": 8.0}}

Query: "anime with score above 7.5 by madhouse"
Response: {"studios": "Madhouse", "score": {"gt": 7.5}}

Query: "animes like 2012"
Response: {}

Query: "${sanitizedQuery}"
Response:`;
};

/**
 * Generates the prompt template for converting a follow-up query to a standalone query.
 */
export const getConversationSummaryPrompt = (historyString: string, query: string): string => {
  return `Given the following chat history and a follow-up user query, rewrite the follow-up query to be a standalone, fully self-contained search query suitable for semantic vector database retrieval. The rewritten query should preserve the original search intent, replacing pronouns (like "them", "it", "that", "these", "those") with the specific anime titles, genres, or concepts referenced in the history.
Do not explain, do not add metadata labels, and do not answer the query. Output ONLY the rewritten search query.

**Chat History:**
${historyString}

**Follow-up User Query:**
${query}

**Standalone Search Query:**`;
};

/**
 * The LangChain PromptTemplate for direct chat/conversation.
 */
export const DIRECT_CHAT_PROMPT_TEMPLATE = `
You are PlotArmor AI, an expert recommender of anime, movies, and TV series.
You are here to answer general questions, explain anime concepts or terms, greet the user, or have a casual conversation.
Always be conversational, enthusiastic, and helpful.

Conversation History:
{chat_history}

User's Request: {question}
Answer:
`;

/**
 * The LangChain PromptTemplate for generating recommendations.
 */
export const RECOMMENDATION_PROMPT_TEMPLATE = `
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
`;
