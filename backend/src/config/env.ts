import dotenv from 'dotenv';
import { z } from 'zod';

dotenv.config();

const schema = z.object({
  NODE_ENV: z.enum(['development', 'test', 'production']).default('development'),
  PORT: z.string().default('4000'),
  DATABASE_URL: z.string(),
  JWT_ACCESS_SECRET: z.string().min(16),
  JWT_REFRESH_SECRET: z.string().min(16),
  STORAGE_ROOT: z.string().default('../storage'),
  APP_BASE_URL: z.string().default('http://localhost:4000')
});

export const env = schema.parse(process.env);
