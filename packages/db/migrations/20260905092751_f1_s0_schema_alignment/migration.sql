-- CreateTable
CREATE TABLE "Domain" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "tenantId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "displayName" TEXT NOT NULL,
    "version" TEXT NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'active',
    "configuration" TEXT NOT NULL,
    "capabilities" TEXT,
    "publishedAt" DATETIME,
    "deprecatedAt" DATETIME,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL,
    "revision" INTEGER NOT NULL DEFAULT 0,
    "deletedAt" DATETIME,
    "syncOrigin" TEXT,
    "idempotencyKey" TEXT
);

-- CreateTable
CREATE TABLE "Module" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "tenantId" TEXT NOT NULL,
    "domainId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "displayName" TEXT NOT NULL,
    "version" TEXT NOT NULL,
    "active" BOOLEAN NOT NULL DEFAULT true,
    "dependencies" TEXT,
    "capabilities" TEXT,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL,
    "revision" INTEGER NOT NULL DEFAULT 0,
    "deletedAt" DATETIME,
    "syncOrigin" TEXT,
    "idempotencyKey" TEXT
);

-- CreateTable
CREATE TABLE "EntityType" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "tenantId" TEXT NOT NULL,
    "domainId" TEXT NOT NULL,
    "moduleId" TEXT,
    "name" TEXT NOT NULL,
    "displayName" TEXT NOT NULL,
    "schemaJson" TEXT NOT NULL,
    "schemaVersion" INTEGER NOT NULL DEFAULT 1,
    "storageClass" TEXT NOT NULL,
    "typedTableName" TEXT,
    "lifecycle" TEXT,
    "permissions" TEXT,
    "publishedAt" DATETIME,
    "deprecatedAt" DATETIME,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL,
    "revision" INTEGER NOT NULL DEFAULT 0,
    "deletedAt" DATETIME,
    "syncOrigin" TEXT,
    "idempotencyKey" TEXT
);

-- CreateTable
CREATE TABLE "DynamicRecord" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "tenantId" TEXT NOT NULL,
    "domainId" TEXT NOT NULL,
    "entityTypeId" TEXT NOT NULL,
    "recordId" TEXT NOT NULL,
    "dataJson" TEXT NOT NULL,
    "schemaVersion" INTEGER NOT NULL,
    "lifecycleState" TEXT,
    "updatedAt" DATETIME NOT NULL,
    "revision" INTEGER NOT NULL DEFAULT 0,
    "deletedAt" DATETIME,
    "syncOrigin" TEXT,
    "idempotencyKey" TEXT
);

-- CreateTable
CREATE TABLE "EntityFieldIndex" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "tenantId" TEXT NOT NULL,
    "dynamicRecordId" TEXT NOT NULL,
    "domainId" TEXT NOT NULL,
    "entityTypeId" TEXT NOT NULL,
    "fieldName" TEXT NOT NULL,
    "fieldValue" TEXT NOT NULL,
    "fieldType" TEXT NOT NULL,
    "updatedAt" DATETIME NOT NULL,
    "revision" INTEGER NOT NULL DEFAULT 0,
    "deletedAt" DATETIME,
    "syncOrigin" TEXT,
    "idempotencyKey" TEXT
);

-- CreateTable
CREATE TABLE "Relationship" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "tenantId" TEXT NOT NULL,
    "domainId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "sourceEntityTypeId" TEXT NOT NULL,
    "sourceFieldName" TEXT NOT NULL,
    "targetEntityTypeId" TEXT NOT NULL,
    "targetFieldName" TEXT,
    "cardinality" TEXT NOT NULL,
    "ownership" TEXT NOT NULL,
    "onDelete" TEXT NOT NULL,
    "permissions" TEXT,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL,
    "revision" INTEGER NOT NULL DEFAULT 0,
    "deletedAt" DATETIME,
    "syncOrigin" TEXT,
    "idempotencyKey" TEXT
);

-- CreateTable
CREATE TABLE "AIModel" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "tenantId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "version" TEXT NOT NULL,
    "provider" TEXT NOT NULL,
    "runtime" TEXT NOT NULL,
    "modelType" TEXT NOT NULL,
    "contextSize" INTEGER NOT NULL,
    "quantization" TEXT,
    "hardwareRequirements" TEXT,
    "capabilities" TEXT,
    "status" TEXT NOT NULL DEFAULT 'registered',
    "installedLocation" TEXT,
    "sha256" TEXT,
    "licenseType" TEXT,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL,
    "revision" INTEGER NOT NULL DEFAULT 0,
    "deletedAt" DATETIME,
    "syncOrigin" TEXT,
    "idempotencyKey" TEXT
);

-- CreateTable
CREATE TABLE "KnowledgeDocument" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "tenantId" TEXT NOT NULL,
    "domainId" TEXT NOT NULL,
    "title" TEXT NOT NULL,
    "sourceType" TEXT NOT NULL,
    "documentType" TEXT NOT NULL,
    "department" TEXT NOT NULL,
    "contentHash" TEXT NOT NULL,
    "rawFileHash" TEXT,
    "status" TEXT NOT NULL DEFAULT 'pending',
    "version" INTEGER NOT NULL DEFAULT 1,
    "lastVerifiedAt" DATETIME,
    "freshnessTtlDays" INTEGER NOT NULL DEFAULT 90,
    "metadata" TEXT,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL,
    "revision" INTEGER NOT NULL DEFAULT 0,
    "deletedAt" DATETIME,
    "syncOrigin" TEXT,
    "idempotencyKey" TEXT
);

-- CreateTable
CREATE TABLE "KnowledgeChunk" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "tenantId" TEXT NOT NULL,
    "documentId" TEXT NOT NULL,
    "parentId" TEXT,
    "content" TEXT NOT NULL,
    "chunkHash" TEXT NOT NULL,
    "chunkType" TEXT NOT NULL,
    "position" INTEGER NOT NULL,
    "tokenCount" INTEGER NOT NULL,
    "embeddingModel" TEXT,
    "embeddingVersion" TEXT,
    "embeddingDim" INTEGER,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP
);

-- CreateTable
CREATE TABLE "KnowledgeCitation" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "tenantId" TEXT NOT NULL,
    "queryId" TEXT NOT NULL,
    "chunkId" TEXT NOT NULL,
    "documentId" TEXT NOT NULL,
    "docVersion" INTEGER NOT NULL,
    "relevanceScore" REAL NOT NULL,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP
);

-- CreateTable
CREATE TABLE "KnowledgeQuery" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "tenantId" TEXT NOT NULL,
    "domainId" TEXT NOT NULL,
    "userId" TEXT,
    "query" TEXT NOT NULL,
    "response" TEXT,
    "citations" TEXT,
    "confidenceScore" REAL,
    "confidenceTier" TEXT,
    "citationIrregularity" TEXT,
    "modelUsed" TEXT,
    "latencyMs" INTEGER,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP
);

-- CreateTable
CREATE TABLE "MemoryRecord" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "tenantId" TEXT NOT NULL,
    "domainId" TEXT NOT NULL,
    "userId" TEXT,
    "agentId" TEXT,
    "sessionId" TEXT,
    "category" TEXT NOT NULL,
    "content" TEXT NOT NULL,
    "embedding" TEXT,
    "importance" REAL NOT NULL DEFAULT 0.5,
    "sensitivity" TEXT NOT NULL DEFAULT 'internal',
    "retentionPolicy" TEXT,
    "provenance" TEXT,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL,
    "revision" INTEGER NOT NULL DEFAULT 0,
    "deletedAt" DATETIME,
    "syncOrigin" TEXT,
    "idempotencyKey" TEXT
);

-- CreateTable
CREATE TABLE "MemoryEvent" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "tenantId" TEXT NOT NULL,
    "memoryRecordId" TEXT NOT NULL,
    "eventType" TEXT NOT NULL,
    "actorId" TEXT,
    "actorType" TEXT,
    "details" TEXT,
    "timestamp" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP
);

-- CreateTable
CREATE TABLE "MemoryAccessLog" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "tenantId" TEXT NOT NULL,
    "memoryRecordId" TEXT NOT NULL,
    "accessorId" TEXT,
    "accessorType" TEXT,
    "operation" TEXT NOT NULL,
    "context" TEXT,
    "timestamp" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP
);

-- CreateTable
CREATE TABLE "AgentContract" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "tenantId" TEXT NOT NULL,
    "domainId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "purpose" TEXT NOT NULL,
    "identity" TEXT NOT NULL,
    "capabilities" TEXT,
    "allowedTools" TEXT,
    "maxRiskClass" TEXT NOT NULL DEFAULT 'LOW',
    "memoryPolicy" TEXT,
    "knowledgeScope" TEXT,
    "decisionBoundaries" TEXT,
    "policies" TEXT,
    "escalationRules" TEXT,
    "auditConfig" TEXT,
    "manualFallback" BOOLEAN NOT NULL DEFAULT false,
    "maxSteps" INTEGER NOT NULL DEFAULT 20,
    "maxDurationMs" INTEGER NOT NULL DEFAULT 300000,
    "status" TEXT NOT NULL DEFAULT 'draft',
    "version" TEXT NOT NULL DEFAULT '0.1.0',
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL,
    "revision" INTEGER NOT NULL DEFAULT 0,
    "deletedAt" DATETIME,
    "syncOrigin" TEXT,
    "idempotencyKey" TEXT
);

-- CreateTable
CREATE TABLE "AgentSession" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "tenantId" TEXT NOT NULL,
    "agentContractId" TEXT NOT NULL,
    "userId" TEXT,
    "status" TEXT NOT NULL DEFAULT 'active',
    "context" TEXT,
    "budget" TEXT,
    "startedAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "endedAt" DATETIME,
    "updatedAt" DATETIME NOT NULL,
    "revision" INTEGER NOT NULL DEFAULT 0,
    "deletedAt" DATETIME,
    "syncOrigin" TEXT,
    "idempotencyKey" TEXT
);

-- CreateTable
CREATE TABLE "AgentStep" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "tenantId" TEXT NOT NULL,
    "sessionId" TEXT NOT NULL,
    "stepNumber" INTEGER NOT NULL,
    "stepType" TEXT NOT NULL,
    "input" TEXT,
    "output" TEXT,
    "status" TEXT NOT NULL DEFAULT 'pending',
    "durationMs" INTEGER,
    "startedAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "endedAt" DATETIME
);

-- CreateTable
CREATE TABLE "Tool" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "tenantId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "description" TEXT NOT NULL,
    "inputSchema" TEXT NOT NULL,
    "outputSchema" TEXT NOT NULL,
    "riskClass" TEXT NOT NULL DEFAULT 'LOW',
    "sideEffects" TEXT NOT NULL DEFAULT 'read',
    "offlineCompatible" BOOLEAN NOT NULL DEFAULT true,
    "auditRequired" BOOLEAN NOT NULL DEFAULT true,
    "status" TEXT NOT NULL DEFAULT 'active',
    "generatorType" TEXT,
    "domainId" TEXT,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL,
    "revision" INTEGER NOT NULL DEFAULT 0,
    "deletedAt" DATETIME,
    "syncOrigin" TEXT,
    "idempotencyKey" TEXT
);

-- CreateTable
CREATE TABLE "ToolPermission" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "tenantId" TEXT NOT NULL,
    "toolId" TEXT NOT NULL,
    "agentContractId" TEXT NOT NULL,
    "grantType" TEXT NOT NULL,
    "conditions" TEXT,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL,
    "revision" INTEGER NOT NULL DEFAULT 0,
    "deletedAt" DATETIME,
    "syncOrigin" TEXT,
    "idempotencyKey" TEXT
);

-- CreateTable
CREATE TABLE "AIAuditEvent" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "tenantId" TEXT NOT NULL,
    "agentId" TEXT,
    "sessionId" TEXT,
    "eventType" TEXT NOT NULL,
    "actorId" TEXT,
    "actorType" TEXT,
    "action" TEXT NOT NULL,
    "resource" TEXT,
    "result" TEXT,
    "severity" TEXT NOT NULL DEFAULT 'info',
    "details" TEXT,
    "traceId" TEXT,
    "correlationId" TEXT,
    "previousEventHash" TEXT,
    "rowHash" TEXT,
    "timestamp" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP
);

-- CreateTable
CREATE TABLE "AuditMerkleRoot" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "tenantId" TEXT NOT NULL,
    "date" DATETIME NOT NULL,
    "rootHash" TEXT NOT NULL,
    "signature" TEXT,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP
);

-- CreateTable
CREATE TABLE "AIConfiguration" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "tenantId" TEXT NOT NULL,
    "domainId" TEXT,
    "version" INTEGER NOT NULL DEFAULT 1,
    "configJson" TEXT NOT NULL,
    "promptInjectionConfig" TEXT NOT NULL,
    "piiRedactionConfig" TEXT NOT NULL,
    "egressConfig" TEXT NOT NULL,
    "approvalConfig" TEXT NOT NULL,
    "driftConfig" TEXT NOT NULL,
    "rateLimitConfig" TEXT NOT NULL,
    "modelConfig" TEXT NOT NULL,
    "auditConfig" TEXT NOT NULL,
    "changedBy" TEXT NOT NULL,
    "changedAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "previousVersionId" TEXT,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL,
    "revision" INTEGER NOT NULL DEFAULT 0,
    "deletedAt" DATETIME,
    "syncOrigin" TEXT,
    "idempotencyKey" TEXT
);

-- CreateTable
CREATE TABLE "SyncOutbox" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "tenantId" TEXT NOT NULL,
    "tableName" TEXT NOT NULL,
    "recordId" TEXT NOT NULL,
    "operation" TEXT NOT NULL,
    "eventJson" TEXT NOT NULL,
    "revision" INTEGER NOT NULL DEFAULT 0,
    "status" TEXT NOT NULL DEFAULT 'pending',
    "attempts" INTEGER NOT NULL DEFAULT 0,
    "lastError" TEXT,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL
);

-- CreateTable
CREATE TABLE "SyncCheckpoint" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "tenantId" TEXT NOT NULL,
    "sessionType" TEXT NOT NULL,
    "cursor" TEXT,
    "lsn" TEXT,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL
);

-- CreateTable
CREATE TABLE "SyncConflict" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "tenantId" TEXT NOT NULL,
    "tableName" TEXT NOT NULL,
    "recordId" TEXT NOT NULL,
    "localRevision" INTEGER NOT NULL,
    "remoteRevision" INTEGER NOT NULL,
    "conflictType" TEXT NOT NULL,
    "localData" TEXT,
    "remoteData" TEXT,
    "resolution" TEXT,
    "resolvedBy" TEXT,
    "resolvedAt" DATETIME,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL
);

-- CreateTable
CREATE TABLE "FeatureFlag" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "tenantId" TEXT NOT NULL,
    "domainId" TEXT,
    "key" TEXT NOT NULL,
    "category" TEXT NOT NULL,
    "enabled" BOOLEAN NOT NULL DEFAULT false,
    "rolloutPct" INTEGER NOT NULL DEFAULT 0,
    "targetingJson" TEXT,
    "variantJson" TEXT,
    "description" TEXT,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL,
    "revision" INTEGER NOT NULL DEFAULT 0,
    "deletedAt" DATETIME,
    "syncOrigin" TEXT,
    "idempotencyKey" TEXT
);

-- CreateTable
CREATE TABLE "HumanApprovalRequest" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "tenantId" TEXT NOT NULL,
    "agentId" TEXT,
    "sessionId" TEXT,
    "toolId" TEXT,
    "riskClass" TEXT NOT NULL,
    "payload" TEXT,
    "status" TEXT NOT NULL DEFAULT 'pending',
    "approverId" TEXT,
    "approvedAt" DATETIME,
    "alterations" TEXT,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL,
    "revision" INTEGER NOT NULL DEFAULT 0,
    "deletedAt" DATETIME,
    "syncOrigin" TEXT,
    "idempotencyKey" TEXT
);

-- CreateTable
CREATE TABLE "WorkflowDefinition" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "tenantId" TEXT NOT NULL,
    "domainId" TEXT,
    "name" TEXT NOT NULL,
    "machineJson" TEXT NOT NULL,
    "version" TEXT NOT NULL DEFAULT '0.1.0',
    "status" TEXT NOT NULL DEFAULT 'draft',
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL,
    "revision" INTEGER NOT NULL DEFAULT 0,
    "deletedAt" DATETIME,
    "syncOrigin" TEXT,
    "idempotencyKey" TEXT
);

-- CreateTable
CREATE TABLE "WorkflowInstance" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "tenantId" TEXT NOT NULL,
    "definitionId" TEXT NOT NULL,
    "entityType" TEXT,
    "recordId" TEXT,
    "currentState" TEXT NOT NULL,
    "context" TEXT,
    "status" TEXT NOT NULL DEFAULT 'running',
    "startedAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "endedAt" DATETIME,
    "updatedAt" DATETIME NOT NULL,
    "revision" INTEGER NOT NULL DEFAULT 0,
    "deletedAt" DATETIME,
    "syncOrigin" TEXT,
    "idempotencyKey" TEXT
);

-- CreateTable
CREATE TABLE "RuleDefinition" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "tenantId" TEXT NOT NULL,
    "domainId" TEXT,
    "name" TEXT NOT NULL,
    "ruleType" TEXT NOT NULL,
    "decisionTable" TEXT,
    "formula" TEXT,
    "priority" INTEGER NOT NULL DEFAULT 100,
    "enabled" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL,
    "revision" INTEGER NOT NULL DEFAULT 0,
    "deletedAt" DATETIME,
    "syncOrigin" TEXT,
    "idempotencyKey" TEXT
);

-- CreateIndex
CREATE INDEX "Domain_tenantId_idx" ON "Domain"("tenantId");

-- CreateIndex
CREATE INDEX "Domain_tenantId_updatedAt_idx" ON "Domain"("tenantId", "updatedAt");

-- CreateIndex
CREATE INDEX "Domain_tenantId_status_idx" ON "Domain"("tenantId", "status");

-- CreateIndex
CREATE UNIQUE INDEX "Domain_tenantId_name_key" ON "Domain"("tenantId", "name");

-- CreateIndex
CREATE INDEX "Module_tenantId_idx" ON "Module"("tenantId");

-- CreateIndex
CREATE INDEX "Module_domainId_idx" ON "Module"("domainId");

-- CreateIndex
CREATE INDEX "Module_tenantId_active_idx" ON "Module"("tenantId", "active");

-- CreateIndex
CREATE INDEX "Module_tenantId_updatedAt_idx" ON "Module"("tenantId", "updatedAt");

-- CreateIndex
CREATE UNIQUE INDEX "Module_tenantId_domainId_name_key" ON "Module"("tenantId", "domainId", "name");

-- CreateIndex
CREATE INDEX "EntityType_tenantId_idx" ON "EntityType"("tenantId");

-- CreateIndex
CREATE INDEX "EntityType_domainId_idx" ON "EntityType"("domainId");

-- CreateIndex
CREATE INDEX "EntityType_tenantId_storageClass_idx" ON "EntityType"("tenantId", "storageClass");

-- CreateIndex
CREATE INDEX "EntityType_tenantId_updatedAt_idx" ON "EntityType"("tenantId", "updatedAt");

-- CreateIndex
CREATE UNIQUE INDEX "EntityType_tenantId_domainId_name_key" ON "EntityType"("tenantId", "domainId", "name");

-- CreateIndex
CREATE INDEX "DynamicRecord_tenantId_idx" ON "DynamicRecord"("tenantId");

-- CreateIndex
CREATE INDEX "DynamicRecord_tenantId_domainId_entityTypeId_updatedAt_idx" ON "DynamicRecord"("tenantId", "domainId", "entityTypeId", "updatedAt");

-- CreateIndex
CREATE INDEX "DynamicRecord_tenantId_entityTypeId_deletedAt_idx" ON "DynamicRecord"("tenantId", "entityTypeId", "deletedAt");

-- CreateIndex
CREATE UNIQUE INDEX "DynamicRecord_tenantId_entityTypeId_recordId_key" ON "DynamicRecord"("tenantId", "entityTypeId", "recordId");

-- CreateIndex
CREATE INDEX "EntityFieldIndex_tenantId_idx" ON "EntityFieldIndex"("tenantId");

-- CreateIndex
CREATE INDEX "EntityFieldIndex_tenantId_entityTypeId_fieldName_fieldValue_idx" ON "EntityFieldIndex"("tenantId", "entityTypeId", "fieldName", "fieldValue");

-- CreateIndex
CREATE INDEX "EntityFieldIndex_tenantId_updatedAt_idx" ON "EntityFieldIndex"("tenantId", "updatedAt");

-- CreateIndex
CREATE UNIQUE INDEX "EntityFieldIndex_entityTypeId_dynamicRecordId_fieldName_key" ON "EntityFieldIndex"("entityTypeId", "dynamicRecordId", "fieldName");

-- CreateIndex
CREATE INDEX "Relationship_tenantId_idx" ON "Relationship"("tenantId");

-- CreateIndex
CREATE INDEX "Relationship_domainId_idx" ON "Relationship"("domainId");

-- CreateIndex
CREATE INDEX "Relationship_sourceEntityTypeId_idx" ON "Relationship"("sourceEntityTypeId");

-- CreateIndex
CREATE INDEX "Relationship_targetEntityTypeId_idx" ON "Relationship"("targetEntityTypeId");

-- CreateIndex
CREATE INDEX "Relationship_tenantId_updatedAt_idx" ON "Relationship"("tenantId", "updatedAt");

-- CreateIndex
CREATE UNIQUE INDEX "Relationship_tenantId_domainId_name_key" ON "Relationship"("tenantId", "domainId", "name");

-- CreateIndex
CREATE INDEX "AIModel_tenantId_idx" ON "AIModel"("tenantId");

-- CreateIndex
CREATE INDEX "AIModel_tenantId_status_idx" ON "AIModel"("tenantId", "status");

-- CreateIndex
CREATE INDEX "AIModel_sha256_idx" ON "AIModel"("sha256");

-- CreateIndex
CREATE INDEX "AIModel_tenantId_updatedAt_idx" ON "AIModel"("tenantId", "updatedAt");

-- CreateIndex
CREATE UNIQUE INDEX "AIModel_tenantId_name_version_key" ON "AIModel"("tenantId", "name", "version");

-- CreateIndex
CREATE INDEX "KnowledgeDocument_tenantId_idx" ON "KnowledgeDocument"("tenantId");

-- CreateIndex
CREATE INDEX "KnowledgeDocument_tenantId_domainId_documentType_department_idx" ON "KnowledgeDocument"("tenantId", "domainId", "documentType", "department");

-- CreateIndex
CREATE INDEX "KnowledgeDocument_tenantId_lastVerifiedAt_idx" ON "KnowledgeDocument"("tenantId", "lastVerifiedAt");

-- CreateIndex
CREATE INDEX "KnowledgeDocument_contentHash_idx" ON "KnowledgeDocument"("contentHash");

-- CreateIndex
CREATE INDEX "KnowledgeDocument_tenantId_updatedAt_idx" ON "KnowledgeDocument"("tenantId", "updatedAt");

-- CreateIndex
CREATE UNIQUE INDEX "KnowledgeDocument_tenantId_contentHash_key" ON "KnowledgeDocument"("tenantId", "contentHash");

-- CreateIndex
CREATE INDEX "KnowledgeChunk_tenantId_idx" ON "KnowledgeChunk"("tenantId");

-- CreateIndex
CREATE INDEX "KnowledgeChunk_tenantId_documentId_idx" ON "KnowledgeChunk"("tenantId", "documentId");

-- CreateIndex
CREATE INDEX "KnowledgeChunk_chunkHash_idx" ON "KnowledgeChunk"("chunkHash");

-- CreateIndex
CREATE INDEX "KnowledgeChunk_parentId_idx" ON "KnowledgeChunk"("parentId");

-- CreateIndex
CREATE INDEX "KnowledgeCitation_tenantId_idx" ON "KnowledgeCitation"("tenantId");

-- CreateIndex
CREATE INDEX "KnowledgeCitation_queryId_idx" ON "KnowledgeCitation"("queryId");

-- CreateIndex
CREATE INDEX "KnowledgeCitation_chunkId_idx" ON "KnowledgeCitation"("chunkId");

-- CreateIndex
CREATE INDEX "KnowledgeCitation_documentId_idx" ON "KnowledgeCitation"("documentId");

-- CreateIndex
CREATE INDEX "KnowledgeQuery_tenantId_idx" ON "KnowledgeQuery"("tenantId");

-- CreateIndex
CREATE INDEX "KnowledgeQuery_tenantId_domainId_idx" ON "KnowledgeQuery"("tenantId", "domainId");

-- CreateIndex
CREATE INDEX "KnowledgeQuery_tenantId_createdAt_idx" ON "KnowledgeQuery"("tenantId", "createdAt");

-- CreateIndex
CREATE INDEX "MemoryRecord_tenantId_idx" ON "MemoryRecord"("tenantId");

-- CreateIndex
CREATE INDEX "MemoryRecord_tenantId_category_idx" ON "MemoryRecord"("tenantId", "category");

-- CreateIndex
CREATE INDEX "MemoryRecord_tenantId_userId_agentId_idx" ON "MemoryRecord"("tenantId", "userId", "agentId");

-- CreateIndex
CREATE INDEX "MemoryRecord_tenantId_sessionId_idx" ON "MemoryRecord"("tenantId", "sessionId");

-- CreateIndex
CREATE INDEX "MemoryRecord_tenantId_updatedAt_idx" ON "MemoryRecord"("tenantId", "updatedAt");

-- CreateIndex
CREATE INDEX "MemoryEvent_tenantId_idx" ON "MemoryEvent"("tenantId");

-- CreateIndex
CREATE INDEX "MemoryEvent_memoryRecordId_idx" ON "MemoryEvent"("memoryRecordId");

-- CreateIndex
CREATE INDEX "MemoryEvent_tenantId_timestamp_idx" ON "MemoryEvent"("tenantId", "timestamp");

-- CreateIndex
CREATE INDEX "MemoryAccessLog_tenantId_idx" ON "MemoryAccessLog"("tenantId");

-- CreateIndex
CREATE INDEX "MemoryAccessLog_memoryRecordId_idx" ON "MemoryAccessLog"("memoryRecordId");

-- CreateIndex
CREATE INDEX "MemoryAccessLog_tenantId_timestamp_idx" ON "MemoryAccessLog"("tenantId", "timestamp");

-- CreateIndex
CREATE INDEX "AgentContract_tenantId_idx" ON "AgentContract"("tenantId");

-- CreateIndex
CREATE INDEX "AgentContract_tenantId_status_idx" ON "AgentContract"("tenantId", "status");

-- CreateIndex
CREATE INDEX "AgentContract_tenantId_domainId_idx" ON "AgentContract"("tenantId", "domainId");

-- CreateIndex
CREATE INDEX "AgentContract_tenantId_updatedAt_idx" ON "AgentContract"("tenantId", "updatedAt");

-- CreateIndex
CREATE UNIQUE INDEX "AgentContract_tenantId_name_version_key" ON "AgentContract"("tenantId", "name", "version");

-- CreateIndex
CREATE INDEX "AgentSession_tenantId_idx" ON "AgentSession"("tenantId");

-- CreateIndex
CREATE INDEX "AgentSession_tenantId_agentContractId_idx" ON "AgentSession"("tenantId", "agentContractId");

-- CreateIndex
CREATE INDEX "AgentSession_tenantId_status_idx" ON "AgentSession"("tenantId", "status");

-- CreateIndex
CREATE INDEX "AgentSession_tenantId_updatedAt_idx" ON "AgentSession"("tenantId", "updatedAt");

-- CreateIndex
CREATE INDEX "AgentStep_tenantId_idx" ON "AgentStep"("tenantId");

-- CreateIndex
CREATE INDEX "AgentStep_sessionId_stepNumber_idx" ON "AgentStep"("sessionId", "stepNumber");

-- CreateIndex
CREATE INDEX "AgentStep_tenantId_status_idx" ON "AgentStep"("tenantId", "status");

-- CreateIndex
CREATE INDEX "Tool_tenantId_idx" ON "Tool"("tenantId");

-- CreateIndex
CREATE INDEX "Tool_tenantId_status_idx" ON "Tool"("tenantId", "status");

-- CreateIndex
CREATE INDEX "Tool_tenantId_riskClass_idx" ON "Tool"("tenantId", "riskClass");

-- CreateIndex
CREATE INDEX "Tool_tenantId_updatedAt_idx" ON "Tool"("tenantId", "updatedAt");

-- CreateIndex
CREATE UNIQUE INDEX "Tool_tenantId_name_key" ON "Tool"("tenantId", "name");

-- CreateIndex
CREATE INDEX "ToolPermission_tenantId_idx" ON "ToolPermission"("tenantId");

-- CreateIndex
CREATE INDEX "ToolPermission_toolId_idx" ON "ToolPermission"("toolId");

-- CreateIndex
CREATE INDEX "ToolPermission_agentContractId_idx" ON "ToolPermission"("agentContractId");

-- CreateIndex
CREATE INDEX "ToolPermission_tenantId_updatedAt_idx" ON "ToolPermission"("tenantId", "updatedAt");

-- CreateIndex
CREATE UNIQUE INDEX "ToolPermission_tenantId_toolId_agentContractId_key" ON "ToolPermission"("tenantId", "toolId", "agentContractId");

-- CreateIndex
CREATE INDEX "AIAuditEvent_tenantId_idx" ON "AIAuditEvent"("tenantId");

-- CreateIndex
CREATE INDEX "AIAuditEvent_tenantId_timestamp_idx" ON "AIAuditEvent"("tenantId", "timestamp");

-- CreateIndex
CREATE INDEX "AIAuditEvent_tenantId_eventType_idx" ON "AIAuditEvent"("tenantId", "eventType");

-- CreateIndex
CREATE INDEX "AIAuditEvent_traceId_idx" ON "AIAuditEvent"("traceId");

-- CreateIndex
CREATE INDEX "AIAuditEvent_correlationId_idx" ON "AIAuditEvent"("correlationId");

-- CreateIndex
CREATE INDEX "AIAuditEvent_sessionId_idx" ON "AIAuditEvent"("sessionId");

-- CreateIndex
CREATE INDEX "AuditMerkleRoot_tenantId_idx" ON "AuditMerkleRoot"("tenantId");

-- CreateIndex
CREATE INDEX "AuditMerkleRoot_tenantId_date_idx" ON "AuditMerkleRoot"("tenantId", "date");

-- CreateIndex
CREATE UNIQUE INDEX "AuditMerkleRoot_tenantId_date_key" ON "AuditMerkleRoot"("tenantId", "date");

-- CreateIndex
CREATE INDEX "AIConfiguration_tenantId_version_idx" ON "AIConfiguration"("tenantId", "version");

-- CreateIndex
CREATE INDEX "AIConfiguration_tenantId_domainId_version_idx" ON "AIConfiguration"("tenantId", "domainId", "version");

-- CreateIndex
CREATE INDEX "AIConfiguration_tenantId_updatedAt_idx" ON "AIConfiguration"("tenantId", "updatedAt");

-- CreateIndex
CREATE UNIQUE INDEX "AIConfiguration_tenantId_domainId_key" ON "AIConfiguration"("tenantId", "domainId");

-- CreateIndex
CREATE INDEX "SyncOutbox_tenantId_idx" ON "SyncOutbox"("tenantId");

-- CreateIndex
CREATE INDEX "SyncOutbox_tenantId_status_idx" ON "SyncOutbox"("tenantId", "status");

-- CreateIndex
CREATE INDEX "SyncOutbox_tenantId_tableName_recordId_idx" ON "SyncOutbox"("tenantId", "tableName", "recordId");

-- CreateIndex
CREATE INDEX "SyncOutbox_status_createdAt_idx" ON "SyncOutbox"("status", "createdAt");

-- CreateIndex
CREATE INDEX "SyncCheckpoint_tenantId_idx" ON "SyncCheckpoint"("tenantId");

-- CreateIndex
CREATE UNIQUE INDEX "SyncCheckpoint_tenantId_sessionType_key" ON "SyncCheckpoint"("tenantId", "sessionType");

-- CreateIndex
CREATE INDEX "SyncConflict_tenantId_idx" ON "SyncConflict"("tenantId");

-- CreateIndex
CREATE INDEX "SyncConflict_tenantId_tableName_recordId_idx" ON "SyncConflict"("tenantId", "tableName", "recordId");

-- CreateIndex
CREATE INDEX "SyncConflict_tenantId_conflictType_resolution_idx" ON "SyncConflict"("tenantId", "conflictType", "resolution");

-- CreateIndex
CREATE INDEX "FeatureFlag_tenantId_idx" ON "FeatureFlag"("tenantId");

-- CreateIndex
CREATE INDEX "FeatureFlag_tenantId_domainId_category_idx" ON "FeatureFlag"("tenantId", "domainId", "category");

-- CreateIndex
CREATE INDEX "FeatureFlag_tenantId_updatedAt_idx" ON "FeatureFlag"("tenantId", "updatedAt");

-- CreateIndex
CREATE UNIQUE INDEX "FeatureFlag_tenantId_key_key" ON "FeatureFlag"("tenantId", "key");

-- CreateIndex
CREATE INDEX "HumanApprovalRequest_tenantId_idx" ON "HumanApprovalRequest"("tenantId");

-- CreateIndex
CREATE INDEX "HumanApprovalRequest_tenantId_status_idx" ON "HumanApprovalRequest"("tenantId", "status");

-- CreateIndex
CREATE INDEX "HumanApprovalRequest_sessionId_idx" ON "HumanApprovalRequest"("sessionId");

-- CreateIndex
CREATE INDEX "HumanApprovalRequest_approverId_idx" ON "HumanApprovalRequest"("approverId");

-- CreateIndex
CREATE INDEX "HumanApprovalRequest_tenantId_updatedAt_idx" ON "HumanApprovalRequest"("tenantId", "updatedAt");

-- CreateIndex
CREATE INDEX "WorkflowDefinition_tenantId_idx" ON "WorkflowDefinition"("tenantId");

-- CreateIndex
CREATE INDEX "WorkflowDefinition_tenantId_domainId_status_idx" ON "WorkflowDefinition"("tenantId", "domainId", "status");

-- CreateIndex
CREATE INDEX "WorkflowDefinition_tenantId_updatedAt_idx" ON "WorkflowDefinition"("tenantId", "updatedAt");

-- CreateIndex
CREATE UNIQUE INDEX "WorkflowDefinition_tenantId_name_version_key" ON "WorkflowDefinition"("tenantId", "name", "version");

-- CreateIndex
CREATE INDEX "WorkflowInstance_tenantId_idx" ON "WorkflowInstance"("tenantId");

-- CreateIndex
CREATE INDEX "WorkflowInstance_tenantId_definitionId_idx" ON "WorkflowInstance"("tenantId", "definitionId");

-- CreateIndex
CREATE INDEX "WorkflowInstance_tenantId_status_idx" ON "WorkflowInstance"("tenantId", "status");

-- CreateIndex
CREATE INDEX "WorkflowInstance_recordId_idx" ON "WorkflowInstance"("recordId");

-- CreateIndex
CREATE INDEX "WorkflowInstance_tenantId_updatedAt_idx" ON "WorkflowInstance"("tenantId", "updatedAt");

-- CreateIndex
CREATE INDEX "RuleDefinition_tenantId_idx" ON "RuleDefinition"("tenantId");

-- CreateIndex
CREATE INDEX "RuleDefinition_tenantId_domainId_enabled_idx" ON "RuleDefinition"("tenantId", "domainId", "enabled");

-- CreateIndex
CREATE INDEX "RuleDefinition_tenantId_updatedAt_idx" ON "RuleDefinition"("tenantId", "updatedAt");

-- CreateIndex
CREATE UNIQUE INDEX "RuleDefinition_tenantId_name_key" ON "RuleDefinition"("tenantId", "name");
