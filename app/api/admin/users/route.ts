import { NextRequest, NextResponse } from "next/server";
import bcrypt from "bcryptjs";
import { dbQuery } from "@/lib/db";
import { authRequired, normalizeEmail } from "@/lib/auth";
import { monthStartISO } from "@/lib/helpers";
import { parsePaginationParams, paginatedResult } from "@/lib/pagination";
import { validatePassword } from "@/lib/validation";

/* ------------------------------------------------------------------ */
/*  GET /api/admin/users  –  List admin & staff users                 */
/* ------------------------------------------------------------------ */
export async function GET(request: NextRequest) {
  const auth = authRequired(request);
  if (auth instanceof NextResponse) return auth;
  if (auth.role !== "admin") {
    return NextResponse.json(
      { error: "Admin access required" },
      { status: 403 },
    );
  }

  try {
    const sp = request.nextUrl.searchParams;
    const { cursor, limit } = parsePaginationParams(sp);
    const fetchLimit = limit + 1;
    const cursorClause = cursor ? "AND au.id < :cursor" : "";

    const rows = await dbQuery(
      `SELECT au.id, au.email, au.role, au.status, au.created_at,
              COALESCE(m.full_name, r.full_name) AS full_name,
              m.role AS staff_role,
              u.unit_number
       FROM auth_users au
       LEFT JOIN staff m ON m.auth_user_id = au.id
       LEFT JOIN residents r ON r.id = au.resident_id
       LEFT JOIN units u ON u.id = r.unit_id
       WHERE (au.role IN ('admin', 'staff') OR (au.role = 'resident' AND au.status = 'INACTIVE'))
       ${cursorClause}
       ORDER BY au.id DESC
       LIMIT :fetchLimit`,
      { ...(cursor ? { cursor } : {}), fetchLimit },
    );

    const { items, hasMore, nextCursor } = paginatedResult(rows as (typeof rows[0] & { id: number })[], limit);
    return NextResponse.json({ users: items, hasMore, nextCursor });
  } catch (err) {
    console.error(err);
    return NextResponse.json(
      { error: "Failed to list users" },
      { status: 500 },
    );
  }
}

/* ------------------------------------------------------------------ */
/*  POST /api/admin/users  –  Create user (admin / staff / resident)  */
/* ------------------------------------------------------------------ */
export async function POST(request: NextRequest) {
  const auth = authRequired(request);
  if (auth instanceof NextResponse) return auth;
  if (auth.role !== "admin") {
    return NextResponse.json(
      { error: "Admin access required" },
      { status: 403 },
    );
  }

  try {
    const body = await request.json();
    const {
      email,
      password,
      role,
      status = "ACTIVE",
      fullName,
      unitNumber,
    } = body || {};

    if (!email || !password || !role) {
      return NextResponse.json(
        { error: "email, password, and role are required" },
        { status: 400 },
      );
    }

    const validRoles = ["admin", "staff", "resident"];
    if (!validRoles.includes(role)) {
      return NextResponse.json(
        { error: `role must be one of: ${validRoles.join(", ")}` },
        { status: 400 },
      );
    }

    // Password strength check
    const pwCheck = validatePassword(password);
    if (!pwCheck.ok) {
      return NextResponse.json({ error: pwCheck.error }, { status: 400 });
    }

    const normalizedEmail = normalizeEmail(email);

    // Check for duplicate email
    const existing = await dbQuery(
      `SELECT id FROM auth_users WHERE email = :email LIMIT 1`,
      { email: normalizedEmail },
    );
    if (existing.length > 0) {
      return NextResponse.json(
        { error: "Email is already registered" },
        { status: 409 },
      );
    }

    const passwordHash = await bcrypt.hash(String(password), 10);

    /* ---- Resident flow ---- */
    if (role === "resident") {
      if (!fullName || !unitNumber) {
        return NextResponse.json(
          { error: "fullName and unitNumber are required for residents" },
          { status: 400 },
        );
      }

      const cleanUnit = String(unitNumber).trim();
      const cleanName = String(fullName).trim();

      // Get or create unit
      let unitId: number;
      const unitRows = await dbQuery(
        `SELECT id FROM units WHERE unit_number = :unitNumber LIMIT 1`,
        { unitNumber: cleanUnit },
      );
      if (unitRows.length === 0) {
        const unitInsert = await dbQuery(
          `INSERT INTO units (unit_number) VALUES (:unitNumber) RETURNING id`,
          { unitNumber: cleanUnit },
        );
        unitId = unitInsert[0]?.id ?? unitInsert.insertId;
      } else {
        unitId = unitRows[0].id;
      }

      // Check duplicate resident email
      const existingResident = await dbQuery(
        `SELECT id FROM residents WHERE email = :email LIMIT 1`,
        { email: normalizedEmail },
      );
      if (existingResident.length > 0) {
        return NextResponse.json(
          { error: "A resident with this email already exists" },
          { status: 409 },
        );
      }

      // Insert resident
      const residentInsert = await dbQuery(
        `INSERT INTO residents (unit_id, full_name, email, status, is_primary_contact)
         VALUES (:unitId, :fullName, :email, :status, TRUE) RETURNING id`,
        {
          unitId,
          fullName: cleanName,
          email: normalizedEmail,
          status: status || "ACTIVE",
        },
      );
      const residentId = residentInsert[0]?.id ?? residentInsert.insertId;

      // Ensure free pass bucket exists
      await dbQuery(
        `INSERT INTO resident_free_pass_months (resident_id, month_start, free_nights_total, free_nights_used)
         VALUES (:residentId, :monthStart, 1, 0)
         ON CONFLICT (resident_id, month_start) DO UPDATE SET resident_id = EXCLUDED.resident_id`,
        { residentId, monthStart: monthStartISO(new Date()) },
      );

      // Insert auth user linked to resident
      await dbQuery(
        `INSERT INTO auth_users (resident_id, email, password_hash, role, status)
         VALUES (:residentId, :email, :passwordHash, 'resident', :status) RETURNING id`,
        {
          residentId,
          email: normalizedEmail,
          passwordHash,
          status: status || "ACTIVE",
        },
      );

      return NextResponse.json({ status: "ok", role: "resident" }, { status: 201 });
    }

    /* ---- Admin or Staff flow ---- */
    const cleanName = String(fullName || "").trim();

    const authInsert = await dbQuery(
      `INSERT INTO auth_users (resident_id, email, password_hash, role, status)
       VALUES (NULL, :email, :passwordHash, :role, :status) RETURNING id`,
      {
        email: normalizedEmail,
        passwordHash,
        role,
        status: status || "ACTIVE",
      },
    );
    const authUserId = authInsert[0]?.id ?? authInsert.insertId;

    if (cleanName) {
      await dbQuery(
        `INSERT INTO staff (auth_user_id, full_name, email, role)
         VALUES (:authUserId, :fullName, :email, :role) RETURNING id`,
        {
          authUserId,
          fullName: cleanName,
          email: normalizedEmail,
          role,
        },
      );
    }

    return NextResponse.json({ status: "ok", role }, { status: 201 });
  } catch (err: unknown) {
    console.error(err);
    return NextResponse.json(
      { error: "Failed to add user" },
      { status: 500 },
    );
  }
}
