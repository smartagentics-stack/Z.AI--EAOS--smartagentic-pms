/**
 * AI Security SDK interfaces (ADR-080 umbrella; ADR-081 prompt-injection
 * defense; ADR-082 data-exfiltration prevention; ADR-092 model trust;
 * ADR-094 agent sandbox & egress control; ADR-096 EU AI Act + GDPR).
 *
 * Covers the 6-layer prompt-injection defense, PII redaction + default-
 * deny egress allowlist, Sigstore model-signing verification, and the
 * agent execution sandbox. All controls are runtime boundaries that
 * contain a compromised or injected agent — defense-in-depth that
 * compensates for Phase 1 small-model (Phi-3.5-mini, Qwen2.5-7B) weaker
 * instruction-hierarchy training per ADR-081.
 *
 * This file contains TYPE DEFINITIONS ONLY — no implementation logic.
 */

/** Prompt-injection defense layer (per ADR-081 §4 6-layer architecture). */
export type PromptInjectionLayer =
  | 'instruction-hierarchy'
  | 'input-classification'
  | 'output-classification'
  | 'system-prompt-isolation'
  | 'kb-sanitization'
  | 'tool-approval-gate';

/** PII detector class (per ADR-082 §4 TypeScript-native detector). */
export type PIIClass =
  | 'email'
  | 'phone'
  | 'passport'
  | 'national-id'
  | 'credit-card'
  | 'iban'
  | 'name'
  | 'address'
  | 'date-of-birth'
  | 'custom';

/** GDPR Article 22 decision-effect classification (per ADR-082 §4). */
export type DecisionEffectClass =
  'no-effect' | 'minor-effect' | 'significant-effect' | 'legal-effect';

/** Egress allowlist protocol (per ADR-094 §4 default-deny egress). */
export type EgressProtocol = 'http' | 'https' | 'ws' | 'wss' | 'tcp';

/** Tool side-effect classification (per ADR-086 / ADR-094 §4 dimension 1). */
export type ToolSideEffectClass =
  'PURE_READ' | 'WRITE_IN_SESSION' | 'WRITE_PERSISTENT' | 'WRITE_IRREVERSIBLE' | 'EXTERNAL_EGRESS';

/** Result of an input-classification rail (Llama Prompt Guard 2 — Layer 2). */
export interface PromptClassificationResult {
  readonly layer: PromptInjectionLayer;
  readonly label: 'BENIGN' | 'INJECTION' | 'JAILBREAK';
  readonly confidence: number;
  readonly reason?: string;
  readonly blocked: boolean;
  readonly evaluatedAt: string;
}

/** Result of an output-classification rail (Llama Guard 4 — Layer 3). */
export interface OutputClassificationResult {
  readonly layer: PromptInjectionLayer;
  readonly label: 'safe' | 'unsafe';
  readonly hazardCategories: readonly string[];
  readonly confidence: number;
  readonly redacted: boolean;
  readonly redactedOutput?: string;
  readonly evaluatedAt: string;
}

/** PII detection finding. */
export interface PIIFinding {
  readonly piiClass: PIIClass;
  readonly field?: string;
  readonly startOffset: number;
  readonly endOffset: number;
  readonly matchedText: string;
  readonly confidence: number;
}

/** Result of a PII redaction pass on a prompt or tool-call argument. */
export interface PIIRedactionResult {
  readonly findings: readonly PIIFinding[];
  readonly redactedText: string;
  readonly redactionCount: number;
  readonly evaluatedAt: string;
}

/** Egress allowlist rule (per ADR-094 §4 default-deny egress). */
export interface EgressAllowlistRule {
  readonly id: string;
  readonly host: string;
  readonly port?: number;
  readonly protocol: EgressProtocol;
  readonly path?: string;
  readonly method?: string;
  readonly tenantId: string | null;
  readonly agentId: string | null;
  readonly toolId: string | null;
  readonly reason: string;
  readonly expiresAt?: string | null;
}

/** Egress decision for an outbound request. */
export interface EgressDecision {
  readonly allowed: boolean;
  readonly matchedRuleId?: string;
  readonly reason: string;
  readonly evaluatedAt: string;
}

/** Outbound request evaluated against the egress allowlist. */
export interface EgressRequest {
  readonly host: string;
  readonly port?: number;
  readonly protocol: EgressProtocol;
  readonly path?: string;
  readonly method?: string;
  readonly tenantId?: string;
  readonly agentId?: string;
  readonly toolId?: string;
}

/**
 * `EgressAllowlist` — default-deny egress rules collection (per ADR-094
 * §4). A prompt-injection attack that achieves tool-call execution cannot
 * exfiltrate guest data to any URL/IP not on this allowlist.
 */
export interface EgressAllowlist {
  list(): Promise<readonly EgressAllowlistRule[]>;
  add(rule: Omit<EgressAllowlistRule, 'id'>): Promise<EgressAllowlistRule>;
  remove(ruleId: string): Promise<void>;
  evaluate(request: EgressRequest): Promise<EgressDecision>;
}

/** SLSA Build Level 3 provenance attestation (per ADR-092 §4). */
export interface SlsaProvenance {
  readonly sourceRepo: string;
  readonly sourceCommit: string;
  readonly buildTool: string;
  readonly buildToolCommit: string;
  readonly outputHash: string;
  readonly outputSizeBytes: number;
  readonly license: string;
  readonly signer: string;
  readonly signedAt: string;
}

/** Outcome of a Sigstore model-signing verification (per ADR-092). */
export interface ModelTrustVerificationResult {
  readonly modelId: string;
  readonly modelVersion: string;
  readonly ggufSha256: string;
  readonly sigstoreVerified: boolean;
  readonly slsaBuildLevel: number;
  readonly provenance: SlsaProvenance | null;
  readonly signerKeyId?: string;
  readonly verifiedAt: string;
  readonly verificationError?: string;
}

/** Input for recording a verified model signature. */
export interface ModelSignatureRecord {
  readonly modelId: string;
  readonly modelVersion: string;
  readonly ggufSha256: string;
  readonly sigstoreSignature: string;
  readonly slsaProvenance: SlsaProvenance;
  readonly verifiedBy: string;
}

/**
 * `ModelTrustVerifier` — verifies Sigstore signature + SLSA Build Level 3
 * provenance at install time (Windows installer) and load time (Ollama
 * model loader wrapper). Failure → `ModelIntegrityError` +
 * `AIAuditEvent` `eventType=MODEL_INTEGRITY_FAILED` + abort (per ADR-092).
 */
export interface ModelTrustVerifier {
  verifyModel(modelPath: string): Promise<ModelTrustVerificationResult>;
  verifyBundle(modelIds: readonly string[]): Promise<readonly ModelTrustVerificationResult[]>;
  recordSignature(record: ModelSignatureRecord): Promise<void>;
}

/** Per-(agentId, toolId, tenantId) rate-limit window (per ADR-094 §4 dimension 4). */
export interface RateLimitWindow {
  readonly agentId: string;
  readonly toolId: string;
  readonly tenantId: string;
  readonly maxInvocations: number;
  readonly windowMs: number;
  readonly currentCount: number;
  readonly windowStartedAt: string;
  readonly exhausted: boolean;
}

/** Circuit-breaker state for a tool (per ADR-094 §4 dimension 5). */
export interface CircuitBreakerState {
  readonly toolId: string;
  readonly tenantId: string;
  readonly state: 'closed' | 'open' | 'half-open';
  readonly failureCount: number;
  readonly failureThreshold: number;
  readonly openedAt?: string;
  readonly cooldownMs: number;
}

/** A tool invocation request submitted to the `AgentSandbox`. */
export interface SandboxToolInvocation {
  readonly toolId: string;
  readonly input: Readonly<Record<string, unknown>>;
  readonly idempotencyKey: string;
  readonly sideEffectClass: ToolSideEffectClass;
}

/** Outcome of executing a tool through the `AgentSandbox`. */
export interface SandboxToolResult {
  readonly invocationId: string;
  readonly allowed: boolean;
  readonly blocked: boolean;
  readonly blockReason?: string;
  readonly output?: Readonly<Record<string, unknown>>;
  readonly errorMessage?: string;
  readonly piiRedaction?: PIIRedactionResult;
  readonly egressDecision?: EgressDecision;
  readonly rateLimitWindow?: RateLimitWindow;
  readonly circuitBreaker?: CircuitBreakerState;
  readonly startedAt: string;
  readonly completedAt: string;
}

/** Security scan outcome summary (per ADR-080 umbrella). */
export interface SecurityScanResult {
  readonly scanId: string;
  readonly tenantId: string;
  readonly agentId?: string;
  readonly sessionId?: string;
  readonly layers: readonly PromptInjectionLayer[];
  readonly promptClassification?: PromptClassificationResult;
  readonly outputClassification?: OutputClassificationResult;
  readonly piiRedaction?: PIIRedactionResult;
  readonly egressDecision?: EgressDecision;
  readonly modelTrust?: ModelTrustVerificationResult;
  readonly rateLimitWindow?: RateLimitWindow;
  readonly circuitBreaker?: CircuitBreakerState;
  readonly blocked: boolean;
  readonly blockReason?: string;
  readonly scannedAt: string;
}

/** Input for evaluating prompt or output through the defense rails. */
export interface DefenseEvaluationContext {
  readonly tenantId?: string;
  readonly agentId?: string;
  readonly sessionId?: string;
}

/**
 * `PromptInjectionDefense` — 6-layer defense-in-depth per ADR-081 §4:
 * (L1) instruction-hierarchy prompt template, (L2) input classification
 * (Llama Prompt Guard 2 via Ollama), (L3) output classification (Llama
 * Guard 4 via Ollama), (L4) system-prompt isolation, (L5) knowledge-base
 * document sanitization (Anthropic "spotlighting"), (L6) tool-call
 * approval gates.
 */
export interface PromptInjectionDefense {
  evaluateInput(
    input: string,
    context?: DefenseEvaluationContext,
  ): Promise<PromptClassificationResult>;
  evaluateOutput(
    output: string,
    context?: DefenseEvaluationContext,
  ): Promise<OutputClassificationResult>;
  wrapSystemPrompt(systemPrompt: string): string;
  wrapUserInput(userInput: string): string;
  wrapToolOutput(toolOutput: string, source: string): string;
  wrapRetrievedDocument(document: string, chunkId: string, source: string): string;
}

/** Result of a GDPR Article 22 decision-effect classification. */
export interface DecisionEffectClassification {
  readonly action: string;
  readonly effect: DecisionEffectClass;
  readonly requiresHumanApproval: boolean;
  readonly reason: string;
}

/**
 * `DataExfiltrationPrevention` — 4-layer defense per ADR-082: PII
 * redaction on prompt input + PII redaction on model output + default-
 * deny egress allowlist + GDPR Article 22 decision-effect mapping.
 */
export interface DataExfiltrationPrevention {
  redactInput(text: string, context?: DefenseEvaluationContext): Promise<PIIRedactionResult>;
  redactOutput(text: string, context?: DefenseEvaluationContext): Promise<PIIRedactionResult>;
  classifyDecision(action: string, effect: DecisionEffectClass): DecisionEffectClassification;
  getEgressAllowlist(): EgressAllowlist;
}

/**
 * `AgentSandbox` — the runtime boundary that contains a compromised or
 * injected agent (per ADR-094 §4). Even if a prompt-injection attack
 * achieves tool-call execution, the sandbox ensures: (a) the call
 * destination is on the egress allowlist; (b) the arguments are
 * zod-validated; (c) the per-(agentId, toolId, tenantId) rate limit is
 * not exceeded; (d) the circuit breaker is not open; (e) the idempotency
 * key is present for HIGH/CRITICAL tools.
 */
export interface AgentSandbox {
  readonly agentId: string;
  readonly tenantId: string;
  readonly sessionId: string;
  readonly maxSteps: number;
  readonly maxTokensPerStep: number;
  readonly maxTotalCostUsd: number;
  readonly egressAllowlist: EgressAllowlist;
  readonly rateLimitWindows: readonly RateLimitWindow[];
  readonly circuitBreakers: readonly CircuitBreakerState[];
  executeTool(invocation: SandboxToolInvocation): Promise<SandboxToolResult>;
  evaluateInput(
    input: string,
    context?: DefenseEvaluationContext,
  ): Promise<PromptClassificationResult & PIIRedactionResult>;
  evaluateOutput(
    output: string,
    context?: DefenseEvaluationContext,
  ): Promise<OutputClassificationResult & PIIRedactionResult>;
}
