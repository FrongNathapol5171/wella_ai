import { z } from 'zod';
const bool = fallback => z.enum(['true','false']).default(fallback).transform(v => v === 'true');
const envSchema = z.object({
  LINE_CHANNEL_SECRET: z.string().min(1), LINE_CHANNEL_ACCESS_TOKEN: z.string().min(1),
  OPENAI_API_KEY: z.string().min(1), OPENAI_MODEL: z.string().min(1).default('gpt-4.1-mini'),
  OPENAI_BASE_URL: z.preprocess(v => v === '' ? undefined : v, z.url().refine(v => ['http:','https:'].includes(new URL(v).protocol)).default('https://api.openai.com/v1')),
  OPENAI_API_MODE: z.enum(['responses','chat']).default('responses'),
  MYSQL_HOST: z.string().min(1), MYSQL_PORT: z.coerce.number().int().min(1).max(65535).default(3306),
  MYSQL_USER: z.string().min(1), MYSQL_PASSWORD: z.string().default(''),
  MYSQL_DATABASE: z.string().regex(/^[a-zA-Z0-9_]{1,64}$/),
  MYSQL_SSL: bool('false'), MYSQL_SSL_CA: z.string().optional(), MYSQL_CREATE_DATABASE: bool('true'),
  MYSQL_POOL_SIZE: z.coerce.number().int().min(1).max(10).default(3),
  APP_TIMEZONE: z.string().default('Asia/Bangkok'), PORT: z.coerce.number().int().min(1).max(65535).default(3000)
});
export function readConfig(env = process.env) {
  const result = envSchema.safeParse(env);
  if (!result.success) throw new Error('Invalid or missing env: ' + [...new Set(result.error.issues.map(i => i.path[0]))].join(', '));
  new Intl.DateTimeFormat('en', { timeZone: result.data.APP_TIMEZONE });
  return result.data;
}
