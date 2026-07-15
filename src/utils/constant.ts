export const PROVIDERS = {
  GEMINI: 'gemini',
  SILICONFLOW: 'siliconflow',
} as const;

export const SUPPORTED_MODELS = {
  GEMINI_FLASH: 'gemini-2.5-flash',
  QWEN_7B: 'qwen-2.5-7b',
  QWEN_14B: 'qwen-2.5-14b',
  QWEN_32B: 'qwen-2.5-32b',
  QWEN_72B: 'qwen-2.5-72b',
  QWEN3_14B: 'qwen-3-14b',
} as const;

export type ModelId = typeof SUPPORTED_MODELS[keyof typeof SUPPORTED_MODELS];

export interface ModelMetadata {
  id: ModelId;
  provider: typeof PROVIDERS[keyof typeof PROVIDERS];
  textModel: string;
  embeddingModel: string;
  tableName: string;
  dimensions: number;
  baseURL?: string;
}

export const MODEL_REGISTRY: Record<ModelId, ModelMetadata> = {
  [SUPPORTED_MODELS.GEMINI_FLASH]: {
    id: SUPPORTED_MODELS.GEMINI_FLASH,
    provider: PROVIDERS.GEMINI,
    textModel: 'gemini-2.5-flash',
    embeddingModel: 'gemini-embedding-2',
    tableName: 'anime_documents',
    dimensions: 768,
  },
  [SUPPORTED_MODELS.QWEN_7B]: {
    id: SUPPORTED_MODELS.QWEN_7B,
    provider: PROVIDERS.SILICONFLOW,
    textModel: 'Qwen/Qwen2.5-7B-Instruct',
    embeddingModel: 'Qwen/Qwen3-Embedding-0.6B',
    tableName: 'anime_documents_qwen',
    dimensions: 1024,
    baseURL: 'https://api.siliconflow.com/v1',
  },
  [SUPPORTED_MODELS.QWEN_14B]: {
    id: SUPPORTED_MODELS.QWEN_14B,
    provider: PROVIDERS.SILICONFLOW,
    textModel: 'Qwen/Qwen2.5-14B-Instruct',
    embeddingModel: 'Qwen/Qwen3-Embedding-0.6B',
    tableName: 'anime_documents_qwen',
    dimensions: 1024,
    baseURL: 'https://api.siliconflow.com/v1',
  },
  [SUPPORTED_MODELS.QWEN_32B]: {
    id: SUPPORTED_MODELS.QWEN_32B,
    provider: PROVIDERS.SILICONFLOW,
    textModel: 'Qwen/Qwen2.5-32B-Instruct',
    embeddingModel: 'Qwen/Qwen3-Embedding-0.6B',
    tableName: 'anime_documents_qwen',
    dimensions: 1024,
    baseURL: 'https://api.siliconflow.com/v1',
  },
  [SUPPORTED_MODELS.QWEN_72B]: {
    id: SUPPORTED_MODELS.QWEN_72B,
    provider: PROVIDERS.SILICONFLOW,
    textModel: 'Qwen/Qwen2.5-72B-Instruct',
    embeddingModel: 'Qwen/Qwen3-Embedding-0.6B',
    tableName: 'anime_documents_qwen',
    dimensions: 1024,
    baseURL: 'https://api.siliconflow.com/v1',
  },
  [SUPPORTED_MODELS.QWEN3_14B]: {
    id: SUPPORTED_MODELS.QWEN3_14B,
    provider: PROVIDERS.SILICONFLOW,
    textModel: 'Qwen/Qwen3-14B',
    embeddingModel: 'Qwen/Qwen3-Embedding-0.6B',
    tableName: 'anime_documents_qwen',
    dimensions: 1024,
    baseURL: 'https://api.siliconflow.com/v1',
  },
};

export const CHAT_INTENTS = {
  DIRECT_CHAT: 'DIRECT_CHAT',
  VECTOR_SEARCH: 'VECTOR_SEARCH',
  FACTUAL_LOOKUP: 'FACTUAL_LOOKUP',
  UNSUPPORTED: 'UNSUPPORTED',
} as const;

export type ChatIntent = typeof CHAT_INTENTS[keyof typeof CHAT_INTENTS];

export const ROUTER_TOOL_NAMES = {
  DIRECT_CHAT: 'direct_chat',
  FACTUAL_LOOKUP: 'factual_lookup',
  RECOMMEND_ANIME: 'recommend_anime',
  UNSUPPORTED: 'unsupported_content',
} as const;

export const INGESTION_TARGETS = {
  GEMINI: 'gemini',
  QWEN: 'qwen',
  BOTH: 'both',
} as const;

export const MEDIA_TYPES = {
  ANIME: 'anime',
  MOVIES: 'movies',
  SERIES: 'series',
} as const;

export type MediaType = typeof MEDIA_TYPES[keyof typeof MEDIA_TYPES];

export const MEDIA_COLLECTIONS = {
  [MEDIA_TYPES.ANIME]: 'animated_series',
  [MEDIA_TYPES.MOVIES]: 'animated_movies',
  [MEDIA_TYPES.SERIES]: 'live_action_series',
} as const;

export const normalizeModelId = (input: string): ModelId => {
  const normalized = input.toLowerCase();
  if (normalized === 'gemini' || normalized === 'gemini-2.5-flash') {
    return SUPPORTED_MODELS.GEMINI_FLASH;
  }
  if (normalized === 'siliconflow' || normalized === 'qwen' || normalized === 'qwen-2.5-7b' || normalized === 'qwen-3-14b') {
    return SUPPORTED_MODELS.QWEN3_14B;
  }
  return SUPPORTED_MODELS.GEMINI_FLASH;
};

/**
 * Generates the prompt template for intent classification routing.
 */
export const getRouteIntentPrompt = (query: string): string => {
  const sanitizedQuery = query.replace(/"/g, '\\"');
  return `You are a query classifier for an AI recommendation assistant.
We only support animated TV series (anime) recommendations. We do not support live-action movies, live-action TV series, or non-anime content.

Classify the user's query into exactly one of these three intents:
1. "VECTOR_SEARCH": Use this if the user is asking for recommendations, suggestions, lists of anime/animated series, or describing a plot/characters/themes of an anime they want to find.
   - Also use this if the user is refining, correcting, or adding filters/constraints to a previous recommendation search (e.g., specifying a studio, year, genre, rating, or length).
   - Example: "suggest me isekai anime", "recommend a good romance show", "anime where mc is op", "looking for an anime about space", "Studios should be passione", "I meant producer is Passione", "only from 2023", "less than 13 episodes"
2. "DIRECT_CHAT": Use this if the user is greeting you, asking generic questions, defining concepts, explaining terms, or having a casual conversation.
   - Example: "hello", "what is an isekai?", "explain what shonen means", "who are you?"
3. "UNSUPPORTED": Use this if the user is asking for recommendations, suggestions, or information about live-action movies, live-action TV series, or non-anime content (like Hollywood/Bollywood movies, Game of Thrones, Kdramas, sitcoms).
   - Example: "recommend some live action fantasy series", "best hollywood action movies", "good sitcoms to watch"
   - Note: Anime movies or anime series (like Akira, Spirited Away, Naruto) are anime and should be classified as VECTOR_SEARCH, not UNSUPPORTED.

Output ONLY the word "DIRECT_CHAT", "VECTOR_SEARCH", or "UNSUPPORTED" (without quotes or punctuation). Do not add any explanation.

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
- "episodes" (object): Numeric count of episodes. Supported comparison operators are:
  - "gte" (greater than or equal to)
  - "gt" (greater than)
  - "lte" (less than or equal to, e.g. for "short series with under 13 episodes" use {"episodes": {"lte": 13}})
  - "lt" (less than)
- "genres" (array of strings): Extract any matching genres as a JSON list (e.g., "Action", "Comedy", "Fantasy", "Sci-Fi", "Drama", "Slice of Life", "Romance", "Adventure", "Suspense").

Respond ONLY with a valid JSON object. Do not include markdown code block formatting or any other text. If no filters apply, return an empty object {}.

Examples:
Query: "animes released in 2026"
Response: {"year": 2026}

Query: "completed action and fantasy series by bones studio"
Response: {"studios": "Bones", "status": "Finished Airing", "genres": ["Action", "Fantasy"]}

Query: "Some high rated anime with less than 13 episodes"
Response: {"score": {"gte": 8.0}, "episodes": {"lte": 13}}

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
You are PlotArmor AI, an expert recommender of animated TV series (anime). We currently only support animated TV series (anime) on our platform.
You are here to answer general questions, explain anime concepts or terms, greet the user, or have a casual conversation.
Always be conversational, enthusiastic, and helpful.
If the user asks for recommendations of live-action movies, live-action series, or other non-animated formats, politely explain that you only support animated TV series (anime) and guide them to find anime instead.

Conversation History:
{chat_history}

User's Request: {question}
Answer:
`;

/**
 * The LangChain PromptTemplate for generating recommendations.
 */
export const RECOMMENDATION_PROMPT_TEMPLATE = `
You are PlotArmor AI, an expert recommender of animated TV series (anime). We currently only support animated TV series (anime) on our platform.
Use the following pieces of retrieved context and conversation history and conversation summary to answer the user's question and provide a recommendation.
If you don't know the answer or the context doesn't match perfectly, use your general knowledge to suggest only animated TV series (anime) that fit the description, but mention that it's a broader recommendation.
Do NOT recommend live-action movies or live-action series under any circumstances. If the user asks for non-animated or live-action media, explain politely that you only support animated TV series (anime) and guide them to find anime instead.
Always be conversational, enthusiastic, and helpful.

-- Formatting Instructions --
* Always output recommendations strictly inside custom ":::anime-card" block boundaries.
* For each recommended anime/movie/series, render the details block EXACTLY in the following structure (do NOT modify the keys in brackets):
:::anime-card
[Title] Anime Title Here
[Image] exact_image_url_here
[Year] Release Year Here
[Episodes] Episode Count or Runtime Here (e.g. 28 episodes for series, or 148 min for movies)
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

export const RATE_LIMITS = {
  CHAT_LIMIT: 10,    // 10 requests per minute for chat
  DEFAULT_LIMIT: 30, // 30 requests per minute for other endpoints
  KEYS: {
    CHAT: 'chat',
    CONVERSATIONS: 'conversations',
    CONVERSATIONS_DETAIL: 'conversations:detail',
  },
} as const;

export const CACHE_CONFIG = {
  /**
   * Similarity threshold for checking semantic duplicates during write (promotion).
   * If a candidate query has >= 95% similarity to a cached query, we skip saving it.
   */
  DEDUPLICATION_THRESHOLD: 0.95,
  /**
   * Similarity threshold for checking semantic cache hits during read (user search).
   * If the user's search has >= 90% similarity to a cached query, we serve the cached answer.
   */
  RETRIEVAL_THRESHOLD: 0.90,
  /**
   * The minimum base search frequency score required for a query to be considered
   * for L1 to L2 cache promotion (if the average search score is lower than this).
   */
  MIN_PROMOTION_THRESHOLD: 5,
} as const;

export const TEMPORAL_KEYWORDS = [
  'new', 'recent', 'recently', 'latest', 'newest', 'airing', 'ongoing', 'upcoming', 'current', 
  'today', 'now', 'this season', 'current season', 'next season',
  'this year', 'last year', 'next year', 'fresh',
  'this spring', 'this summer', 'this autumn', 'this fall', 'this winter'
] as const;
