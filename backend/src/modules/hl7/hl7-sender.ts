/**
 * MLLP sender — wraps HL7 message with MLLP framing and sends over TCP.
 * Retries 3 times with exponential backoff on failure.
 */

import net from 'node:net';
import { buildOruR01, Hl7OruPayload } from './hl7-service.js';
import { logSystemAudit } from '../../middleware/audit.js';

const MLLP_START = 0x0b;   // \x0B
const MLLP_END1  = 0x1c;   // \x1C
const MLLP_END2  = 0x0d;   // \x0D (CR)

function wrapMllp(message: string): Buffer {
  const msgBuf = Buffer.from(message, 'utf8');
  const frame  = Buffer.alloc(msgBuf.length + 3);
  frame[0] = MLLP_START;
  msgBuf.copy(frame, 1);
  frame[msgBuf.length + 1] = MLLP_END1;
  frame[msgBuf.length + 2] = MLLP_END2;
  return frame;
}

async function sendOnce(host: string, port: number, data: Buffer): Promise<void> {
  return new Promise((resolve, reject) => {
    const socket = net.createConnection({ host, port }, () => {
      socket.write(data, (err) => {
        if (err) { socket.destroy(); reject(err); return; }
        socket.end();
        resolve();
      });
    });
    socket.setTimeout(10_000);
    socket.on('timeout', () => { socket.destroy(); reject(new Error('MLLP timeout')); });
    socket.on('error', reject);
  });
}

export async function sendHl7ORU(
  payload: Hl7OruPayload,
  host: string,
  port: number
): Promise<void> {
  const message = buildOruR01(payload);
  const frame   = wrapMllp(message);
  let lastErr: unknown;
  for (let attempt = 1; attempt <= 3; attempt++) {
    try {
      await sendOnce(host, port, frame);
      await logSystemAudit('HL7_ORU_SENT', 'REPORT', payload.reportId, { host, port, attempt });
      return;
    } catch (err) {
      lastErr = err;
      if (attempt < 3) await new Promise(r => setTimeout(r, attempt * 1000));
    }
  }
  await logSystemAudit('HL7_ORU_FAILED', 'REPORT', payload.reportId, { host, port, error: String(lastErr) });
  throw lastErr;
}
