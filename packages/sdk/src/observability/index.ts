/**
 * AI Observability SDK interfaces (ADR-091) — OpenTelemetry GenAI semantic
 * conventions for LLM / agent / tool / retriever spans.
 *
 * Phase 1 exports spans to a local SQLite `OtelSpan` table (no Docker
 * dependency); Phase 2+ exports to a self-hosted Langfuse instance
 * (richer UI, dashboards, cost analytics); Phase 3+ exports to an
 * optional cloud OTel collector with no code change (instrumentation is
 * OTel-native). The `AIAuditEvent` table (ADR-084) remains the
 * authoritative source of truth for compliance; Langfuse is the
 * operations surface.
 *
 * This file contains TYPE DEFINITIONS ONLY — no implementation logic.
 */

/** OpenTelemetry GenAI span kind (per OTel GenAI semantic conventions). */
export type AISpanKind = 'gen_ai' | 'agent' | 'tool' | 'retriever' | 'embedding' | 'chunker';

/** Status of an emitted span. */
export type AISpanStatus = 'ok' | 'error' | 'unset';

/** Agent execution status (mirrors ADR-049 AgentRuntime). */
export type AgentRunStatus = 'running' | 'succeeded' | 'failed' | 'cancelled' | 'paused';

/** Tool invocation status (mirrors ADR-054 ToolResult). */
export type ToolInvocationStatus = 'SUCCEEDED' | 'FAILED' | 'REJECTED' | 'COMPENSATED';

/** Token usage breakdown (per OTel `gen_ai.usage.*` conventions). */
export interface TokenUsage {
  readonly promptTokens: number;
  readonly completionTokens: number;
  readonly totalTokens: number;
  readonly cachedPromptTokens?: number;
  readonly reasoningTokens?: number;
}

/** A named event recorded on a span (per OTel span events). */
export interface AISpanEvent {
  readonly name: string;
  readonly timestamp: string;
  readonly attributes?: Readonly<Record<string, unknown>>;
}

/** Model invocation metrics for a single LLM `generate()` call. */
export interface ModelMetrics {
  readonly modelId: string;
  readonly modelVersion: string;
  readonly provider: string;
  readonly system: string;
  readonly promptTokens: number;
  readonly completionTokens: number;
  readonly totalTokens: number;
  readonly latencyMs: number;
  readonly timeToFirstTokenMs?: number;
  readonly finishReasons: readonly string[];
  readonly costUsd?: number;
  readonly requestId?: string;
  readonly responseId?: string;
  readonly temperature?: number;
  readonly topP?: number;
}

/** Metrics for a single agent execution (per ADR-049 AgentRuntime). */
export interface AgentMetrics {
  readonly agentId: string;
  readonly agentContractId: string;
  readonly tenantId: string;
  readonly sessionId: string;
  readonly steps: number;
  readonly maxSteps: number;
  readonly llmCallCount: number;
  readonly toolCallCount: number;
  readonly retrieverCallCount: number;
  readonly latencyMs: number;
  readonly promptTokens: number;
  readonly completionTokens: number;
  readonly totalCostUsd?: number;
  readonly status: AgentRunStatus;
  readonly startedAt: string;
  readonly completedAt?: string;
  readonly error?: string;
}

/** Metrics for a single tool invocation (per ADR-054 ToolRegistry). */
export interface ToolMetrics {
  readonly toolId: string;
  readonly toolName: string;
  readonly tenantId: string;
  readonly agentId?: string;
  readonly invocationId: string;
  readonly riskClass: 'LOW' | 'MEDIUM' | 'HIGH' | 'CRITICAL';
  readonly sideEffects: 'NONE' | 'READ' | 'WRITE' | 'IRREVERSIBLE';
  readonly status: ToolInvocationStatus;
  readonly latencyMs: number;
  readonly retryCount: number;
  readonly approvedBy?: string;
  readonly errorMessage?: string;
  readonly startedAt: string;
  readonly completedAt: string;
}

/** GenAI span data emitted by `AIObservabilityEmitter` (per OTel semantic conventions). */
export interface AIObservabilitySpan {
  readonly spanId: string;
  readonly traceId: string;
  readonly parentSpanId?: string;
  readonly name: string;
  readonly kind: AISpanKind;
  readonly status: AISpanStatus;
  readonly startedAt: string;
  readonly endedAt: string;
  readonly latencyMs: number;
  readonly tenantId: string;
  readonly agentId?: string;
  readonly sessionId?: string;
  readonly toolId?: string;
  readonly modelId?: string;
  readonly attributes: Readonly<Record<string, unknown>>;
  readonly events: readonly AISpanEvent[];
  readonly usage?: TokenUsage;
  readonly resourceSpans?: Readonly<Record<string, unknown>>;
}

/** Options for starting a new span. */
export interface AISpanStartOptions {
  readonly name: string;
  readonly kind: AISpanKind;
  readonly parentSpanId?: string;
  readonly tenantId: string;
  readonly agentId?: string;
  readonly sessionId?: string;
  readonly toolId?: string;
  readonly modelId?: string;
  readonly attributes?: Readonly<Record<string, unknown>>;
}

/**
 * A live (open) span — extends `AIObservabilitySpan` with the mutator
 * methods callers use while the span is in flight. The span is serialized
 * to its final `AIObservabilitySpan` shape by `end()`.
 */
export interface AIObservabilityLiveSpan extends AIObservabilitySpan {
  end(status?: AISpanStatus, attributes?: Readonly<Record<string, unknown>>): Promise<void>;
  recordError(error: Error, attributes?: Readonly<Record<string, unknown>>): Promise<void>;
  addEvent(name: string, attributes?: Readonly<Record<string, unknown>>): Promise<void>;
  setAttributes(attributes: Readonly<Record<string, unknown>>): void;
}

/**
 * `AIObservabilityEmitter` — emits OTel GenAI spans for every LLM
 * `generate()`, every `tool()` invocation, every `Retriever.retrieve()`,
 * per ADR-091 §4 Component 1. Exporters are pluggable: Phase 1 SQLite
 * `OtelSpan` table; Phase 2+ self-hosted Langfuse; Phase 3+ cloud OTel
 * collector (no code change required — instrumentation is OTel-native).
 */
export interface AIObservabilityEmitter {
  startSpan(options: AISpanStartOptions): AIObservabilityLiveSpan;
  emitSpan(span: AIObservabilitySpan): Promise<void>;
  emitModelMetrics(metrics: ModelMetrics): Promise<void>;
  emitAgentMetrics(metrics: AgentMetrics): Promise<void>;
  emitToolMetrics(metrics: ToolMetrics): Promise<void>;
}
