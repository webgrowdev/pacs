#!/usr/bin/env tsx
/**
 * Switches the Prisma schema datasource provider between mysql and postgresql.
 *
 * Reads DATABASE_PROVIDER from .env (defaults to "mysql") and patches
 * prisma/schema.prisma accordingly, then runs `prisma generate`.
 *
 * Usage:
 *   npx tsx scripts/switch-db-provider.ts          # reads from .env
 *   DATABASE_PROVIDER=postgresql npx tsx scripts/switch-db-provider.ts
 */
import fs from 'node:fs';
import path from 'node:path';
import { execSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import dotenv from 'dotenv';

dotenv.config();

const __dirname = path.dirname(fileURLToPath(import.meta.url));

const VALID_PROVIDERS = ['mysql', 'postgresql'] as const;
type Provider = (typeof VALID_PROVIDERS)[number];

const requestedProvider = (process.env.DATABASE_PROVIDER || 'mysql').toLowerCase();

if (!VALID_PROVIDERS.includes(requestedProvider as Provider)) {
  console.error(`✗ DATABASE_PROVIDER inválido: "${requestedProvider}". Usa "mysql" o "postgresql".`);
  process.exit(1);
}

const schemaPath = path.resolve(__dirname, '..', 'prisma', 'schema.prisma');

if (!fs.existsSync(schemaPath)) {
  console.error(`✗ No se encontró schema.prisma en: ${schemaPath}`);
  process.exit(1);
}

let schema = fs.readFileSync(schemaPath, 'utf-8');

// Replace the provider line inside the datasource db block
const providerRegex = /(provider\s*=\s*)"(?:mysql|postgresql)"/;

if (!providerRegex.test(schema)) {
  console.error('✗ No se pudo encontrar la línea provider en datasource db.');
  process.exit(1);
}

const currentMatch = schema.match(providerRegex);
const currentProvider = currentMatch?.[0].match(/"(\w+)"/)?.[1];

if (currentProvider === requestedProvider) {
  console.log(`✓ El provider ya es "${requestedProvider}". Sin cambios.`);
} else {
  schema = schema.replace(providerRegex, `$1"${requestedProvider}"`);
  fs.writeFileSync(schemaPath, schema, 'utf-8');
  console.log(`✓ Provider cambiado: ${currentProvider} → ${requestedProvider}`);
}

// Regenerate Prisma client
console.log('  Regenerando Prisma Client...');
execSync('npx prisma generate', { stdio: 'inherit', cwd: path.resolve(__dirname, '..') });
console.log(`✓ Prisma Client regenerado para "${requestedProvider}".`);
console.log('');
console.log('Próximos pasos:');
console.log('  1. Asegúrate de que DATABASE_URL en .env apunta al motor correcto.');
console.log('  2. Ejecuta: npx prisma db push   (para sincronizar el schema)');
console.log('     o bien:  npx prisma migrate dev --name switch_provider');
