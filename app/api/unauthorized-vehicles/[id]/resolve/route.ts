import { NextRequest, NextResponse } from "next/server";
import { dbQuery } from "@/lib/db";
import { authRequired } from "@/lib/auth";

/* ------------------------------------------------------------------ */
/*  PATCH /api/unauthorized-vehicles/:id/resolve  –  Mark resolved    */
/* ------------------------------------------------------------------ */
export async function PATCH(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  const auth = authRequired(request);
  if (auth instanceof NextResponse) return auth;
  if (auth.role !== "admin" && auth.role !== "staff") {
    return NextResponse.json({ error: "Admin or staff access required" }, { status: 403 });
  }

  try {
    const { id: idParam } = await params;
    const id = Number(idParam);
    if (!id) {
      return NextResponse.json({ error: "Invalid id" }, { status: 400 });
    }

    await dbQuery(
      `UPDATE unauthorized_vehicles SET resolved = TRUE WHERE id = :id`,
      { id },
    );

    return NextResponse.json({ id, status: "resolved" });
  } catch (err) {
    console.error(err);
    return NextResponse.json(
      { error: "Failed to resolve unauthorized vehicle" },
      { status: 500 },
    );
  }
}
