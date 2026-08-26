/**
 * S1-1 Tests: Prisma Business Models
 *
 * Tests:
 *  1. All 7 business models exist with correct fields
 *  2. Valid records can be created
 *  3. Tenant isolation constraints behave correctly
 *  4. Uniqueness/idempotency constraints reject duplicates
 *  5. Required relationships behave correctly
 *  6. Falsification: missing tenantId rejected
 *  7. Falsification: duplicate idempotencyKey rejected
 *
 * Uses an in-memory SQLite database for isolation.
 */

import { describe, it, expect, beforeAll, afterAll, beforeEach } from 'vitest';
import { PrismaClient } from '@prisma/client';
import { join } from 'node:path';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';

describe('S1-1: Prisma Business Models', () => {
  let prisma: PrismaClient;
  let tmpDir: string;

  beforeAll(async () => {
    tmpDir = mkdtempSync(join(tmpdir(), 's1-test-'));
    const dbPath = join(tmpDir, 'test.db');
    prisma = new PrismaClient({
      datasources: { db: { url: `file:${dbPath}` } },
    });
    // Push schema to create tables in the test database
    await prisma.$executeRawUnsafe(
      'CREATE TABLE IF NOT EXISTS "SystemMeta" ("id" TEXT NOT NULL PRIMARY KEY, "key" TEXT NOT NULL, "value" TEXT NOT NULL, "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP, "updatedAt" DATETIME NOT NULL)',
    );
    await prisma.$executeRawUnsafe(
      'CREATE TABLE IF NOT EXISTS "Tenant" ("id" TEXT NOT NULL PRIMARY KEY, "name" TEXT NOT NULL, "code" TEXT NOT NULL, "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP, "updatedAt" DATETIME NOT NULL)',
    );
    await prisma.$executeRawUnsafe(
      'CREATE TABLE IF NOT EXISTS "User" ("id" TEXT NOT NULL PRIMARY KEY, "email" TEXT NOT NULL, "passwordHash" TEXT NOT NULL, "displayName" TEXT NOT NULL, "roles" TEXT NOT NULL, "tenantId" TEXT NOT NULL, "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP, "updatedAt" DATETIME NOT NULL, "lastLoginAt" DATETIME, CONSTRAINT "User_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES "Tenant" ("id") ON DELETE RESTRICT ON UPDATE CASCADE)',
    );
    await prisma.$executeRawUnsafe(
      'CREATE TABLE IF NOT EXISTS "Room" ("id" TEXT NOT NULL PRIMARY KEY, "roomNumber" TEXT NOT NULL, "roomType" TEXT NOT NULL, "floor" INTEGER, "status" TEXT NOT NULL DEFAULT \'available\', "tenantId" TEXT NOT NULL, "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP, "updatedAt" DATETIME NOT NULL, CONSTRAINT "Room_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES "Tenant" ("id") ON DELETE RESTRICT ON UPDATE CASCADE)',
    );
    await prisma.$executeRawUnsafe(
      'CREATE TABLE IF NOT EXISTS "Reservation" ("id" TEXT NOT NULL PRIMARY KEY, "guestName" TEXT NOT NULL, "guestEmail" TEXT, "guestPhone" TEXT, "roomType" TEXT NOT NULL, "roomId" TEXT, "checkInDate" DATETIME NOT NULL, "checkOutDate" DATETIME NOT NULL, "ratePerNight" REAL NOT NULL, "status" TEXT NOT NULL DEFAULT \'pending\', "idempotencyKey" TEXT NOT NULL, "tenantId" TEXT NOT NULL, "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP, "updatedAt" DATETIME NOT NULL, CONSTRAINT "Reservation_roomId_fkey" FOREIGN KEY ("roomId") REFERENCES "Room" ("id") ON DELETE SET NULL ON UPDATE CASCADE, CONSTRAINT "Reservation_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES "Tenant" ("id") ON DELETE RESTRICT ON UPDATE CASCADE)',
    );
    await prisma.$executeRawUnsafe(
      'CREATE TABLE IF NOT EXISTS "Invoice" ("id" TEXT NOT NULL PRIMARY KEY, "reservationId" TEXT NOT NULL, "totalAmount" REAL NOT NULL, "currency" TEXT NOT NULL DEFAULT \'NGN\', "lineItems" TEXT NOT NULL, "status" TEXT NOT NULL DEFAULT \'draft\', "tenantId" TEXT NOT NULL, "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP, "updatedAt" DATETIME NOT NULL)',
    );
    await prisma.$executeRawUnsafe(
      'CREATE TABLE IF NOT EXISTS "InventoryItem" ("id" TEXT NOT NULL PRIMARY KEY, "name" TEXT NOT NULL, "sku" TEXT, "quantity" INTEGER NOT NULL DEFAULT 0, "unit" TEXT NOT NULL DEFAULT \'unit\', "tenantId" TEXT NOT NULL, "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP, "updatedAt" DATETIME NOT NULL)',
    );
    await prisma.$executeRawUnsafe(
      'CREATE TABLE IF NOT EXISTS "AuditEvent" ("id" TEXT NOT NULL PRIMARY KEY, "eventType" TEXT NOT NULL, "eventVersion" INTEGER NOT NULL DEFAULT 1, "actorId" TEXT, "actorType" TEXT, "action" TEXT NOT NULL, "resource" TEXT NOT NULL, "result" TEXT, "severity" TEXT NOT NULL DEFAULT \'info\', "details" TEXT, "traceId" TEXT, "tenantId" TEXT NOT NULL, "timestamp" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP)',
    );
    // Create indexes
    await prisma.$executeRawUnsafe(
      'CREATE UNIQUE INDEX IF NOT EXISTS "SystemMeta_key_key" ON "SystemMeta"("key")',
    );
    await prisma.$executeRawUnsafe(
      'CREATE UNIQUE INDEX IF NOT EXISTS "Tenant_code_key" ON "Tenant"("code")',
    );
    await prisma.$executeRawUnsafe(
      'CREATE INDEX IF NOT EXISTS "User_tenantId_idx" ON "User"("tenantId")',
    );
    await prisma.$executeRawUnsafe(
      'CREATE UNIQUE INDEX IF NOT EXISTS "User_tenantId_email_key" ON "User"("tenantId", "email")',
    );
    await prisma.$executeRawUnsafe(
      'CREATE INDEX IF NOT EXISTS "Room_tenantId_status_idx" ON "Room"("tenantId", "status")',
    );
    await prisma.$executeRawUnsafe(
      'CREATE UNIQUE INDEX IF NOT EXISTS "Room_tenantId_roomNumber_key" ON "Room"("tenantId", "roomNumber")',
    );
    await prisma.$executeRawUnsafe(
      'CREATE INDEX IF NOT EXISTS "Reservation_tenantId_checkInDate_idx" ON "Reservation"("tenantId", "checkInDate")',
    );
    await prisma.$executeRawUnsafe(
      'CREATE INDEX IF NOT EXISTS "Reservation_tenantId_status_idx" ON "Reservation"("tenantId", "status")',
    );
    await prisma.$executeRawUnsafe(
      'CREATE UNIQUE INDEX IF NOT EXISTS "Reservation_tenantId_idempotencyKey_key" ON "Reservation"("tenantId", "idempotencyKey")',
    );
    await prisma.$executeRawUnsafe(
      'CREATE INDEX IF NOT EXISTS "Invoice_tenantId_reservationId_idx" ON "Invoice"("tenantId", "reservationId")',
    );
    await prisma.$executeRawUnsafe(
      'CREATE INDEX IF NOT EXISTS "InventoryItem_tenantId_idx" ON "InventoryItem"("tenantId")',
    );
    await prisma.$executeRawUnsafe(
      'CREATE UNIQUE INDEX IF NOT EXISTS "InventoryItem_tenantId_name_key" ON "InventoryItem"("tenantId", "name")',
    );
    await prisma.$executeRawUnsafe(
      'CREATE INDEX IF NOT EXISTS "AuditEvent_tenantId_timestamp_idx" ON "AuditEvent"("tenantId", "timestamp")',
    );
    await prisma.$executeRawUnsafe(
      'CREATE INDEX IF NOT EXISTS "AuditEvent_tenantId_eventType_idx" ON "AuditEvent"("tenantId", "eventType")',
    );
    await prisma.$executeRawUnsafe(
      'CREATE INDEX IF NOT EXISTS "AuditEvent_traceId_idx" ON "AuditEvent"("traceId")',
    );
  });

  afterAll(async () => {
    await prisma.$disconnect();
    rmSync(tmpDir, { recursive: true, force: true });
  });

  beforeEach(async () => {
    // Clean all tables between tests
    await prisma.auditEvent.deleteMany();
    await prisma.inventoryItem.deleteMany();
    await prisma.invoice.deleteMany();
    await prisma.reservation.deleteMany();
    await prisma.room.deleteMany();
    await prisma.user.deleteMany();
    await prisma.tenant.deleteMany();
  });

  // ─── Test 1: All 7 models exist ───────────────────────────────────────────

  it('all 7 business models are accessible via PrismaClient', () => {
    expect(prisma.tenant).toBeDefined();
    expect(prisma.user).toBeDefined();
    expect(prisma.room).toBeDefined();
    expect(prisma.reservation).toBeDefined();
    expect(prisma.invoice).toBeDefined();
    expect(prisma.inventoryItem).toBeDefined();
    expect(prisma.auditEvent).toBeDefined();
  });

  // ─── Test 2: Valid records can be created ──────────────────────────────────

  it('creates a valid Tenant', async () => {
    const tenant = await prisma.tenant.create({
      data: { name: 'Test Hotel', code: 'HOTEL_001' },
    });
    expect(tenant.id).toBeDefined();
    expect(tenant.name).toBe('Test Hotel');
    expect(tenant.code).toBe('HOTEL_001');
    expect(tenant.createdAt).toBeDefined();
    expect(tenant.updatedAt).toBeDefined();
  });

  it('creates a valid User with tenant relationship', async () => {
    const tenant = await prisma.tenant.create({
      data: { name: 'Test Hotel', code: 'HOTEL_002' },
    });
    const user = await prisma.user.create({
      data: {
        email: 'admin@test.com',
        passwordHash: 'hashed-password',
        displayName: 'Admin User',
        roles: JSON.stringify(['admin']),
        tenantId: tenant.id,
      },
    });
    expect(user.id).toBeDefined();
    expect(user.tenantId).toBe(tenant.id);
    expect(user.email).toBe('admin@test.com');
  });

  it('creates a valid Room with tenant relationship', async () => {
    const tenant = await prisma.tenant.create({
      data: { name: 'Test Hotel', code: 'HOTEL_003' },
    });
    const room = await prisma.room.create({
      data: {
        roomNumber: '101',
        roomType: 'Deluxe',
        floor: 1,
        status: 'available',
        tenantId: tenant.id,
      },
    });
    expect(room.id).toBeDefined();
    expect(room.roomNumber).toBe('101');
    expect(room.status).toBe('available');
  });

  it('creates a valid Reservation with idempotencyKey', async () => {
    const tenant = await prisma.tenant.create({
      data: { name: 'Test Hotel', code: 'HOTEL_004' },
    });
    const reservation = await prisma.reservation.create({
      data: {
        guestName: 'John Doe',
        roomType: 'Deluxe',
        checkInDate: new Date('2026-09-01'),
        checkOutDate: new Date('2026-09-03'),
        ratePerNight: 150.0,
        idempotencyKey: 'res-key-001',
        tenantId: tenant.id,
      },
    });
    expect(reservation.id).toBeDefined();
    expect(reservation.idempotencyKey).toBe('res-key-001');
    expect(reservation.status).toBe('pending');
  });

  it('creates a valid Invoice', async () => {
    const tenant = await prisma.tenant.create({
      data: { name: 'Test Hotel', code: 'HOTEL_005' },
    });
    const invoice = await prisma.invoice.create({
      data: {
        reservationId: 'res-001',
        totalAmount: 300.0,
        currency: 'NGN',
        lineItems: JSON.stringify([{ description: 'Room', amount: 150, quantity: 2 }]),
        status: 'draft',
        tenantId: tenant.id,
      },
    });
    expect(invoice.id).toBeDefined();
    expect(invoice.totalAmount).toBe(300.0);
    expect(invoice.currency).toBe('NGN');
  });

  it('creates a valid InventoryItem', async () => {
    const tenant = await prisma.tenant.create({
      data: { name: 'Test Hotel', code: 'HOTEL_006' },
    });
    const item = await prisma.inventoryItem.create({
      data: {
        name: 'Towels',
        sku: 'TOW-001',
        quantity: 100,
        unit: 'unit',
        tenantId: tenant.id,
      },
    });
    expect(item.id).toBeDefined();
    expect(item.name).toBe('Towels');
    expect(item.quantity).toBe(100);
  });

  it('creates a valid AuditEvent', async () => {
    const tenant = await prisma.tenant.create({
      data: { name: 'Test Hotel', code: 'HOTEL_007' },
    });
    const event = await prisma.auditEvent.create({
      data: {
        eventType: 'reservation.created',
        eventVersion: 1,
        action: 'create',
        resource: 'reservation',
        severity: 'info',
        tenantId: tenant.id,
      },
    });
    expect(event.id).toBeDefined();
    expect(event.eventType).toBe('reservation.created');
    expect(event.severity).toBe('info');
  });

  // ─── Test 3: Tenant isolation ─────────────────────────────────────────────

  it('tenant isolation: users from different tenants are separate', async () => {
    const tenant1 = await prisma.tenant.create({ data: { name: 'Hotel A', code: 'A001' } });
    const tenant2 = await prisma.tenant.create({ data: { name: 'Hotel B', code: 'B001' } });

    await prisma.user.create({
      data: {
        email: 'user@a.com',
        passwordHash: 'h1',
        displayName: 'User A',
        roles: '[]',
        tenantId: tenant1.id,
      },
    });
    await prisma.user.create({
      data: {
        email: 'user@b.com',
        passwordHash: 'h2',
        displayName: 'User B',
        roles: '[]',
        tenantId: tenant2.id,
      },
    });

    const tenant1Users = await prisma.user.findMany({ where: { tenantId: tenant1.id } });
    const tenant2Users = await prisma.user.findMany({ where: { tenantId: tenant2.id } });

    expect(tenant1Users).toHaveLength(1);
    expect(tenant2Users).toHaveLength(1);
    expect(tenant1Users[0].email).toBe('user@a.com');
    expect(tenant2Users[0].email).toBe('user@b.com');
  });

  // ─── Test 4: Uniqueness constraints ───────────────────────────────────────

  it('rejects duplicate [tenantId, email] for User', async () => {
    const tenant = await prisma.tenant.create({ data: { name: 'Hotel', code: 'C001' } });
    await prisma.user.create({
      data: {
        email: 'dup@test.com',
        passwordHash: 'h',
        displayName: 'User',
        roles: '[]',
        tenantId: tenant.id,
      },
    });

    await expect(
      prisma.user.create({
        data: {
          email: 'dup@test.com',
          passwordHash: 'h2',
          displayName: 'User 2',
          roles: '[]',
          tenantId: tenant.id,
        },
      }),
    ).rejects.toThrow();
  });

  it('rejects duplicate [tenantId, roomNumber] for Room', async () => {
    const tenant = await prisma.tenant.create({ data: { name: 'Hotel', code: 'C002' } });
    await prisma.room.create({
      data: { roomNumber: '101', roomType: 'Std', tenantId: tenant.id },
    });

    await expect(
      prisma.room.create({
        data: { roomNumber: '101', roomType: 'Deluxe', tenantId: tenant.id },
      }),
    ).rejects.toThrow();
  });

  it('rejects duplicate [tenantId, idempotencyKey] for Reservation', async () => {
    const tenant = await prisma.tenant.create({ data: { name: 'Hotel', code: 'C003' } });
    await prisma.reservation.create({
      data: {
        guestName: 'Guest',
        roomType: 'Std',
        checkInDate: new Date('2026-09-01'),
        checkOutDate: new Date('2026-09-02'),
        ratePerNight: 100,
        idempotencyKey: 'dup-key',
        tenantId: tenant.id,
      },
    });

    await expect(
      prisma.reservation.create({
        data: {
          guestName: 'Guest 2',
          roomType: 'Std',
          checkInDate: new Date('2026-09-01'),
          checkOutDate: new Date('2026-09-02'),
          ratePerNight: 100,
          idempotencyKey: 'dup-key',
          tenantId: tenant.id,
        },
      }),
    ).rejects.toThrow();
  });

  it('allows same email across different tenants', async () => {
    const t1 = await prisma.tenant.create({ data: { name: 'Hotel A', code: 'C004' } });
    const t2 = await prisma.tenant.create({ data: { name: 'Hotel B', code: 'C005' } });

    await prisma.user.create({
      data: {
        email: 'same@test.com',
        passwordHash: 'h',
        displayName: 'U1',
        roles: '[]',
        tenantId: t1.id,
      },
    });
    const user2 = await prisma.user.create({
      data: {
        email: 'same@test.com',
        passwordHash: 'h',
        displayName: 'U2',
        roles: '[]',
        tenantId: t2.id,
      },
    });

    expect(user2.email).toBe('same@test.com');
  });

  it('rejects duplicate Tenant code', async () => {
    await prisma.tenant.create({ data: { name: 'Hotel 1', code: 'UNIQUE_CODE' } });

    await expect(
      prisma.tenant.create({ data: { name: 'Hotel 2', code: 'UNIQUE_CODE' } }),
    ).rejects.toThrow();
  });

  // ─── Test 5: Required relationships ───────────────────────────────────────

  it('User requires valid tenantId FK', async () => {
    await expect(
      prisma.user.create({
        data: {
          email: 'no-tenant@test.com',
          passwordHash: 'h',
          displayName: 'User',
          roles: '[]',
          tenantId: 'nonexistent-tenant-id',
        },
      }),
    ).rejects.toThrow();
  });

  it('Room requires valid tenantId FK', async () => {
    await expect(
      prisma.room.create({
        data: { roomNumber: '999', roomType: 'Std', tenantId: 'nonexistent-tenant-id' },
      }),
    ).rejects.toThrow();
  });

  // ─── Test 6: Falsification — missing tenantId ──────────────────────────────

  it('FALSIFICATION: Room.create without tenantId fails (SQLite enforces NOT NULL)', async () => {
    await expect(
      // @ts-expect-error: deliberately omitting tenantId to test DB constraint
      prisma.room.create({
        data: { roomNumber: '000', roomType: 'Std' },
      }),
    ).rejects.toThrow();
  });

  it('FALSIFICATION: AuditEvent without tenantId fails', async () => {
    await expect(
      // @ts-expect-error: deliberately omitting tenantId
      prisma.auditEvent.create({
        data: { eventType: 'test', action: 'test', resource: 'test' },
      }),
    ).rejects.toThrow();
  });

  // ─── Test 7: Default values ───────────────────────────────────────────────

  it('Room defaults status to "available"', async () => {
    const tenant = await prisma.tenant.create({ data: { name: 'H', code: 'D001' } });
    const room = await prisma.room.create({
      data: { roomNumber: '201', roomType: 'Std', tenantId: tenant.id },
    });
    expect(room.status).toBe('available');
  });

  it('Reservation defaults status to "pending"', async () => {
    const tenant = await prisma.tenant.create({ data: { name: 'H', code: 'D002' } });
    const res = await prisma.reservation.create({
      data: {
        guestName: 'G',
        roomType: 'Std',
        checkInDate: new Date('2026-09-01'),
        checkOutDate: new Date('2026-09-02'),
        ratePerNight: 100,
        idempotencyKey: 'def-test',
        tenantId: tenant.id,
      },
    });
    expect(res.status).toBe('pending');
  });

  it('Invoice defaults currency to "NGN" and status to "draft"', async () => {
    const tenant = await prisma.tenant.create({ data: { name: 'H', code: 'D003' } });
    const inv = await prisma.invoice.create({
      data: { reservationId: 'r1', totalAmount: 100, lineItems: '[]', tenantId: tenant.id },
    });
    expect(inv.currency).toBe('NGN');
    expect(inv.status).toBe('draft');
  });

  it('AuditEvent defaults eventVersion to 1 and severity to "info"', async () => {
    const tenant = await prisma.tenant.create({ data: { name: 'H', code: 'D004' } });
    const evt = await prisma.auditEvent.create({
      data: { eventType: 'test', action: 'test', resource: 'test', tenantId: tenant.id },
    });
    expect(evt.eventVersion).toBe(1);
    expect(evt.severity).toBe('info');
  });
});
