import { NextRequest, NextResponse } from "next/server";
import { dbQuery } from "@/lib/db";

/**
 * POST /api/verify-resident
 * Checks whether a resident exists by email or unit_number.
 * Returns resident display info on success, or 404 if not found.
 */
export async function POST(request: NextRequest) {
  try {
    const body = await request.json();
    const { residentInfo, residentName } = body || {};
    const raw = String(residentInfo || "").trim();
    if (!raw) {
      return NextResponse.json(
        { error: "Resident email or unit number is required" },
        { status: 400 }
      );
    }

    const isEmail = raw.includes("@");

    const normalizeUnitNumber = (value: string): string => {
      if (!value) return "";
      return String(value)
        .trim()
        .replace(/^\s*Unit\s+/i, "")
        .replace(/^\s*UNIT\s*-\s*/i, "")
        .replace(/^\s*Unit\s*-\s*/i, "")
        .trim();
    };

    const unitNumber = !isEmail ? normalizeUnitNumber(raw) : null;
    const nameFilter =
      !isEmail && residentName ? String(residentName).trim() : null;

    let query: string;
    let params: Record<string, unknown>;

    if (isEmail) {
      query = `SELECT r.id AS resident_id, r.full_name, r.email, u.unit_number
               FROM residents r
               INNER JOIN units u ON u.id = r.unit_id
               WHERE r.status = 'ACTIVE' AND r.email = :email
               ORDER BY r.is_primary_contact DESC, r.id ASC
               LIMIT 1`;
      params = { email: raw.toLowerCase() };
    } else if (nameFilter) {
      query = `SELECT r.id AS resident_id, r.full_name, r.email, u.unit_number
               FROM residents r
               INNER JOIN units u ON u.id = r.unit_id
               WHERE r.status = 'ACTIVE'
                 AND u.unit_number = :unitNumber
                 AND LOWER(r.full_name) LIKE :namePattern
               ORDER BY r.is_primary_contact DESC, r.id ASC
               LIMIT 1`;
      params = {
        unitNumber,
        namePattern: `%${nameFilter.toLowerCase()}%`,
      };
    } else {
      query = `SELECT r.id AS resident_id, r.full_name, r.email, u.unit_number
               FROM residents r
               INNER JOIN units u ON u.id = r.unit_id
               WHERE r.status = 'ACTIVE' AND u.unit_number = :unitNumber
               ORDER BY r.is_primary_contact DESC, r.id ASC
               LIMIT 1`;
      params = { unitNumber };
    }

    const rows = await dbQuery(query, params);

    if (!rows?.length) {
      return NextResponse.json(
        {
          error: isEmail
            ? "No active resident found with this email"
            : nameFilter
              ? "No active resident found matching this unit number and name"
              : "No active resident found for this unit number",
        },
        { status: 404 }
      );
    }

    const resident = rows[0];
    return NextResponse.json({
      exists: true,
      residentName: resident.full_name,
      unitNumber: resident.unit_number,
    });
  } catch (err) {
    console.error(err);
    return NextResponse.json(
      { error: "Failed to verify resident" },
      { status: 500 }
    );
  }
}
