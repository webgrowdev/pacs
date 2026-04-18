/**
 * Security utilities — HIPAA / ANMAT compliance helpers
 *
 * Covers:
 *  - Password complexity enforcement (HIPAA 45 CFR §164.308(a)(5)(ii)(A))
 *  - Cryptographically secure token / temp-password generation
 *  - PHI field scrubbing before sending to third-party AI services
 */

import crypto from 'node:crypto';

// ─── Password Complexity ──────────────────────────────────────────────────────

export interface PasswordValidationResult {
  valid: boolean;
  errors: string[];
}

/**
 * Validates password complexity.
 * Requirements (HIPAA §164.308):
 *   - Minimum 12 characters
 *   - At least one uppercase letter
 *   - At least one lowercase letter
 *   - At least one digit
 *   - At least one special character
 */
export function validatePasswordComplexity(password: string): PasswordValidationResult {
  const errors: string[] = [];

  if (password.length < 12) {
    errors.push('La contraseña debe tener al menos 12 caracteres');
  }
  if (!/[A-Z]/.test(password)) {
    errors.push('La contraseña debe contener al menos una letra mayúscula');
  }
  if (!/[a-z]/.test(password)) {
    errors.push('La contraseña debe contener al menos una letra minúscula');
  }
  if (!/[0-9]/.test(password)) {
    errors.push('La contraseña debe contener al menos un número');
  }
  if (!/[^A-Za-z0-9]/.test(password)) {
    errors.push('La contraseña debe contener al menos un carácter especial (!@#$%^&*...)');
  }

  return { valid: errors.length === 0, errors };
}

// ─── Secure Token Generation ──────────────────────────────────────────────────

/**
 * Generates a cryptographically secure random token (hex string).
 * Used for one-time invite links, password reset, etc.
 */
export function generateSecureToken(bytes = 32): string {
  return crypto.randomBytes(bytes).toString('hex');
}

/**
 * Generates a temporary password that satisfies complexity requirements.
 * Format: <Uppercase><6 alphanum><2 digits><special>
 * Example: "Tr8xKq94!m2P"
 */
export function generateTempPassword(): string {
  const upper   = 'ABCDEFGHJKLMNPQRSTUVWXYZ';
  const lower   = 'abcdefghjkmnpqrstuvwxyz';
  const digits  = '0123456789';
  const special = '!@#$%^&*';
  const all     = upper + lower + digits + special;

  const rand = (chars: string) => chars[crypto.randomInt(chars.length)];

  // Guarantee at least one of each required class
  const parts = [
    rand(upper),
    rand(lower),
    rand(lower),
    rand(lower),
    rand(digits),
    rand(digits),
    rand(special),
  ];

  // Fill to 12 characters
  while (parts.length < 12) parts.push(rand(all));

  // Fisher-Yates shuffle to avoid predictable positions
  for (let i = parts.length - 1; i > 0; i--) {
    const j = crypto.randomInt(i + 1);
    [parts[i], parts[j]] = [parts[j], parts[i]];
  }

  return parts.join('');
}

// ─── PHI Scrubbing for AI calls ──────────────────────────────────────────────

/**
 * Removes or masks patient-identifying information from clinical text
 * before sending to any external AI API.
 *
 * HIPAA §164.514(b) — Safe Harbor: remove 18 PHI identifiers.
 *
 * NOTE: This is a best-effort text scrub. If your OpenAI agreement does
 * NOT include a Business Associate Agreement (BAA), do NOT send any
 * patient-specific clinical text to external APIs.
 */
export function scrubPhiFromText(text: string): string {
  let scrubbed = text;

  // Remove date patterns (DOB, study dates, etc.)
  scrubbed = scrubbed.replace(
    /\b\d{1,2}[\/\-\.]\d{1,2}[\/\-\.]\d{2,4}\b/g,
    '[FECHA]'
  );

  // Remove phone numbers
  scrubbed = scrubbed.replace(
    /\b(\+?54)?[\s\-]?\(?\d{2,4}\)?[\s\-]?\d{6,8}\b/g,
    '[TELEFONO]'
  );

  // Remove email addresses
  scrubbed = scrubbed.replace(
    /[a-zA-Z0-9._%+\-]+@[a-zA-Z0-9.\-]+\.[a-zA-Z]{2,}/g,
    '[EMAIL]'
  );

  // Remove Argentine DNI / CUIL / CUIT patterns
  scrubbed = scrubbed.replace(
    /\b(DNI|CUIL|CUIT)?\s*:?\s*\d{7,11}\b/gi,
    '[ID_DOCUMENTO]'
  );

  // Remove medical record / patient code references
  scrubbed = scrubbed.replace(
    /\b(paciente|patient|N[°º]?|HC|MR|NHC)\s*[:#]?\s*[A-Z0-9\-]{4,20}\b/gi,
    '[CODIGO_PACIENTE]'
  );

  // Remove names in common Argentine/Spanish formats (B6):
  //   - ALL-CAPS: "GARCIA, JUAN CARLOS"
  //   - Title case: "García, Juan" or "Juan García"
  //   - Accented characters are included via the Unicode ranges
  //
  // Patterns:
  //   1. "Apellido, Nombre" or "APELLIDO, NOMBRE" (comma-separated)
  //   2. Standalone ALL-CAPS name sequences (legacy pattern)
  scrubbed = scrubbed.replace(
    /\b[A-ZÁÉÍÓÚÑÜ][a-záéíóúñüA-ZÁÉÍÓÚÑÜ]{1,}\s*,\s*[A-ZÁÉÍÓÚÑÜ][a-záéíóúñüA-ZÁÉÍÓÚÑÜ\s]{1,20}\b/g,
    '[NOMBRE_PACIENTE]'
  );
  // ALL-CAPS sequences (e.g., "GARCIA JUAN")
  scrubbed = scrubbed.replace(
    /\b[A-ZÁÉÍÓÚÑÜ]{2,}\s+[A-ZÁÉÍÓÚÑÜ]{2,}(\s+[A-ZÁÉÍÓÚÑÜ]{2,})?\b/g,
    '[NOMBRE_PACIENTE]'
  );

  return scrubbed;
}

// ─── IP Address Extraction ────────────────────────────────────────────────────

import { Request } from 'express';

/**
 * Extracts the real client IP from the request.
 * Handles X-Forwarded-For (reverse proxy) with safe first-IP extraction.
 */
export function getClientIp(req: Request): string {
  const forwarded = req.headers['x-forwarded-for'];
  if (forwarded) {
    const first = String(forwarded).split(',')[0].trim();
    // Basic validation — reject if not IP-like
    if (/^[\d.]{7,15}$/.test(first) || /^[0-9a-fA-F:]{3,39}$/.test(first)) {
      return first;
    }
  }
  return req.socket?.remoteAddress ?? req.ip ?? 'unknown';
}
