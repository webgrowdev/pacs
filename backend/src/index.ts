import express from 'express';
import cors from 'cors';
import helmet from 'helmet';
import path from 'node:path';
import { env } from './config/env.js';
import { authRouter } from './modules/auth/routes.js';
import { usersRouter } from './modules/users/routes.js';
import { patientsRouter } from './modules/patients/routes.js';
import { studiesRouter } from './modules/studies/routes.js';
import { reportsRouter } from './modules/reports/routes.js';
import { aiRouter } from './modules/ai/routes.js';
import { portalRouter } from './modules/portal/routes.js';
import { notificationsRouter } from './modules/notifications/routes.js';

const app = express();
app.use(helmet());
app.use(cors({ origin: true, credentials: true }));
app.use(express.json({ limit: '10mb' }));

app.get('/health', (_req, res) => res.json({ status: 'ok', service: 'pacs-backend' }));
app.use('/files', express.static(path.resolve(process.cwd(), env.STORAGE_ROOT)));

app.use('/api/auth', authRouter);
app.use('/api/users', usersRouter);
app.use('/api/patients', patientsRouter);
app.use('/api/studies', studiesRouter);
app.use('/api/reports', reportsRouter);
app.use('/api/ai', aiRouter);
app.use('/api/portal', portalRouter);
app.use('/api/notifications', notificationsRouter);

app.listen(Number(env.PORT), () => {
  console.log(`PACS backend ejecutando en puerto ${env.PORT}`);
});
