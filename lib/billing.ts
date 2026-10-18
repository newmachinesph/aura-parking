import { dbQuery, dbTransaction } from "./db";

const MS_PER_DAY = 24 * 60 * 60 * 1000;

export const FREE_NIGHTS_PER_RESIDENT_PER_MONTH = 1;
export const RATE_CENTS_PER_NIGHT = 500;

function toUtcMidnight(dateLike: string | Date): Date {
  const d = new Date(dateLike);
  if (Number.isNaN(d.getTime())) throw new Error(`Invalid date: ${dateLike}`);
  return new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate()));
}

function monthStartUtc(date: Date): Date {
  return new Date(Date.UTC(date.getUTCFullYear(), date.getUTCMonth(), 1));
}

function nextMonthStartUtc(date: Date): Date {
  return new Date(Date.UTC(date.getUTCFullYear(), date.getUTCMonth() + 1, 1));
}

function diffDaysUtc(later: Date, earlier: Date): number {
  return Math.round((later.getTime() - earlier.getTime()) / MS_PER_DAY);
}

export function splitNightsByMonth(startDate: string | Date, endDate: string | Date) {
  const start = toUtcMidnight(startDate);
  let end = toUtcMidnight(endDate);
  if (end < start) throw new Error("endDate cannot be before startDate");
  // Same-day stay = 1 night minimum
  if (end.getTime() === start.getTime()) {
    end = new Date(end.getTime() + MS_PER_DAY);
  }

  const parts: { monthStart: string; nights: number }[] = [];
  let cursor = start;

  while (cursor < end) {
    const ms = monthStartUtc(cursor);
    const monthEnd = nextMonthStartUtc(cursor);
    const chunkEnd = monthEnd < end ? monthEnd : end;
    const nights = diffDaysUtc(chunkEnd, cursor);
    if (nights > 0) {
      parts.push({ monthStart: ms.toISOString().slice(0, 10), nights });
    }
    cursor = chunkEnd;
  }
  return parts;
}

async function ensureMonthlyBucket(residentId: number, monthStart: string) {
  await dbQuery(
    `INSERT INTO resident_free_pass_months (resident_id, month_start, free_nights_total, free_nights_used)
     VALUES (:residentId, :monthStart, :freeTotal, 0)
     ON CONFLICT (resident_id, month_start) DO NOTHING`,
    { residentId, monthStart, freeTotal: FREE_NIGHTS_PER_RESIDENT_PER_MONTH }
  );
}

async function getMonthlyBucket(residentId: number, monthStart: string) {
  const rows = await dbQuery(
    `SELECT month_start, free_nights_total, free_nights_used
     FROM resident_free_pass_months
     WHERE resident_id = :residentId AND month_start = :monthStart
     LIMIT 1`,
    { residentId, monthStart }
  );
  return rows.length ? rows[0] : null;
}

async function getGuestVehicleFreePass(plateNumber: string) {
  if (!plateNumber) return null;
  // Normalize plate for consistent lookup (TC-04/TC-07)
  const normalized = plateNumber.trim().toUpperCase().replace(/[\s-]/g, "");
  const rows = await dbQuery(
    `SELECT free_pass, used FROM guest_vehicle_free_pass WHERE plate_number = :plate LIMIT 1`,
    { plate: normalized }
  );
  return rows.length ? rows[0] : null;
}

export interface BillingResult {
  residentId: number;
  startDate: string | Date;
  endDate: string | Date;
  rateCentsPerNight: number;
  totalNights: number;
  guestFreePassApplied: number;
  bonusNightsApplied: number;
  freeNightsApplied: number;
  billableNights: number;
  amountCents: number;
  months: {
    monthStart: string;
    nights: number;
    freeRemaining: number;
    freeApplied: number;
    billable: number;
  }[];
  /** Tracks which month buckets had free passes consumed (for DB deduction at approval) */
  monthConsumptions: { monthStart: string; consumed: number }[];
}

export async function calculateStayBilling(
  residentId: number,
  startDate: string | Date,
  endDate: string | Date,
  options: { rateCentsPerNight?: number; plateNumber?: string } = {}
): Promise<BillingResult> {
  const rateCentsPerNight = Number(options.rateCentsPerNight ?? RATE_CENTS_PER_NIGHT);
  if (!Number.isFinite(rateCentsPerNight) || rateCentsPerNight < 0) {
    throw new Error("Invalid rateCentsPerNight");
  }

  const plateNumber = options.plateNumber || null;

  let guestFreePassApplied = 0;
  if (plateNumber) {
    const vehiclePass = await getGuestVehicleFreePass(plateNumber);
    if (vehiclePass && Number(vehiclePass.free_pass) === 1 && !vehiclePass.used) {
      guestFreePassApplied = 1;
    }
  }

  const monthParts = splitNightsByMonth(startDate, endDate);

  let totalNights = 0;
  for (const part of monthParts) totalNights += part.nights;

  if (totalNights === 1 && guestFreePassApplied === 1) {
    return {
      residentId, startDate, endDate, rateCentsPerNight,
      totalNights: 1, guestFreePassApplied: 1, bonusNightsApplied: 0, freeNightsApplied: 0,
      billableNights: 0, amountCents: 0,
      months: monthParts.map((p) => ({
        monthStart: p.monthStart, nights: p.nights,
        freeRemaining: 0, freeApplied: 0, billable: 0,
      })),
      monthConsumptions: [],
    };
  }

  // Read bonus passes from residents table
  const bonusRows = await dbQuery(
    `SELECT bonus_free_nights FROM residents WHERE id = :residentId LIMIT 1`,
    { residentId }
  );
  const bonusAvailable = Number((bonusRows[0] as Record<string, unknown>)?.bonus_free_nights ?? 0);

  // Apply bonus nights after guest free pass, before monthly buckets
  const nightsAfterGuestPass = Math.max(0, totalNights - guestFreePassApplied);
  const bonusNightsApplied = Math.min(nightsAfterGuestPass, bonusAvailable);

  // Ensure monthly buckets exist for all relevant months BEFORE querying the pool
  const currentMonthStart = monthStartUtc(new Date()).toISOString().slice(0, 10);
  for (const part of monthParts) {
    if (part.monthStart <= currentMonthStart) {
      await ensureMonthlyBucket(residentId, part.monthStart);
    }
  }

  // Fetch ALL monthly buckets with remaining passes (oldest first) for global pool
  const allBuckets = await dbQuery(
    `SELECT month_start, free_nights_total, free_nights_used
     FROM resident_free_pass_months
     WHERE resident_id = :residentId AND free_nights_used < free_nights_total
     ORDER BY month_start ASC`,
    { residentId }
  );

  // Build consumable pool from oldest months first
  const passPool: { monthStart: string; remaining: number }[] = allBuckets.map((b: Record<string, unknown>) => ({
    monthStart: b.month_start as string,
    remaining: Math.max(0, Number(b.free_nights_total) - Number(b.free_nights_used)),
  }));

  let poolIndex = 0;
  let poolRemaining = passPool.length > 0 ? passPool[0].remaining : 0;
  const monthConsumptions = new Map<string, number>();

  function consumeFromPool(nights: number): number {
    let consumed = 0;
    let remaining = nights;
    while (remaining > 0 && poolIndex < passPool.length) {
      const take = Math.min(remaining, poolRemaining);
      consumed += take;
      remaining -= take;
      poolRemaining -= take;
      const ms = passPool[poolIndex].monthStart;
      monthConsumptions.set(ms, (monthConsumptions.get(ms) || 0) + take);
      if (poolRemaining <= 0) {
        poolIndex++;
        poolRemaining = poolIndex < passPool.length ? passPool[poolIndex].remaining : 0;
      }
    }
    return consumed;
  }

  // Global remainder tracks how many nights still need coverage from monthly buckets
  let globalRemainder = guestFreePassApplied + bonusNightsApplied;
  let freeNightsApplied = 0;
  let billableNights = 0;
  const months: BillingResult["months"] = [];

  for (const part of monthParts) {
    // Subtract already-covered nights (guest pass + bonus) from this month chunk
    const covered = Math.min(part.nights, globalRemainder);
    globalRemainder = Math.max(0, globalRemainder - part.nights);
    const effectiveNights = part.nights - covered;

    // Consume from global pool of accumulated passes (oldest first)
    const freeApplied = consumeFromPool(effectiveNights);
    const billable = Math.max(0, effectiveNights - freeApplied);

    freeNightsApplied += freeApplied;
    billableNights += billable;

    months.push({
      monthStart: part.monthStart, nights: part.nights,
      freeRemaining: 0, freeApplied, billable,
    });
  }

  return {
    residentId, startDate, endDate, rateCentsPerNight,
    totalNights, guestFreePassApplied, bonusNightsApplied, freeNightsApplied,
    billableNights, amountCents: billableNights * rateCentsPerNight,
    months,
    monthConsumptions: Array.from(monthConsumptions.entries()).map(([monthStart, consumed]) => ({
      monthStart, consumed,
    })),
  };
}

/**
 * Recalculate billing estimates for all PENDING stays belonging to a resident.
 * Call this after passes are consumed (auto-approve or approve) so that
 * other PENDING stays reflect the updated pass balance.
 */
export async function refreshPendingStayBilling(residentId: number): Promise<void> {
  await dbTransaction(async (client) => {
    // Lock pending stays to prevent concurrent refresh
    const pendingStays = await dbQuery(
      `SELECT id, start_date, end_date, COALESCE(vehicle_plate, plate_number) AS vehicle_plate
       FROM guest_stays
       WHERE requested_by_resident_id = :residentId AND status = 'PENDING'
       FOR UPDATE`,
      { residentId },
      client
    );

    for (const stay of pendingStays) {
      const billing = await calculateStayBilling(
        residentId,
        stay.start_date as string,
        stay.end_date as string,
        { plateNumber: stay.vehicle_plate as string }
      );
      const gfp = billing.guestFreePassApplied || 0;
      const passesApplied = gfp + (billing.bonusNightsApplied || 0) + (billing.freeNightsApplied || 0);

      await dbQuery(
        `UPDATE guest_stays
         SET passes_applied = :passesApplied,
             guest_free_pass_nights = :gfp,
             billable_nights = :billableNights,
             amount_cents = :amountCents
         WHERE id = :id`,
        {
          id: stay.id,
          passesApplied,
          gfp,
          billableNights: billing.billableNights,
          amountCents: billing.amountCents,
        },
        client
      );
    }
  });
}
