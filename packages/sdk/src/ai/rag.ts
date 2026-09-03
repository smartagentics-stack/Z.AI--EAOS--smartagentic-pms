// ADR-030 RAG Pipeline · ADR-032 Source Attribution & Citation · ADR-033 Confidence Scoring.
// Thin SmartAgentics-owned RagGenerator orchestrating Stream 1 LLM + Stream 2 retrieval + citation-forcing prompt.
// Fail-closed on LocalLLMRuntime.isAvailable() — never silently falls back to a cloud LLM (research R-3.7).

import type { LocalLLMRuntime, ModelId, Version } from './runtime.js';
import type { SearchResult } from './retriever.js';

/** Confidence display tiers per ADR-033 §4 (avoid false precision). */
export type ConfidenceTier = 'VERY_LOW' | 'LOW' | 'MEDIUM' | 'HIGH' | 'VERY_HIGH';

/** Method used to compute the confidence score (audit trail). */
export type ConfidenceMethod =
  'COVERAGE_V1' | 'COVERAGE_V2_HHEM' | 'FAITHFULNESS' | 'ANSWER_RELEVANCY';

/** A resolved citation — chunkId → (docId, docVersion, headerPath, sourcePath, pageNumber, snippet). */
export interface Citation {
  readonly chunkId: string;
  readonly docId: string;
  readonly docVersion: number;
  readonly headerPath: string;
  readonly sourcePath: string;
  readonly pageNumber?: number;
  readonly snippet: string;
}

/** Resolves LLM-emitted <source chunk_id="..."/> tags to structured Citations (ADR-032). */
export interface CitationResolver {
  resolve(
    answerRaw: string,
    retrieved: readonly SearchResult[],
  ): Promise<{
    readonly citations: readonly Citation[];
    readonly unresolvedChunkIds: readonly string[];
  }>;
}

/** Confidence score envelope per ADR-033. */
export interface ConfidenceScore {
  readonly score: number;
  readonly tier: ConfidenceTier;
  readonly method: ConfidenceMethod;
  readonly components: {
    readonly coverage: number;
    readonly retrieval: number;
    readonly logprob: number | null;
  };
  readonly weights: {
    readonly coverage: number;
    readonly retrieval: number;
    readonly logprob: number;
  };
}

/** Request to the RagGenerator. */
export interface RagRequest {
  readonly query: string;
  readonly tenantId: string;
  readonly userId: string;
  readonly propertyId?: string;
  readonly retrievedChunks: readonly SearchResult[];
  readonly llm: LocalLLMRuntime;
  readonly modelId?: ModelId;
  readonly version?: Version;
  readonly systemPromptOverride?: string;
  readonly temperature?: number;
  readonly maxTokens?: number;
  readonly idempotencyKey: string;
}

/** Response from the RagGenerator — post-processed answer + structured citations + confidence. */
export interface RagResponse {
  readonly answer: string;
  readonly answerRaw: string;
  readonly citations: readonly Citation[];
  readonly unresolvedCitationChunkIds: readonly string[];
  readonly confidence: ConfidenceScore;
  readonly usage: {
    readonly tokensIn: number;
    readonly tokensOut: number;
    readonly latencyMs: number;
  };
  readonly modelUsed: string;
  readonly queryId: string;
}

/** Streaming chunk emitted during RagGenerator.generate() (answer + citations may interleave). */
export type RagStreamChunk =
  | { readonly kind: 'ANSWER_DELTA'; readonly delta: string }
  | { readonly kind: 'CITATIONS'; readonly citations: readonly Citation[] }
  | { readonly kind: 'CONFIDENCE'; readonly confidence: ConfidenceScore }
  | { readonly kind: 'DONE'; readonly response: RagResponse }
  | {
      readonly kind: 'ERROR';
      readonly errorKind: 'LLM_UNAVAILABLE' | 'RETRIEVAL_EMPTY' | 'PARSE_FAILURE';
      readonly message: string;
    };

/** Result of a RagEvaluator.evaluate() call (ADR-033 §4). */
export interface EvalResult {
  readonly faithfulness: number;
  readonly answerRelevancy: number;
  readonly coverage: number;
  readonly retrieval: number;
  readonly logprob: number | null;
  readonly hallucinationDetected: boolean;
  readonly evaluatedAt: string;
}

/** Evaluator contract per ADR-033 §4 — Phase 1: coverage_v1 (local heuristic); Phase 2+: HHEM-2.1-Open. */
export interface RagEvaluator {
  evaluate(request: RagRequest, response: RagResponse): Promise<EvalResult>;
  runGoldenSuite(
    suite: unknown,
  ): Promise<{
    readonly totalTests: number;
    readonly passed: number;
    readonly hallucinationRate: number;
  }>;
}

/**
 * RagGenerator contract per ADR-030 §4.
 * Calls Stream 1's LocalLLMRuntime via OpenAI-compatible HTTP, builds a citation-forcing prompt,
 * post-processes <source> tags, resolves chunkIds, computes confidence, and persists
 * KnowledgeQuery + KnowledgeCitation rows (ADR-028/032).
 */
export interface RagGenerator {
  generate(request: RagRequest): Promise<RagResponse>;
  stream(request: RagRequest): AsyncIterable<RagStreamChunk>;
  isAvailable(): boolean;
}
