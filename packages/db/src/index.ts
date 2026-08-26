/**
 * @smartagentics/db — Prisma client export
 *
 * Exports the generated Prisma client and a repository factory
 * that implements the SDK StorageRepository interface.
 *
 * Sprint 1: Business models (Tenant, User, Room, Reservation, Invoice, InventoryItem, AuditEvent)
 */

export { PrismaClient } from '@prisma/client';

// Re-export Prisma types for downstream consumers
export type {
  Tenant,
  User,
  Room,
  Reservation,
  Invoice,
  InventoryItem,
  AuditEvent,
  SystemMeta,
} from '@prisma/client';
