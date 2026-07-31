import { z } from 'zod';
export const EventMetadataSchema = z.object({ eventId: z.string().uuid(), eventType: z.string(), eventVersion: z.literal(1), occurredAt: z.string().datetime(), tenantId: z.string(), userId: z.string().optional(), correlationId: z.string().optional(), causationId: z.string().optional() });
export type EventMetadata = z.infer<typeof EventMetadataSchema>;
export interface DomainEvent<TPayload = unknown> { readonly metadata: EventMetadata; readonly payload: TPayload }
export interface EventSchema<TPayload> { readonly eventType: string; readonly eventVersion: 1; readonly payloadSchema: z.ZodType<TPayload>; validate(payload: unknown): { success: true; data: TPayload } | { success: false; error: z.ZodError }; create(payload: TPayload, metadata: Omit<EventMetadata, 'eventType' | 'eventVersion'>): DomainEvent<TPayload> }
export interface EventHandler<TPayload = unknown> { readonly eventType: string; handle(event: DomainEvent<TPayload>): Promise<void>; canHandle(eventType: string, eventVersion: number): boolean }
export interface EventBus { publish<TPayload>(event: DomainEvent<TPayload>): Promise<void>; subscribe<TPayload>(handler: EventHandler<TPayload>): void; unsubscribe<TPayload>(handler: EventHandler<TPayload>): void }
export const ReservationCreatedPayloadSchema = z.object({ reservationId: z.string(), guestName: z.string(), roomType: z.string(), checkInDate: z.string().date(), checkOutDate: z.string().date(), ratePerNight: z.number().positive(), idempotencyKey: z.string() });
export type ReservationCreatedPayload = z.infer<typeof ReservationCreatedPayloadSchema>;
export const GuestCheckedInPayloadSchema = z.object({ reservationId: z.string(), roomId: z.string(), roomNumber: z.string(), checkedInAt: z.string().datetime(), idempotencyKey: z.string() });
export type GuestCheckedInPayload = z.infer<typeof GuestCheckedInPayloadSchema>;
export const InvoiceGeneratedPayloadSchema = z.object({ invoiceId: z.string(), reservationId: z.string(), totalAmount: z.number().nonnegative(), currency: z.string().length(3), lineItems: z.array(z.object({ description: z.string(), amount: z.number(), quantity: z.number().int().positive() })), idempotencyKey: z.string() });
export type InvoiceGeneratedPayload = z.infer<typeof InvoiceGeneratedPayloadSchema>;
export const RoomStatusChangedPayloadSchema = z.object({ roomId: z.string(), roomNumber: z.string(), previousStatus: z.enum(['available','occupied','cleaning','maintenance']), newStatus: z.enum(['available','occupied','cleaning','maintenance']), changedAt: z.string().datetime(), changedBy: z.string(), idempotencyKey: z.string() });
export type RoomStatusChangedPayload = z.infer<typeof RoomStatusChangedPayloadSchema>;
export const InventoryAdjustedPayloadSchema = z.object({ inventoryItemId: z.string(), adjustment: z.number(), reason: z.string(), adjustedAt: z.string().datetime(), adjustedBy: z.string(), idempotencyKey: z.string() });
export type InventoryAdjustedPayload = z.infer<typeof InventoryAdjustedPayloadSchema>;
