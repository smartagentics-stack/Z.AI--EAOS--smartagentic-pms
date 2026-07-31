export type LogLevel = 'debug' | 'info' | 'warn' | 'error' | 'fatal';
export interface LogContext { [key: string]: unknown }
export interface Logger {
  debug(message: string, context?: LogContext): void;
  info(message: string, context?: LogContext): void;
  warn(message: string, context?: LogContext): void;
  error(message: string, context?: LogContext, error?: Error): void;
  fatal(message: string, context?: LogContext, error?: Error): void;
  child(context: LogContext): Logger;
  setLevel(level: LogLevel): void;
}
export interface LoggerFactory { create(context?: LogContext): Logger }
export const PII_FIELDS = ['password','api_key','apiKey','token','secret','credit_card','creditCard','ssn','national_id','nationalId','guest_name','guestName','phone','email'] as const;
