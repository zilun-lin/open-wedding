// Provider contracts keep domain services independent of Cloudflare and Resend.
export interface EmailMessage {
  to: string;
  subject: string;
  html: string;
  text: string;
  idempotencyKey: string;
}
export interface EmailProvider {
  send(message: EmailMessage): Promise<void>;
}
