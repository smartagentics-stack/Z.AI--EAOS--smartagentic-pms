export type UserRole = 'admin' | 'manager' | 'front-desk' | 'housekeeping' | 'accountant';
export interface User { id: string; email: string; tenantId: string; roles: UserRole[]; displayName: string; createdAt: string; lastLoginAt?: string }
export interface Session { id: string; userId: string; tenantId: string; roles: UserRole[]; expiresAt: string; createdAt: string }
export interface AuthProvider { authenticate(credentials: { email: string; password: string }): Promise<Session>; getSession(sessionId: string): Promise<Session | null>; revokeSession(sessionId: string): Promise<void>; canPerform(roles: UserRole[], action: string, resource?: string): boolean }
