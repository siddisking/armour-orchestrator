export const PROVIDERS = {
  GEMINI: 'gemini',
  HUGGINGFACE: 'huggingface',
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

export const DEFAULT_MODEL_ID = SUPPORTED_MODELS.QWEN3_14B;

export type ModelId = typeof SUPPORTED_MODELS[keyof typeof SUPPORTED_MODELS];

export interface ModelMetadata {
  id: ModelId;
  provider: typeof PROVIDERS[keyof typeof PROVIDERS];
  textModel: string;
  embeddingModel: string;
  tableName: string;
  dimensions: number;
  baseURL?: string;
  embeddingBaseURL?: string;
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
    embeddingBaseURL: 'https://api.siliconflow.com/v1',
    tableName: 'anime_documents_qwen',
    dimensions: 1024,
    baseURL: 'https://api.siliconflow.com/v1',
  },
  [SUPPORTED_MODELS.QWEN_14B]: {
    id: SUPPORTED_MODELS.QWEN_14B,
    provider: PROVIDERS.SILICONFLOW,
    textModel: 'Qwen/Qwen3-14B',
    embeddingModel: 'Qwen/Qwen3-Embedding-0.6B',
    embeddingBaseURL: 'https://api.siliconflow.com/v1',
    tableName: 'anime_documents_qwen',
    dimensions: 1024,
    baseURL: 'https://api.siliconflow.com/v1',
  },
  [SUPPORTED_MODELS.QWEN_32B]: {
    id: SUPPORTED_MODELS.QWEN_32B,
    provider: PROVIDERS.SILICONFLOW,
    textModel: 'Qwen/Qwen2.5-Coder-32B-Instruct',
    embeddingModel: 'Qwen/Qwen3-Embedding-0.6B',
    embeddingBaseURL: 'https://api.siliconflow.com/v1',
    tableName: 'anime_documents_qwen',
    dimensions: 1024,
    baseURL: 'https://api.siliconflow.com/v1',
  },
  [SUPPORTED_MODELS.QWEN_72B]: {
    id: SUPPORTED_MODELS.QWEN_72B,
    provider: PROVIDERS.SILICONFLOW,
    textModel: 'Qwen/Qwen2.5-72B-Instruct',
    embeddingModel: 'Qwen/Qwen3-Embedding-0.6B',
    embeddingBaseURL: 'https://api.siliconflow.com/v1',
    tableName: 'anime_documents_qwen',
    dimensions: 1024,
    baseURL: 'https://api.siliconflow.com/v1',
  },
  [SUPPORTED_MODELS.QWEN3_14B]: {
    id: SUPPORTED_MODELS.QWEN3_14B,
    provider: PROVIDERS.SILICONFLOW,
    textModel: 'Qwen/Qwen3-14B',
    embeddingModel: 'Qwen/Qwen3-Embedding-0.6B',
    embeddingBaseURL: 'https://api.siliconflow.com/v1',
    tableName: 'anime_documents_qwen',
    dimensions: 1024,
    baseURL: 'https://api.siliconflow.com/v1',
  },
};

export const SAFETY_CONFIG = {
  HUGGINGFACE_BASE_URL: 'https://router.huggingface.co/hf-inference/models',
  ADVERSARIAL_MODEL: 'protectai/deberta-v3-base-prompt-injection-v2',
  TOXIC_MODEL: 'unitary/toxic-bert',
} as const;

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
Use the provided retrieved context, conversation history, and conversation summary to answer the user's question.

Always be conversational, enthusiastic, and helpful.
Do NOT recommend live-action movies or live-action series under any circumstances. If the user asks for non-animated or live-action media, explain politely that you only support animated TV series (anime) and guide them to find anime instead.

-- Formatting Instructions --
1. If the user is asking for recommendations, lists of shows, or a general overview/details of a specific anime, render the details block of each show EXACTLY inside a custom ":::anime-card" block structure (do NOT modify the bracket keys):
:::anime-card
[Title] Anime Title Here
[Image] exact_image_url_here
[Year] Release Year Here
[Episodes] Episode Count or Runtime Here (e.g. 28 episodes or 120 min)
[StartDate] Airing Start Date Here (e.g. 2002-10-03)
[EndDate] Airing End Date Here (e.g. 2007-02-08)
[Studio] Producing Studio Here
[Status] Airing Status Here (e.g. "Finished Airing", "Currently Airing", or "Not yet aired")
[Score] Score Here (e.g., 8.01 or 9.1)
[Genres] Action, Fantasy, Comedy (comma-separated genres from the context)
[Description] A 2-3 sentence synopsis describing the show and explaining how it fits.
[MAL] exact_url_here
:::

2. If the user is asking a specific factual question (e.g., "how many episodes", "when did it start airing", "what studio produced it") or has a follow-up question, answer dynamically and conversationally using standard markdown text. Format dates cleanly (e.g., "October 3, 2002").

3. You can combine both formats in a single response if the user asks a mixed query (e.g. answering a subjective question in markdown paragraphs, followed by the cards for the referenced anime).

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
