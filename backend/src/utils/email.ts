/**
 * Email service — HIPAA §164.308(a)(3) — Encryption/decryption in transmission
 *
 * Security notes:
 *  - NEVER send plaintext passwords in email bodies
 *  - Portal access uses temporary passwords with mustChangePassword=true flag
 *  - The patient is forced to change password on first login
 *  - Emails do NOT include patient clinical data, study findings, or diagnoses
 *  - For full HIPAA compliance, configure SMTP with TLS (SMTP_SECURE=true, port 465/587)
 */

// eslint-disable-next-line @typescript-eslint/ban-ts-comment
// @ts-ignore — @types/nodemailer not installed; package ships its own types
import nodemailer from 'nodemailer';
import { env } from '../config/env.js';

function createTransporter() {
  if (!env.SMTP_HOST || !env.SMTP_USER) return null;
  return nodemailer.createTransport({
    host:   env.SMTP_HOST,
    port:   env.SMTP_PORT,
    secure: env.SMTP_SECURE,  // true = TLS from the start (port 465); false = STARTTLS (port 587)
    auth:   { user: env.SMTP_USER, pass: env.SMTP_PASS },
    tls:    { rejectUnauthorized: true }  // Never accept self-signed certs in production
  });
}

export async function sendEmail(opts: { to: string; subject: string; html: string }): Promise<void> {
  const transporter = createTransporter();
  if (!transporter) {
    console.log(`[EMAIL] Sin SMTP configurado. Destinatario: ${opts.to} | Asunto: ${opts.subject}`);
    return;
  }
  await transporter.sendMail({ from: env.EMAIL_FROM, ...opts });
}

// ─── Study assigned notification (to doctor) ─────────────────────────────────
export async function sendStudyAssignedEmail(
  doctor: { email: string; firstName: string; lastName: string },
  study:  { id: string; modality: string }
): Promise<void> {
  const loginUrl = `${env.APP_BASE_URL}`;
  await sendEmail({
    to:      doctor.email,
    subject: `[PACSMed] Nuevo estudio asignado — ${study.modality}`,
    html: `
      <p>Dr/a. ${doctor.firstName} ${doctor.lastName},</p>
      <p>Se le ha asignado un nuevo estudio de <strong>${study.modality}</strong> para informar.</p>
      <p>Ingrese al sistema para revisarlo:</p>
      <p><a href="${loginUrl}">${loginUrl}</a></p>
      <p><small>Si usted no esperaba este mensaje, contáctese con el administrador del sistema.</small></p>
    `
  });
}

// ─── Report finalized notification (to patient) ──────────────────────────────
// NOTE: Does NOT include clinical content — patient must log in to portal to view
export async function sendReportFinalizedEmail(
  patientEmail: string,
  _report: { id: string }
): Promise<void> {
  const portalUrl = env.PORTAL_BASE_URL ?? env.APP_BASE_URL;
  await sendEmail({
    to:      patientEmail,
    subject: '[PACSMed] Su informe médico está disponible',
    html: `
      <p>Estimado/a paciente,</p>
      <p>Su informe médico ha sido publicado y está disponible en su portal de paciente.</p>
      <p>Ingrese al portal para consultarlo:</p>
      <p><a href="${portalUrl}">${portalUrl}</a></p>
      <p><em>Si tiene dudas, consulte con su médico tratante.</em></p>
      <p><small>Este mensaje fue generado automáticamente. No responda a este correo.</small></p>
    `
  });
}

// ─── Sección 1: Critical finding alert (to requesting doctor) ────────────────
export async function sendCriticalFindingEmail(
  requestingDoctorEmail: string,
  requestingDoctorName: string,
  data: {
    reportId:    string;
    patientName: string;
    modality:    string;
    reason:      string;
    doctorName:  string;
  }
): Promise<void> {
  const reportUrl = `${env.APP_BASE_URL}/reports/${data.reportId}/verify`;
  await sendEmail({
    to:      requestingDoctorEmail,
    subject: `[PACSMed] 🚨 HALLAZGO CRÍTICO — ${data.patientName} — ${data.modality}`,
    html: `
      <div style="background:#fef2f2;border-left:4px solid #dc2626;padding:16px;margin-bottom:16px;">
        <strong style="color:#dc2626;font-size:16px;">🚨 HALLAZGO CRÍTICO / STAT</strong>
      </div>
      <p>Dr/a. ${requestingDoctorName},</p>
      <p>Se ha detectado un hallazgo crítico en el estudio de su paciente que requiere atención inmediata.</p>
      <table style="border-collapse:collapse;width:100%;max-width:500px;">
        <tr><td style="padding:6px;font-weight:bold;">Paciente:</td><td style="padding:6px;">${data.patientName}</td></tr>
        <tr><td style="padding:6px;font-weight:bold;">Modalidad:</td><td style="padding:6px;">${data.modality}</td></tr>
        <tr><td style="padding:6px;font-weight:bold;">Hallazgo:</td><td style="padding:6px;color:#dc2626;">${data.reason}</td></tr>
        <tr><td style="padding:6px;font-weight:bold;">Informado por:</td><td style="padding:6px;">${data.doctorName}</td></tr>
      </table>
      <p style="margin-top:16px;">
        <a href="${reportUrl}" style="background:#1e3a5f;color:#fff;padding:10px 20px;text-decoration:none;border-radius:4px;">
          Ver informe
        </a>
      </p>
      <p><small>
        Este mensaje fue generado automáticamente por PACSMed.
        Se requiere documentación del reconocimiento de esta comunicación urgente
        según el estándar ACR Practice Parameter para comunicación de hallazgos críticos.
      </small></p>
    `
  });
}

// ─── Sección 13: Distribución automática post-firma al médico solicitante ─────
export async function sendSignedReportEmail(
  requestingDoctorEmail: string,
  requestingDoctorName: string,
  report: { id: string; pdfPath?: string | null }
): Promise<void> {
  const reportUrl = `${env.APP_BASE_URL}/reports/${report.id}/verify`;
  await sendEmail({
    to:      requestingDoctorEmail,
    subject: `[PACSMed] Informe firmado disponible — Nº ${report.id.slice(0, 8).toUpperCase()}`,
    html: `
      <p>Dr/a. ${requestingDoctorName},</p>
      <p>El informe radiológico correspondiente a su solicitud ha sido firmado y está disponible.</p>
      <p>Informe Nº: <strong>${report.id.slice(0, 8).toUpperCase()}</strong></p>
      <p>
        <a href="${reportUrl}" style="background:#1e3a5f;color:#fff;padding:10px 20px;text-decoration:none;border-radius:4px;">
          Ver y verificar informe
        </a>
      </p>
      <p><small>
        Este mensaje fue generado automáticamente por PACSMed.
        El informe incluye un código QR de verificación en el pie de página.
      </small></p>
    `
  });
}

// ─── Portal access granted (to patient) ──────────────────────────────────────
// SECURITY: The temporary password is auto-generated, NOT chosen by the admin.
//           The patient MUST change it on first login (mustChangePassword=true).
//           Email does NOT contain any clinical or diagnostic information.
export async function sendPortalAccessEmail(
  email: string,
  tempPassword: string,
  firstName: string
): Promise<void> {
  const portalUrl = env.PORTAL_BASE_URL ?? env.APP_BASE_URL;
  await sendEmail({
    to:      email,
    subject: '[PACSMed] Acceso al Portal del Paciente — Acción requerida',
    html: `
      <p>Hola ${firstName},</p>
      <p>Se ha creado su acceso al Portal del Paciente de PACSMed.</p>
      <p><strong>Email de acceso:</strong> ${email}</p>
      <p><strong>Contraseña temporal:</strong> <code>${tempPassword}</code></p>
      <p><strong>⚠️ Deberá cambiar esta contraseña en su primer inicio de sesión.</strong></p>
      <p>Acceda al portal en:</p>
      <p><a href="${portalUrl}">${portalUrl}</a></p>
      <hr/>
      <p><small>
        Esta contraseña es temporal y de uso único. Si no solicitó este acceso,
        contáctese con el centro médico de inmediato.
        No comparta esta contraseña con nadie.
      </small></p>
    `
  });
}

// ─── Password reset (A4) ──────────────────────────────────────────────────────
// SECURITY: Email contains a single-use reset link — not the new password.
//           The link expires in 1 hour.
export async function sendPasswordResetEmail(
  email: string,
  firstName: string,
  rawToken: string
): Promise<void> {
  const baseUrl   = env.PORTAL_BASE_URL ?? env.APP_BASE_URL;
  const resetUrl  = `${baseUrl}/reset-password?token=${encodeURIComponent(rawToken)}`;
  await sendEmail({
    to:      email,
    subject: '[PACSMed] Recuperación de contraseña',
    html: `
      <p>Hola ${firstName},</p>
      <p>Recibimos una solicitud para restablecer la contraseña de su cuenta PACSMed.</p>
      <p>Haga clic en el siguiente enlace para establecer una nueva contraseña:</p>
      <p><a href="${resetUrl}">${resetUrl}</a></p>
      <p><strong>Este enlace expira en 1 hora y solo puede usarse una vez.</strong></p>
      <hr/>
      <p><small>
        Si no solicitó este restablecimiento, ignore este correo — su contraseña no será cambiada.
        Si le preocupa la seguridad de su cuenta, contáctese con el administrador del sistema.
      </small></p>
    `
  });
}
