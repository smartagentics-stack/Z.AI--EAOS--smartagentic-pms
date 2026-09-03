import { z } from 'zod';
export const EventMetadataSchema = z.object({
  eventId: z.string().uuid(),
  eventType: z.string(),
  eventVersion: z.literal(1),
  occurredAt: z.string().datetime(),
  tenantId: z.string(),
  userId: z.string().optional(),
  correlationId: z.string().optional(),
  causationId: z.string().optional(),
});
export type EventMetadata = z.infer<typeof EventMetadataSchema>;
export interface DomainEvent<TPayload = unknown> {
  readonly metadata: EventMetadata;
  readonly payload: TPayload;
}
export interface EventSchema<TPayload> {
  readonly eventType: string;
  readonly eventVersion: 1;
  readonly payloadSchema: z.ZodType<TPayload>;
  validate(
    payload: unknown,
  ): { success: true; data: TPayload } | { success: false; error: z.ZodError };
  create(
    payload: TPayload,
    metadata: Omit<EventMetadata, 'eventType' | 'eventVersion'>,
  ): DomainEvent<TPayload>;
}
export interface EventHandler<TPayload = unknown> {
  readonly eventType: string;
  handle(event: DomainEvent<TPayload>): Promise<void>;
  canHandle(eventType: string, eventVersion: number): boolean;
}
export interface EventBus {
  publish<TPayload>(event: DomainEvent<TPayload>): Promise<void>;
  subscribe<TPayload>(handler: EventHandler<TPayload>): void;
  unsubscribe<TPayload>(handler: EventHandler<TPayload>): void;
}
export const ReservationCreatedPayloadSchema = z.object({
  reservationId: z.string(),
  guestName: z.string(),
  roomType: z.string(),
  checkInDate: z.string().date(),
  checkOutDate: z.string().date(),
  ratePerNight: z.number().positive(),
  idempotencyKey: z.string(),
});
export type ReservationCreatedPayload = z.infer<typeof ReservationCreatedPayloadSchema>;
export const GuestCheckedInPayloadSchema = z.object({
  reservationId: z.string(),
  roomId: z.string(),
  roomNumber: z.string(),
  checkedInAt: z.string().datetime(),
  idempotencyKey: z.string(),
});
export type GuestCheckedInPayload = z.infer<typeof GuestCheckedInPayloadSchema>;
export const InvoiceGeneratedPayloadSchema = z.object({
  invoiceId: z.string(),
  reservationId: z.string(),
  totalAmount: z.number().nonnegative(),
  currency: z.string().length(3),
  lineItems: z.array(
    z.object({
      description: z.string(),
      amount: z.number(),
      quantity: z.number().int().positive(),
    }),
  ),
  idempotencyKey: z.string(),
});
export type InvoiceGeneratedPayload = z.infer<typeof InvoiceGeneratedPayloadSchema>;
export const RoomStatusChangedPayloadSchema = z.object({
  roomId: z.string(),
  roomNumber: z.string(),
  previousStatus: z.enum(['available', 'occupied', 'cleaning', 'maintenance']),
  newStatus: z.enum(['available', 'occupied', 'cleaning', 'maintenance']),
  changedAt: z.string().datetime(),
  changedBy: z.string(),
  idempotencyKey: z.string(),
});
export type RoomStatusChangedPayload = z.infer<typeof RoomStatusChangedPayloadSchema>;
export const InventoryAdjustedPayloadSchema = z.object({
  inventoryItemId: z.string(),
  adjustment: z.number(),
  reason: z.string(),
  adjustedAt: z.string().datetime(),
  adjustedBy: z.string(),
  idempotencyKey: z.string(),
});
export type InventoryAdjustedPayload = z.infer<typeof InventoryAdjustedPayloadSchema>;

// ============================================================================
// ADR-101 CloudEvents v1.0 Envelope — appended for Phase E foundation.
// The legacy `DomainEvent<TPayload>` above (EventMetadata + payload shape)
// is retained for backward compatibility; the CloudEvents-based envelope
// below is the ADR-101 forward contract. Both coexist until the legacy
// envelope is deprecated.
// ============================================================================

/** CloudEvents v1.0 envelope (CNCF spec — mandatory + optional attributes). */
export interface CloudEvent<TData = unknown> {
  readonly specversion: '1.0';
  readonly id: string;
  readonly source: string;
  readonly type: string;
  readonly time: string;
  readonly datacontenttype?: string;
  readonly subject?: string;
  readonly dataschema?: string;
  readonly data?: TData;
}

/**
 * SmartAgentics domain event envelope — CloudEvents v1.0 extended with
 * tenant / domain / entity / schemaVersion per ADR-101 §4. Distinct from
 * the legacy `DomainEvent<TPayload>` above (which uses the older
 * `EventMetadata` + `payload` shape); named `DomainCloudEvent` to avoid
 * a duplicate-identifier collision with that legacy type.
 */
export interface DomainCloudEvent<TData = unknown> extends CloudEvent<TData> {
  readonly tenantId: string;
  readonly domainId: string;
  readonly entityTypeId: string;
  readonly recordId: string;
  readonly schemaVersion: number;
}

/** Body of the `data` field on a `DomainCloudEvent` (per ADR-101 §4). */
export interface CloudEventData {
  readonly tenantId: string;
  readonly domainId: string;
  readonly entityTypeId: string;
  readonly recordId: string;
  readonly schemaVersion: number;
  readonly operation: 'create' | 'update' | 'delete';
  readonly payload: Readonly<Record<string, unknown>>;
  readonly delta?: Readonly<Record<string, unknown>>;
  readonly syncOrigin?: string;
  readonly revision: number;
  readonly traceparent?: string;
}

/** Filter for an `EventSubscriber` subscription. */
export interface EventSubscription {
  readonly tenantId?: string;
  readonly domainId?: string;
  readonly entityTypeId?: string;
  readonly eventType?: string;
  readonly recordId?: string;
}

/**
 * `EventPublisher` — publishes events to the `SyncOutbox` table in the
 * same Prisma transaction as the business-data change (transactional
 * outbox, per ADR-073). Each published row is a CloudEvents v1.0
 * document per ADR-101.
 */
export interface EventPublisher {
  publish<TData>(event: DomainCloudEvent<TData>): Promise<void>;
  publishBatch<TData>(events: readonly DomainCloudEvent<TData>[]): Promise<void>;
}

/**
 * `EventSubscriber` — subscribes to `DomainCloudEvent`s emitted from the
 * `SyncOutbox`. Subscriptions are scoped by tenant / domain / entity /
 * event-type. Returns an unsubscribe function.
 */
export interface EventSubscriber {
  subscribe(
    subscription: EventSubscription,
    handler: (event: DomainCloudEvent) => Promise<void>,
  ): Promise<() => Promise<void>>;
  unsubscribe(subscription: EventSubscription): Promise<void>;
}
