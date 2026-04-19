/**
 * Sección 11: Gestión de informes incompletos (Stale Draft Alerts)
 *
 * Background job that runs periodically and creates notifications for doctors
 * who have DRAFT reports with no activity for more than STALE_DRAFT_HOURS hours.
 * Critical for guardia workflow — drafts must not be abandoned.
 */
import { prisma } from '../config/prisma.js';
import { createNotification } from '../modules/notifications/service.js';

/** Milliseconds per hour, used for stale-draft threshold calculation. */
const MILLIS_PER_HOUR = 3_600_000;

/** Hours of inactivity before a DRAFT report is considered stale. */
const STALE_DRAFT_HOURS = Number(process.env.STALE_DRAFT_HOURS ?? 4);

/** Interval (ms) between stale-draft checks. Default: every 30 minutes. */
const CHECK_INTERVAL_MS = 30 * 60 * 1000;

export function startStaleDraftAlertJob(): void {
  const run = async () => {
    try {
      const cutoff = new Date(Date.now() - STALE_DRAFT_HOURS * MILLIS_PER_HOUR);

      const staleDrafts = await prisma.report.findMany({
        where: {
          status:    'DRAFT',
          updatedAt: { lt: cutoff }
        },
        select: {
          id:         true,
          doctorId:   true,
          updatedAt:  true,
          study:      { select: { modality: true, patient: { select: { lastName: true, firstName: true } } } }
        }
      });

      for (const draft of staleDrafts) {
        const hoursStale = Math.round(
          (Date.now() - draft.updatedAt.getTime()) / MILLIS_PER_HOUR
        );
        const patientName = `${draft.study.patient.lastName}, ${draft.study.patient.firstName}`;

        await createNotification(
          draft.doctorId,
          `⏰ Borrador pendiente — ${patientName}`,
          `Tiene un informe en borrador de ${draft.study.modality} sin actividad por ${hoursStale} horas. Recuerde finalizarlo.`,
          'STALE_DRAFT'
        ).catch(() => {});
      }

      if (staleDrafts.length > 0) {
        console.log(`[STALE-DRAFTS] ${staleDrafts.length} borrador(es) vencido(s) notificado(s)`);
      }
    } catch (err) {
      console.error('[STALE-DRAFTS] Error en job de borradores vencidos:', err);
    }
  };

  // Run immediately on startup, then every CHECK_INTERVAL_MS
  run();
  const timer = setInterval(run, CHECK_INTERVAL_MS);

  // Allow Node.js to exit even while this timer is active
  if (timer.unref) timer.unref();

  console.log(`✓ Stale-draft alert job started (threshold: ${STALE_DRAFT_HOURS}h, interval: ${CHECK_INTERVAL_MS / 60000}min)`);
}

// Also export a manual trigger for tests / admin endpoints
export { STALE_DRAFT_HOURS, CHECK_INTERVAL_MS };
