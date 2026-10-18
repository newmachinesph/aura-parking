import { NextRequest, NextResponse } from "next/server";
import { dbQuery, dbTransaction } from "@/lib/db";
import { authRequired, verifyAuth } from "@/lib/auth";
import { sendParkingEmail } from "@/lib/mailer";
import { calculateStayBilling, refreshPendingStayBilling } from "@/lib/billing";
import { formatShortDate, toSqlDate, normalizePlate, generatePublicToken, todayMST } from "@/lib/helpers";
import { parsePaginationParams, paginatedResult } from "@/lib/pagination";
import { rateLimit } from "@/lib/validation";

/* ------------------------------------------------------------------ */
/*  GET /api/guest-stays                                               */
/*  List guest stays with optional filters.                            */
/* ------------------------------------------------------------------ */
export async function GET(request: NextRequest) {
  try {
    const auth = authRequired(request);
    if (auth instanceof NextResponse) return auth;
    const sp = request.nextUrl.searchParams;
    const unitIdParam = sp.get("unitId") || sp.get("unit_id") || "";
    const unitNumberParam = sp.get("unitNumber") || sp.get("unit_number") || "";
    const emailParam = sp.get("email") || "";
    const { cursor, limit } = parsePaginationParams(sp);

    let extraJoin = "";
    const conditions: string[] = [];
    const params: Record<string, unknown> = {};

    // Residents can only see stays for their own unit
    if (auth.role === "resident") {
      if (!auth.residentId) {
        return NextResponse.json({ error: "Resident account not linked" }, { status: 403 });
      }
      const resRows = await dbQuery(
        `SELECT unit_id FROM residents WHERE id = :residentId LIMIT 1`,
        { residentId: auth.residentId }
      );
      if (!resRows?.length) {
        return NextResponse.json({ error: "Resident not found" }, { status: 404 });
      }
      conditions.push("gs.unit_id = :residentUnitId");
      params.residentUnitId = resRows[0].unit_id;
    }

    const emailCandidate = emailParam.trim();

    if (emailCandidate) {
      extraJoin = "INNER JOIN residents r ON r.unit_id = u.id AND r.status = 'ACTIVE'";
      conditions.push("r.email = :email");
      params.email = emailCandidate;
    } else if (unitNumberParam) {
      const normalized = String(unitNumberParam).replace(/^\s*Unit\s+/i, "").trim();
      conditions.push("u.unit_number = :unitNumber");
      params.unitNumber = normalized;
    } else if (unitIdParam) {
      const raw = String(unitIdParam).trim();
      if (/^\d{4,}$/.test(raw)) {
        conditions.push("u.unit_number = :unitNumber");
        params.unitNumber = raw;
      } else {
        conditions.push("gs.unit_id = :unitId");
        params.unitId = Number(unitIdParam);
      }
    }

    // Filter to admin-created stays only
    const createdByAdmin = sp.get("createdByAdmin");
    if (createdByAdmin === "true") {
      conditions.push("gs.created_by_user_id IN (SELECT id FROM auth_users WHERE role = 'admin')");
    }

    if (cursor) {
      conditions.push("gs.id < :cursor");
      params.cursor = cursor;
    }

    const whereClause = conditions.length > 0 ? "WHERE " + conditions.join(" AND ") : "";
    const fetchLimit = limit + 1;
    params.fetchLimit = fetchLimit;

    const rows = await dbQuery(
      `SELECT gs.id, gs.unit_id, gs.start_date, gs.end_date,
              COALESCE(gs.vehicle_plate, gs.plate_number) AS vehicle_plate,
              gs.vehicle_desc, gs.status,
              gs.passes_applied, gs.guest_free_pass_nights, gs.billable_nights, gs.amount_cents,
              gs.resident_email_status,
              gs.resident_email_error,
              gs.guest_email_status,
              gs.guest_email_error,
              gs.email_last_attempt_at,
              u.unit_number,
              g.full_name AS guest_name,
              g.email AS guest_email
       FROM guest_stays gs
       INNER JOIN units u ON u.id = gs.unit_id
       INNER JOIN guests g ON g.id = gs.guest_id
       ${extraJoin}
       ${whereClause}
       ORDER BY gs.id DESC
       LIMIT :fetchLimit`,
      params
    );

    const { items, hasMore, nextCursor } = paginatedResult(rows as (typeof rows[0] & { id: number })[], limit);
    return NextResponse.json({ stays: items, hasMore, nextCursor });
  } catch (err) {
    console.error(err);
    return NextResponse.json(
      { error: "Failed to list guest stays" },
      { status: 500 }
    );
  }
}

/* ------------------------------------------------------------------ */
/*  POST /api/guest-stays                                              */
/*  Guest request submission: create stay, email resident + guest.     */
/* ------------------------------------------------------------------ */
export async function POST(request: NextRequest) {
  try {
    // autoApprove requires auth (resident adding their own guest, or admin/staff)
    const authResult = verifyAuth(request);
    const auth = authResult === "expired" ? null : authResult;

    // Rate limit unauthenticated submissions to prevent spam/email flood
    if (!auth) {
      const ip = request.headers.get("x-forwarded-for")?.split(",")[0]?.trim() || "unknown";
      const rl = rateLimit(`guest-stay:${ip}`, 10, 15 * 60 * 1000);
      if (!rl.ok) {
        return NextResponse.json(
          { error: "Too many requests. Please try again later." },
          { status: 429 }
        );
      }
    }

    const body = await request.json();
    let {
      unitId,
      unitNumber,
      guest,
      vehicle,
      stay,
      actionUrlResident,
      actionUrlGuest,
      autoApprove,
    } = body || {};

    // Only authenticated residents, admins, and staff can use autoApprove
    if (autoApprove) {
      if (!auth) {
        return NextResponse.json(
          { error: "Authentication required to auto-approve" },
          { status: 401 }
        );
      }
      if (!["admin", "staff", "resident"].includes(auth.role)) {
        return NextResponse.json(
          { error: "Unauthorized to auto-approve" },
          { status: 403 }
        );
      }
    }

    const residentEmailInput = (
      body?.residentEmail ||
      body?.resident_email ||
      ""
    ).trim();

    if (!unitId && !unitNumber && !residentEmailInput) {
      return NextResponse.json(
        { error: "unitId or unitNumber or residentEmail is required" },
        { status: 400 }
      );
    }
    // Trim all string inputs
    if (guest?.fullName) guest.fullName = String(guest.fullName).trim();
    if (guest?.email) guest.email = String(guest.email).trim();
    if (vehicle?.plate) vehicle.plate = String(vehicle.plate).trim();
    if (vehicle?.desc) vehicle.desc = String(vehicle.desc).trim();

    if (
      !guest?.fullName ||
      !vehicle?.plate ||
      !stay?.startDate ||
      !stay?.endDate
    ) {
      return NextResponse.json(
        {
          error:
            "guest.fullName, vehicle.plate, stay.startDate, stay.endDate are required",
        },
        { status: 400 }
      );
    }

    // Normalize plate: uppercase, strip spaces/dashes
    vehicle.plate = normalizePlate(vehicle.plate);

    // Date validation (use MST so late-night users aren't blocked)
    const today = todayMST();
    const startStr = toSqlDate(stay.startDate);
    const endStr = toSqlDate(stay.endDate);
    if (startStr < today) {
      return NextResponse.json(
        { error: "Start date cannot be in the past" },
        { status: 400 }
      );
    }
    if (endStr < startStr) {
      return NextResponse.json(
        { error: "End date cannot be before start date" },
        { status: 400 }
      );
    }

    const normalizeUnitNumber = (value: unknown): string | null => {
      if (value == null) return null;
      const raw = String(value).trim();
      if (!raw) return null;
      return raw
        .replace(/^\s*Unit\s+/i, "")
        .replace(/^\s*UNIT\s*-\s*/i, "")
        .replace(/^\s*Unit\s*-\s*/i, "")
        .trim();
    };

    const normalizedUnitNumber = normalizeUnitNumber(unitNumber);

    // Resolve unit + active resident
    const whereClause = residentEmailInput
      ? "r.email = :residentEmail"
      : unitId
        ? "u.id = :unitId"
        : "u.unit_number = :unitNumber";

    const lookupParams = residentEmailInput
      ? { residentEmail: residentEmailInput }
      : unitId
        ? { unitId: Number(unitId) }
        : { unitNumber: normalizedUnitNumber };

    const unitAndResident = await dbQuery(
      `SELECT u.id AS unit_id, u.unit_number, r.id AS resident_id, r.email AS resident_email
       FROM units u
       INNER JOIN residents r ON r.unit_id = u.id AND r.status = 'ACTIVE'
       WHERE ${whereClause}
       ORDER BY r.is_primary_contact DESC, r.id ASC
       LIMIT 1`,
      lookupParams
    );

    if (!unitAndResident?.length || !unitAndResident[0].resident_email) {
      return NextResponse.json(
        { error: "No ACTIVE resident email found for this unit" },
        { status: 409 }
      );
    }

    unitId = unitAndResident[0].unit_id;
    unitNumber = unitAndResident[0].unit_number;
    const residentId = unitAndResident[0].resident_id;
    const residentEmail = unitAndResident[0].resident_email as string;

    // #26: Residents can only autoApprove for their own unit
    if (autoApprove && auth?.role === "resident") {
      if (!auth.residentId) {
        return NextResponse.json({ error: "Resident account not linked" }, { status: 403 });
      }
      const ownUnit = await dbQuery(
        `SELECT unit_id FROM residents WHERE id = :residentId LIMIT 1`,
        { residentId: auth.residentId }
      );
      if (!ownUnit?.length || ownUnit[0].unit_id !== unitId) {
        return NextResponse.json(
          { error: "You can only auto-approve stays for your own unit" },
          { status: 403 }
        );
      }
    }

    // --- Cross-unit plate conflict check ---
    // Prevent the same plate from having active/pending passes under a different unit
    const conflictRows = await dbQuery(
      `SELECT gs.id, u.unit_number
       FROM guest_stays gs
       INNER JOIN units u ON u.id = gs.unit_id
       WHERE gs.plate_number = :plate
         AND gs.status IN ('PENDING', 'APPROVED', 'NEEDS_PAYMENT', 'PAID')
         AND gs.end_date >= :today
         AND gs.unit_id != :unitId
       LIMIT 1`,
      { plate: vehicle.plate, today, unitId }
    );
    if (conflictRows?.length) {
      const conflictUnit = conflictRows[0].unit_number;
      return NextResponse.json(
        { error: `This vehicle already has an active parking pass with Unit ${conflictUnit}. A vehicle can only hold one guest pass at a time.` },
        { status: 409 }
      );
    }

    // --- Find or create guest ---
    let guestId: number | null = null;
    if (guest.email) {
      const existing = await dbQuery(
        `SELECT id, full_name FROM guests WHERE email = :email ORDER BY id DESC LIMIT 1`,
        { email: guest.email }
      );
      guestId = (existing?.[0]?.id as number) || null;

      const submittedName = String(guest.fullName || "").trim();
      const existingName = String(existing?.[0]?.full_name || "").trim();
      if (guestId && submittedName && submittedName !== existingName) {
        await dbQuery(
          `UPDATE guests SET full_name = :fullName WHERE id = :id`,
          { id: guestId, fullName: submittedName }
        );
      }
    }
    if (!guestId) {
      const guestInsert = await dbQuery(
        `INSERT INTO guests (full_name, email, phone)
         VALUES (:fullName, :email, :phone)
         RETURNING id`,
        {
          fullName: guest.fullName,
          email: guest.email || null,
          phone: guest.phone || null,
        }
      );
      guestId = guestInsert.insertId;
    }

    // Ensure guest_vehicle_free_pass record exists for this plate.
    // First-time plates get free_pass=1; returning plates keep existing record.
    await dbQuery(
      `INSERT INTO guest_vehicle_free_pass (plate_number, free_pass)
       VALUES (:plate, 1)
       ON CONFLICT (plate_number) DO UPDATE SET plate_number = EXCLUDED.plate_number
       RETURNING id`,
      { plate: vehicle.plate }
    );

    // Calculate billing estimate for PENDING stays (passes are NOT deducted yet).
    // For autoApprove, billing is recalculated inside the transaction below.
    const billing = await calculateStayBilling(
      residentId,
      stay.startDate,
      stay.endDate,
      { plateNumber: vehicle.plate }
    );

    let initialStatus = "PENDING";
    if (autoApprove) {
      initialStatus =
        (billing?.amountCents as number) > 0 ? "NEEDS_PAYMENT" : "APPROVED";
    }

    const guestFreePassNights = (billing.guestFreePassApplied as number) || 0;
    const passesApplied =
      guestFreePassNights +
      ((billing.bonusNightsApplied as number) || 0) +
      ((billing.freeNightsApplied as number) || 0);
    const billableNights = (billing.billableNights as number) || 0;
    const amountCents = (billing.amountCents as number) || 0;

    const publicToken = generatePublicToken();

    const stayInsert = await dbQuery(
      `INSERT INTO guest_stays (
          unit_id, guest_id,
          plate_number,
          vehicle_plate, vehicle_desc,
          start_date, end_date,
          status,
          approved_at,
          requested_by_resident_id,
          created_by_user_id,
          passes_applied, guest_free_pass_nights, billable_nights, amount_cents,
          public_token
       ) VALUES (
          :unitId, :guestId,
          :plate,
          :plate, :desc,
          :startDate, :endDate,
          :status,
          ${autoApprove ? "NOW()" : "NULL"},
          :requestedByResidentId,
          :createdByUserId,
          :passesApplied, :guestFreePassNights, :billableNights, :amountCents,
          :publicToken
       )
       RETURNING id, public_token`,
      {
        unitId,
        guestId,
        plate: vehicle.plate,
        desc: vehicle.desc || null,
        startDate: toSqlDate(stay.startDate),
        endDate: toSqlDate(stay.endDate),
        status: initialStatus,
        requestedByResidentId: residentId,
        createdByUserId: auth?.sub || null,
        passesApplied,
        guestFreePassNights,
        billableNights,
        amountCents,
        publicToken,
      }
    );

    const stayId = stayInsert.insertId;
    const stayStart = formatShortDate(stay.startDate);
    const stayEnd = formatShortDate(stay.endDate);

    /* ---------- autoApprove path ---------- */
    if (autoApprove) {
      // Recalculate billing + debit passes inside a transaction with FOR UPDATE locks
      // to prevent TOCTOU race conditions on pass balances
      const txBilling = await dbTransaction(async (client) => {
        // Lock resident pass rows to serialize concurrent operations
        await dbQuery(
          `SELECT id FROM residents WHERE id = :residentId FOR UPDATE`,
          { residentId },
          client
        );
        await dbQuery(
          `SELECT id FROM resident_free_pass_months WHERE resident_id = :residentId FOR UPDATE`,
          { residentId },
          client
        );
        // GP-FREEPASS-02 fix: Lock guest vehicle free pass record to prevent concurrent
        // requests for the same plate from both applying the one-time free pass
        await dbQuery(
          `SELECT id FROM guest_vehicle_free_pass WHERE plate_number = :plate FOR UPDATE`,
          { plate: vehicle.plate },
          client
        );

        // Recalculate billing inside the transaction (after locks)
        const txBill = await calculateStayBilling(
          residentId,
          stay.startDate,
          stay.endDate,
          { plateNumber: vehicle.plate }
        );

        const txStatus = (txBill?.amountCents as number) > 0 ? "NEEDS_PAYMENT" : "APPROVED";

        // Update the stay with the accurate billing
        const txGfp = (txBill.guestFreePassApplied as number) || 0;
        const txPasses = txGfp + ((txBill.bonusNightsApplied as number) || 0) + ((txBill.freeNightsApplied as number) || 0);
        await dbQuery(
          `UPDATE guest_stays SET status = :status, passes_applied = :passesApplied,
           guest_free_pass_nights = :gfp, billable_nights = :billableNights, amount_cents = :amountCents
           WHERE id = :stayId`,
          { stayId, status: txStatus, passesApplied: txPasses, gfp: txGfp, billableNights: txBill.billableNights, amountCents: txBill.amountCents },
          client
        );

        const consumptions = txBill?.monthConsumptions as
          | Array<{ monthStart: string; consumed: number }>
          | undefined;
        if (consumptions?.length) {
          for (const c of consumptions) {
            if (c.consumed > 0) {
              await dbQuery(
                `UPDATE resident_free_pass_months
                 SET free_nights_used = free_nights_used + :consumed,
                     updated_at = NOW()
                 WHERE resident_id = :residentId AND month_start = :monthStart`,
                { residentId, monthStart: c.monthStart, consumed: c.consumed },
                client
              );
            }
          }
        }

        const bonusApplied = (txBill?.bonusNightsApplied as number) || 0;
        if (bonusApplied > 0) {
          await dbQuery(
            `UPDATE residents SET bonus_free_nights = GREATEST(0, bonus_free_nights - :bonusApplied) WHERE id = :residentId`,
            { bonusApplied, residentId },
            client
          );
        }

        if ((txBill?.guestFreePassApplied as number) > 0) {
          await dbQuery(
            `UPDATE guest_vehicle_free_pass
             SET used = TRUE, guest_stay_id = :stayId, updated_at = NOW()
             WHERE plate_number = :plate AND used = FALSE`,
            { stayId, plate: vehicle.plate },
            client
          );
        }

        return { ...txBill, finalStatus: txStatus };
      });

      // Update initialStatus from the transactional result
      initialStatus = txBilling.finalStatus as string;

      // Recalculate billing estimates for any other PENDING stays (passes changed)
      await refreshPendingStayBilling(residentId);

      // Send the guest permit email directly (skip resident notification)
      if (initialStatus === "APPROVED" && guest.email) {
        const permitUrl = `${process.env.FRONTEND_URL || ""}/permit/${stayId}?token=${publicToken}`;
        await sendParkingEmail(
          guest.email,
          "Parking Permit Approved",
          "guest_approval",
          {
            unit_number: unitNumber,
            vehicle_plate: vehicle.plate,
            vehicle_desc: vehicle.desc || "",
            stay_start: stayStart,
            stay_end: stayEnd,
            action_url: permitUrl,
          }
        );
      }

      return NextResponse.json(
        { id: stayId, status: initialStatus, billing: txBilling },
        { status: 201 }
      );
    }

    /* ---------- Normal PENDING flow: send notification emails ---------- */
    const residentLink =
      actionUrlResident ||
      `${process.env.FRONTEND_URL || ""}/dashboard`;

    const residentEmailResult = await sendParkingEmail(
      residentEmail,
      "New Parking Request",
      "new_guest_request_resident",
      {
        unit_number: unitNumber,
        vehicle_plate: vehicle.plate,
        vehicle_desc: vehicle.desc || "",
        stay_start: stayStart,
        stay_end: stayEnd,
        action_url: residentLink,
      }
    );
    if (!residentEmailResult.ok) {
      console.error(
        "[email] resident notification failed:",
        residentEmailResult.error
      );
    }

    let guestEmailResult: { ok: boolean; error?: { message: string } } | null = null;
    if (guest.email) {
      const guestLink =
        actionUrlGuest ||
        `${process.env.FRONTEND_URL || ""}/status/${stayId}`;
      guestEmailResult = await sendParkingEmail(
        guest.email,
        "Request Submitted",
        "guest_request_received_guest",
        {
          unit_number: unitNumber,
          vehicle_plate: vehicle.plate,
          vehicle_desc: vehicle.desc || "",
          stay_start: stayStart,
          stay_end: stayEnd,
          action_url: guestLink,
        }
      );
      if (!guestEmailResult.ok) {
        console.error(
          "[email] guest notification failed:",
          guestEmailResult.error
        );
      }
    }

    // Persist email attempt results (best-effort)
    try {
      const residentStatus = residentEmailResult?.ok ? "SENT" : "FAILED";
      const guestStatus =
        guestEmailResult == null
          ? null
          : guestEmailResult?.ok
            ? "SENT"
            : "FAILED";
      const residentError = residentEmailResult?.ok
        ? null
        : ((residentEmailResult?.error as { message?: string })?.message ??
          null);
      const guestError =
        guestEmailResult?.ok || guestEmailResult == null
          ? null
          : ((guestEmailResult?.error as { message?: string })?.message ?? null);

      await dbQuery(
        `UPDATE guest_stays
         SET resident_email_status = :residentStatus,
             resident_email_error = :residentError,
             guest_email_status = :guestStatus,
             guest_email_error = :guestError,
             email_last_attempt_at = NOW()
         WHERE id = :id`,
        {
          id: stayId,
          residentStatus,
          residentError,
          guestStatus,
          guestError,
        }
      );
    } catch (e: unknown) {
      const msg =
        (e as { sqlMessage?: string })?.sqlMessage ||
        (e as Error)?.message ||
        "";
      console.warn(
        "[email] failed to persist email status on guest_stays:",
        msg
      );
    }

    return NextResponse.json(
      {
        id: stayId,
        status: "PENDING",
        email: { resident: residentEmailResult, guest: guestEmailResult },
      },
      { status: 201 }
    );
  } catch (err: unknown) {
    console.error(err);
    return NextResponse.json(
      { error: "Failed to create guest stay" },
      { status: 500 }
    );
  }
}
