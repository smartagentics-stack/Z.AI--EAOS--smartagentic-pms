import { z } from 'zod';
export interface ConfigSource { get(key: string): string | undefined }
export interface Config<TSchema extends z.ZodType> { readonly values: z.infer<TSchema>; readonly schema: TSchema }
export const BaseConfigSchema = z.object({ NODE_ENV: z.enum(['development','test','production']), LOG_LEVEL: z.enum(['debug','info','warn','error']).default('info') });
export type BaseConfig = z.infer<typeof BaseConfigSchema>;
export const envSource: ConfigSource = { get(key: string): string | undefined { return process.env[key]; } };
export class ConfigValidationError extends Error { constructor(public readonly errors: z.ZodError, message?: string) { super(message ?? 'Configuration validation failed'); this.name = 'ConfigValidationError'; } }
