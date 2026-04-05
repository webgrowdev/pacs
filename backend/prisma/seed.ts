import { PrismaClient, RoleName, StudyStatus, ReportStatus } from '@prisma/client';
import bcrypt from 'bcryptjs';

const prisma = new PrismaClient();

async function main() {
  const roles = await Promise.all(
    [RoleName.ADMIN, RoleName.DOCTOR, RoleName.PATIENT].map((name) =>
      prisma.role.upsert({ where: { name }, update: {}, create: { name } })
    )
  );

  const passwordHash = await bcrypt.hash('ChangeMe123!', 10);
  const adminRole = roles.find((r) => r.name === RoleName.ADMIN)!;
  const doctorRole = roles.find((r) => r.name === RoleName.DOCTOR)!;
  const patientRole = roles.find((r) => r.name === RoleName.PATIENT)!;

  const admin = await prisma.user.upsert({
    where: { email: 'admin@pacs.local' },
    update: {},
    create: {
      email: 'admin@pacs.local',
      passwordHash,
      firstName: 'Admin',
      lastName: 'Principal',
      roleId: adminRole.id
    }
  });

  const doctor = await prisma.user.upsert({
    where: { email: 'doctor@pacs.local' },
    update: {},
    create: {
      email: 'doctor@pacs.local',
      passwordHash,
      firstName: 'Laura',
      lastName: 'Méndez',
      roleId: doctorRole.id
    }
  });

  const portalUser = await prisma.user.upsert({
    where: { email: 'paciente@pacs.local' },
    update: {},
    create: {
      email: 'paciente@pacs.local',
      passwordHash,
      firstName: 'Carlos',
      lastName: 'Pérez',
      roleId: patientRole.id
    }
  });

  const patient = await prisma.patient.upsert({
    where: { documentId: 'DNI12345678' },
    update: {},
    create: {
      internalCode: 'PAC-0001',
      firstName: 'Carlos',
      lastName: 'Pérez',
      documentId: 'DNI12345678',
      dateOfBirth: new Date('1988-07-10'),
      sex: 'M',
      email: 'paciente@demo.com',
      phone: '+54 9 11 5555 5555'
    }
  });

  await prisma.patientPortalAccess.upsert({
    where: { patientId: patient.id },
    update: { userId: portalUser.id },
    create: { patientId: patient.id, userId: portalUser.id }
  });

  // Idempotente: solo crear estudio demo si el paciente no tiene estudios
  let study = await prisma.study.findFirst({ where: { patientId: patient.id, modality: 'RM' } });
  if (!study) {
    study = await prisma.study.create({
      data: {
        patientId: patient.id,
        modality: 'RM',
        studyDate: new Date(),
        status: StudyStatus.IN_REVIEW,
        description: 'RM de rodilla derecha',
        uploadedById: admin.id,
        assignedDoctorId: doctor.id,
        metadataJson: { institution: 'Centro Médico Demo', bodyPart: 'KNEE' }
      }
    });
  }

  // Idempotente: solo crear informe demo si el estudio no tiene informes
  const existingReport = await prisma.report.findFirst({ where: { studyId: study.id, doctorId: doctor.id } });
  if (!existingReport) {
    await prisma.report.create({
      data: {
        studyId: study.id,
        doctorId: doctor.id,
        findings: 'No se observan lesiones meniscales significativas.',
        conclusion: 'RM de rodilla dentro de parámetros normales.',
        patientSummary: 'No se encontraron hallazgos relevantes en su resonancia.',
        status: ReportStatus.DRAFT,
        draftedAt: new Date()
      }
    });
  }

  // Idempotente: solo crear notificación si no existe una igual
  const existingNotif = await prisma.notification.findFirst({ where: { userId: doctor.id, type: 'SYSTEM', title: 'Worklist inicial' } });
  if (!existingNotif) {
    await prisma.notification.create({
      data: {
        userId: doctor.id,
        title: 'Worklist inicial',
        message: 'Tiene 1 estudio demo asignado para revisar.',
        type: 'SYSTEM'
      }
    });
  }

  await prisma.auditLog.create({
    data: {
      userId: admin.id,
      action: 'SEED_BOOTSTRAP',
      entityType: 'SYSTEM',
      payload: { message: 'Datos demo iniciales creados' }
    }
  });

  // ─── Módulos del sistema ────────────────────────────────────────────────────
  const MODULES = [
    { code: 'PACS',           name: 'Almacenamiento PACS',     description: 'Gestión y almacenamiento de estudios DICOM. Servidor SCP, DICOMweb (WADO-RS/STOW-RS/QIDO-RS), carga manual de archivos y carpetas.',                         version: '1.0.0' },
    { code: 'INFORMES',       name: 'Informes Radiológicos',    description: 'Redacción, firma y generación de informes clínicos en PDF. Visor DICOM integrado con CornerstoneJS v3. Asistencia IA editorial.',                             version: '1.0.0' },
    { code: 'AGENDA',         name: 'Agenda y Turnos',          description: 'Gestión de turnos, recursos y modalidades. Calendario de agenda, confirmación automática, recordatorios.',                                                     version: '0.0.0' },
    { code: 'ADMISION',       name: 'Admisión y Recepción',     description: 'Registro de pacientes, órdenes médicas, DICOM Worklist (MWL), recepción de estudios desde equipos.',                                                          version: '0.0.0' },
    { code: 'COMUNICACION',   name: 'Comunicación con Equipos', description: 'Integración DICOM completa: Modality Worklist (MWL), MPPS, Storage SCU/SCP. Integración HL7 ADT para admisión y alta de pacientes.',                          version: '0.1.0' },
    { code: 'FACTURACION',    name: 'Facturación Argentina',    description: 'Facturación electrónica AFIP/ARCA, liquidación a obras sociales, nomenclador AMB/PMC, gestión de copagos.',                                                   version: '0.0.0' },
    { code: 'PORTAL_MEDICO',  name: 'Portal Médico',            description: 'Acceso externo para médicos derivantes: consulta de estudios e informes de sus pacientes, solicitud de estudios.',                                            version: '0.0.0' },
    { code: 'PORTAL_PACIENTE',name: 'Portal Paciente',          description: 'Acceso del paciente a sus propios estudios e informes. Descarga de PDF. Resumen en lenguaje simple generado por IA.',                                         version: '0.5.0' },
  ];

  for (const m of MODULES) {
    await prisma.module.upsert({
      where:  { code: m.code },
      update: { name: m.name, description: m.description, version: m.version },
      create: { ...m }
    });
  }

  // Tenant demo
  const demoTenant = await prisma.tenant.upsert({
    where:  { slug: 'demo-hospital' },
    update: {},
    create: {
      name:     'Hospital Demo',
      slug:     'demo-hospital',
      cuit:     '30-12345678-9',
      isActive: true,
    }
  });

  // Habilitar PACS, INFORMES y PORTAL_PACIENTE para el tenant demo
  for (const code of ['PACS', 'INFORMES', 'PORTAL_PACIENTE']) {
    const mod = await prisma.module.findUnique({ where: { code } });
    if (mod) {
      await prisma.tenantModule.upsert({
        where:  { tenantId_moduleId: { tenantId: demoTenant.id, moduleId: mod.id } },
        update: {},
        create: { tenantId: demoTenant.id, moduleId: mod.id, isActive: true }
      });
    }
  }
}

main().finally(async () => prisma.$disconnect());
