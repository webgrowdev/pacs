import express, { NextFunction, Request, Response } from 'express';
import cors from 'cors';
import helmet from 'helmet';
import cookieParser from 'cookie-parser';
import path from 'node:path';
import fs from 'node:fs';
import { rateLimit } from 'express-rate-limit';
import { env } from './config/env.js';
import { requireAuth, AuthRequest } from './middleware/auth.js';
import { verifyAccessToken } from './utils/jwt.js';
import { prisma } from './config/prisma.js';
import { authRouter } from './modules/auth/routes.js';
import { usersRouter } from './modules/users/routes.js';
import { patientsRouter } from './modules/patients/routes.js';
import { studiesRouter } from './modules/studies/routes.js';
import { reportsRouter } from './modules/reports/routes.js';
import { reportTemplatesRouter } from './modules/reports/templates-routes.js';
import { aiRouter } from './modules/ai/routes.js';
import { portalRouter } from './modules/portal/routes.js';
import { notificationsRouter } from './modules/notifications/routes.js';
import { dicomwebRouter } from './modules/dicomweb/routes.js';
import { analyticsRouter } from './modules/analytics/routes.js';
import { auditRouter } from './modules/audit/routes.js';
import { systemRouter } from './modules/system/routes.js';
import { viewerRouter } from './modules/viewer/routes.js';
import { startScpServer } from './dicom/scp-server.js';
import { startSftpWatcher } from './dicom/sftp-watcher.js';

const app = express();

// ─── Security headers (HIPAA §164.312(a)(2)(i)) ───────────────────────────────
app.use(helmet({
  // Content-Security-Policy — strict but allows PDF/DICOM viewers
  contentSecurityPolicy: {
    directives: {
      defaultSrc: ["'self'"],
      scriptSrc:  ["'self'"],
      styleSrc:   ["'self'", "'unsafe-inline'"], // inline styles needed for PDF viewer
      imgSrc:     ["'self'", 'data:', 'blob:'],
      fontSrc:    ["'self'", 'data:'],
      objectSrc:  ["'none'"],
      frameSrc:   ["'none'"],
      connectSrc: ["'self'"],
      mediaSrc:   ["'self'", 'blob:'],
      workerSrc:  ["'self'", 'blob:'],
    }
  },
  crossOriginResourcePolicy: { policy: 'same-origin' },
  // HSTS — enforce HTTPS for 1 year (HIPAA §164.312(a)(2)(b))
  strictTransportSecurity: {
    maxAge: 31536000,
    includeSubDomains: true
  },
  // Prevent clickjacking
  frameguard: { action: 'deny' },
  // Prevent MIME sniffing
  noSniff: true,
  // Remove X-Powered-By (information disclosure)
  hidePoweredBy: true,
  // Referrer policy
  referrerPolicy: { policy: 'strict-origin-when-cross-origin' }
}));

// ─── CORS — explicit allowlist only, NO development bypass ───────────────────
// HIPAA: restricting cross-origin access prevents credential theft
const allowedOrigins = env.CORS_ORIGIN
  ? env.CORS_ORIGIN.split(',').map((o) => o.trim())
  : ['http://localhost:5173'];

app.use(cors({
  origin: (origin, callback) => {
    // Allow same-origin requests (no Origin header = server-to-server or same-origin)
    if (!origin) {
      callback(null, true);
      return;
    }
    if (allowedOrigins.includes(origin)) {
      callback(null, true);
    } else {
      callback(new Error(`CORS: origin "${origin}" not allowed`));
    }
  },
  credentials: true,                    // required for cookies to be sent cross-origin
  methods: ['GET', 'POST', 'PUT', 'DELETE', 'OPTIONS'],
  allowedHeaders: ['Content-Type', 'Authorization'],
  exposedHeaders: ['Set-Cookie']
}));

// ─── Global rate limiter — defense against DDoS / enumeration ────────────────
app.use(rateLimit({
  windowMs: 15 * 60 * 1000, // 15 minutes
  max: 300,                  // 300 req/window per IP for general API
  standardHeaders: true,
  legacyHeaders: false,
  message: { message: 'Demasiadas solicitudes. Intente más tarde.' }
}));

app.use(express.json({ limit: '10mb' }));
// Cookie parser — needed for httpOnly refresh token (HIPAA: tokens not in localStorage)
app.use(cookieParser());

// ─── rawBody para DICOMweb STOW-RS (multipart/related binario) ────────────────
app.use('/wado', (req, _res, next) => {
  const chunks: Buffer[] = [];
  req.on('data', (chunk: Buffer) => chunks.push(chunk));
  req.on('end', () => {
    (req as any).rawBody = Buffer.concat(chunks);
    next();
  });
});

// ─── Health check — no system info exposed in production ─────────────────────
app.get('/health', (_req, res) => {
  res.json({
    status: 'ok',
    service: 'pacs-backend',
    version: env.APP_VERSION
    // NOTE: never expose NODE_ENV, DB info, or internal paths here
  });
});

// ─── Archivos protegidos — autenticación + verificación de ownership ──────────
// C4: Replaced express.static with a dynamic endpoint that verifies the requesting
// user owns or has access to the requested file before streaming it.
// HIPAA §164.308(a)(4): role-based access with ownership enforcement.
app.get('/files/*', requireAuth as any, async (req: AuthRequest, res: Response) => {
  const urlPath = (req.params as any)[0] as string; // relative path after /files/
  if (!urlPath) return res.status(400).json({ message: 'Ruta de archivo inválida' });

  // Prevent path traversal attacks
  const normalizedPath = path.normalize(urlPath).replace(/\\/g, '/');
  if (normalizedPath.startsWith('..') || normalizedPath.includes('../')) {
    return res.status(400).json({ message: 'Ruta de archivo inválida' });
  }

  const storageRoot = path.resolve(process.cwd(), env.STORAGE_ROOT);
  const absoluteFilePath = path.join(storageRoot, normalizedPath);

  // Ensure the resolved path is within STORAGE_ROOT (second-layer traversal guard)
  if (!absoluteFilePath.startsWith(storageRoot + path.sep) && absoluteFilePath !== storageRoot) {
    return res.status(400).json({ message: 'Ruta de archivo inválida' });
  }

  if (!fs.existsSync(absoluteFilePath)) {
    return res.status(404).json({ message: 'Archivo no encontrado' });
  }

  const user = req.user!;
  const parts = normalizedPath.split('/');
  const fileType = parts[0]; // 'dicom' or 'pdfs'

  try {
    if (fileType === 'dicom' && parts.length >= 3) {
      // URL format: dicom/{studyId}/{filename}
      const studyId = parts[1];
      const study = await prisma.study.findUnique({
        where: { id: studyId },
        select: { id: true, patientId: true, assignedDoctorId: true }
      });
      if (!study) return res.status(404).json({ message: 'Archivo no encontrado' });

      if (user.role === 'ADMIN') {
        // ADMIN always allowed
      } else if (user.role === 'DOCTOR') {
        // DOCTOR: only if assigned to this study OR has a report for it
        const hasAccess = study.assignedDoctorId === user.sub;
        if (!hasAccess) {
          const hasReport = await prisma.report.findFirst({
            where: { studyId: study.id, doctorId: user.sub }
          });
          if (!hasReport) return res.status(403).json({ message: 'No autorizado para acceder a este archivo' });
        }
      } else if (user.role === 'PATIENT') {
        // PATIENT: only if the study belongs to them
        const access = await prisma.patientPortalAccess.findUnique({ where: { userId: user.sub } });
        if (!access || access.patientId !== study.patientId) {
          return res.status(403).json({ message: 'No autorizado para acceder a este archivo' });
        }
      } else {
        return res.status(403).json({ message: 'No autorizado' });
      }

    } else if (fileType === 'pdfs') {
      // URL format: pdfs/{reportId}.pdf
      const filename     = parts[1] ?? '';
      const reportId     = filename.replace(/\.pdf$/i, '');
      const report = await prisma.report.findUnique({
        where: { id: reportId },
        select: { id: true, doctorId: true, studyId: true, study: { select: { patientId: true } } }
      });
      if (!report) return res.status(404).json({ message: 'Archivo no encontrado' });

      if (user.role === 'ADMIN') {
        // ADMIN always allowed
      } else if (user.role === 'DOCTOR') {
        if (report.doctorId !== user.sub) return res.status(403).json({ message: 'No autorizado para acceder a este archivo' });
      } else if (user.role === 'PATIENT') {
        const access = await prisma.patientPortalAccess.findUnique({ where: { userId: user.sub } });
        if (!access || access.patientId !== report.study?.patientId) {
          return res.status(403).json({ message: 'No autorizado para acceder a este archivo' });
        }
      } else {
        return res.status(403).json({ message: 'No autorizado' });
      }

    } else {
      // Unknown file type — block access
      return res.status(403).json({ message: 'Tipo de archivo no permitido' });
    }

    // ── Stream the file with secure headers ─────────────────────────────────
    res.setHeader('X-Content-Type-Options', 'nosniff');
    res.setHeader('Cache-Control', 'private, no-store'); // no caching of medical files

    // B2: Use 'attachment' disposition for PDFs to prevent accidental display on shared screens
    if (fileType === 'pdfs') {
      const reportId = path.basename(normalizedPath, '.pdf');
      res.setHeader('Content-Disposition', `attachment; filename="informe-${reportId}.pdf"`);
    } else {
      res.setHeader('Content-Disposition', 'attachment');
    }

    res.sendFile(absoluteFilePath);
  } catch (err) {
    console.error('[FILES] Error al servir archivo:', err);
    res.status(500).json({ message: 'Error al obtener archivo' });
  }
});

// 404 de archivos
app.use('/files', (_req, res) => {
  res.status(404).json({ message: 'Archivo no encontrado' });
});

// ─── API routes ───────────────────────────────────────────────────────────────
app.use('/api/auth',          authRouter);
app.use('/api/users',         usersRouter);
app.use('/api/patients',      patientsRouter);
app.use('/api/studies',       studiesRouter);
app.use('/api/reports',           reportsRouter);
app.use('/api/report-templates',  reportTemplatesRouter);
app.use('/api/ai',            aiRouter);
app.use('/api/portal',        portalRouter);
app.use('/api/notifications', notificationsRouter);
app.use('/api/analytics',     analyticsRouter);
app.use('/api/audit',         auditRouter);
app.use('/api/system',        systemRouter);
app.use('/api/viewer',        viewerRouter);

// ─── DICOMweb — authentication required ──────────────────────────────────────
// HIPAA §164.312(a)(2)(i): unauthenticated DICOM endpoints are a critical risk.
// Options:
//   A) Bearer token — imaging equipment sends: Authorization: Bearer <DICOM_SYSTEM_TOKEN>
//   B) IP allowlist  — configure DICOM_ALLOWED_IPS in .env
// Both mechanisms work in parallel; at least one must pass.
app.use('/wado', dicomWebAuthMiddleware, dicomwebRouter);

// ─── 404 handler ─────────────────────────────────────────────────────────────
app.use((_req, res) => res.status(404).json({ message: 'Recurso no encontrado' }));

// ─── Global error handler — NEVER expose stack traces to client ───────────────
// HIPAA: stack traces leak internal architecture and must never reach clients
// eslint-disable-next-line @typescript-eslint/no-unused-vars
app.use((err: Error, _req: Request, res: Response, _next: NextFunction) => {
  // Always log internally with full detail
  console.error('[ERROR]', err.message, err.stack);
  // Never send stack trace to client — even in development
  res.status(500).json({ message: 'Error interno del servidor' });
});

// ─── Unhandled rejections ─────────────────────────────────────────────────────
process.on('unhandledRejection', (reason) => {
  console.error('[UNHANDLED REJECTION]', reason);
});

// ─── Start server ─────────────────────────────────────────────────────────────
app.listen(Number(env.PORT), () => {
  console.log(`✓ PACS backend v${env.APP_VERSION} en http://localhost:${env.PORT} [${env.NODE_ENV}]`);

  try { startScpServer(); } catch (err) {
    console.error('[SCP] No se pudo iniciar el servidor DICOM SCP:', err);
  }

  try { startSftpWatcher(); } catch (err) {
    console.error('[SFTP-WATCHER]', err);
  }
});

// ─── DICOMweb auth middleware ─────────────────────────────────────────────────
// Precompute the allowed IP set once at startup to avoid repeated string parsing per request.
// C5: '*' is excluded from the allowed set — it would disable all authentication.
const _allowedDicomIps: ReadonlySet<string> = (() => {
  if (!env.DICOM_ALLOWED_IPS) return new Set<string>();
  const ips = env.DICOM_ALLOWED_IPS.split(',').map((ip) => ip.trim()).filter((ip) => ip && ip !== '*');
  if (env.DICOM_ALLOWED_IPS.includes('*')) {
    console.warn(
      '[DICOM-AUTH] ⚠️  DICOM_ALLOWED_IPS contains "*" which is no longer supported ' +
      'and will NOT grant access. Remove "*" and list explicit IP addresses, or configure DICOM_SYSTEM_TOKEN.'
    );
  }
  return new Set(ips);
})();

function dicomWebAuthMiddleware(req: AuthRequest, res: Response, next: NextFunction) {
  // Option A: Bearer token authentication
  const authHeader = req.headers.authorization;
  if (authHeader?.startsWith('Bearer ')) {
    const token = authHeader.replace('Bearer ', '');
    // Accept DICOM_SYSTEM_TOKEN (for imaging equipment) or a valid user JWT
    if (env.DICOM_SYSTEM_TOKEN && token === env.DICOM_SYSTEM_TOKEN) {
      return next();
    }
    // Try as standard user JWT
    try {
      req.user = verifyAccessToken(token);
      return next();
    } catch {
      // fall through to IP allowlist check
    }
  }

  // Option B: IP allowlist (for trusted internal equipment networks)
  // Security: use req.socket.remoteAddress (the actual TCP peer) instead of
  // X-Forwarded-For, which is trivially spoofable by any client. If the server
  // is behind a trusted reverse proxy, configure DICOM_SYSTEM_TOKEN instead.
  // C5: The wildcard '*' is no longer accepted — it disabled all authentication.
  if (_allowedDicomIps.size > 0) {
    const clientIp = (req.socket?.remoteAddress ?? '').replace(/^::ffff:/, ''); // strip IPv6-mapped IPv4
    if (_allowedDicomIps.has(clientIp)) {
      return next();
    }
  }

  // If neither passes, reject
  res.status(401).json({
    message: 'Acceso no autorizado al endpoint DICOMweb. Configure DICOM_SYSTEM_TOKEN o DICOM_ALLOWED_IPS.'
  });
}
