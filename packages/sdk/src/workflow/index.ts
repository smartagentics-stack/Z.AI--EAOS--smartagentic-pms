export interface WorkflowInput { readonly idempotencyKey: string; readonly tenantId: string }
export interface WorkflowResult<TOutput = unknown> { readonly status: 'completed' | 'failed' | 'compensated'; readonly output?: TOutput; readonly workflowId: string; readonly durationMs: number }
export interface WorkflowContext { readonly workflowId: string; readonly tenantId: string; runStep<T>(stepName: string, fn: () => Promise<T>): Promise<T>; sleep(durationMs: number): Promise<void> }
export interface WorkflowEngine { start<TInput extends WorkflowInput>(definition: unknown, input: TInput): Promise<{ workflowId: string }>; getResult<TOutput>(workflowId: string, timeoutMs?: number): Promise<WorkflowResult<TOutput>>; cancel(workflowId: string): Promise<void> }
