/**
 * Database portability helpers.
 *
 * Prisma's `mode: 'insensitive'` for string filters is only supported
 * on PostgreSQL. MySQL with utf8mb4_unicode_ci collation is already
 * case-insensitive by default, so we simply omit the mode.
 *
 * Usage:
 *   import { insensitive } from '../config/db.js';
 *   prisma.patient.findMany({
 *     where: { firstName: { contains: search, ...insensitive() } }
 *   });
 */

const provider = (process.env.DATABASE_PROVIDER || 'mysql').toLowerCase();

export const isPostgres = provider === 'postgresql' || provider === 'postgres';
export const isMySQL = !isPostgres;

/**
 * Returns `{ mode: 'insensitive' }` for PostgreSQL, `{}` for MySQL.
 * Spread into Prisma string filter objects for portable case-insensitive search.
 */
export function insensitive(): { mode?: 'insensitive' } {
  return isPostgres ? { mode: 'insensitive' } : {};
}
