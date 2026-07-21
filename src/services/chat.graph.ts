import { Annotation, StateGraph, END } from "@langchain/langgraph";
import { RunnableConfig, RunnableSequence, RunnablePassthrough } from "@langchain/core/runnables";
import { ChatOpenAI } from "@langchain/openai";
import { PromptTemplate } from "@langchain/core/prompts";
import { StringOutputParser } from "@langchain/core/output_parsers";
import { tool } from "@langchain/core/tools";
import { z } from "zod";
import { RedisService } from "./redis.service";
import { ChatService } from "./chat.service";
import { VectorRepository } from "../repositories/vector.repository";
import { AnimeDocumentRepository } from "../repositories/anime-document.repository";
import { SemanticCacheRepository } from "../repositories/semantic-cache.repository";
import { isTemporalQuery } from "../utils/helpers";
import { SafetyService } from "./safety.service";
import {
  SUPPORTED_MODELS,
  ModelId,
  MODEL_REGISTRY,
  PROVIDERS,
  CHAT_INTENTS,
  ChatIntent,
  ROUTER_TOOL_NAMES,
  getConversationSummaryPrompt,
  getMetadataFilterPrompt,
  RECOMMENDATION_PROMPT_TEMPLATE,
  DIRECT_CHAT_PROMPT_TEMPLATE,
  MEDIA_TYPES,
  MediaType,
  DEFAULT_MODEL_ID,
  SAFETY_CONFIG,
} from "../utils/constant";

// --- Types & Configuration ---

const extractTitleFromContent = (content: string): string => {
  const match = content.match(/^Title:\s*(.*)$/m);
  return match ? match[1].trim() : '';
};


const formatHistory = (history: any[] = []) => {
  return history
    .map((msg) => {
      const prefix = msg.role === 'user' ? 'User' : 'Model';
      return `${prefix}: ${msg.content}`;
    })
    .join("\n");
};

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

async function* makeTextStream(text: string) {
  yield text;
}

// --- Dynamic Model Resolver ---

export function getLlmForNode(
  modelId: ModelId,
  temperature?: number
) {
  const modelConfig = MODEL_REGISTRY[modelId];
  if (!modelConfig) {
    throw new Error(`ModelId ${modelId} not registered in MODEL_REGISTRY`);
  }

  const finalTemp = temperature !== undefined ? temperature : 0.7;
  const apiKey = modelConfig.provider === PROVIDERS.HUGGINGFACE
    ? (process.env.HF_TOKEN || '')
    : (process.env.SILICONFLOW_API_KEY || '');

  return new ChatOpenAI({
    apiKey: apiKey,
    configuration: {
      baseURL: modelConfig.baseURL,
      apiKey: apiKey,
    },
    modelName: modelConfig.textModel,
    temperature: finalTemp,
    frequencyPenalty: 0.2,
  });
}

// Helper methods executing dynamic model requests
async function createConversationSummaryDynamic(history: any[], query: string, modelId: ModelId): Promise<string> {
  try {
    const prompt = getConversationSummaryPrompt(formatHistory(history), query);
    const llm = getLlmForNode(modelId, 0.2);
    const response = await llm.invoke(prompt);
    return (typeof response === 'string' ? response : (response as any).content).trim();
  } catch (error) {
    console.warn("Failed to create conversation summary:", error);
    return query;
  }
}

async function extractMetadataFilterDynamic(query: string, modelId: ModelId): Promise<Record<string, any> | undefined> {
  try {
    const prompt = getMetadataFilterPrompt(query);
    const llm = getLlmForNode(modelId, 0.3);
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

// --- Router Tools Definition ---

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
    description: 'Use this tool to lookup objective database facts about a specific anime series, such as episode count, release year, airing status, studios, rating, or score.',
    schema: z.object({
      anime_title: z.string().describe("The name of the anime title referenced by the user (e.g. Naruto, Attack on Titan)"),
      attribute: z.enum(['episodes', 'studios', 'score', 'status', 'year', 'genres', 'all'])
        .describe("The specific database attribute the user is asking for. Use 'all' if they want general metadata details of the show.")
    })
  }
);

const recommendAnimeTool = tool(
  async () => { },
  {
    name: ROUTER_TOOL_NAMES.RECOMMEND_ANIME,
    description: 'Use this tool when the user is asking for recommendations, suggestions, lists, or searching for anime matching plot descriptions, studios, genres, release years, or scores.',
    schema: z.object({
      plot_keywords: z.string().optional().describe("Plot description, theme keywords, or search tags to query (e.g. bounty hunters in space)"),
      genres: z.array(z.string()).optional().describe("Target genres matching the query (e.g. ['Action', 'Comedy'])"),
      studios: z.string().optional().describe("Studio constraint if specified (e.g. Wit Studio)"),
      year: z.number().optional().describe("Release year constraint if specified (e.g. 2023)"),
      type: z.string().optional().describe("Constraint for type, e.g. TV, Movie, OVA, Special"),
      status: z.string().optional().describe("Constraint for status, e.g. Finished Airing, Currently Airing"),
      minScore: z.number().optional().describe("Minimum rating score constraint"),
      minEpisodes: z.number().optional().describe("Minimum episode count constraint"),
      limit: z.number().optional().describe("Limit of matching shows to return")
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

const ROUTER_TOOLS = [directChatTool, factualLookupTool, recommendAnimeTool, unsupportedContentTool];

// --- Graph State Schema ---

export const ChatGraphState = Annotation.Root({
  message: Annotation<string>(),
  history: Annotation<any[]>(),
  chatId: Annotation<string | null>(),
  mediaType: Annotation<MediaType>(),
  isCacheable: Annotation<boolean>(),
  normalizedQuery: Annotation<string>(),
  requestStart: Annotation<number>(),

  // Explicit dynamic model configuration variables on Graph State
  modelId: Annotation<ModelId>({
    value: (x, y) => y ?? x,
    default: () => DEFAULT_MODEL_ID
  }),
  cqrModelId: Annotation<ModelId | null>({
    value: (x, y) => y ?? x,
    default: () => null
  }),
  routerModelId: Annotation<ModelId | null>({
    value: (x, y) => y ?? x,
    default: () => null
  }),
  ragModelId: Annotation<ModelId | null>({
    value: (x, y) => y ?? x,
    default: () => null
  }),
  chatModelId: Annotation<ModelId | null>({
    value: (x, y) => y ?? x,
    default: () => null
  }),

  // Intermediate outputs
  reformulatedQuery: Annotation<string | null>(),
  intent: Annotation<ChatIntent | null>(),
  toolCall: Annotation<any | null>(),
  preExtractedFilter: Annotation<Record<string, any> | null>(),
  cachedResponse: Annotation<string | null>(),
  responseStream: Annotation<any>(),
  factualSuccess: Annotation<boolean | null>(),
  isSafe: Annotation<boolean | null>(),
  safetyModelId: Annotation<string | null>({
    value: (x, y) => y ?? x,
    default: () => null
  }),
});

// --- Graph Nodes ---

// Node 0: Input Safety Guardrails (Prompt-Guard + Toxic-BERT)
async function inputGuardrailNode(state: typeof ChatGraphState.State) {
  const guardrailStart = Date.now();
  console.log(`Step 0: Input guardrail check - Initiating safety check...`);
  try {
    const safetyService = new SafetyService();
    const safetyResult = await safetyService.evaluateSafety(state.normalizedQuery);
    console.log(`Step 0: Input guardrail check - Completed in ${Date.now() - guardrailStart}ms | isSafe: ${safetyResult.isSafe}`);
    
    if (!safetyResult.isSafe) {
      const safetyModelId = safetyResult.checks.adversarial.flag
        ? SAFETY_CONFIG.ADVERSARIAL_MODEL
        : SAFETY_CONFIG.TOXIC_MODEL;
      return { isSafe: false, safetyModelId };
    }
    return { isSafe: true, safetyModelId: null };
  } catch (error) {
    console.warn(`Step 0: Input guardrail check - Failed after ${Date.now() - guardrailStart}ms, defaulting to safe.`);
    console.warn("[Guardrail Error] Details:", error);
    return { isSafe: true, safetyModelId: null };
  }
}

// Node 0B: Safety Blocker Output
async function blockedNode(state: typeof ChatGraphState.State) {
  console.log(`Step 0: Input guardrail check - Blocked unsafe content request.`);
  const reply = "I cannot process this request because it does not comply with our safety guidelines.";
  return { 
    responseStream: makeTextStream(reply)
  };
}

// Node 1: Cache Evaluation (L1 Redis + L2 Qdrant)
async function checkCachesNode(state: typeof ChatGraphState.State) {
  if (!state.isCacheable) {
    return { cachedResponse: null };
  }

  const cacheCheckStart = Date.now();
  const redisService = new RedisService();

  // L1 Check
  try {
    const cachedResponse = await redisService.getExactRecommendationCache(state.normalizedQuery);
    if (cachedResponse) {
      console.log(`Step 1: L1 exact cache check - Hit! (Bypassed router) | Total time: ${Date.now() - cacheCheckStart}ms`);
      await redisService.incrementQueryLeaderboard(state.normalizedQuery);
      return { cachedResponse };
    }
  } catch (cacheErr) {
    console.warn("[Cache Error] L1 exact cache check failed, falling back:", cacheErr);
  }
  console.log(`Step 1: L1 exact cache check - Miss | Total time: ${Date.now() - cacheCheckStart}ms`);

  // L2 Check
  const l2Start = Date.now();
  const modelId = state.modelId;
  const textModel = MODEL_REGISTRY[modelId]?.textModel || modelId;

  try {
    console.log(`[L2 Cache Check] Trying L2 semantic cache for query: "${state.normalizedQuery}"...`);
    const semanticCacheRepo = new SemanticCacheRepository(SUPPORTED_MODELS.QWEN3_14B);
    const cachedResponse = await semanticCacheRepo.retrieveCache(state.normalizedQuery);
    if (cachedResponse) {
      console.log(`Step 2: L2 semantic cache check - Hit! (Bypassed router) | Model: ${textModel} | Total time: ${Date.now() - l2Start}ms`);
      await redisService.incrementQueryLeaderboard(state.normalizedQuery);
      return { cachedResponse };
    } else {
      console.log(`Step 2: L2 semantic cache check - Miss | Model: ${textModel} | Total time: ${Date.now() - l2Start}ms`);
    }
  } catch (cacheErr) {
    console.warn("[Cache Error] L2 semantic cache check failed, falling back:", cacheErr);
  }

  return { cachedResponse: null };
}

// Node 2: Conversational Query Reformulation (CQR)
async function cqrNode(state: typeof ChatGraphState.State) {
  const recentHistory = state.history ? state.history.slice(-5) : [];
  const modelId = state.cqrModelId || state.modelId;
  const textModel = MODEL_REGISTRY[modelId]?.textModel || modelId;

  if (recentHistory.length > 0) {
    const cqrStart = Date.now();
    const summary = await createConversationSummaryDynamic(recentHistory, state.normalizedQuery, modelId);
    console.log(`Step 1: ChatService.routeAndParseQuery (CQR) - Model: ${textModel} | Total time: ${Date.now() - cqrStart}ms`);
    return { reformulatedQuery: summary };
  } else {
    console.log(`Step 1: ChatService.routeAndParseQuery (CQR) - Skipped | Model: ${textModel} | Total time: 0ms`);
    return { reformulatedQuery: state.normalizedQuery };
  }
}

// Node 3: Router Classification & Parameter Extraction
async function routerNode(state: typeof ChatGraphState.State) {
  const routerStart = Date.now();
  const modelId = state.routerModelId || state.modelId;
  const textModel = MODEL_REGISTRY[modelId]?.textModel || modelId;

  const llm = getLlmForNode(modelId, 0.0);
  const llmWithTools = llm.bindTools(ROUTER_TOOLS);

  const queryToRoute = state.reformulatedQuery || state.normalizedQuery;
  const response = await llmWithTools.invoke(
    `Analyze the query and select the appropriate tool.
     Query: "${queryToRoute}"`
  );

  const routeTime = Date.now() - routerStart;
  let intent: ChatIntent = CHAT_INTENTS.DIRECT_CHAT;
  let toolCall = null;
  let preExtractedFilter = null;

  if (response.tool_calls && response.tool_calls.length > 0) {
    const rawToolCall = response.tool_calls[0];
    toolCall = {
      name: rawToolCall.name,
      args: rawToolCall.args
    };
    
    if (rawToolCall.name === ROUTER_TOOL_NAMES.RECOMMEND_ANIME) {
      intent = CHAT_INTENTS.VECTOR_SEARCH;
      preExtractedFilter = rawToolCall.args;
    } else if (rawToolCall.name === ROUTER_TOOL_NAMES.FACTUAL_LOOKUP) {
      intent = CHAT_INTENTS.FACTUAL_LOOKUP;
    } else if (rawToolCall.name === ROUTER_TOOL_NAMES.UNSUPPORTED) {
      intent = CHAT_INTENTS.UNSUPPORTED;
    }
    console.log(`Step 3: ChatService.routeAndParseQuery (Tool Call) - Tool: ${rawToolCall.name} - Total time: ${routeTime}ms`);
  } else {
    console.log(`Step 3: ChatService.routeAndParseQuery (Text Fallback) - Direct Chat - Total time: ${routeTime}ms`);
    toolCall = {
      name: ROUTER_TOOL_NAMES.DIRECT_CHAT,
      args: { message: state.normalizedQuery }
    };
  }

  console.log(`Step 3: ChatService.routeAndParseQuery (Tool Router classification) - Intent: ${intent} | Model: ${textModel} | Total time: ${routeTime}ms`);

  return { intent, toolCall, preExtractedFilter };
}

// Node 4A: Factual Database Lookup (Bypassing Vectors)
async function factualLookupNode(state: typeof ChatGraphState.State) {
  const modelId = state.modelId;
  const textModel = MODEL_REGISTRY[modelId]?.textModel || modelId;

  const factualStart = Date.now();
  const { anime_title, attribute } = state.toolCall.args;
  console.log(`[Factual Lookup] Title: "${anime_title}", Attribute: "${attribute}"`);
  
  const animeRepo = new AnimeDocumentRepository();
  const doc = await animeRepo.findAnimeByTitle(anime_title, modelId);
  
  if (!doc) {
    console.log(`[Factual Fallback] Title "${anime_title}" not found in DB. Routing query to Vector Search...`);
    return { factualSuccess: false };
  }

  // Format the single database record as context for the LLM
  const matchedTitle = extractTitleFromContent(doc.content) || anime_title;
  const metadataStr = JSON.stringify(doc.metadata);
  const contextString = `Title: ${matchedTitle}\n${doc.content}\nMetadata: ${metadataStr}`;

  const chatHistoryString = formatHistory(state.history);
  const finalQuery = state.reformulatedQuery || state.normalizedQuery;

  const chainSetupStart = Date.now();
  const prompt = PromptTemplate.fromTemplate(RECOMMENDATION_PROMPT_TEMPLATE);
  const llm = getLlmForNode(modelId);

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

  console.log(`Step 4: PostgreSQL Factual Search - Completed lookup and initiated LLM generation | Model: ${textModel} | Total time: ${Date.now() - factualStart}ms`);
  const stream = await chain.stream(state.normalizedQuery);

  return { responseStream: stream, factualSuccess: true, modelId };
}

// Node 4B: Recommendation Search (Qdrant retrieve & RAG generate)
async function vectorSearchRagNode(state: typeof ChatGraphState.State) {
  const modelId = state.ragModelId || state.modelId;
  const textModel = MODEL_REGISTRY[modelId]?.textModel || modelId;

  console.log(`Step 4: Vector Search RAG - Initiating recommendation streaming... | Model: ${textModel}`);

  const finalQuery = state.reformulatedQuery || state.normalizedQuery;

  // Resolve filters
  let filter: Record<string, any> | null | undefined = state.preExtractedFilter;
  if (!filter) {
    const filterStart = Date.now();
    filter = await extractMetadataFilterDynamic(finalQuery, modelId);
    console.log(`Step 5: ChatService.extractMetadataFilter - Filter Extracted: ${JSON.stringify(filter || {})} - Total time: ${Date.now() - filterStart}ms`);
  } else {
    console.log(`Step 5: ChatService.routeAndParseQuery - Filter already extracted: ${JSON.stringify(filter)}`);
  }

  const vectorRepo = new VectorRepository(modelId, state.mediaType);
  const retrieverStart = Date.now();
  const retriever = await vectorRepo.getRetriever(filter || undefined);
  console.log(`Step 6: VectorRepository.getRetriever - Total time: ${Date.now() - retrieverStart}ms`);
  const chatHistoryString = formatHistory(state.history);

  const docRetrievalStart = Date.now();
  const contextDocs = await retriever.invoke(finalQuery);
  const contextString = formatDocumentsAsString(contextDocs);
  console.log(`Step 7: VectorStoreRetriever.invoke (Vector DB Query) - Total time: ${Date.now() - docRetrievalStart}ms`);

  const chainSetupStart = Date.now();
  const prompt = PromptTemplate.fromTemplate(RECOMMENDATION_PROMPT_TEMPLATE);
  const llm = getLlmForNode(modelId);

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
  const stream = await chain.stream(state.normalizedQuery);
  return { responseStream: stream, modelId };
}

// Node 4C: Casual Conversational Chat
async function directChatNode(state: typeof ChatGraphState.State) {
  const modelId = state.chatModelId || state.modelId;
  const textModel = MODEL_REGISTRY[modelId]?.textModel || modelId;

  console.log(`Step 4: Direct Chat - Initiating direct conversational streaming... | Model: ${textModel}`);

  const totalStart = Date.now();
  const chatHistoryString = formatHistory(state.history);
  const prompt = PromptTemplate.fromTemplate(DIRECT_CHAT_PROMPT_TEMPLATE);
  const llm = getLlmForNode(modelId);

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
  const stream = await chain.stream(state.normalizedQuery);
  return { responseStream: stream, modelId };
}

// Node 4D: Unsupported Subject Matter Fallback
async function unsupportedNode(state: typeof ChatGraphState.State) {
  const modelId = state.modelId;
  const textModel = MODEL_REGISTRY[modelId]?.textModel || modelId;

  console.log(`Step 4: Unsupported - Initiating under-development fallback response... | Model: ${textModel}`);
  const reply = "This feature is still under development, please check with us later, meanwhile look for any animated series (anime) on our platform";
  
  return { responseStream: makeTextStream(reply), modelId };
}

// --- Assemble StateGraph Workflow ---

const workflow = new StateGraph(ChatGraphState)
  .addNode("input_guardrail", inputGuardrailNode)
  .addNode("blocked", blockedNode)
  .addNode("check_caches", checkCachesNode)
  .addNode("cqr", cqrNode)
  .addNode("router", routerNode)
  .addNode("factual_lookup", factualLookupNode)
  .addNode("rag_recommendation", vectorSearchRagNode)
  .addNode("direct_chat", directChatNode)
  .addNode("unsupported", unsupportedNode);

workflow.setEntryPoint("input_guardrail");

workflow.addConditionalEdges(
  "input_guardrail",
  (state) => {
    return state.isSafe ? "safe" : "unsafe";
  },
  {
    safe: "check_caches",
    unsafe: "blocked"
  }
);

workflow.addConditionalEdges(
  "check_caches",
  (state) => {
    return state.cachedResponse ? "end" : "continue";
  },
  {
    end: END,
    continue: "cqr"
  }
);

workflow.addEdge("cqr", "router");

workflow.addConditionalEdges(
  "router",
  (state) => {
    switch (state.intent) {
      case CHAT_INTENTS.FACTUAL_LOOKUP:
        return "factual";
      case CHAT_INTENTS.VECTOR_SEARCH:
        return "rag";
      case CHAT_INTENTS.UNSUPPORTED:
        return "unsupported";
      default:
        return "chat";
    }
  },
  {
    factual: "factual_lookup",
    rag: "rag_recommendation",
    chat: "direct_chat",
    unsupported: "unsupported"
  }
);

workflow.addConditionalEdges(
  "factual_lookup",
  (state) => {
    return state.factualSuccess ? "end" : "vector_fallback";
  },
  {
    end: END,
    vector_fallback: "rag_recommendation"
  }
);
workflow.addEdge("rag_recommendation", END);
workflow.addEdge("direct_chat", END);
workflow.addEdge("unsupported", END);
workflow.addEdge("blocked", END);

export const compiledChatGraph = workflow.compile();
