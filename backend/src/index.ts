import express, { NextFunction, Request, Response } from 'express';
import cors from 'cors';
import helmet from 'helmet';
import path from 'node:path';
import { env } from './config/env.js';
import { requireAuth, AuthRequest } from './middleware/auth.js';
import { authRouter } from './modules/auth/routes.js';
import { usersRouter } from './modules/users/routes.js';
import { patientsRouter } from './modules/patients/routes.js';
import { studiesRouter } from './modules/studies/routes.js';
import { reportsRouter } from './modules/reports/routes.js';
import { aiRouter } from './modules/ai/routes.js';
import { portalRouter } from './modules/portal/routes.js';
import { notificationsRouter } from './modules/notifications/routes.js';

const app = express();

// Security headers
app.use(helmet({
  crossOriginResourcePolicy: { policy: 'same-origin' },
  contentSecurityPolicy: false  // Allow inline styles for PDF viewer
}));

// CORS — configurable via env
const allowedOrigins = env.CORS_ORIGIN
  ? env.CORS_ORIGIN.split(',').map((o) => o.trim())
  : ['http://localhost:5173'];

app.use(cors({
  origin: (origin, callback) => {
    if (!origin || allowedOrigins.includes(origin) || env.NODE_ENV === 'development') {
      callback(null, true);
    } else {
      callback(new Error('Not allowed by CORS'));
    }
  },
  credentials: true
}));

app.use(express.json({ limit: '10mb' }));

// Health check (público)
app.get('/health', (_req, res) => res.json({ status: 'ok', service: 'pacs-backend', env: env.NODE_ENV }));

// Archivos estáticos — protegidos por autenticación
app.use(
  '/files',
  requireAuth as any,
  express.static(path.resolve(process.cwd(), env.STORAGE_ROOT), {
    fallthrough: false,
    setHeaders: (res) => {
      res.setHeader('X-Content-Type-Options', 'nosniff');
      res.setHeader('Cache-Control', 'private, max-age=3600');
    }
  })
);

// API routes
app.use('/api/auth', authRouter);
app.use('/api/users', usersRouter);
app.use('/api/patients', patientsRouter);
app.use('/api/studies', studiesRouter);
app.use('/api/reports', reportsRouter);
app.use('/api/ai', aiRouter);
app.use('/api/portal', portalRouter);
app.use('/api/notifications', notificationsRouter);

// 404 handler
app.use((_req, res) => res.status(404).json({ message: 'Recurso no encontrado' }));

// Global error handler
// eslint-disable-next-line @typescript-eslint/no-unused-vars
app.use((err: Error, _req: Request, res: Response, _next: NextFunction) => {
  console.error('[ERROR]', err.message, err.stack);
  if (env.NODE_ENV === 'production') {
    res.status(500).json({ message: 'Error interno del servidor' });
  } else {
    res.status(500).json({ message: err.message, stack: err.stack });
  }
});

// Graceful shutdown
process.on('unhandledRejection', (reason) => {
  console.error('[UNHANDLED REJECTION]', reason);
});

app.listen(Number(env.PORT), () => {
  console.log(`✓ PACS backend ejecutando en http://localhost:${env.PORT} [${env.NODE_ENV}]`);
});
