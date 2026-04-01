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

  const study = await prisma.study.create({
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

  await prisma.notification.create({
    data: {
      userId: doctor.id,
      title: 'Worklist inicial',
      message: 'Tiene 1 estudio demo asignado para revisar.',
      type: 'SYSTEM'
    }
  });

  await prisma.auditLog.create({
    data: {
      userId: admin.id,
      action: 'SEED_BOOTSTRAP',
      entityType: 'SYSTEM',
      payload: { message: 'Datos demo iniciales creados' }
    }
  });
}

main().finally(async () => prisma.$disconnect());
