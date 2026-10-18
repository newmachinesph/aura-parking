import { NextRequest, NextResponse } from "next/server";
import { dbQuery } from "@/lib/db";
import { authRequired } from "@/lib/auth";
import { parsePaginationParams, paginatedResult } from "@/lib/pagination";

export async function GET(request: NextRequest) {
  const auth = authRequired(request);
  if (auth instanceof NextResponse) return auth;
  if (auth.role !== "admin") {
    return NextResponse.json({ error: "Admin access required" }, { status: 403 });
  }

  try {
    const sp = request.nextUrl.searchParams;
    const { cursor, limit } = parsePaginationParams(sp);
    const fetchLimit = limit + 1;
    const cursorClause = cursor ? "AND u.id < :cursor" : "";

    const rows = await dbQuery(
      `SELECT u.id, u.unit_number, u.building_code, u.created_at,
              COUNT(r.id) FILTER (WHERE r.status = 'ACTIVE') AS active_residents,
              COUNT(r.id) AS total_residents
       FROM units u
       LEFT JOIN residents r ON r.unit_id = u.id
       WHERE 1=1 ${cursorClause}
       GROUP BY u.id
       ORDER BY u.id DESC
       LIMIT :fetchLimit`,
      { ...(cursor ? { cursor } : {}), fetchLimit }
    );

    const { items, hasMore, nextCursor } = paginatedResult(
      rows as (typeof rows[0] & { id: number })[],
      limit
    );

    return NextResponse.json({ units: items, hasMore, nextCursor });
  } catch (err) {
    console.error(err);
    return NextResponse.json({ error: "Failed to list units" }, { status: 500 });
  }
}

export async function POST(request: NextRequest) {
  const auth = authRequired(request);
  if (auth instanceof NextResponse) return auth;
  if (auth.role !== "admin") {
    return NextResponse.json({ error: "Admin access required" }, { status: 403 });
  }

  try {
    const body = await request.json();
    const { unitNumber, buildingCode } = body || {};
    if (!unitNumber || !String(unitNumber).trim()) {
      return NextResponse.json({ error: "Unit number is required" }, { status: 400 });
    }

    const trimmed = String(unitNumber).trim();
    const building = buildingCode ? String(buildingCode).trim() : null;

    const existing = await dbQuery(
      `SELECT id FROM units WHERE unit_number = :unitNumber LIMIT 1`,
      { unitNumber: trimmed }
    );
    if (existing.length > 0) {
      return NextResponse.json({ error: "Unit number already exists" }, { status: 409 });
    }

    const rows = await dbQuery(
      `INSERT INTO units (unit_number, building_code) VALUES (:unitNumber, :buildingCode) RETURNING id`,
      { unitNumber: trimmed, buildingCode: building }
    );

    return NextResponse.json({ id: rows[0].id, status: "ok" }, { status: 201 });
  } catch (err) {
    console.error(err);
    return NextResponse.json({ error: "Failed to create unit" }, { status: 500 });
  }
}
