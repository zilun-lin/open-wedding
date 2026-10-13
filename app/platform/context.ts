import { createContext } from "react-router";

export interface AppEnv {
  DB: D1Database;
  MEDIA: R2Bucket;
  EMAIL_QUEUE: Queue<{ id: string }>;
  AUTH_SECRET: string;
  SETUP_TOKEN: string;
  RESEND_API_KEY?: string;
  EMAIL_FROM?: string;
  APP_ORIGIN?: string;
}
export const platformContext = createContext<{
  env: AppEnv;
  ctx: ExecutionContext;
}>();
