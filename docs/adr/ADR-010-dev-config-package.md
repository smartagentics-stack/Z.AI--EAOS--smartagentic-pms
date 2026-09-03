# ADR-010: Consolidated Dev Config Package

**Status:** ACCEPTED | **Date:** 2026-07-14 | **Owner:** Engineering Office

## Decision

packages/dev-config containing ESLint, Prettier, TypeScript, Vitest, Commitlint configs. All packages import from it.

## Alternatives Rejected

Per-package config (drifts), Root-level only (doesn't scale), Config generation tool (over-engineering)

## Consequences

Single source of truth, no drift. TRB-006 #4.

## Context

Phase 1 requires a single source of truth for ESLint, Prettier, TypeScript, Vitest, and Commitlint configurations. Per-package configuration drifts over time; root-level only doesn't scale to a monorepo. Consolidated dev-config was validated in EAOS TRB-006 item #4.
