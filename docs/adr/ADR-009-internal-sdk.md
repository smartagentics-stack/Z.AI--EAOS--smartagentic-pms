# ADR-009: Internal Platform SDK

**Status:** ACCEPTED | **Date:** 2026-07-14 | **Owner:** Architecture Office

## Decision

packages/sdk with framework-agnostic interfaces: Logger, Events, Config, Storage, Auth, AI, Workflow, Notifications, Metrics, Errors. Interfaces only, no implementations.

## Alternatives Rejected

No SDK (tight coupling), SDK with implementations (violates DI), Multiple SDKs (over-engineering)

## Consequences

Business modules depend on interfaces. Future industries build on same SDK. Framework-agnostic. TRB-006 #5, #9.

## Context

Phase 1 requires framework-agnostic SDK interfaces so that business modules depend on abstractions, not implementations. This enables future industry expansion (hotels, supermarkets, schools) without coupling to a specific framework. The SDK pattern was validated in EAOS TRB-006 items #5 and #9.
