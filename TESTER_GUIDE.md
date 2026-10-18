# Aura Parking — Tester Guide
**Last updated:** 2026-02-22
**Branch:** `main`

---

## How to Use This Document
Each section contains **Happy Path** tests (expected normal behavior) and **Edge Cases** (boundary conditions, abuse scenarios, and gotchas). Mark each test ✅ pass, ❌ fail, or ⚠️ partial. Log failures with: test ID, steps to reproduce, expected vs actual.

---

## 1. Guest Pass Creation — Core Flow

### 1.1 Happy Path

| ID | Test | Expected |
|----|------|----------|
| GP-01 | Resident logs in and adds a guest with a brand-new plate for 1 night | Pass created with status `APPROVED`, `guest_free_pass_nights = 1`, `amount_cents = 0`, permit email sent to guest |
| GP-02 | Resident adds a guest with same plate a second time (different dates, no overlap) | Pass created, guest vehicle free pass already `used = TRUE` so `guest_free_pass_nights = 0`, monthly pass or billable applies |
| GP-03 | Resident adds a guest for 2 nights when they have 1 monthly free pass remaining | 1 free night applied, 1 billable night ($5), status = `NEEDS_PAYMENT` |
| GP-04 | Resident adds a guest for 2 nights when they have 0 passes | Both nights billable ($10), status = `NEEDS_PAYMENT` |
| GP-05 | Resident has accumulated passes from 3 prior months (3 free nights pooled) and books a 3-night stay | All 3 nights covered by monthly pool (oldest month consumed first), `amount_cents = 0`, status = `APPROVED` |
| GP-06 | Admin creates a guest stay via admin/guests page with autoApprove | Stay created, passes applied, correct status returned |
| GP-07 | Public guest form submitted (no auth) for a valid unit | Stay created as `PENDING`, resident notification email sent, guest confirmation email sent |
| GP-08 | Resident approves a PENDING request | Status moves to `APPROVED` or `NEEDS_PAYMENT`, passes deducted, permit email sent |
| GP-09 | Resident cancels a PENDING stay | Status = `CANCELLED`, rejection email sent to guest, no passes deducted |
| GP-10 | Resident cancels a NEEDS_PAYMENT stay | Status = `CANCELLED`, rejection email sent |

### 1.2 Edge Cases

| ID | Test | Expected |
|----|------|----------|
| GP-E01 | Same-day stay (start = end date) | Counts as **1 night**, not 0 |
| GP-E02 | Start date set to today | Allowed (today is valid) |
| GP-E03 | Start date set to yesterday | **Blocked** — "Start date cannot be in the past" |
| GP-E04 | End date before start date | **Blocked** — "End date cannot be before start date" |
| GP-E05 | Start date = end date with both passed (past date) | **Blocked** |
| GP-E06 | Guest name submitted with only spaces | Should be rejected or trimmed — verify no blank names saved |
| GP-E07 | Plate submitted as `abc-123` (lowercase with dash) | Normalized to `ABC123` (uppercase, no dash) before saving |
| GP-E08 | Plate submitted as `ABC 123` (with space) | Normalized to `ABC123` |
| GP-E09 | Plate submitted as `` (empty string) | **Blocked** — plate is required |
| GP-E10 | Guest email is optional — submit without email | Stay created, only resident email sent (no guest email) |
| GP-E11 | Resident tries to create stay for a different unit | **Blocked** with 403 if autoApprove=true; if regular PENDING, it resolves to the requested unit's resident |
| GP-E12 | Unauthenticated user submits 11 guest requests from same IP in 15 min | 11th request returns **429 Too Many Requests** |
| GP-E13 | Resident tries to approve a stay that belongs to a different unit | **Blocked** — "You can only approve stays for your own unit" (403) |
| GP-E14 | Resident tries to approve a stay that's already `APPROVED` | **Blocked** — "Only PENDING stays can be approved" (409) |
| GP-E15 | Resident tries to cancel an already `APPROVED` stay | **Blocked** — "Only PENDING or NEEDS_PAYMENT stays can be cancelled" |
| GP-E16 | Resident tries to cancel a `PAID` stay | **Blocked** — same as above |
| GP-E17 | Stay submitted for a unit number that doesn't exist | **Blocked** — "No ACTIVE resident email found for this unit" (409) |
| GP-E18 | Stay submitted for a unit with an INACTIVE resident | **Blocked** — no active resident email found |
| GP-E19 | Two residents simultaneously submit for the same plate — race condition | One succeeds, the other gets a conflict or the billing recalculates correctly inside the transaction — no double free pass applied |
| GP-E20 | Stay with past end_date is still showing in "active" list | It should **not** appear as active — verify filter logic |

---

## 2. Guest Vehicle Free Pass (One-Time Free Night Per Plate)

| ID | Test | Expected |
|----|------|----------|
| FP-01 | Brand-new plate creates its first ever guest stay (1 night) | `guest_free_pass_nights = 1`, `amount_cents = 0`, status = `APPROVED` |
| FP-02 | Same plate creates a second stay at the **same** unit | `guest_free_pass_nights = 0` (already used), monthly or bonus pass applies instead |
| FP-03 | Check `guest_vehicle_free_pass` table after first stay approved | `used = TRUE`, `guest_stay_id` = the approved stay's ID |
| FP-04 | Query `GET /api/guest-vehicle-free-pass/ABC123` for a brand-new plate | Returns `freePass: 1, used: false, isNewPlate: true` |
| FP-05 | Query `GET /api/guest-vehicle-free-pass/ABC123` after the plate's stay was approved | Returns `freePass: 1, used: true` |
| FP-06 | New plate stays for 2 nights | Guest free pass covers 1 night, remaining 1 night goes to bonus → monthly → billable |
| FP-07 | Resident previews billing for a new plate before submitting | UI shows `1 free (new guest)` applied |

### Edge Cases

| ID | Test | Expected |
|----|------|----------|
| FP-E01 | Cancel a stay that consumed the guest free pass | `guest_vehicle_free_pass.used` **stays TRUE** — free pass is not restored on cancellation |
| FP-E02 | Admin edits a stay's plate to a brand-new plate (never seen before) | Billing recalculated, new plate gets free pass applied in billing estimate; actual deduction happens on approval |
| FP-E03 | Admin edits a stay's plate to an already-used plate | Billing recalculated, free pass NOT applied |
| FP-E04 | Plate `ABC123` and `abc123` and `ABC-123` all refer to same plate | Confirm all normalize to `ABC123` — only one `guest_vehicle_free_pass` record exists |

---

## 3. Plate Locking — Cross-Unit Restriction (NEW)

> **Rule:** Once plate ABC123 has an active/pending pass with Unit 101, no other unit can create a pass for that plate until the existing one expires or is cancelled.

| ID | Test | Expected |
|----|------|----------|
| PL-01 | Resident A (Unit 101) creates a pass for plate `ABC123` | **Succeeds** |
| PL-02 | Resident B (Unit 202) immediately tries to create a pass for the same plate `ABC123` (overlapping or any dates) | **Blocked** — 409 "This vehicle already has an active parking pass with Unit 101. A vehicle can only hold one guest pass at a time." |
| PL-03 | A third resident (Unit 303) also tries for `ABC123` | Same 409 block |
| PL-04 | Resident A **cancels** their pass, then Resident B tries again | **Now allowed** — cancelled stay does not block |
| PL-05 | Resident A's pass **expires** (end_date < today), then Resident B tries | **Now allowed** — expired stays do not block |
| PL-06 | Resident A's pass has status `NEEDS_PAYMENT`, Resident B tries | **Blocked** — NEEDS_PAYMENT is included in the blocking statuses |
| PL-07 | Resident A's pass has status `PENDING`, Resident B tries | **Blocked** — PENDING is included |
| PL-08 | **Same unit** roommate (both in Unit 101) tries to create a pass for `ABC123` that Resident A already created | **Allowed** — same unit is not blocked |
| PL-09 | Admin tries to create a pass for a locked plate from a different unit | **Blocked** — admin goes through the same check |
| PL-10 | Admin **edits** an existing stay's plate to a plate already locked to another unit | **Blocked** — 409 same error |
| PL-11 | Public guest form submitted for a locked plate targeting a different unit | **Blocked** — 409 error shown on form |
| PL-12 | Plate `ABC123` is currently locked to Unit 101. Unit 101 edits that same stay (no plate change) | **Allowed** — only blocks when plate is changing to a different plate that's locked |
| PL-13 | Plate `ABC123` (active in Unit 101) — Unit 101 edits the stay and changes the plate to `XYZ999` | **Allowed** — `XYZ999` is new, no conflict |
| PL-14 | Staff member tries to create unauthorized vehicle report for a plate locked to another unit | **Allowed** — unauthorized vehicles are separate from guest stays |

---

## 4. Monthly Free Pass Buckets

| ID | Test | Expected |
|----|------|----------|
| MB-01 | Newly registered resident — check their pass bucket | One bucket exists for current month with `free_nights_total = 1`, `free_nights_used = 0` |
| MB-02 | Resident approves a 1-night stay using monthly pass | Bucket: `free_nights_used = 1` |
| MB-03 | Resident has passes from 3 prior months (3 accumulated) — books 2 nights | Oldest 2 months consumed first; remaining 1 month stays available |
| MB-04 | Resident books a stay that spans 2 calendar months (e.g., Jan 30 – Feb 2) | Billing split correctly by month; passes consumed from correct buckets |
| MB-05 | Monthly reset cron runs | New bucket created for upcoming month; existing buckets unchanged |
| MB-06 | Resident with 0 free nights books any stay | All nights billable, `amount_cents > 0`, status = `NEEDS_PAYMENT` |
| MB-07 | After approval, check `GET /api/residents/:id/pass-balance` | `monthlyFreeRemaining` decremented by nights consumed |
| MB-08 | Resident purchases a bonus pass bundle, then books a stay | Bonus passes consumed **before** monthly passes |

### Edge Cases

| ID | Test | Expected |
|----|------|----------|
| MB-E01 | Resident has partial bucket (e.g., `free_nights_total = 2`, `free_nights_used = 1`) | Only 1 night available from that bucket, not 2 |
| MB-E02 | A PENDING stay shows billing estimate; resident approves a different stay first (consuming the last free pass) | When original PENDING stay is approved, billing recalculates correctly — billable amount increases, `amount_cents > 0` |
| MB-E03 | Booking a stay in a future month before that bucket is created | Bucket created on-demand during billing calculation for current/past months; future month buckets via cron |
| MB-E04 | Two concurrent approvals for the same resident — race condition | FOR UPDATE lock ensures only one deducts at a time; second recalculates after first commits |

---

## 5. Bonus Pass Purchase & Application

| ID | Test | Expected |
|----|------|----------|
| BP-01 | Resident purchases a pass bundle via Stripe | `residents.bonus_free_nights` incremented by bundle size |
| BP-02 | After purchase, resident books a 1-night stay with `bonus_free_nights = 1` | Bonus pass applied, `amount_cents = 0`, status = `APPROVED` |
| BP-03 | Resident has a `NEEDS_PAYMENT` stay; they purchase a pass bundle that fully covers it | Stay automatically transitions to `APPROVED`, permit email sent |
| BP-04 | Resident has a `NEEDS_PAYMENT` stay; they purchase a bundle that partially covers it | Stay billing recalculated, `amount_cents` reduced but still > 0 — remains `NEEDS_PAYMENT` |
| BP-05 | Stripe webhook received twice for same session (duplicate event) | Idempotent — passes credited only once (`ON CONFLICT DO NOTHING`) |
| BP-06 | `GET /api/residents/:id/pass-balance` after bundle purchase | `bonusPasses` reflects new total |

---

## 6. Payment — Stripe Checkout

| ID | Test | Expected |
|----|------|----------|
| PAY-01 | Resident initiates checkout for a `NEEDS_PAYMENT` stay | Stripe checkout session created, redirect or embedded UI shown |
| PAY-02 | Guest completes payment | Stay transitions to `PAID`, permit email sent to guest |
| PAY-03 | Guest cancels payment midway | Stay remains `NEEDS_PAYMENT`, no change |
| PAY-04 | Resident purchases pass bundle that fully covers the `NEEDS_PAYMENT` stay, **then** tries to pay again | No payment required — `requiresPayment: false` returned |
| PAY-05 | Resident tries to pay for an already `PAID` stay | No-op — returns success without double-charging |
| PAY-06 | Admin bypass payment on a `NEEDS_PAYMENT` stay | Status = `APPROVED`, no Stripe session needed, permit email sent |
| PAY-07 | Stripe webhook fires for a session already processed | Idempotent — no duplicate state change |

### Edge Cases

| ID | Test | Expected |
|----|------|----------|
| PAY-E01 | Checkout session created; resident buys bonus passes before completing payment | On payment confirmation, billing is recalculated — if now fully covered, `requiresPayment = false` |
| PAY-E02 | `confirm-payment` called with an invalid or expired session_id | Error returned |
| PAY-E03 | `confirm-payment` called for a `PENDING` stay (not `NEEDS_PAYMENT`) | Blocked — only `NEEDS_PAYMENT` stays processed |
| PAY-E04 | Two browsers simultaneously confirm payment for same stay | Idempotent check: second request sees `status = PAID` and returns success without re-processing |

---

## 7. Authentication & Authorization

| ID | Test | Expected |
|----|------|----------|
| AU-01 | Login with correct credentials (resident) | JWT cookie set, redirect to dashboard |
| AU-02 | Login with wrong password | 401 "Invalid credentials" |
| AU-03 | 6th failed login attempt for same email within 15 min | 429 rate limit |
| AU-04 | Resident registers with valid phone + OTP | Account created as ACTIVE, auto-logged in |
| AU-05 | Resident registers with already-used email | 409 conflict |
| AU-06 | Resident registers with weak password (no special char) | 400 validation error |
| AU-07 | JWT token expires — resident tries to access dashboard | Redirect to login |
| AU-08 | Staff user tries to access `/admin/guests` | **Blocked** — 403 access denied |
| AU-09 | Resident user tries to access `/admin/` pages | **Blocked** — 403 |
| AU-10 | Resident A tries to view/edit Resident B's guest stays via API | **Blocked** — IDOR check returns 403 |
| AU-11 | Logged-out user hits any `/api/*` protected endpoint | 401 Unauthorized |
| AU-12 | Admin creates a resident account | Account created as ACTIVE, can log in immediately |
| AU-13 | Self-registered admin account (via /admin/register) before approval | Account may be INACTIVE — verify can't log in until activated |
| AU-14 | Change password with correct current password | Success, new password works on next login |
| AU-15 | Change password with wrong current password | 401 error |

---

## 8. Unauthorized Vehicles

| ID | Test | Expected |
|----|------|----------|
| UV-01 | Staff reports an unauthorized vehicle with photo | Record created, appears in staff parking view |
| UV-02 | Admin reports unauthorized vehicle | Record created |
| UV-03 | Resident tries to access unauthorized vehicle endpoints | **Blocked** — 403 |
| UV-04 | Admin marks vehicle as resolved | `resolved = TRUE`, disappears from active list |
| UV-05 | Staff deletes a vehicle record | Record removed from DB |
| UV-06 | Admin views vehicle report with photo | Photo displays as horizontal thumbnail; clicking expands to full-screen view |
| UV-07 | Close full-screen photo by clicking backdrop | Photo viewer closes |
| UV-08 | Close full-screen photo by clicking X button | Photo viewer closes |
| UV-09 | Admin sends tow warning email | Email sent to provided address, form shows success state |

### Edge Cases

| ID | Test | Expected |
|----|------|----------|
| UV-E01 | Report unauthorized vehicle without a plate | **Blocked** — plate_number is required |
| UV-E02 | Plate submitted as lowercase | Normalized to uppercase |
| UV-E03 | Report submitted with past spotted_date | Allowed (historical reports valid) |
| UV-E04 | Report submitted without spotted_date | Defaults to today |
| UV-E05 | Same plate reported twice (two separate incidents) | Both records created — no uniqueness constraint on unauthorized_vehicles.plate |
| UV-E06 | Photo upload fails mid-upload | Error shown, no record created with broken image URL |

---

## 9. Admin Functions

| ID | Test | Expected |
|----|------|----------|
| AD-01 | Admin creates a new unit | Unit appears in unit list |
| AD-02 | Admin creates a resident for an existing unit | Resident created as ACTIVE, can log in |
| AD-03 | Admin creates a resident for a **new** unit number (unit doesn't exist yet) | Unit created automatically, resident linked to it |
| AD-04 | Admin views all guest stays across all units | Unfiltered global view |
| AD-05 | Admin filters stays by unit number | Only that unit's stays shown |
| AD-06 | Admin approves a PENDING stay | Status updated, passes deducted, email sent |
| AD-07 | Admin edits guest name on an existing stay | Name updated in guests table |
| AD-08 | Admin deactivates a resident account | Resident cannot log in; stays associated still visible |
| AD-09 | Admin activates an INACTIVE account | Account becomes ACTIVE, resident can log in |
| AD-10 | Admin views pass balance for a resident | Correct monthly + bonus balance shown |
| AD-11 | Admin bypass payment on NEEDS_PAYMENT stay | Status = APPROVED, no payment taken |

---

## 10. Resident Dashboard

| ID | Test | Expected |
|----|------|----------|
| RD-01 | Resident views their dashboard | Only their unit's guests shown (no other unit data visible) |
| RD-02 | Resident adds guest — sees pass balance preview before submitting | Billing breakdown shows correctly (free pass, monthly pass, billable) |
| RD-03 | Resident edits a pending guest's dates | Billing recalculated, status updated if amount changes |
| RD-04 | Resident edits a guest's plate | Cross-unit conflict check runs; if no conflict, billing recalculated |
| RD-05 | Resident views a guest stay that is APPROVED | "Edit" and "Cancel" buttons visibility follows business rules (can't cancel APPROVED) |
| RD-06 | Resident's free pass balance shown correctly | Matches sum of `resident_free_pass_months` remaining nights + `bonus_free_nights` |
| RD-07 | After pass consumed, balance updates on next page load | Balance reflects deduction |

---

## 11. Public Guest Form

| ID | Test | Expected |
|----|------|----------|
| PG-01 | Guest submits form for valid unit with all fields | Stay created as PENDING, resident notified, guest sees confirmation |
| PG-02 | Guest submits for invalid unit number | Error: "Resident not found" or unit not found |
| PG-03 | Guest submits for a plate already locked to a **different** unit | 409 error shown: "This vehicle already has an active parking pass with Unit X..." |
| PG-04 | Guest submits without email | Stay created, no guest email sent |
| PG-05 | Guest submits with an email — receives confirmation | Guest confirmation email arrives |
| PG-06 | Guest submits 11 times from same IP in 15 min | 11th request rate-limited |
| PG-07 | Guest submits with past start date | Blocked — "Start date cannot be in the past" |

---

## 12. Email Notifications

| ID | Test | Expected |
|----|------|----------|
| EM-01 | Public guest form submitted | Resident gets "New Parking Request" email with action link |
| EM-02 | Public guest form submitted with guest email | Guest gets "Request Submitted" confirmation email |
| EM-03 | Stay approved | Guest gets "Parking Permit Approved" email with permit URL |
| EM-04 | Stay cancelled | Guest gets "Parking Request Declined" email |
| EM-05 | Stay auto-approved by resident | Guest gets "Parking Permit Approved" directly (no PENDING stage) |
| EM-06 | Payment confirmed via Stripe | Guest gets "Parking Permit Approved" email |
| EM-07 | Email send fails (invalid SMTP) | `guest_email_status = FAILED`, error logged — stay still created/approved normally |
| EM-08 | Tow warning email sent from admin | Owner receives tow warning email |
| EM-09 | Check `resident_email_status` and `guest_email_status` in DB after various flows | Should be `SENT` or `FAILED` — never left null after email attempt |

---

## 13. Data Validation & Input Sanitization

| ID | Test | Expected |
|----|------|----------|
| DV-01 | Submit guest form with plate `<script>alert(1)</script>` | Sanitized/rejected — no XSS stored |
| DV-02 | Submit guest name with 500+ characters | Truncated or rejected gracefully |
| DV-03 | Submit unit number as `Unit 101`, `unit-101`, `UNIT 101` | All normalized to `101` |
| DV-04 | Dates submitted as invalid strings (`"not-a-date"`) | 400 validation error |
| DV-05 | API body with missing required fields | 400 with clear error message |
| DV-06 | Phone number with spaces/dashes for registration | Should normalize or validate properly |
| DV-07 | Email with uppercase letters | Stored as-is but lookup should be case-insensitive |
| DV-08 | Concurrent identical POST /guest-stays requests | Both should succeed or one blocked — no duplicate stay created with incorrect billing |

---

## 14. Billing Calculation — Accuracy Tests

| ID | Test | Scenario | Expected |
|----|------|----------|----------|
| BC-01 | 1 night, new plate, 0 monthly passes | guest free pass only | $0, 0 billable |
| BC-02 | 1 night, returning plate (free pass used), 1 monthly pass | monthly covers | $0, 0 billable |
| BC-03 | 1 night, returning plate, 0 passes | fully billable | $5, 1 billable |
| BC-04 | 2 nights, new plate, 1 monthly pass | free pass (1) + monthly (1) | $0, 0 billable |
| BC-05 | 3 nights, new plate, 2 monthly passes | free (1) + monthly (2) | $0, 0 billable |
| BC-06 | 3 nights, returning plate, 1 monthly pass | monthly (1) + billable (2) | $10, 2 billable |
| BC-07 | 3 nights, new plate, 1 bonus pass, 1 monthly pass | free (1) + bonus (1) + monthly (1) | $0, 0 billable |
| BC-08 | Stay crosses month boundary (e.g., Jan 30 – Feb 3 = 4 nights) | Split Jan: 2 nights, Feb: 2 nights; passes applied correctly | Verify month buckets consumed correctly |
| BC-09 | Same-day stay (start = end = today) | 1 night minimum | Same as 1-night case |
| BC-10 | Resident has 3 old accumulated months (3 nights pooled), books 5 nights | 3 free + 2 billable | $10, 2 billable |
| BC-11 | Bonus pass > total nights | Only total nights' worth of passes deducted | Correct — no over-deduction |

---

## 15. Concurrency & Race Conditions

| ID | Test | Expected |
|----|------|----------|
| RC-01 | Two browser tabs simultaneously approve the same PENDING stay | Second gets "Stay has already been processed" (409) |
| RC-02 | Two residents (same unit) simultaneously approve different PENDING stays using the same monthly pass | FOR UPDATE lock serializes — second recalculates correctly; no double-dip |
| RC-03 | Plate submitted for same unit by two browsers simultaneously | One succeeds; second either succeeds or gets a 409 (depending on timing) — no data corruption |
| RC-04 | Pass bundle webhook fires while an approval transaction is in progress | Approval transaction commits first (locked); billing recalculates after |

---

## 16. Pagination

| ID | Test | Expected |
|----|------|----------|
| PG-P01 | Unit with 25+ guest stays — scroll/load more | Cursor-based pagination returns next batch correctly |
| PG-P02 | `hasMore = true` while more items exist | Load More button visible |
| PG-P03 | `hasMore = false` after last page | Load More button hidden |
| PG-P04 | Admin unauthorized vehicles list with 20+ records | Pagination works correctly |

---

## 17. Staff — Scope & Restrictions

| ID | Test | Expected |
|----|------|----------|
| ST-01 | Staff logs in and sees `/staff/dashboard` | Access granted |
| ST-02 | Staff tries to access `/admin/guests` | **Blocked** — 403 |
| ST-03 | Staff tries to approve a guest stay via API | **Blocked** — 403 |
| ST-04 | Staff reports unauthorized vehicle | **Allowed** |
| ST-05 | Staff resolves unauthorized vehicle | **Allowed** |
| ST-06 | Staff deletes unauthorized vehicle | **Allowed** |
| ST-07 | Staff tries to GET `/api/admin/units` | **Blocked** |

---

## 18. Permit URL Access

| ID | Test | Expected |
|----|------|----------|
| PM-01 | Guest opens permit URL `/permit/{stayId}` after APPROVED | Permit details visible without login |
| PM-02 | Guest opens permit URL for a NEEDS_PAYMENT stay | Shows payment required or appropriate message |
| PM-03 | Guest opens permit URL for a CANCELLED stay | Shows cancelled status |
| PM-04 | Invalid/nonexistent stayId in permit URL | 404 or graceful not-found message |

---

## 19. UI / UX Spot Checks

| ID | Test | Expected |
|----|------|----------|
| UI-01 | Unauthorized vehicle photo — click thumbnail | Full-screen photo viewer opens |
| UI-02 | Full-screen photo viewer — click backdrop | Viewer closes |
| UI-03 | Full-screen photo viewer — click X button | Viewer closes |
| UI-04 | Vehicle with no photo — detail sheet | Photo section not shown (no broken image) |
| UI-05 | Long plate number or vehicle description | No overflow/clipping issues in cards |
| UI-06 | Dashboard stats (active, upcoming counts) | Numbers match actual data |
| UI-07 | Pass balance widget | Shows correct monthly + bonus breakdown |
| UI-08 | Error messages (form validation, API 409s) | Displayed in red banner within the relevant form |
| UI-09 | Loading states on all async buttons | Spinner shown during API calls |
| UI-10 | Mobile: all forms scrollable and usable | No cut-off fields on small screens |

---

## 20. Known Business Rules — Quick Reference for Testers

| Rule | Detail |
|------|--------|
| Guest free pass | 1 night per plate, **ever** — cannot be re-used or restored after cancellation |
| Monthly passes | 1 per resident per month, accumulate (don't expire monthly) |
| Pass priority | Guest free → Bonus → Monthly (oldest month first) |
| Rate | $5 / billable night |
| Plate locking | One active pass per plate across the whole system at any time |
| Same-unit exemption | Plate locking doesn't apply within the same unit |
| Cancellation | Only PENDING or NEEDS_PAYMENT can be cancelled |
| Editing | PAID stays cannot be edited or have plate/dates changed |
| Plate format | Always uppercase, no spaces/dashes |
| Date baseline | Uses MST timezone (`todayMST()`) — users near midnight may get different results depending on timezone |
| Admin bypass | Admin can approve NEEDS_PAYMENT without charging — useful for disputes |
| Stripe idempotency | Duplicate webhooks/confirmation calls are safe — no double-processing |

---

## Bug Report Template

```
ID: [test ID from above]
Severity: Critical / High / Medium / Low
Feature: [area]
Steps to Reproduce:
  1.
  2.
  3.
Expected:
Actual:
Screenshot/Log: [attach if available]
Environment: [browser, device, logged in as: role]
```

---

*This document should be updated whenever a new feature is shipped or a business rule changes.*
