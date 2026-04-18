import dotenv from 'dotenv';
import { z } from 'zod';

dotenv.config();

const schema = z.object({
  NODE_ENV: z.enum(['development', 'test', 'production']).default('development'),
  PORT: z.string().default('4000'),
  // Application version — required for ANMAT Disposición 2318/02 software traceability
  APP_VERSION: z.string().default('1.0.0'),
  DATABASE_URL: z.string(),
  DATABASE_PROVIDER: z.enum(['mysql', 'postgresql']).default('mysql'),
  // JWT — min 32 chars required (HIPAA §164.312(a)(2)(i))
  // Generate with: node -e "console.log(require('crypto').randomBytes(48).toString('hex'))"
  JWT_ACCESS_SECRET: z.string().min(32),
  JWT_REFRESH_SECRET: z.string().min(32),
  STORAGE_ROOT: z.string().default('../storage'),
  APP_BASE_URL: z.string().default('http://localhost:4000'),
  // Portal URL for invite links (defaults to APP_BASE_URL if not set)
  PORTAL_BASE_URL: z.string().optional(),
  CORS_ORIGIN: z.string().optional(),
  // DICOM networking
  DICOM_SCP_PORT: z.coerce.number().default(11112),
  DICOM_AE_TITLE: z.string().default('PACS_SERVER'),
  // DICOMweb auth — Bearer token for imaging equipment
  DICOM_SYSTEM_TOKEN: z.string().optional(),
  // DICOMweb auth — IP allowlist (comma-separated — do NOT use * in production)
  DICOM_ALLOWED_IPS: z.string().optional(),
  // A6: Allow multiple doctors to create independent reports for the same study.
  // Default false — set to true only with explicit institutional policy approval.
  ALLOW_PARALLEL_REPORTS: z.coerce.boolean().default(false),
  // OpenAI — REQUIRES signed HIPAA BAA before sending real PHI
  // See: https://openai.com/enterprise-privacy
  OPENAI_API_KEY: z.string().optional(),
  OPENAI_MODEL: z.string().default('gpt-4o-mini'),
  // SMTP
  SMTP_HOST: z.string().optional(),
  SMTP_PORT: z.coerce.number().default(587),
  SMTP_SECURE: z.coerce.boolean().default(false),
  SMTP_USER: z.string().optional(),
  SMTP_PASS: z.string().optional(),
  EMAIL_FROM: z.string().default('PACSMed <noreply@pacsmed.local>'),
  // Integrations
  ORTHANC_URL: z.string().optional(),
  SFTP_DROP_FOLDER: z.string().default('../sftp-drop')
});

export const env = schema.parse(process.env);
