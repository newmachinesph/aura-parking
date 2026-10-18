import { test, expect, type Page } from "@playwright/test";
import { ACCOUNTS } from "./helpers";

/**
 * API Security & Access Control E2E Tests
 *
 * Tests:
 *   - Unauthenticated API access → 401
 *   - IDOR protection: residents can't access other units' data
 *   - Role enforcement: resident vs admin vs staff
 *   - Payment-info token vs auth access
 *   - Status-based restrictions (inactive users)
 *   - Can't approve/cancel other unit's stays
 */

test.setTimeout(120_000);

/* ── Helpers ── */

const RUN_ID = Date.now().toString(36).slice(-6);

function futureDate(daysFromNow: number): string {
  const d = new Date();
  d.setDate(d.getDate() + daysFromNow);
  return d.toISOString().slice(0, 10);
}

async function apiLogin(page: Page, email: string, password: string) {
  const res = await page.request.post("/api/auth/login", {
    data: { email, password },
  });
  return { status: res.status(), data: await res.json() };
}

async function apiLoginAdmin(page: Page) {
  const { status } = await apiLogin(page, ACCOUNTS.admin.email, ACCOUNTS.admin.password);
  expect(status).toBe(200);
}

/* ── Test data ── */
const RES1_EMAIL = `e2e-sec1-${RUN_ID}@test.com`;
const RES2_EMAIL = `e2e-sec2-${RUN_ID}@test.com`;
const TEST_PASSWORD = process.env.SEED_PASSWORD!;
const UNIT_1 = `S1${RUN_ID.slice(0, 3).toUpperCase()}`;
const UNIT_2 = `S2${RUN_ID.slice(0, 3).toUpperCase()}`;

/* ── Shared state ── */
let res1StayId: number;
let res1ResidentId: number;

test.describe.serial("API: Security & Access Control", () => {
  // ═══════════════════════════════════════════
  // S0 — Setup: create test residents and stay
  // ═══════════════════════════════════════════
  test("S0: Setup — create test residents and a guest stay", async ({ page }) => {
    await apiLoginAdmin(page);

    // Create resident 1
    const r1 = await page.request.post("/api/admin/users", {
      data: {
        email: RES1_EMAIL,
        password: TEST_PASSWORD,
        role: "resident",
        fullName: `SecRes1 ${RUN_ID}`,
        unitNumber: UNIT_1,
        status: "ACTIVE",
      },
    });
    expect(r1.status()).toBe(201);

    // Create resident 2
    const r2 = await page.request.post("/api/admin/users", {
      data: {
        email: RES2_EMAIL,
        password: TEST_PASSWORD,
        role: "resident",
        fullName: `SecRes2 ${RUN_ID}`,
        unitNumber: UNIT_2,
        status: "ACTIVE",
      },
    });
    expect(r2.status()).toBe(201);

    // Create a stay for resident 1 (public endpoint, creates as PENDING)
    const stayRes = await page.request.post("/api/guest-stays", {
      data: {
        residentEmail: RES1_EMAIL,
        guest: { fullName: `SecGuest ${RUN_ID}`, email: `secg-${RUN_ID}@test.com` },
        vehicle: { plate: `SEC${RUN_ID}`, desc: "Test Vehicle" },
        stay: { startDate: futureDate(1), endDate: futureDate(3) },
      },
    });
    expect(stayRes.ok()).toBeTruthy();
    const stayData = await stayRes.json();
    res1StayId = Number(stayData.id);

    // Approve it so it becomes NEEDS_PAYMENT or APPROVED
    const approveRes = await page.request.post(`/api/guest-stays/${res1StayId}/approve`);
    expect(approveRes.ok()).toBeTruthy();
    const approveData = await approveRes.json();
    res1ResidentId = Number(approveData.billing.residentId);

    console.log(`  ✓ S0: Setup complete — Res1 (${UNIT_1}), Res2 (${UNIT_2}), Stay #${res1StayId}`);
  });

  // ═══════════════════════════════════════════
  // S1 — Unauthenticated API access → 401
  // ═══════════════════════════════════════════
  test("S1: Unauthenticated API calls → 401", async ({ page }) => {
    // Clear any existing auth by navigating to logout
    await page.request.post("/api/auth/logout");

    // Try to access protected endpoints without auth
    const endpoints = [
      { method: "GET", url: "/api/guest-stays" },
      { method: "GET", url: `/api/residents/${res1ResidentId}/pass-balance` },
      { method: "POST", url: `/api/guest-stays/${res1StayId}/approve` },
      { method: "DELETE", url: `/api/guest-stays/${res1StayId}` },
      { method: "GET", url: "/api/admin/users" },
    ];

    for (const ep of endpoints) {
      let res;
      if (ep.method === "GET") {
        res = await page.request.get(ep.url);
      } else if (ep.method === "POST") {
        res = await page.request.post(ep.url);
      } else if (ep.method === "DELETE") {
        res = await page.request.delete(ep.url);
      }
      expect(res!.status(), `${ep.method} ${ep.url} should be 401`).toBe(401);
    }

    console.log(`  ✓ S1: All ${endpoints.length} unauthenticated requests correctly rejected (401)`);
  });

  // ═══════════════════════════════════════════
  // S2 — IDOR: Resident can't access other unit's payment-info
  // ═══════════════════════════════════════════
  test("S2: Resident can't access other unit's payment-info (IDOR)", async ({ page }) => {
    // Login as resident 2
    await apiLogin(page, RES2_EMAIL, TEST_PASSWORD);

    // Try to access resident 1's stay payment-info
    const res = await page.request.get(`/api/guest-stays/${res1StayId}/payment-info`);

    // Should be 404 (stay not found for this unit) or 400 (not NEEDS_PAYMENT)
    // The IDOR fix filters by unit_id, so resident 2 won't find resident 1's stay
    expect([400, 404]).toContain(res.status());

    console.log(`  ✓ S2: Resident2 can't access Resident1's payment-info (IDOR blocked)`);
  });

  // ═══════════════════════════════════════════
  // S3 — IDOR: Resident can't approve other unit's stay
  // ═══════════════════════════════════════════
  test("S3: Resident can't approve other unit's stay", async ({ page }) => {
    // First create a PENDING stay for resident 1
    await apiLoginAdmin(page);
    const stayRes = await page.request.post("/api/guest-stays", {
      data: {
        residentEmail: RES1_EMAIL,
        guest: { fullName: `SecGuest2 ${RUN_ID}`, email: `secg2-${RUN_ID}@test.com` },
        vehicle: { plate: `SC2${RUN_ID}`, desc: "Test" },
        stay: { startDate: futureDate(10), endDate: futureDate(11) },
      },
    });
    expect(stayRes.ok()).toBeTruthy();
    const pendingStayId = (await stayRes.json()).id;

    // Login as resident 2 and try to approve resident 1's stay
    await apiLogin(page, RES2_EMAIL, TEST_PASSWORD);
    const approveRes = await page.request.post(`/api/guest-stays/${pendingStayId}/approve`);
    expect(approveRes.status()).toBe(403);

    const data = await approveRes.json();
    expect(data.error).toContain("own unit");

    console.log(`  ✓ S3: Resident2 can't approve Resident1's stay (403)`);

    // Clean up
    await apiLoginAdmin(page);
    await page.request.delete(`/api/guest-stays/${pendingStayId}`);
  });

  // ═══════════════════════════════════════════
  // S4 — IDOR: Resident can't cancel other unit's stay
  // ═══════════════════════════════════════════
  test("S4: Resident can't cancel other unit's stay", async ({ page }) => {
    // Create a PENDING stay for resident 1
    await apiLoginAdmin(page);
    const stayRes = await page.request.post("/api/guest-stays", {
      data: {
        residentEmail: RES1_EMAIL,
        guest: { fullName: `SecGuest3 ${RUN_ID}`, email: `secg3-${RUN_ID}@test.com` },
        vehicle: { plate: `SC3${RUN_ID}`, desc: "Test" },
        stay: { startDate: futureDate(12), endDate: futureDate(13) },
      },
    });
    expect(stayRes.ok()).toBeTruthy();
    const pendingStayId = (await stayRes.json()).id;

    // Login as resident 2 and try to cancel resident 1's stay
    await apiLogin(page, RES2_EMAIL, TEST_PASSWORD);
    const cancelRes = await page.request.delete(`/api/guest-stays/${pendingStayId}`);
    expect(cancelRes.status()).toBe(403);

    console.log(`  ✓ S4: Resident2 can't cancel Resident1's stay (403)`);

    // Clean up
    await apiLoginAdmin(page);
    await page.request.delete(`/api/guest-stays/${pendingStayId}`);
  });

  // ═══════════════════════════════════════════
  // S5 — Admin can access any stay
  // ═══════════════════════════════════════════
  test("S5: Admin can access any stay across all units", async ({ page }) => {
    await apiLoginAdmin(page);

    // Admin can list all stays
    const listRes = await page.request.get("/api/guest-stays");
    expect(listRes.ok()).toBeTruthy();
    const listData = await listRes.json();
    expect(listData.stays).toBeTruthy();
    expect(Array.isArray(listData.stays)).toBeTruthy();

    // Admin can access resident 1's pass balance
    const balRes = await page.request.get(`/api/residents/${res1ResidentId}/pass-balance`);
    expect(balRes.ok()).toBeTruthy();

    console.log(`  ✓ S5: Admin can access all stays and balances`);
  });

  // ═══════════════════════════════════════════
  // S6 — Payment-info without token or auth → 401
  // ═══════════════════════════════════════════
  test("S6: Payment-info without token or auth → 401", async ({ page }) => {
    // Logout first
    await page.request.post("/api/auth/logout");

    // Bare numeric ID without token or auth
    const res = await page.request.get(`/api/guest-stays/${res1StayId}/payment-info`);
    expect(res.status()).toBe(401);

    const data = await res.json();
    expect(data.error).toContain("Authentication");

    console.log(`  ✓ S6: Payment-info without token/auth → 401`);
  });

  // ═══════════════════════════════════════════
  // S7 — Resident role can't access admin endpoints
  // ═══════════════════════════════════════════
  test("S7: Resident can't access admin endpoints", async ({ page }) => {
    await apiLogin(page, RES1_EMAIL, TEST_PASSWORD);

    // Try admin-only endpoints
    const adminEndpoints = [
      { method: "GET", url: "/api/admin/users" },
      { method: "POST", url: "/api/admin/users" },
      { method: "GET", url: "/api/admin/counts" },
      { method: "POST", url: "/api/cron/monthly-reset" },
    ];

    for (const ep of adminEndpoints) {
      let res;
      if (ep.method === "GET") {
        res = await page.request.get(ep.url);
      } else {
        res = await page.request.post(ep.url, { data: {} });
      }
      expect(res!.status(), `${ep.method} ${ep.url} should be 403`).toBe(403);
    }

    console.log(`  ✓ S7: Resident correctly blocked from all admin endpoints`);
  });

  // ═══════════════════════════════════════════
  // S8 — Resident can approve OWN unit's stays
  // ═══════════════════════════════════════════
  test("S8: Resident CAN approve their OWN unit's stays", async ({ page }) => {
    // Create a PENDING stay for resident 1
    await apiLoginAdmin(page);
    const stayRes = await page.request.post("/api/guest-stays", {
      data: {
        residentEmail: RES1_EMAIL,
        guest: { fullName: `OwnGuest ${RUN_ID}`, email: `own-${RUN_ID}@test.com` },
        vehicle: { plate: `OWN${RUN_ID}`, desc: "Test" },
        stay: { startDate: futureDate(15), endDate: futureDate(16) },
      },
    });
    expect(stayRes.ok()).toBeTruthy();
    const pendingId = (await stayRes.json()).id;

    // Login as resident 1 and approve their own stay
    await apiLogin(page, RES1_EMAIL, TEST_PASSWORD);
    const approveRes = await page.request.post(`/api/guest-stays/${pendingId}/approve`);
    expect(approveRes.ok()).toBeTruthy();
    const approveData = await approveRes.json();
    expect(["APPROVED", "NEEDS_PAYMENT"]).toContain(approveData.status);

    console.log(`  ✓ S8: Resident1 can approve their own unit's stay → ${approveData.status}`);
  });

  // ═══════════════════════════════════════════
  // S9 — Inactive user can't login
  // ═══════════════════════════════════════════
  test("S9: Inactive user can't login", async ({ page }) => {
    const { status, data } = await apiLogin(page, ACCOUNTS.inactive.email, ACCOUNTS.inactive.password);
    expect(status).toBe(403);
    expect(data.error).toBeTruthy();

    console.log(`  ✓ S9: Inactive user correctly blocked from login`);
  });

  // ═══════════════════════════════════════════
  // S10 — Admin bypass: resident can't use it
  // ═══════════════════════════════════════════
  test("S10: Resident can't use admin-bypass-payment", async ({ page }) => {
    await apiLogin(page, RES1_EMAIL, TEST_PASSWORD);

    const res = await page.request.post(`/api/guest-stays/${res1StayId}/admin-bypass-payment`, {
      data: {},
    });
    expect(res.status()).toBe(403);

    console.log(`  ✓ S10: Resident correctly blocked from admin-bypass-payment`);
  });

  // ═══════════════════════════════════════════
  // S11 — Summary
  // ═══════════════════════════════════════════
  test("S11: Security summary", async () => {
    console.log(`\n  ══════════════════════════════════════`);
    console.log(`  Security & Access Control — Summary`);
    console.log(`  ──────────────────────────────────────`);
    console.log(`  S0:  Setup                          ✓`);
    console.log(`  S1:  Unauthenticated → 401          ✓`);
    console.log(`  S2:  IDOR payment-info              ✓`);
    console.log(`  S3:  IDOR approve                   ✓`);
    console.log(`  S4:  IDOR cancel                    ✓`);
    console.log(`  S5:  Admin full access              ✓`);
    console.log(`  S6:  No token/auth → 401            ✓`);
    console.log(`  S7:  Resident ≠ admin               ✓`);
    console.log(`  S8:  Resident own-unit approve      ✓`);
    console.log(`  S9:  Inactive user blocked          ✓`);
    console.log(`  S10: Resident ≠ admin-bypass        ✓`);
    console.log(`  ══════════════════════════════════════\n`);
  });
});
