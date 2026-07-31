export interface AIRequest { readonly prompt: string; readonly tenantId: string; readonly userId: string; readonly idempotencyKey: string }
export interface AIUsage { readonly promptTokens: number; readonly completionTokens: number; readonly totalTokens: number; readonly estimatedCostUSD: number }
export interface AIResponse { readonly content: string; readonly usage: AIUsage; readonly model: string; readonly requestId: string }
export interface AIProvider { generate(request: AIRequest): Promise<AIResponse>; isAvailable(): boolean; estimateCost(request: AIRequest): Promise<{ estimatedCostUSD: number; estimatedTokens: number }> }
export interface AIEvaluator { evaluate(prompt: string, expectedResponse?: string): Promise<{ score: number; hallucinationDetected: boolean; latencyMs: number }>; runGoldenSuite(suite: unknown): Promise<{ totalTests: number; passed: number; hallucinationRate: number }> }
export interface AIBudgetEnforcer { checkBudget(tenantId: string): Promise<{ allowed: boolean; remaining: number }>; recordUsage(tenantId: string, usage: AIUsage): Promise<void> }
