export type ErrorCategory = 'validation' | 'authentication' | 'authorization' | 'not_found' | 'conflict' | 'rate_limit' | 'external_service' | 'data_integrity' | 'configuration' | 'internal';
export class SmartAgenticsError extends Error { constructor(message: string, public readonly category: ErrorCategory, public readonly statusCode: number = 500) { super(message); this.name = this.constructor.name; } }
export class ValidationError extends SmartAgenticsError { constructor(message: string) { super(message, 'validation', 400); } }
export class AuthenticationError extends SmartAgenticsError { constructor(message: string = 'Authentication required') { super(message, 'authentication', 401); } }
export class NotFoundError extends SmartAgenticsError { constructor(resource: string, id: string) { super(`${resource} not found: ${id}`, 'not_found', 404); } }
export class ConflictError extends SmartAgenticsError { constructor(message: string) { super(message, 'conflict', 409); } }
