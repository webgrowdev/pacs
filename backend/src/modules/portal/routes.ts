import { Router } from 'express';
import bcrypt from 'bcryptjs';
import { prisma } from '../../config/prisma.js';
import { requireAuth, requireRole, invalidateAuthCache, AuthRequest } from '../../middleware/auth.js';
import { logAudit } from '../../middleware/audit.js';
import { toFileUrl } from '../../storage/file-storage.js';
import { env } from '../../config/env.js';
import { sendPortalAccessEmail } from '../../utils/email.js';
import { generateTempPassword } from '../../utils/security.js';

export const portalRouter = Router();
portalRouter.use(requireAuth as any);

// ── Rutas de paciente ─────────────────────────────────────────────────────────

// Estudios del paciente con informes
portalRouter.get('/my-results', requireRole('PATIENT') as any, async (req: AuthRequest, res: any) => {
  try {
    const access = await prisma.patientPortalAccess.findUnique({ where: { userId: req.user!.sub } });
    if (!access) return res.status(403).json({ message: 'Sin perfil de paciente asociado' });

    // Actualizar última visita
    await prisma.patientPortalAccess.update({
      where: { userId: req.user!.sub },
      data: { lastLoginAt: new Date() }
    });

    const studies = await prisma.study.findMany({
      where: { patientId: access.patientId },
      include: {
        reports: {
          where: { status: { in: ['FINAL', 'SIGNED'] } },
          select: {
            id: true,
            status: true,
            finalizedAt: true,
            pdfPath: true,
            // A5: conclusion is NOT returned to the patient portal.
            // patientSummary is the approved patient-facing text.
            patientSummary: true,
            doctor: { select: { firstName: true, lastName: true } }
          }
        }
      },
      orderBy: { studyDate: 'desc' }
    });

    await logAudit(req, 'PORTAL_ACCESS', 'PATIENT', access.patientId, undefined, { eventActionCode: 'R', participantObjectId: access.patientId, participantObjectTypeCode: 1 });

    return res.json(
      studies.map((s) => ({
        studyId:     s.id,
        modality:    s.modality,
        studyDate:   s.studyDate,
        description: s.description,
        status:      s.status,
        report: s.reports[0]
          ? {
              id:             s.reports[0].id,
              status:         s.reports[0].status,
              finalizedAt:    s.reports[0].finalizedAt,
              // A5: If patientSummary is empty, return a generic message instead of
              // exposing the raw medical conclusion to the patient.
              patientSummary: s.reports[0].patientSummary?.trim()
                ? s.reports[0].patientSummary
                : 'Su informe ha sido emitido. Por favor consulte con su médico para la interpretación de los resultados.',
              doctorName: `${s.reports[0].doctor.firstName} ${s.reports[0].doctor.lastName}`,
              pdfUrl: s.reports[0].pdfPath
                ? toFileUrl(s.reports[0].pdfPath, env.APP_BASE_URL)
                : null
            }
          : null
      }))
    );
  } catch (err) {
    console.error('[PORTAL/MY-RESULTS]', err);
    return res.status(500).json({ message: 'Error al obtener resultados' });
  }
});

// Perfil del paciente — HIPAA §164.514: minimum necessary information only
portalRouter.get('/my-profile', requireRole('PATIENT') as any, async (req: AuthRequest, res: any) => {
  try {
    const access = await prisma.patientPortalAccess.findUnique({
      where: { userId: req.user!.sub },
      include: {
        patient: {
          select: {
            // Return only fields the patient needs to see — no internal codes exposed
            firstName:   true,
            lastName:    true,
            dateOfBirth: true,
            sex:         true,
            email:       true
          }
        }
      }
    });
    if (!access) return res.status(403).json({ message: 'Sin perfil de paciente' });
    return res.json(access.patient);
  } catch (err) {
    console.error('[PORTAL/PROFILE]', err);
    return res.status(500).json({ message: 'Error al obtener perfil' });
  }
});

// ── Rutas de admin — gestión de acceso al portal ──────────────────────────────

// Listar accesos al portal (con paginación)
portalRouter.get('/admin/access-list', requireRole('ADMIN') as any, async (req: AuthRequest, res: any) => {
  try {
    const page  = Math.max(1, parseInt(String(req.query.page  ?? '1')));
    const limit = Math.min(100, Math.max(1, parseInt(String(req.query.limit ?? '50'))));
    const skip  = (page - 1) * limit;

    const [list, total] = await Promise.all([
      prisma.patientPortalAccess.findMany({
        include: {
          patient: { select: { id: true, firstName: true, lastName: true, documentId: true, internalCode: true } },
          user:    { select: { id: true, email: true, isActive: true, createdAt: true } }
        },
        orderBy: { createdAt: 'desc' },
        skip,
        take: limit
      }),
      prisma.patientPortalAccess.count()
    ]);

    return res.json({ data: list, total, page, limit });
  } catch (err) {
    console.error('[PORTAL/ADMIN/LIST]', err);
    return res.status(500).json({ message: 'Error al obtener lista de accesos' });
  }
});

// Verificar acceso de un paciente específico
portalRouter.get('/admin/access/:patientId', requireRole('ADMIN') as any, async (req: AuthRequest, res: any) => {
  try {
    const patientId = String(req.params.patientId);
    const access = await prisma.patientPortalAccess.findUnique({
      where: { patientId },
      include: { user: { select: { id: true, email: true, isActive: true, createdAt: true } } }
    });
    return res.json({ hasAccess: !!access, access });
  } catch (err) {
    console.error('[PORTAL/ADMIN/ACCESS]', err);
    return res.status(500).json({ message: 'Error al verificar acceso' });
  }
});

// Otorgar acceso al portal
// SECURITY CHANGES vs original:
//   - Admin NO LONGER provides a password — it is auto-generated securely
//   - mustChangePassword is set to true — patient must change on first login
//   - Uses database transaction to prevent partial state
portalRouter.post('/admin/grant', requireRole('ADMIN') as any, async (req: AuthRequest, res: any) => {
  const { patientId, email, firstName, lastName } = req.body;
  if (!patientId || !email || !firstName || !lastName) {
    return res.status(400).json({ message: 'Faltan campos: patientId, email, firstName, lastName' });
  }

  // Basic email validation
  const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
  if (!emailRegex.test(email)) {
    return res.status(400).json({ message: 'Email inválido' });
  }

  try {
    const patient = await prisma.patient.findUnique({ where: { id: patientId } });
    if (!patient) return res.status(404).json({ message: 'Paciente no encontrado' });

    const existing = await prisma.patientPortalAccess.findUnique({ where: { patientId } });
    if (existing) return res.status(409).json({ message: 'El paciente ya tiene acceso al portal' });

    const patientRole = await prisma.role.findUnique({ where: { name: 'PATIENT' } });
    if (!patientRole) return res.status(500).json({ message: 'Rol PATIENT no configurado en base de datos' });

    // Auto-generate cryptographically secure temporary password
    // Admin never sees the password — only the patient receives it via email
    const tempPassword   = generateTempPassword();
    const passwordHash   = await bcrypt.hash(tempPassword, 12);

    // Use transaction to ensure atomicity — either both records are created or neither
    const { user, access } = await prisma.$transaction(async (tx) => {
      const user = await tx.user.create({
        data: {
          email,
          passwordHash,
          firstName,
          lastName,
          roleId:            patientRole.id,
          mustChangePassword: true  // Patient MUST change password on first login
        }
      });

      const access = await tx.patientPortalAccess.create({
        data: { patientId, userId: user.id }
      });

      return { user, access };
    });

    await logAudit(req, 'PORTAL_ACCESS_GRANTED', 'PATIENT', patientId, { userId: user.id, email });

    // Send temporary password via email — patient must change it on first login
    sendPortalAccessEmail(email, tempPassword, firstName).catch((err) => {
      console.error('[PORTAL/GRANT] Error enviando email de acceso:', err);
    });

    return res.status(201).json({
      message: 'Acceso otorgado. Se envió email con credenciales temporales al paciente.',
      accessId: access.id,
      userId: user.id
    });
  } catch (err: any) {
    if (err?.code === 'P2002') return res.status(409).json({ message: 'Email ya registrado en el sistema' });
    console.error('[PORTAL/ADMIN/GRANT]', err);
    return res.status(500).json({ message: 'Error al otorgar acceso' });
  }
});

// Revocar acceso al portal
portalRouter.delete('/admin/revoke/:patientId', requireRole('ADMIN') as any, async (req: AuthRequest, res: any) => {
  try {
    const patientId = String(req.params.patientId);
    const access = await prisma.patientPortalAccess.findUnique({ where: { patientId } });
    if (!access) return res.status(404).json({ message: 'El paciente no tiene acceso al portal' });

    // Transaction: delete access record + deactivate user atomically
    await prisma.$transaction([
      prisma.patientPortalAccess.delete({ where: { patientId } }),
      prisma.user.update({ where: { id: access.userId }, data: { isActive: false } })
    ]);

    // N1: Invalidate the auth cache so the deactivated user is rejected on their next request
    invalidateAuthCache(access.userId);

    await logAudit(req, 'PORTAL_ACCESS_REVOKED', 'PATIENT', patientId, { userId: access.userId });
    return res.json({ message: 'Acceso revocado exitosamente' });
  } catch (err) {
    console.error('[PORTAL/ADMIN/REVOKE]', err);
    return res.status(500).json({ message: 'Error al revocar acceso' });
  }
});
