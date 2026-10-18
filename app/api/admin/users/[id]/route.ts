import { NextRequest, NextResponse } from "next/server";
import bcrypt from "bcryptjs";
import { dbQuery } from "@/lib/db";
import { authRequired } from "@/lib/auth";
import { validatePassword } from "@/lib/validation";

/* ------------------------------------------------------------------ */
/*  PATCH /api/admin/users/:id  –  Update admin/staff user            */
/* ------------------------------------------------------------------ */
export async function PATCH(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  const auth = authRequired(request);
  if (auth instanceof NextResponse) return auth;
  if (auth.role !== "admin") {
    return NextResponse.json(
      { error: "Admin access required" },
      { status: 403 },
    );
  }

  try {
    const { id: idParam } = await params;
    const id = Number(idParam);
    if (!id) {
      return NextResponse.json({ error: "Invalid user id" }, { status: 400 });
    }

    const rows = await dbQuery(
      `SELECT id, role, email FROM auth_users WHERE id = :id LIMIT 1`,
      { id },
    );
    if (!rows?.length) {
      return NextResponse.json({ error: "User not found" }, { status: 404 });
    }

    const user = rows[0];
    if (user.role !== "admin" && user.role !== "staff") {
      return NextResponse.json(
        { error: "Only admin and staff accounts can be updated here" },
        { status: 400 },
      );
    }

    const body = await request.json();
    const { email, role, status, password } = body || {};

    if (role && !["admin", "staff"].includes(role)) {
      return NextResponse.json(
        { error: "Role must be admin or staff" },
        { status: 400 },
      );
    }

    // Check email uniqueness if changing email
    if (email && email.trim().toLowerCase() !== user.email) {
      const dup = await dbQuery(
        `SELECT id FROM auth_users WHERE email = :email AND id != :id LIMIT 1`,
        { email: email.trim().toLowerCase(), id },
      );
      if (dup.length > 0) {
        return NextResponse.json(
          { error: "Email is already in use by another account" },
          { status: 409 },
        );
      }
    }

    // Build dynamic SET clause
    const updates: string[] = [];
    const queryParams: Record<string, unknown> = { id };

    if (email) {
      updates.push("email = :email");
      queryParams.email = String(email).trim().toLowerCase();
    }
    if (role) {
      updates.push("role = :role");
      queryParams.role = role;
    }
    if (status) {
      updates.push("status = :status");
      queryParams.status = status;
    }
    if (password) {
      const pwCheck = validatePassword(password);
      if (!pwCheck.ok) {
        return NextResponse.json({ error: pwCheck.error }, { status: 400 });
      }
      updates.push("password_hash = :passwordHash");
      queryParams.passwordHash = await bcrypt.hash(String(password), 10);
    }

    if (updates.length === 0) {
      return NextResponse.json(
        { error: "No fields to update" },
        { status: 400 },
      );
    }

    await dbQuery(
      `UPDATE auth_users SET ${updates.join(", ")}, updated_at = NOW() WHERE id = :id`,
      queryParams,
    );

    return NextResponse.json({ id, status: "ok" });
  } catch (err: unknown) {
    console.error(err);
    return NextResponse.json(
      { error: "Failed to update user" },
      { status: 500 },
    );
  }
}

/* ------------------------------------------------------------------ */
/*  DELETE /api/admin/users/:id  –  Delete admin/staff user           */
/* ------------------------------------------------------------------ */
export async function DELETE(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  const auth = authRequired(request);
  if (auth instanceof NextResponse) return auth;
  if (auth.role !== "admin") {
    return NextResponse.json(
      { error: "Admin access required" },
      { status: 403 },
    );
  }

  try {
    const { id: idParam } = await params;
    const id = Number(idParam);
    if (!id) {
      return NextResponse.json({ error: "Invalid user id" }, { status: 400 });
    }

    const rows = await dbQuery(
      `SELECT id, role, email FROM auth_users WHERE id = :id LIMIT 1`,
      { id },
    );
    if (!rows?.length) {
      return NextResponse.json({ error: "User not found" }, { status: 404 });
    }

    const user = rows[0];
    if (user.role !== "admin" && user.role !== "staff") {
      return NextResponse.json(
        { error: "Only admin and staff accounts can be deleted here" },
        { status: 400 },
      );
    }

    // Prevent self-deletion
    if (String(user.id) === String(auth.sub)) {
      return NextResponse.json(
        { error: "You cannot delete your own account" },
        { status: 400 },
      );
    }

    await dbQuery(`DELETE FROM auth_users WHERE id = :id`, { id });

    return NextResponse.json({ id, status: "deleted" });
  } catch (err: unknown) {
    console.error(err);
    return NextResponse.json(
      { error: "Failed to delete user" },
      { status: 500 },
    );
  }
}
