import { type Page, expect } from "@playwright/test";

/* ── Test accounts from init-db.ts (accounts-only seed) ── */
export const ACCOUNTS = {
  admin: { email: "admin@example.com", password: process.env.SEED_PASSWORD!, dashboard: "/admin/dashboard" },
  staff: { email: "staff@example.com", password: process.env.SEED_PASSWORD!, dashboard: "/staff/dashboard" },
  resident: { email: "r01@example.com", password: process.env.SEED_PASSWORD!, dashboard: "/dashboard" },       // Resident User, Unit 1001
  resident2: { email: "maria.santos@email.com", password: process.env.SEED_PASSWORD!, dashboard: "/dashboard" },             // Maria Santos, Unit 1002
  residentWithBonus: { email: "sarah.johnson@email.com", password: process.env.SEED_PASSWORD!, dashboard: "/dashboard" },    // Sarah Johnson, Unit 2001
  inactive: { email: "admin2@example.com", password: process.env.SEED_PASSWORD! },                               // Inactive admin
} as const;

export const OTP_CODE = "123456";
export const MAILPIT_API = "http://localhost:8025/api/v1";

/* ── Login helper ── */
export async function login(page: Page, email: string, password: string, loginUrl = "/login") {
  await page.goto(loginUrl);
  // Wait for the Login button to be visible as indicator that page is ready
  await page.getByRole("button", { name: /login|sign in/i }).waitFor({ state: "visible", timeout: 10000 });

  // Fill email field - use placeholder since our Input component uses it
  await page.getByPlaceholder("Email").fill(email);

  // Fill password field
  await page.getByPlaceholder("Password").fill(password);

  // Click submit
  await page.getByRole("button", { name: /login|sign in/i }).click();
}

export async function loginAsResident(page: Page, account: { email: string; password: string; dashboard?: string } = ACCOUNTS.resident) {
  await login(page, account.email, account.password, "/login");
  await page.waitForURL("**/dashboard", { timeout: 15000 });
}

export async function loginAsAdmin(page: Page) {
  await login(page, ACCOUNTS.admin.email, ACCOUNTS.admin.password, "/admin/login");
  await page.waitForURL("**/admin/dashboard", { timeout: 15000 });
}

export async function loginAsStaff(page: Page) {
  await login(page, ACCOUNTS.staff.email, ACCOUNTS.staff.password, "/staff/login");
  await page.waitForURL("**/staff/dashboard", { timeout: 15000 });
}

/* ── Mailpit helpers ── */
export async function clearMailpit() {
  try {
    await fetch(`${MAILPIT_API}/messages`, { method: "DELETE" });
  } catch {
    // Mailpit may not be running
  }
}

export async function getMailpitMessages(retries = 5, delay = 1000): Promise<any[]> {
  for (let i = 0; i < retries; i++) {
    try {
      const res = await fetch(`${MAILPIT_API}/messages`);
      const data = await res.json();
      if (data.messages && data.messages.length > 0) return data.messages;
    } catch {
      // Mailpit may not be running
    }
    await new Promise((r) => setTimeout(r, delay));
  }
  return [];
}

export async function getMailpitMessage(id: string): Promise<any> {
  const res = await fetch(`${MAILPIT_API}/message/${id}`);
  return res.json();
}

export async function waitForEmail(toContains: string, subjectContains?: string, retries = 8): Promise<any | null> {
  for (let i = 0; i < retries; i++) {
    const messages = await getMailpitMessages(1, 0);
    const match = messages.find((m: any) => {
      const toMatch = m.To?.some((t: any) => t.Address?.toLowerCase().includes(toContains.toLowerCase()));
      if (!toMatch) return false;
      if (subjectContains) return m.Subject?.toLowerCase().includes(subjectContains.toLowerCase());
      return true;
    });
    if (match) return match;
    await new Promise((r) => setTimeout(r, 1500));
  }
  return null;
}

/* ── Input helpers ── */
export async function fillInput(page: Page, placeholder: string, value: string) {
  await page.getByPlaceholder(new RegExp(placeholder, "i")).first().fill(value);
}

/* ── Wait for page to be stable ── */
export async function waitForLoad(page: Page) {
  await page.waitForLoadState("networkidle", { timeout: 15000 }).catch(() => {});
}

/* ── DateRangePicker helper ── */
// The DateRangePicker is a custom calendar BottomSheet, not native <input type="date">.
// It opens when clicking "Select dates" placeholder button, then you pick start+end days, then "Confirm Dates".
export async function pickDateRange(page: Page, startDayOffset: number, endDayOffset: number) {
  // Click the date picker trigger (shows "Select dates" or date range)
  const trigger = page.locator("button").filter({ hasText: /select dates|—/i }).first();
  await trigger.click();
  await page.waitForTimeout(800);

  // Get today's date and calculate target dates
  const now = new Date();
  const startDate = new Date(now.getTime() + startDayOffset * 86400000);
  const endDate = new Date(now.getTime() + endDayOffset * 86400000);

  // Click the start day in the calendar grid
  const startDay = startDate.getDate().toString();
  const calendarGrid = page.locator(".grid-cols-7").last();

  // Find and click the start date button
  const startBtn = calendarGrid.getByText(startDay, { exact: true }).first();
  await startBtn.click();
  await page.waitForTimeout(500);

  // Click the end date button
  const endDay = endDate.getDate().toString();
  const endBtn = calendarGrid.getByText(endDay, { exact: true }).last();
  await endBtn.click();
  await page.waitForTimeout(500);

  // Confirm
  await page.getByRole("button", { name: /confirm dates/i }).click();
  await page.waitForTimeout(500);
}
