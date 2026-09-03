/**
 * Data Type & Semantic Value Foundation SDK interfaces (directive E14).
 *
 * Defines the canonical data-type taxonomy for entity fields, semantic-value
 * envelopes (value + unit + type) for typed business quantities, and the
 * type-mapping table that bridges DataType → JSON Schema type → Prisma type
 * → TypeScript type. Consumed by the entity-builder (Phase F+) and by the
 * schema-to-prompt compiler (ADR-103).
 *
 * This file contains TYPE DEFINITIONS ONLY — no implementation logic.
 */

/**
 * DataType — the canonical data-type taxonomy for entity fields.
 * Used by `FieldDefinition.dataType` (see ./domain/index.ts) and by the
 * FieldTypeMapping table below.
 */
export enum DataType {
  String = 'string',
  Integer = 'integer',
  Decimal = 'decimal',
  Boolean = 'boolean',
  Date = 'date',
  DateTime = 'datetime',
  Time = 'time',
  Currency = 'currency',
  Percentage = 'percentage',
  Quantity = 'quantity',
  Duration = 'duration',
  Json = 'json',
  Array = 'array',
  Reference = 'reference',
  File = 'file',
  Image = 'image',
  Location = 'location',
  Enumeration = 'enumeration',
  Formula = 'formula',
}

/** ISO 4217 currency codes (subset — extend as new tenants onboard). */
export type Currency =
  'NGN' | 'USD' | 'EUR' | 'GBP' | 'GHS' | 'KES' | 'ZAR' | 'AED' | 'CAD' | 'AUD' | (string & {}); // allow additional ISO 4217 codes without recompiling

/** Units of measure supported by `Quantity` and `Duration` semantic values. */
export type UnitOfMeasure =
  | 'kg'
  | 'g'
  | 'lb'
  | 'litre'
  | 'ml'
  | 'gallon'
  | 'unit'
  | 'hour'
  | 'day'
  | 'week'
  | 'month'
  | 'year'
  | 'minute'
  | 'second'
  | 'meter'
  | 'km'
  | 'mile'
  | 'percentage'
  | 'byte'
  | 'kb'
  | 'mb'
  | 'gb';

/** A geolocation value (lat/long plus optional accuracy / label). */
export interface LocationValue {
  readonly latitude: number;
  readonly longitude: number;
  readonly accuracyMeters?: number;
  readonly label?: string;
}

/** A file attachment reference (stored blob id + metadata). */
export interface FileValue {
  readonly blobId: string;
  readonly filename: string;
  readonly mimeType: string;
  readonly sizeBytes: number;
  readonly url?: string;
}

/** An image file with optional dimension / alt-text metadata. */
export interface ImageValue extends FileValue {
  readonly widthPx?: number;
  readonly heightPx?: number;
  readonly altText?: string;
  readonly thumbnailUrl?: string;
}

/** An enumeration option (value + display label + optional sort order). */
export interface EnumerationOption {
  readonly value: string;
  readonly label: string;
  readonly description?: string;
  readonly sortOrder?: number;
  readonly deprecated?: boolean;
}

/** A reference to another record (typed FK carried in a SemanticValue). */
export interface ReferenceValue {
  readonly entityTypeId: string;
  readonly recordId: string;
  readonly displayLabel?: string;
}

/**
 * SemanticValue — a typed business quantity: value + unit + type.
 * E.g. `{ value: 75000, unit: 'NGN', type: DataType.Currency }`,
 *      `{ value: 2.5, unit: 'kg', type: DataType.Quantity }`,
 *      `{ value: 18, unit: 'percentage', type: DataType.Percentage }`.
 */
export interface SemanticValue<TValue = unknown> {
  readonly value: TValue;
  readonly unit: Currency | UnitOfMeasure | string;
  readonly type: DataType;
  readonly precision?: number;
  readonly displayFormat?: string;
}

/** Currency SemanticValue convenience alias. */
export interface CurrencyValue extends SemanticValue<number> {
  readonly type: DataType.Currency;
  readonly unit: Currency;
}

/** Quantity SemanticValue convenience alias. */
export interface QuantityValue extends SemanticValue<number> {
  readonly type: DataType.Quantity;
  readonly unit: UnitOfMeasure;
}

/** Percentage SemanticValue convenience alias (0–100 unless displayFormat says otherwise). */
export interface PercentageValue extends SemanticValue<number> {
  readonly type: DataType.Percentage;
  readonly unit: 'percentage';
}

/** Duration SemanticValue convenience alias. */
export interface DurationValue extends SemanticValue<number> {
  readonly type: DataType.Duration;
  readonly unit: Extract<
    UnitOfMeasure,
    'second' | 'minute' | 'hour' | 'day' | 'week' | 'month' | 'year'
  >;
}

/** A field reference inside a formula expression (e.g. `subtotal`, `taxRate`). */
export interface FormulaFieldReference {
  readonly field: string;
  readonly path?: string;
  readonly entityTypeId?: string;
}

/** A function call inside a formula expression (e.g. `SUM(items.price)`). */
export interface FormulaFunctionCall {
  readonly name: string;
  readonly args: readonly FormulaExpression[];
}

/** A single node in a formula's AST (literal, field reference, or function call). */
export type FormulaExpression =
  | { readonly kind: 'literal'; readonly value: unknown }
  | { readonly kind: 'field'; readonly ref: FormulaFieldReference }
  | { readonly kind: 'function'; readonly call: FormulaFunctionCall }
  | {
      readonly kind: 'binary';
      readonly op: '+' | '-' | '*' | '/' | '%' | '^';
      readonly left: FormulaExpression;
      readonly right: FormulaExpression;
    };

/**
 * FormulaDefinition — a declarative formula attached to a field.
 * `expression` is the AST or source string; `dependencies` lists the fields
 * the formula reads from; `resultType` is the DataType the formula evaluates to.
 */
export interface FormulaDefinition {
  readonly expression: FormulaExpression | string;
  readonly dependencies: readonly FormulaFieldReference[];
  readonly resultType: DataType;
  readonly evaluatedAt?: 'write' | 'read' | 'manual';
  readonly cacheable: boolean;
}

/** JSON Schema type strings (Draft 2020-12 vocabulary). */
export type JsonSchemaTypeName =
  'string' | 'number' | 'integer' | 'boolean' | 'object' | 'array' | 'null';

/** Prisma scalar type names (the subset usable as column types). */
export type PrismaScalarType =
  | 'String'
  | 'Int'
  | 'BigInt'
  | 'Float'
  | 'Decimal'
  | 'Boolean'
  | 'DateTime'
  | 'Json'
  | 'Bytes'
  | 'Unsupported';

/** TypeScript type expression strings emitted by codegen for a field. */
export type TypeScriptTypeExpression = string;

/**
 * FieldTypeMapping — bridges a DataType to its JSON Schema type, Prisma column
 * type, and TypeScript emitted type. The entity-builder (Phase F+) and the
 * schema-to-prompt compiler (ADR-103) consume this table to translate
 * FieldDefinition.dataType into concrete storage / language types.
 */
export interface FieldTypeMapping {
  readonly dataType: DataType;
  readonly jsonSchemaType: JsonSchemaTypeName;
  readonly jsonSchemaFormat?: string;
  readonly prismaType: PrismaScalarType;
  readonly typescriptType: TypeScriptTypeExpression;
  readonly searchable: boolean;
  readonly aggregatable: boolean;
  readonly sortable: boolean;
  readonly defaultValueKind?: 'none' | 'now' | 'uuid' | 'autoincrement';
}

/** A validation rule attached to a field (re-exported shape mirroring domain). */
export interface ValidationRule {
  readonly kind: string;
  readonly params: Readonly<Record<string, unknown>>;
  readonly message?: string;
}

/** Registry contract for resolving DataType → FieldTypeMapping at runtime. */
export interface DataTypeRegistry {
  resolve(dataType: DataType): Promise<FieldTypeMapping | null>;
  list(): Promise<readonly FieldTypeMapping[]>;
  register(mapping: FieldTypeMapping): Promise<void>;
  coerceToSemanticValue(value: unknown, dataType: DataType, unit?: string): Promise<SemanticValue>;
}
