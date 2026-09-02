# ADR-048: Memory Framework Policy

**ADR-ID:** ADR-048
**Status:** ACCEPTED
**Context:** 2026-09-02
**Owner:** Architecture Office

---

## 1. Context

Stream 4 research evaluated several memory frameworks (Mem0, Letta/MemGPT, Zep) and found that each introduces runtime dependencies, cloud coupling, or architectural patterns that conflict with SmartAgentics' offline-first, TypeScript-native, Restate-based architecture.

## 2. Problem

Should SmartAgentics adopt an existing memory framework (Mem0, Letta, Zep) as a runtime dependency, or build a thin SmartAgentics-owned memory abstraction backed by SQLite + sqlite-vec?

## 3. Options

### Option A: Adopt Mem0 as runtime dependency

Mem0 (MIT) provides memory management with graph memory. However, it's Python-first, has cloud coupling, and introduces a second runtime alongside Ollama.

### Option B: Adopt Letta/MemGPT as runtime dependency

Letta provides agent memory with block-based abstraction. However, it's Python-only, server-based, and its memory architecture would conflict with SmartAgentics' CoALA-based 7-category taxonomy.

### Option C: Adopt Zep as runtime dependency

Zep provides long-term memory with temporal knowledge graphs. However, it's a separate server process, cloud-oriented, and adds operational complexity.

### Option D: SmartAgentics-owned thin abstraction

Build a thin `MemoryStore` interface (SDK contract) backed by SQLite + sqlite-vec + SQLCipher. Use Letta's 4-block working memory pattern as a _reference design_ (not a dependency). Use CoALA taxonomy for memory categories.

## 4. Decision

Adopt **Option D** — SmartAgentics-owned thin abstraction. No Mem0, Letta, or Zep as runtime dependencies.

## 5. Rationale

- Offline-first: no external server process required
- TypeScript-native: no Python runtime needed
- Restate-compatible: memory operations journaled via Restate
- SQLite-backed: same database as PMS (no second storage engine)
- Architectural control: SmartAgentics owns the memory contract, can evolve independently
- Letta's 4-block pattern and CoALA taxonomy are _reference designs_, not dependencies
- Consistent with ADR-037 (RAG Framework Policy — no LangChain/LlamaIndex as runtime deps)

## 6. Consequences

- SmartAgentics must implement and maintain the `MemoryStore` interface
- No vendor lock-in for memory
- Memory architecture can evolve without framework upgrade constraints
- Must self-implement features that Mem0/Letta/Zep provide out-of-box (e.g., memory consolidation, temporal indexing)
- Phase 1 implements basic memory operations; advanced features deferred to Phase 2+

## 7. Review Conditions

- Review if Mem0/Letta/Zep release TypeScript-native, offline-first versions
- Review if memory management complexity justifies adopting a framework
- Review if community memory standards emerge (e.g., standardized memory interchange format)
