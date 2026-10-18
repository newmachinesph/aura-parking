import { NextResponse } from "next/server";

/* ------------------------------------------------------------------ */
/*  GET /api  –  Health check                                         */
/* ------------------------------------------------------------------ */
export async function GET() {
  return NextResponse.json({ ok: true, message: "Aura Parking API" });
}
