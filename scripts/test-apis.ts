/**
 * Full API test suite for Aura Parking
 * Run: npx tsx scripts/test-apis.ts
 */

const BASE = "http://localhost:3000/api";
const MAILPIT = "http://localhost:8025/api";
const ADMIN_EMAIL = "admin01@example.com";
const STAFF_EMAIL = "staff01@example.com";
const RESIDENT_EMAIL = "01@example.com";
const RESIDENT2_EMAIL = "03@example.com";
const RESIDENT_PHONE = "+16025551001";
const PASSWORD = process.env.SEED_PASSWORD!;
const TWILIO_TEST_CODE = "123456";

let passed = 0;
let failed = 0;
let skipped = 0;
const failures: string[] = [];

// Stored tokens
let adminToken = "";
let staffToken = "";
let residentToken = "";
let resident2Token = "";

// Stored IDs from test flow
let createdGuestStayId = 0;
let createdUnauthorizedVehicleId = 0;
let createdAdminUserId = 0;
let residentId = 0;

// Unique suffix to avoid duplicate key collisions on re-runs
const TS = Date.now();

// ─── Helpers ──────────────────────────────────

function cookieHeader(token: string) {
  return { Cookie: `aura_token=${token}` };
}

function extractSetCookie(res: Response): string {
  const setCookie = res.headers.get("set-cookie") || "";
  const match = setCookie.match(/aura_token=([^;]+)/);
  return match ? match[1] : "";
}

async function test(
  name: string,
  fn: () => Promise<void>
): Promise<void> {
  try {
    await fn();
    passed++;
    console.log(`  ✓ ${name}`);
  } catch (err: any) {
    failed++;
    const msg = `  ✗ ${name} — ${err.message}`;
    failures.push(msg);
    console.log(msg);
  }
}

function skip(name: string, reason: string) {
  skipped++;
  console.log(`  ⊘ ${name} — SKIPPED (${reason})`);
}

function assert(condition: boolean, msg: string) {
  if (!condition) throw new Error(msg);
}

function assertStatus(actual: number, expected: number, context = "") {
  if (actual !== expected)
    throw new Error(`Expected status ${expected}, got ${actual}${context ? ": " + context : ""}`);
}

async function json(res: Response) {
  const text = await res.text();
  try {
    return JSON.parse(text);
  } catch {
    throw new Error(`Non-JSON response: ${text.slice(0, 200)}`);
  }
}

// ─── Test Groups ──────────────────────────────

async function testAuthLogin() {
  console.log("\n── AUTH / LOGIN ────────────────────────────");

  await test("POST /auth/login — admin login", async () => {
    const res = await fetch(`${BASE}/auth/login`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ email: ADMIN_EMAIL, password: PASSWORD }),
      redirect: "manual",
    });
    assertStatus(res.status, 200);
    const data = await json(res);
    assert(data.token, "Missing token");
    assert(data.user?.role === "admin", `Expected admin role, got ${data.user?.role}`);
    adminToken = extractSetCookie(res) || data.token;
  });

  await test("POST /auth/login — staff login", async () => {
    const res = await fetch(`${BASE}/auth/login`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ email: STAFF_EMAIL, password: PASSWORD }),
      redirect: "manual",
    });
    assertStatus(res.status, 200);
    const data = await json(res);
    assert(data.token, "Missing token");
    staffToken = extractSetCookie(res) || data.token;
  });

  await test("POST /auth/login — resident login", async () => {
    const res = await fetch(`${BASE}/auth/login`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ email: RESIDENT_EMAIL, password: PASSWORD }),
      redirect: "manual",
    });
    assertStatus(res.status, 200);
    const data = await json(res);
    assert(data.token, "Missing token");
    assert(data.user?.role === "resident", `Expected resident role, got ${data.user?.role}`);
    residentToken = extractSetCookie(res) || data.token;
    residentId = data.user?.residentId || data.user?.resident_id || 0;
  });

  await test("POST /auth/login — resident2 login", async () => {
    const res = await fetch(`${BASE}/auth/login`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ email: RESIDENT2_EMAIL, password: PASSWORD }),
      redirect: "manual",
    });
    assertStatus(res.status, 200);
    const data = await json(res);
    resident2Token = extractSetCookie(res) || data.token;
  });

  await test("POST /auth/login — wrong password returns 401", async () => {
    const res = await fetch(`${BASE}/auth/login`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ email: ADMIN_EMAIL, password: "wrong" }),
    });
    assertStatus(res.status, 401);
  });

  await test("POST /auth/login — missing fields returns 400", async () => {
    const res = await fetch(`${BASE}/auth/login`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ email: "" }),
    });
    assert(res.status === 400 || res.status === 401, `Expected 400 or 401, got ${res.status}`);
  });
}

async function testAuthMe() {
  console.log("\n── AUTH / ME ───────────────────────────────");

  await test("GET /auth/me — admin with Bearer token", async () => {
    const res = await fetch(`${BASE}/auth/me`, {
      headers: { Authorization: `Bearer ${adminToken}` },
    });
    assertStatus(res.status, 200);
    const data = await json(res);
    assert(data.user?.email === ADMIN_EMAIL, `Unexpected email: ${data.user?.email}`);
  });

  await test("GET /auth/me — resident with Bearer token", async () => {
    const res = await fetch(`${BASE}/auth/me`, {
      headers: { Authorization: `Bearer ${residentToken}` },
    });
    assertStatus(res.status, 200);
    const data = await json(res);
    assert(data.user?.role === "resident", `Expected resident role`);
  });

  await test("GET /auth/me — no token returns 401", async () => {
    const res = await fetch(`${BASE}/auth/me`);
    assertStatus(res.status, 401);
  });

  await test("GET /auth/me — invalid token returns 401", async () => {
    const res = await fetch(`${BASE}/auth/me`, {
      headers: { Authorization: "Bearer invalid.token.here" },
    });
    assertStatus(res.status, 401);
  });
}

async function testAuthLogout() {
  console.log("\n── AUTH / LOGOUT ───────────────────────────");

  await test("POST /auth/logout — clears cookie", async () => {
    const res = await fetch(`${BASE}/auth/logout`, {
      method: "POST",
      headers: { Authorization: `Bearer ${residentToken}` },
      redirect: "manual",
    });
    assertStatus(res.status, 200);
    const setCookie = res.headers.get("set-cookie") || "";
    assert(setCookie.includes("aura_token="), "Should set aura_token cookie");
  });
}

async function testAuthRegistration() {
  console.log("\n── AUTH / REGISTRATION ─────────────────────");

  await test("POST /auth/register-resident — missing fields returns 400", async () => {
    const res = await fetch(`${BASE}/auth/register-resident`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ email: "" }),
    });
    assert(res.status >= 400, `Expected 4xx, got ${res.status}`);
  });

  await test("POST /auth/register-staff — requires admin auth", async () => {
    const res = await fetch(`${BASE}/auth/register-staff`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ fullName: "Test Staff", email: "test-no-auth@example.com", password: process.env.SEED_PASSWORD! }),
    });
    assertStatus(res.status, 401);
  });

  await test("POST /auth/register-staff — with admin token validates input", async () => {
    const res = await fetch(`${BASE}/auth/register-staff`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${adminToken}`,
      },
      body: JSON.stringify({ fullName: "", email: "", password: "" }),
    });
    assert(res.status >= 400, `Expected 4xx, got ${res.status}`);
  });

  await test("POST /auth/register-admin — requires admin auth", async () => {
    const res = await fetch(`${BASE}/auth/register-admin`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ fullName: "Test", email: "x@x.com", password: process.env.SEED_PASSWORD! }),
    });
    assertStatus(res.status, 401);
  });
}

async function testAuthPasswordReset() {
  console.log("\n── AUTH / PASSWORD RESET ───────────────────");

  await test("POST /auth/forgot-password — valid email accepted", async () => {
    const res = await fetch(`${BASE}/auth/forgot-password`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ email: RESIDENT_EMAIL }),
    });
    // Should return 200 regardless (to not leak user existence)
    assertStatus(res.status, 200);
  });

  await test("POST /auth/forgot-password — missing email returns 400", async () => {
    const res = await fetch(`${BASE}/auth/forgot-password`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({}),
    });
    assertStatus(res.status, 400);
  });

  await test("POST /auth/reset-password — invalid token returns 400", async () => {
    const res = await fetch(`${BASE}/auth/reset-password`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ token: "fake-token-abc123", newPassword: "NewPass123!" }),
    });
    assertStatus(res.status, 400);
  });

  await test("POST /auth/forgot-password-phone — sends code (test mode)", async () => {
    const res = await fetch(`${BASE}/auth/forgot-password-phone`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ phone: RESIDENT_PHONE }),
    });
    assertStatus(res.status, 200);
    const data = await json(res);
    assert(data.success === true, "Expected success:true");
  });

  await test("POST /auth/verify-phone-reset — wrong code returns 400", async () => {
    const res = await fetch(`${BASE}/auth/verify-phone-reset`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ phone: RESIDENT_PHONE, code: "000000" }),
    });
    assertStatus(res.status, 400);
  });

  await test("POST /auth/verify-phone-reset — correct code returns token", async () => {
    const res = await fetch(`${BASE}/auth/verify-phone-reset`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ phone: RESIDENT_PHONE, code: TWILIO_TEST_CODE }),
    });
    assertStatus(res.status, 200);
    const data = await json(res);
    assert(data.success === true, "Expected success:true");
    assert(typeof data.token === "string" && data.token.length > 0, "Expected reset token");
  });

  await test("POST /auth/send-verification — new phone (test mode)", async () => {
    const res = await fetch(`${BASE}/auth/send-verification`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ phone: `+1602999${String(TS).slice(-4)}` }),
    });
    assertStatus(res.status, 200);
    const data = await json(res);
    assert(data.success === true, "Expected success:true");
  });

  await test("POST /auth/send-verification — existing phone returns 409", async () => {
    const res = await fetch(`${BASE}/auth/send-verification`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ phone: RESIDENT_PHONE }),
    });
    assertStatus(res.status, 409);
  });
}

async function testResidents() {
  console.log("\n── RESIDENTS ──────────────────────────────");

  await test("GET /residents — admin can list", async () => {
    const res = await fetch(`${BASE}/residents`, {
      headers: { Authorization: `Bearer ${adminToken}` },
    });
    assertStatus(res.status, 200);
    const data = await json(res);
    assert(Array.isArray(data.residents || data), "Expected array of residents");
  });

  await test("GET /residents — no auth returns 401", async () => {
    const res = await fetch(`${BASE}/residents`);
    assertStatus(res.status, 401);
  });

  await test("POST /residents — admin can create", async () => {
    const res = await fetch(`${BASE}/residents`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${adminToken}`,
      },
      body: JSON.stringify({
        unitNumber: "A-103",
        fullName: "Test Resident API",
        email: `apitest${TS}@example.com`,
        phone: `+1${String(TS).slice(-10)}`,
      }),
    });
    assert(res.status === 200 || res.status === 201, `Expected 200/201, got ${res.status}`);
  });
}

async function testResidentSubRoutes() {
  console.log("\n── RESIDENTS / SUB-ROUTES ──────────────────");

  // Find a valid resident ID
  const listRes = await fetch(`${BASE}/residents`, {
    headers: { Authorization: `Bearer ${adminToken}` },
  });
  const listData = await json(listRes);
  const allResidents = listData.residents || listData;
  const testResidentId = allResidents?.[0]?.id;

  if (!testResidentId) {
    skip("GET /residents/[id]/guest-stays", "No residents found");
    skip("GET /residents/[id]/free-pass-months", "No residents found");
    return;
  }

  await test(`GET /residents/${testResidentId}/guest-stays`, async () => {
    const res = await fetch(`${BASE}/residents/${testResidentId}/guest-stays`, {
      headers: { Authorization: `Bearer ${adminToken}` },
    });
    assertStatus(res.status, 200);
    const data = await json(res);
    assert(Array.isArray(data.stays || data.guestStays || data), "Expected array");
  });

  await test(`GET /residents/${testResidentId}/free-pass-months`, async () => {
    const res = await fetch(`${BASE}/residents/${testResidentId}/free-pass-months`, {
      headers: { Authorization: `Bearer ${adminToken}` },
    });
    assertStatus(res.status, 200);
  });
}

async function testGuestStays() {
  console.log("\n── GUEST STAYS ────────────────────────────");

  await test("GET /guest-stays — admin can list all", async () => {
    const res = await fetch(`${BASE}/guest-stays`, {
      headers: { Authorization: `Bearer ${adminToken}` },
    });
    assertStatus(res.status, 200);
    const data = await json(res);
    assert(Array.isArray(data.stays || data.guestStays || data), "Expected array");
  });

  await test("GET /guest-stays — resident sees own", async () => {
    const res = await fetch(`${BASE}/guest-stays`, {
      headers: { Authorization: `Bearer ${residentToken}` },
    });
    assertStatus(res.status, 200);
  });

  await test("GET /guest-stays — no auth returns 401", async () => {
    const res = await fetch(`${BASE}/guest-stays`);
    assertStatus(res.status, 401);
  });

  await test("POST /guest-stays — resident creates stay", async () => {
    const today = new Date();
    const start = new Date(today);
    start.setDate(start.getDate() + 30);
    const end = new Date(start);
    end.setDate(end.getDate() + 2);

    const res = await fetch(`${BASE}/guest-stays`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${residentToken}`,
      },
      body: JSON.stringify({
        residentEmail: RESIDENT_EMAIL,
        guest: {
          fullName: "API Test Guest",
          email: `testguest${TS}@example.com`,
          phone: `+1602553${String(TS).slice(-4)}`,
        },
        vehicle: {
          plate: `AZ-TEST-${TS}`,
          desc: "Blue Honda Accord 2022",
        },
        stay: {
          startDate: start.toISOString().slice(0, 10),
          endDate: end.toISOString().slice(0, 10),
        },
        autoApprove: true,
      }),
    });
    assert(res.status === 200 || res.status === 201, `Expected 200/201, got ${res.status}`);
    const data = await json(res);
    createdGuestStayId = data.guestStay?.id || data.id || data.guestStayId || 0;
    assert(createdGuestStayId > 0, `Missing created stay ID, got: ${JSON.stringify(data).slice(0, 200)}`);
  });

  if (createdGuestStayId) {
    await test(`PATCH /guest-stays/${createdGuestStayId} — edit stay`, async () => {
      const res = await fetch(`${BASE}/guest-stays/${createdGuestStayId}`, {
        method: "PATCH",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${residentToken}`,
        },
        body: JSON.stringify({ vehicleDesc: "Updated — Red Honda Accord 2022" }),
      });
      assertStatus(res.status, 200);
    });

    await test(`POST /guest-stays/${createdGuestStayId}/admin-bypass-payment — admin bypass`, async () => {
      const res = await fetch(`${BASE}/guest-stays/${createdGuestStayId}/admin-bypass-payment`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${adminToken}`,
        },
      });
      assertStatus(res.status, 200);
      const data = await json(res);
      assert(data.status === "APPROVED" || data.alreadyProcessed, "Expected APPROVED or alreadyProcessed");
    });
  }

  // Create a separate PENDING stay for approve + cancel flow
  let pendingStayId = 0;
  await test("POST /guest-stays — create PENDING stay (no autoApprove)", async () => {
    const today = new Date();
    const start = new Date(today);
    start.setDate(start.getDate() + 60);
    const end = new Date(start);
    end.setDate(end.getDate() + 1);

    const res = await fetch(`${BASE}/guest-stays`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${residentToken}`,
      },
      body: JSON.stringify({
        residentEmail: RESIDENT_EMAIL,
        guest: {
          fullName: "Pending Test Guest",
          email: `pending${TS}@example.com`,
        },
        vehicle: {
          plate: `AZ-PEND-${TS}`,
          desc: "Pending test car",
        },
        stay: {
          startDate: start.toISOString().slice(0, 10),
          endDate: end.toISOString().slice(0, 10),
        },
      }),
    });
    assert(res.status === 200 || res.status === 201, `Expected 200/201, got ${res.status}`);
    const data = await json(res);
    pendingStayId = data.id || 0;
    assert(pendingStayId > 0, "Missing pending stay ID");
  });

  if (pendingStayId) {
    await test(`POST /guest-stays/${pendingStayId}/approve — admin approves PENDING stay`, async () => {
      const res = await fetch(`${BASE}/guest-stays/${pendingStayId}/approve`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${adminToken}`,
        },
      });
      assertStatus(res.status, 200);
    });
  }

  // Create another PENDING stay to test cancellation
  let cancelStayId = 0;
  await test("POST /guest-stays — create stay for cancel test", async () => {
    const today = new Date();
    const start = new Date(today);
    start.setDate(start.getDate() + 90);
    const end = new Date(start);
    end.setDate(end.getDate() + 1);

    const res = await fetch(`${BASE}/guest-stays`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${residentToken}`,
      },
      body: JSON.stringify({
        residentEmail: RESIDENT_EMAIL,
        guest: {
          fullName: "Cancel Test Guest",
          email: `cancel${TS}@example.com`,
        },
        vehicle: {
          plate: `AZ-CANC-${TS}`,
          desc: "Cancel test car",
        },
        stay: {
          startDate: start.toISOString().slice(0, 10),
          endDate: end.toISOString().slice(0, 10),
        },
      }),
    });
    assert(res.status === 200 || res.status === 201, `Expected 200/201, got ${res.status}`);
    const data = await json(res);
    cancelStayId = data.id || 0;
    assert(cancelStayId > 0, "Missing cancel stay ID");
  });

  if (cancelStayId) {
    await test(`DELETE /guest-stays/${cancelStayId} — cancel PENDING stay`, async () => {
      const res = await fetch(`${BASE}/guest-stays/${cancelStayId}`, {
        method: "DELETE",
        headers: { Authorization: `Bearer ${adminToken}` },
      });
      assertStatus(res.status, 200);
    });
  }
}

async function testGuestVehicleFreePass() {
  console.log("\n── GUEST VEHICLE FREE PASS ─────────────────");

  await test("GET /guest-vehicle-free-pass/AZ-AP-1987 — existing plate", async () => {
    const res = await fetch(`${BASE}/guest-vehicle-free-pass/AZ-AP-1987`, {
      headers: { Authorization: `Bearer ${adminToken}` },
    });
    assertStatus(res.status, 200);
    const data = await json(res);
    assert(data.plate_number || data.plateNumber || data.freePass !== undefined, "Expected pass data");
  });

  await test("GET /guest-vehicle-free-pass/NONEXIST-000 — not found", async () => {
    const res = await fetch(`${BASE}/guest-vehicle-free-pass/NONEXIST-000`, {
      headers: { Authorization: `Bearer ${adminToken}` },
    });
    // Could be 404 or 200 with null
    assert(res.status === 200 || res.status === 404, `Expected 200 or 404, got ${res.status}`);
  });
}

async function testUnauthorizedVehicles() {
  console.log("\n── UNAUTHORIZED VEHICLES ───────────────────");

  await test("GET /unauthorized-vehicles — admin can list", async () => {
    const res = await fetch(`${BASE}/unauthorized-vehicles`, {
      headers: { Authorization: `Bearer ${adminToken}` },
    });
    assertStatus(res.status, 200);
    const data = await json(res);
    assert(Array.isArray(data.vehicles || data), "Expected array");
  });

  await test("POST /unauthorized-vehicles — admin creates report", async () => {
    const res = await fetch(`${BASE}/unauthorized-vehicles`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${adminToken}`,
      },
      body: JSON.stringify({
        plate_number: "AZ-TEST-UV1",
        vehicle_make: "Honda",
        vehicle_color: "Silver",
        violation_note: "API test — no permit displayed",
        spotted_date: new Date().toISOString().slice(0, 10),
        spotted_location: "Building A — Lot A, Spot 1",
        recommended_action: "warn",
      }),
    });
    assert(res.status === 200 || res.status === 201, `Expected 200/201, got ${res.status}`);
    const data = await json(res);
    createdUnauthorizedVehicleId = data.id || data.vehicle?.id || 0;
    assert(createdUnauthorizedVehicleId > 0, `Missing created UV ID`);
  });

  if (createdUnauthorizedVehicleId) {
    await test(`PATCH /unauthorized-vehicles/${createdUnauthorizedVehicleId}/resolve`, async () => {
      const res = await fetch(
        `${BASE}/unauthorized-vehicles/${createdUnauthorizedVehicleId}/resolve`,
        {
          method: "PATCH",
          headers: { Authorization: `Bearer ${adminToken}` },
        }
      );
      assertStatus(res.status, 200);
    });

    await test(`DELETE /unauthorized-vehicles/${createdUnauthorizedVehicleId}`, async () => {
      const res = await fetch(
        `${BASE}/unauthorized-vehicles/${createdUnauthorizedVehicleId}`,
        {
          method: "DELETE",
          headers: { Authorization: `Bearer ${adminToken}` },
        }
      );
      assertStatus(res.status, 200);
    });
  }

  await test("GET /unauthorized-vehicles — no auth returns 401", async () => {
    const res = await fetch(`${BASE}/unauthorized-vehicles`);
    assertStatus(res.status, 401);
  });
}

async function testAdminUsers() {
  console.log("\n── ADMIN / USERS ──────────────────────────");

  await test("GET /admin/users — admin can list", async () => {
    const res = await fetch(`${BASE}/admin/users`, {
      headers: { Authorization: `Bearer ${adminToken}` },
    });
    assertStatus(res.status, 200);
    const data = await json(res);
    assert(Array.isArray(data.users || data), "Expected array");
  });

  await test("GET /admin/users — resident returns 403 or 401", async () => {
    const res = await fetch(`${BASE}/admin/users`, {
      headers: { Authorization: `Bearer ${residentToken}` },
    });
    assert(res.status === 401 || res.status === 403, `Expected 401/403, got ${res.status}`);
  });

  await test("POST /admin/users — admin creates user", async () => {
    const res = await fetch(`${BASE}/admin/users`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${adminToken}`,
      },
      body: JSON.stringify({
        email: `admincreated${TS}@example.com`,
        password: process.env.SEED_PASSWORD!,
        fullName: "Admin Created User",
        role: "staff",
      }),
    });
    assert(res.status === 200 || res.status === 201, `Expected 200/201, got ${res.status}`);
    const data = await json(res);
    createdAdminUserId = data.user?.id || data.id || 0;
  });

  if (createdAdminUserId) {
    await test(`PATCH /admin/users/${createdAdminUserId} — update user`, async () => {
      const res = await fetch(`${BASE}/admin/users/${createdAdminUserId}`, {
        method: "PATCH",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${adminToken}`,
        },
        body: JSON.stringify({ role: "staff", status: "ACTIVE" }),
      });
      assertStatus(res.status, 200);
    });

    await test(`POST /admin/users/${createdAdminUserId}/activate`, async () => {
      const res = await fetch(`${BASE}/admin/users/${createdAdminUserId}/activate`, {
        method: "POST",
        headers: { Authorization: `Bearer ${adminToken}` },
      });
      assertStatus(res.status, 200);
    });

    await test(`DELETE /admin/users/${createdAdminUserId}`, async () => {
      const res = await fetch(`${BASE}/admin/users/${createdAdminUserId}`, {
        method: "DELETE",
        headers: { Authorization: `Bearer ${adminToken}` },
      });
      assertStatus(res.status, 200);
    });
  }
}

async function testVerifyResident() {
  console.log("\n── VERIFY RESIDENT ────────────────────────");

  await test("POST /verify-resident — valid email", async () => {
    const res = await fetch(`${BASE}/verify-resident`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ residentInfo: RESIDENT_EMAIL }),
    });
    assertStatus(res.status, 200);
    const data = await json(res);
    assert(data.exists || data.residentEmail, "Expected verification result");
  });

  await test("POST /verify-resident — valid unit number", async () => {
    const res = await fetch(`${BASE}/verify-resident`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ residentInfo: "A-101" }),
    });
    assertStatus(res.status, 200);
    const data = await json(res);
    assert(data.exists || data.residentEmail, "Expected verification result");
  });

  await test("POST /verify-resident — non-existent email", async () => {
    const res = await fetch(`${BASE}/verify-resident`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ residentInfo: "nobody@nowhere.com" }),
    });
    assertStatus(res.status, 404);
  });
}

async function testCheckoutSession() {
  console.log("\n── CHECKOUT SESSION ────────────────────────");

  skip("POST /checkout-session", "Requires real Stripe session — tested via UI");
  skip("GET /checkout-session/[id]", "Requires real Stripe session ID");

  await test("POST /checkout-session — missing data returns 400", async () => {
    const res = await fetch(`${BASE}/checkout-session`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${residentToken}`,
      },
      body: JSON.stringify({}),
    });
    assert(res.status >= 400, `Expected 4xx, got ${res.status}`);
  });

  await test("GET /checkout-session/cs_fake_123 — invalid session", async () => {
    const res = await fetch(`${BASE}/checkout-session/cs_fake_123`, {
      headers: { Authorization: `Bearer ${residentToken}` },
    });
    assert(res.status >= 400 || res.status === 500, `Expected 4xx/5xx, got ${res.status}`);
  });
}

async function testConfirmPayment() {
  console.log("\n── CONFIRM PAYMENT ────────────────────────");

  await test("POST /guest-stays/confirm-payment — missing session_id returns 400", async () => {
    const res = await fetch(`${BASE}/guest-stays/confirm-payment`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${residentToken}`,
      },
      body: JSON.stringify({}),
    });
    assert(res.status >= 400, `Expected 4xx, got ${res.status}`);
  });
}

async function testTowWarnings() {
  console.log("\n── TOW WARNINGS ───────────────────────────");

  await test("GET /tow-warnings — admin can list", async () => {
    const res = await fetch(`${BASE}/tow-warnings`, {
      headers: { Authorization: `Bearer ${adminToken}` },
    });
    assertStatus(res.status, 200);
    const data = await json(res);
    assert(Array.isArray(data.warnings || data), "Expected array");
  });

  await test("GET /tow-warnings — no auth returns 401", async () => {
    const res = await fetch(`${BASE}/tow-warnings`);
    assertStatus(res.status, 401);
  });
}

async function testSendSupportEmail() {
  console.log("\n── SUPPORT EMAIL ──────────────────────────");

  await test("POST /send-support-email — missing fields returns 400", async () => {
    const res = await fetch(`${BASE}/send-support-email`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({}),
    });
    assertStatus(res.status, 400);
  });

  await test("POST /send-support-email — sends to Mailpit", async () => {
    const res = await fetch(`${BASE}/send-support-email`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        userEmail: "testuser@example.com",
        role: "resident",
        subject: `Support Test ${TS}`,
        message: "This is a test support message sent during API testing.",
      }),
    });
    assertStatus(res.status, 200);
  });
}

async function testCronMonthlyReset() {
  console.log("\n── CRON / MONTHLY RESET ────────────────────");

  await test("POST /cron/monthly-reset — admin can trigger", async () => {
    const res = await fetch(`${BASE}/cron/monthly-reset`, {
      method: "POST",
      headers: { Authorization: `Bearer ${adminToken}` },
    });
    assertStatus(res.status, 200);
  });

  await test("POST /cron/monthly-reset — no auth returns 401", async () => {
    const res = await fetch(`${BASE}/cron/monthly-reset`, {
      method: "POST",
    });
    assertStatus(res.status, 401);
  });
}

async function testMailpitEmails() {
  console.log("\n── MAILPIT EMAIL VERIFICATION ──────────────");

  let mailpitAvailable = false;
  try {
    const ping = await fetch(`${MAILPIT}/v1/messages?limit=1`);
    mailpitAvailable = ping.ok;
  } catch { /* ignore */ }

  if (!mailpitAvailable) {
    skip("Mailpit verification", "Mailpit not running at localhost:8025");
    return;
  }

  await test("Mailpit received emails from test run", async () => {
    const res = await fetch(`${MAILPIT}/v1/messages?limit=50`);
    assertStatus(res.status, 200);
    const data = await json(res);
    const total = data.messages_count || data.total || data.messages?.length || 0;
    console.log(`    → ${total} emails captured in Mailpit`);
    assert(total > 0, "Expected at least 1 email in Mailpit");
  });

  await test("Mailpit has password reset email", async () => {
    const res = await fetch(`${MAILPIT}/v1/search?query=subject:"Password Reset"&limit=5`);
    assertStatus(res.status, 200);
    const data = await json(res);
    const count = data.messages_count || data.messages?.length || 0;
    console.log(`    → ${count} password reset emails`);
    assert(count > 0, "Expected at least 1 password reset email");
  });

  await test("Mailpit has monthly reset notification emails", async () => {
    const res = await fetch(`${MAILPIT}/v1/search?query=subject:"Monthly Guest Passes"&limit=5`);
    assertStatus(res.status, 200);
    const data = await json(res);
    const count = data.messages_count || data.messages?.length || 0;
    console.log(`    → ${count} monthly reset emails`);
    assert(count > 0, "Expected at least 1 monthly reset email");
  });

  await test("Mailpit has support email", async () => {
    const res = await fetch(`${MAILPIT}/v1/search?query=subject:"Support Test ${TS}"&limit=5`);
    assertStatus(res.status, 200);
    const data = await json(res);
    const count = data.messages_count || data.messages?.length || 0;
    console.log(`    → ${count} support emails`);
    assert(count > 0, "Expected at least 1 support email");
  });

  await test("Mailpit has guest stay notification emails", async () => {
    const res = await fetch(`${MAILPIT}/v1/search?query=subject:"Parking"&limit=20`);
    assertStatus(res.status, 200);
    const data = await json(res);
    const count = data.messages_count || data.messages?.length || 0;
    console.log(`    → ${count} parking-related emails`);
    assert(count > 0, "Expected at least 1 parking email");
  });
}

async function testApiRoot() {
  console.log("\n── API ROOT ───────────────────────────────");

  await test("GET /api — health check", async () => {
    const res = await fetch(BASE);
    assertStatus(res.status, 200);
    const data = await json(res);
    assert(data.ok === true, "Expected ok:true");
  });
}

// ─── Run All ──────────────────────────────────

async function warmupRoutes() {
  console.log("\n── WARMUP (pre-compile routes) ─────────────────");
  const warmupUrls = [
    `${BASE}`,
    `${BASE}/auth/me`,
    `${BASE}/residents`,
    `${BASE}/guest-stays`,
    `${BASE}/unauthorized-vehicles`,
    `${BASE}/admin/users`,
    `${BASE}/tow-warnings`,
    `${BASE}/guest-vehicle-free-pass/WARMUP`,
    `${BASE}/cron/monthly-reset`,
  ];
  for (const url of warmupUrls) {
    try { await fetch(url); } catch { /* ignore */ }
  }
  // Wait for compilation
  await new Promise((r) => setTimeout(r, 2000));
  console.log("  Done.\n");
}

async function runAll() {
  console.log("╔══════════════════════════════════════════════╗");
  console.log("║       AURA PARKING — FULL API TEST SUITE     ║");
  console.log("╚══════════════════════════════════════════════╝");

  await warmupRoutes();
  await testApiRoot();
  await testAuthLogin();
  await testAuthMe();
  await testAuthLogout();
  await testAuthRegistration();
  await testAuthPasswordReset();
  await testResidents();
  await testResidentSubRoutes();
  await testGuestStays();
  await testGuestVehicleFreePass();
  await testUnauthorizedVehicles();
  await testAdminUsers();
  await testVerifyResident();
  await testCheckoutSession();
  await testConfirmPayment();
  await testTowWarnings();
  await testSendSupportEmail();
  await testCronMonthlyReset();
  await testMailpitEmails();

  console.log("\n══════════════════════════════════════════════");
  console.log(`  PASSED: ${passed}   FAILED: ${failed}   SKIPPED: ${skipped}`);
  console.log("══════════════════════════════════════════════");

  if (failures.length > 0) {
    console.log("\n── FAILURES ───────────────────────────────");
    for (const f of failures) console.log(f);
  }

  process.exitCode = failed > 0 ? 1 : 0;
}

runAll().catch((err) => {
  console.error("Test runner crashed:", err);
  process.exitCode = 1;
});
