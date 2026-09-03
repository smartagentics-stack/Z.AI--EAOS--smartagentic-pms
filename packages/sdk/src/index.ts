export * from './logger/index.js';
export * from './events/index.js';
export * from './config/index.js';
export * from './storage/index.js';
export * from './auth/index.js';
export * from './ai/index.js';
export * from './workflow/index.js';
export * from './notifications/index.js';
export * from './metrics/index.js';
export * from './errors/index.js';

// Phase E — Domain-Neutral Foundation (ADR-097 to ADR-103)
// Note: domain, crud, authorization, datatypes are available via subpath imports
// (e.g., @smartagentics/sdk/domain) to avoid barrel export name collisions.
export * from './domain/index.js';
// crud, authorization, datatypes excluded from barrel due to name collisions
// (RecordCommand, ToolPermission, FormulaDefinition) — import via subpath:
//   import { CrudService } from '@smartagentics/sdk/crud';
//   import { AuthorizationResolver } from '@smartagentics/sdk/authorization';
//   import { DataType } from '@smartagentics/sdk/datatypes';

// Phase E — AI Runtime Foundation (ADR-015 to ADR-054)
export * from './ai/runtime.js';
export * from './ai/embeddings.js';
export * from './ai/vector-store.js';
export * from './ai/retriever.js';
export * from './ai/reranker.js';
export * from './ai/chunker.js';
export * from './ai/memory.js';
export * from './ai/agent.js';
export * from './ai/supervisor.js';
export * from './ai/planner.js';
export * from './ai/auditor.js';
export * from './ai/tools.js';
export * from './ai/knowledge.js';
export * from './ai/rag.js';

// Phase E — Platform Foundation (ADR-070 to ADR-103)
// Note: workflow-engine excluded from barrel due to name collision with
// existing workflow module (WorkflowContext, WorkflowEngine).
// Import via subpath: import { WorkflowDefinition } from '@smartagentics/sdk/workflow-engine';
export * from './sync/index.js';
export * from './feature-flags/index.js';
export * from './ai-context/index.js';
export * from './observability/index.js';
export * from './security/index.js';
