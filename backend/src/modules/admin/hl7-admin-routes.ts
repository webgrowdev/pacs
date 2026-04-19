import { Router } from 'express';
import net from 'node:net';
import { requireAuth, requireRole, AuthRequest } from '../../middleware/auth.js';
import { env } from '../../config/env.js';

export const hl7AdminRouter = Router();
hl7AdminRouter.use(requireAuth as any, requireRole('ADMIN') as any);

// POST /api/admin/hl7/test — send a test MLLP message to verify connectivity
hl7AdminRouter.post('/test', async (req: AuthRequest, res: any) => {
  const host = String(req.body?.host ?? env.HL7_HOST ?? '');
  const port = Number(req.body?.port ?? env.HL7_PORT ?? 2575);

  if (!host) {
    return res.status(400).json({ message: 'Host HL7 no configurado. Proporcione host en el body o configure HL7_HOST.' });
  }

  const testMessage = [
    `MSH|^~\\&|PACS|PACSMED|HIS|HOSPITAL|${new Date().toISOString().replace(/[-:T]/g,'').slice(0,12)}||ACK^A01|TEST001|P|2.5`,
    'MSA|AA|TEST001|Conexión HL7 verificada exitosamente'
  ].join('\r');

  const frame = Buffer.alloc(testMessage.length + 3);
  frame[0] = 0x0b;
  Buffer.from(testMessage, 'utf8').copy(frame, 1);
  frame[testMessage.length + 1] = 0x1c;
  frame[testMessage.length + 2] = 0x0d;

  const socket = net.createConnection({ host, port }, () => {
    socket.write(frame, () => {
      socket.end();
      res.json({ success: true, message: `Conexión MLLP exitosa a ${host}:${port}` });
    });
  });
  socket.setTimeout(8_000);
  socket.on('timeout', () => {
    socket.destroy();
    if (!res.headersSent) res.status(504).json({ success: false, message: `Timeout al conectar a ${host}:${port}` });
  });
  socket.on('error', (err) => {
    if (!res.headersSent) res.status(502).json({ success: false, message: `Error de conexión: ${err.message}` });
  });
});
