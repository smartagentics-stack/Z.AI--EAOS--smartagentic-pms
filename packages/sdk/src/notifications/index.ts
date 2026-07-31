export type NotificationChannel = 'email' | 'sms' | 'in-app' | 'push';
export interface Notification { readonly id: string; readonly tenantId: string; readonly channel: NotificationChannel; readonly subject: string; readonly body: string; readonly createdAt: string }
export interface NotificationProvider { send(notification: Notification): Promise<{ status: 'sent' | 'failed' | 'queued' }> }
