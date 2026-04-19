/**
 * Audit logging middleware — HIPAA §164.312(b) / ANMAT Disposición 2318/02
 *
 * Every access to PHI must be logged with:
 *   - Who:   userId + email
 *   - What:  action + entityType + entityId
 *   - When:  createdAt (auto by Prisma)
 *   - Where: IP address + User-Agent
 *   - Extra: optional payload for context
 */

import { prisma } from '../config/prisma.js';
import { AuthRequest } from './auth.js';
import { getClientIp } from '../utils/security.js';

interface AuditOptions {
  eventActionCode?: 'C' | 'R' | 'U' | 'D' | 'E';
  eventOutcome?: 0 | 4 | 8 | 12;
  participantObjectId?: string;
  participantObjectTypeCode?: 1 | 2;
}

export async function logAudit(
  req: AuthRequest,
  action: string,
  entityType: string,
  entityId?: string,
  payload?: object,
  atna?: AuditOptions
): Promise<void> {
  try {
    await prisma.auditLog.create({
      data: {
        userId:     req.user?.sub,
        action,
        entityType,
        entityId,
        ipAddress:  getClientIp(req),
        userAgent:  (req.headers['user-agent'] ?? '').slice(0, 500),
        eventActionCode:           atna?.eventActionCode,
        eventOutcome:              atna?.eventOutcome,
        participantObjectId:       atna?.participantObjectId,
        participantObjectTypeCode: atna?.participantObjectTypeCode,
        networkAccessPoint:        getClientIp(req),
        payload
      }
    });
  } catch (err) {
    // Audit failures must NEVER crash the application but must be logged
    // so ops teams can investigate storage issues
    console.error('[AUDIT] Failed to write audit log:', action, entityType, entityId, err);
  }
}

/**
 * System-level audit — for DICOM SCP / SFTP processes that have no HTTP request.
 * Logs with a synthetic "system" context.
 */
export async function logSystemAudit(
  action: string,
  entityType: string,
  entityId?: string,
  payload?: object,
  sourceIp?: string
): Promise<void> {
  try {
    await prisma.auditLog.create({
      data: {
        userId:    null,       // system action — no authenticated user
        action,
        entityType,
        entityId,
        ipAddress: sourceIp ?? 'system',
        userAgent: 'DICOM-SYSTEM',
        payload
      }
    });
  } catch (err) {
    console.error('[AUDIT] Failed to write system audit log:', action, err);
  }
}
