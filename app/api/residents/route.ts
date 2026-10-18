import { NextRequest, NextResponse } from "next/server";
import { dbQuery } from "@/lib/db";
import { authRequired } from "@/lib/auth";
import { sendParkingEmail } from "@/lib/mailer";
import { parsePaginationParams, paginatedResult } from "@/lib/pagination";

/**
 * GET /api/residents
 * List all residents (admin/staff).
 */
export async function GET(request: NextRequest) {
  try {
    const auth = authRequired(request);
    if (auth instanceof NextResponse) return auth;
    if (auth.role !== "admin" && auth.role !== "staff") {
      return NextResponse.json({ error: "Admin or staff access required" }, { status: 403 });
    }

    const sp = request.nextUrl.searchParams;
    const { cursor, limit } = parsePaginationParams(sp);
    const fetchLimit = limit + 1;
    const cursorClause = cursor ? "WHERE r.id < :cursor" : "";

    const rows = await dbQuery(
      `SELECT r.id,
              r.unit_id,
              u.unit_number,
              r.full_name,
              r.email,
              r.status,
              r.is_primary_contact,
              r.created_at,
              r.updated_at
       FROM residents r
       INNER JOIN units u ON u.id = r.unit_id
       ${cursorClause}
       ORDER BY r.id DESC
       LIMIT :fetchLimit`,
      { ...(cursor ? { cursor } : {}), fetchLimit }
    );

    const { items, hasMore, nextCursor } = paginatedResult(rows as (typeof rows[0] & { id: number })[], limit);
    return NextResponse.json({ residents: items, hasMore, nextCursor });
  } catch (err) {
    console.error(err);
    return NextResponse.json(
      { error: "Failed to list residents" },
      { status: 500 }
    );
  }
}

/**
 * POST /api/residents
 * Create a resident: upsert unit, insert resident, send activation email.
 */
export async function POST(request: NextRequest) {
  try {
    const auth = authRequired(request);
    if (auth instanceof NextResponse) return auth;
    if (auth.role !== "admin" && auth.role !== "staff") {
      return NextResponse.json(
        { error: "Admin or staff access required" },
        { status: 403 }
      );
    }

    const body = await request.json();
    const {
      buildingCode = null,
      unitNumber,
      fullName,
      email,
      phone = null,
      isPrimaryContact = true,
      status = "PENDING",
      actionUrl,
    } = body || {};

    if (!unitNumber || !fullName || !email) {
      return NextResponse.json(
        { error: "unitNumber, fullName, email are required" },
        { status: 400 }
      );
    }

    // Upsert unit (PostgreSQL ON CONFLICT)
    const unitInsert = await dbQuery(
      `INSERT INTO units (building_code, unit_number)
       VALUES (:buildingCode, :unitNumber)
       ON CONFLICT (unit_number) DO UPDATE SET building_code = EXCLUDED.building_code
       RETURNING id`,
      { buildingCode, unitNumber }
    );

    const unitId = unitInsert.insertId;

    const residentInsert = await dbQuery(
      `INSERT INTO residents (unit_id, full_name, email, phone, status, is_primary_contact)
       VALUES (:unitId, :fullName, :email, :phone, :status, :isPrimaryContact)
       RETURNING id`,
      {
        unitId,
        fullName,
        email,
        phone,
        status,
        isPrimaryContact: isPrimaryContact ? true : false,
      }
    );

    const activationUrl =
      actionUrl ||
      `${process.env.FRONTEND_URL || ""}/activate?email=${encodeURIComponent(email)}`;

    await sendParkingEmail(
      email,
      "Verify Your Resident Account",
      "resident_activation",
      {
        unit_number: unitNumber,
        action_url: activationUrl,
      }
    );

    return NextResponse.json(
      {
        unitId,
        residentId: residentInsert.insertId,
        status: "ok",
      },
      { status: 201 }
    );
  } catch (err) {
    console.error(err);
    return NextResponse.json(
      { error: "Failed to create resident" },
      { status: 500 }
    );
  }
}
