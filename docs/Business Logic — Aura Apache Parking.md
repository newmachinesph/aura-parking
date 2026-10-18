# Aura Apache Parking — Business Logic Guide

> A plain-language reference for understanding how the Aura Apache guest parking platform works — intended for property management, stakeholders, and non-technical team members.

---

## Table of Contents

1. [What the Platform Does](#1-what-the-platform-does)
2. [Who Uses It (Roles)](#2-who-uses-it-roles)
3. [The Guest Parking Request — Step by Step](#3-the-guest-parking-request--step-by-step)
4. [How Parking Passes Work](#4-how-parking-passes-work)
5. [How Billing & Pricing Work](#5-how-billing--pricing-work)
6. [Payments (Stripe)](#6-payments-stripe)
7. [The Digital Parking Permit](#7-the-digital-parking-permit)
8. [Unauthorized Vehicles & Tow Warnings](#8-unauthorized-vehicles--tow-warnings)
9. [Email Notifications](#9-email-notifications)
10. [Account Management](#10-account-management)
11. [Monthly Cron Job (Automated Tasks)](#11-monthly-cron-job-automated-tasks)
12. [Key Business Rules & Safeguards](#12-key-business-rules--safeguards)

---

## 1. What the Platform Does

Aura Apache Parking is a web-based system that manages **guest vehicle parking** at the Aura Apache residential community. It handles:

- Guest parking requests (submitted by guests or residents)
- Resident approval or rejection of requests
- Free pass tracking and billing calculations
- Online payments via Stripe
- Digital parking permits
- Unauthorized vehicle logging and tow warnings
- Admin/staff oversight of all operations

The platform has **three interfaces**:

| Interface | Who sees it | What it does |
|---|---|---|
| **Public pages** | Guests (no login needed) | Submit parking requests, make payments, view permits |
| **Resident dashboard** | Residents (logged in) | Manage guest stays, view/purchase passes, approve or reject requests |
| **Admin dashboard** | Admin & staff (logged in) | Full oversight — manage residents, units, stays, unauthorized vehicles |

---

## 2. Who Uses It (Roles)

### Residents
- Live at Aura Apache in a specific unit (e.g. Unit 1101)
- Can submit guest parking requests that get **instantly approved**
- Can approve or reject guest requests submitted through the public form
- Can view their free pass balance and purchase additional pass bundles
- Can only see and manage guests for **their own unit**

### Admin
- Has **full access** to everything on the platform
- Can manage residents, units, and staff accounts
- Can approve or reject guest stays for **any unit**
- Can override payments (approve a stay without requiring payment)
- Can activate new staff/admin accounts
- Can trigger the monthly pass reset manually
- Can log unauthorized vehicles and send tow warnings

### Staff
- Handles day-to-day parking operations alongside admin
- Can approve/reject stays, log unauthorized vehicles, send tow warnings
- Can view and create residents, but **cannot** edit or delete them
- Can view any resident's pass balance
- **Cannot** manage user accounts, create/delete units, or activate accounts
- Staff accounts require admin activation before they can log in

### Guests
- Do **not** need an account
- Submit parking requests through a public form
- Pay for parking online if required
- Receive a digital parking permit via email

---

## 3. The Guest Parking Request — Step by Step

### Path A: Guest Submits a Request (Public Form)

```
Guest visits the public parking page
        ↓
Step 1: Find the host resident (by email or unit number)
        ↓
Step 2: Enter guest details (name, vehicle plate, vehicle make, stay dates)
        ↓
Step 3: Submit → Request is created as PENDING
        ↓
Resident receives an email notification
        ↓
Resident logs in and either APPROVES or REJECTS
        ↓
If approved with $0 owed     → Status: APPROVED → Permit email sent to guest
If approved with amount owed  → Status: NEEDS PAYMENT → Guest pays via link on dashboard
If rejected                   → Status: CANCELLED → Rejection email sent to guest
```

### Path B: Resident Adds a Guest (Dashboard)

```
Resident logs into their dashboard
        ↓
Clicks "Add Guest" and enters details
        ↓
Request is INSTANTLY APPROVED (auto-approve)
        ↓
Passes are deducted and billing calculated immediately
        ↓
If $0 owed   → Status: APPROVED → Permit email sent to guest
If amount owed → Status: NEEDS PAYMENT → Guest pays via payment page
```

### Path C: Admin/Staff Creates a Guest Stay

Same as Path B — admin or staff can create stays for any unit and choose to auto-approve.

---

## 4. How Parking Passes Work

Every resident has access to **three types of free parking passes** that reduce or eliminate the nightly fee for guest stays.

### 4.1 Guest Vehicle One-Time Free Pass

- **What:** Every unique license plate gets **one free night** the very first time it parks at Aura Apache — ever.
- **How many:** Exactly 1 per license plate, lifetime.
- **Resets?** No. Once used, it is gone forever for that plate.
- **Example:** If plate "ABC123" visits for the first time, the first night is free. If that same plate visits again months later, this free pass is no longer available.

### 4.2 Monthly Resident Free Nights

- **What:** Every active resident receives **1 free guest parking night per month**, automatically.
- **When:** Added on the 1st of every month by an automated job.
- **Accumulates?** **Yes.** Unused passes carry over indefinitely. A resident who has never used guest parking for 6 months will have 6 free nights saved up.
- **Consumption order:** When multiple months of passes are saved up, the **oldest month's pass is used first** (first-in, first-out).
- **Example:** A resident has unused passes from January, February, and March. When a 2-night stay is approved, the January pass is used first, then February. March remains unused.

### 4.3 Bonus Purchased Passes

- **What:** Residents can buy additional free night passes in bundles.
- **Options:**
  - **3-Pack:** $12.75 (saves $2.25 vs. paying per night)
  - **5-Pack:** $20.00 (saves $5.00 vs. paying per night)
- **How they work:** After purchase, the bonus nights are added to the resident's balance. They are used **before** monthly passes but **after** the vehicle one-time free pass.

### Pass Priority Order

When billing is calculated, passes are applied in this **exact order**:

```
1. Guest vehicle one-time free pass  (1 night max, first-time plates only)
        ↓
2. Bonus purchased passes            (from 3-pack or 5-pack bundles)
        ↓
3. Monthly accumulated passes        (oldest month consumed first)
        ↓
4. Remaining nights are billed at $5.00/night
```

### Short-Circuit Rule

If a stay is **exactly 1 night** and the vehicle has a **one-time free pass available**, the stay costs **$0** and **no other passes are consumed**. The system skips checking bonus or monthly passes entirely.

---

## 5. How Billing & Pricing Work

### Base Rate

| Item | Price |
|---|---|
| Guest parking | **$5.00 per night** |
| 3-pass bundle | **$12.75** (15% discount) |
| 5-pass bundle | **$20.00** (20% discount) |

### How a Stay's Cost Is Calculated

1. Count the **total number of nights** in the stay
   - A same-day stay (check-in and check-out on the same date) counts as **1 night**
   - Multi-day stays count each night individually
2. Apply passes in priority order (see Section 4)
3. **Billable nights** = total nights minus all passes applied
4. **Amount due** = billable nights × $5.00

### Example Calculations

**Example 1:** Guest stays 3 nights, first-time plate, resident has 1 monthly pass saved.
- 1 night covered by vehicle one-time free pass
- 1 night covered by monthly pass
- **1 night billable = $5.00**

**Example 2:** Guest stays 1 night, first-time plate.
- Short-circuit rule: 1 night covered by vehicle free pass
- No other passes consumed
- **$0.00 — no payment needed**

**Example 3:** Guest stays 5 nights, returning plate, resident has 2 bonus passes and 1 monthly pass.
- 0 vehicle free pass (plate already used it)
- 2 nights covered by bonus passes
- 1 night covered by monthly pass
- **2 nights billable = $10.00**

**Example 4:** Guest stays 2 nights, returning plate, no passes available.
- **2 nights billable = $10.00**

### Billing Re-Estimation

While a request is still **PENDING** (not yet approved), the system periodically recalculates the estimated cost. This happens when:

- The resident purchases a pass bundle
- Another guest stay is approved (consuming passes that were shared)
- An admin modifies the stay details

This ensures the cost shown to the resident is always up to date.

---

## 6. Payments (Stripe)

All payments are processed through **Stripe** (credit/debit card).

### Guest Stay Payments

1. After a stay is approved with an amount due, the resident can share the payment link with the guest, or the guest can access it through the resident's dashboard
2. The guest visits the payment page which shows the stay details and total amount
3. The guest clicks "Pay" and completes payment through Stripe's secure checkout
4. After payment, the guest is redirected to a success page showing a billing breakdown
5. The stay status changes from **NEEDS PAYMENT** to **PAID**
6. A digital parking permit is emailed to the guest ("Parking Permit Approved")

### Bundle Purchases

1. Resident selects a bundle (3-pack or 5-pack) from their dashboard
2. Resident is taken to Stripe's secure checkout
3. After payment, the bonus passes are immediately added to their balance
4. Any existing NEEDS PAYMENT stays are re-evaluated — if the new passes fully cover a stay, it is automatically approved

### Payment Safety

- Stripe webhook notifications provide a backup in case the guest's browser closes during payment
- Duplicate payments are prevented — each stay can only be paid once
- All payment confirmations are verified directly with Stripe's servers

---

## 7. The Digital Parking Permit

After a stay is **APPROVED** or **PAID**, a digital parking permit is generated.

### What it contains:
- Guest name
- Unit number
- Vehicle plate and description
- Start and end dates
- Status (Approved/Paid)
- A unique reference code (e.g. "AP-2K3")

### How it's accessed:
- **Email:** The guest receives a "Parking Permit Approved" email with a link
- **Dashboard:** The resident can view permits for all their unit's guests
- **Direct link:** Each permit has a unique secure URL that works without login

### Security:
- Permit links contain a random security token — knowing just the permit number is not enough to view it
- Permits are also accessible to authenticated residents (for their own unit) and admin/staff

---

## 8. Unauthorized Vehicles & Tow Warnings

Admin and staff can log unauthorized vehicles found in the parking area.

### Logging a Vehicle
Each record includes:
- License plate number
- Vehicle make and color
- Where it was spotted and when
- Violation notes
- An optional photo
- Recommended action: **Warn**, **Sticker**, **Tow**, or **Monitor**

### Tow Warnings
- Admin/staff can send a "Final Warning: Unauthorized Vehicle" email to a specified email address
- This is used to notify vehicle owners before towing
- Records can be marked as "resolved" once the situation is handled

### Dashboard View
- Admin and staff see all unauthorized vehicle records in a dedicated section
- Vehicles flagged for towing are highlighted separately

---

## 9. Email Notifications

The platform sends automated emails at key points in the process:

| Event | Who receives it | What it says |
|---|---|---|
| Guest submits a request (public form) | **Resident** | "New Parking Request" — with a link to approve/reject |
| Guest submits a request (public form) | **Guest** | "Request Submitted" — confirmation with reference code |
| Resident adds a guest (auto-approve, $0) | **Guest** | "Parking Permit Approved" — with permit link |
| Stay is approved by resident/staff ($0) | **Guest** | "Parking Permit Approved" — with permit link |
| Stay requires payment (NEEDS PAYMENT) | *(no email)* | Guest accesses payment link via dashboard or shared URL |
| Stay is paid via Stripe | **Guest** | "Parking Permit Approved" — with permit link |
| Stay is rejected/cancelled | **Guest** | "Parking Request Declined" |
| Admin bypasses payment | **Guest** | "Parking Permit Approved" — with permit link |
| Monthly pass is added (1st of month) | **All active residents** | "New Monthly Guest Pass Added" |
| Password reset requested | **User** | "Password Reset" — with reset link (expires in 1 hour) |
| Admin creates a resident account | **Resident** | "Verify Your Resident Account" |
| Admin activates an account | **User** | "Your Account Has Been Activated" |
| New admin/staff self-registers | **Admin** | "New Staff/Admin Registration Pending Approval" |
| Tow warning issued | **Specified email** | "Final Warning: Unauthorized Vehicle" |
| Support message sent | **Admin inbox** | Support request with user details |

### Important Notes on Email Behavior

- **Auto-approve (resident adds a guest):** The resident does **not** receive a notification email since they initiated the action themselves. Only the guest receives the permit email (if the stay is $0).
- **NEEDS PAYMENT stays:** No email is sent to the guest when a stay transitions to NEEDS PAYMENT. The guest accesses the payment page through a link shared by the resident or available on the dashboard. The "Parking Permit Approved" email is only sent **after** payment is completed.
- **Email delivery tracking:** The system records whether each email was sent successfully or failed. If an email fails, the stay is still created — email failure does not block any process.

---

## 10. Account Management

### Resident Registration (Self-Service)
1. Resident visits the registration page
2. Enters: unit number, full name, email, phone number, password
3. A verification code is sent to their phone via SMS
4. After entering the code, the account is created and they are logged in immediately
5. The first resident to register in a unit becomes the **primary contact** for that unit

### Admin/Staff Registration
1. User visits the admin registration page
2. Enters their details and selects their role (admin or staff)
3. Account is created as **inactive**
4. An existing admin is notified by email
5. The admin must manually activate the account before the new user can log in

### Password Requirements
- At least 8 characters
- At least one uppercase letter
- At least one number
- At least one special character (e.g. !@#$%)

### Password Reset
- Available via email or phone
- Reset links expire after **1 hour**
- After reset, all other outstanding reset tokens for that user are invalidated

---

## 11. Monthly Cron Job (Automated Tasks)

On the **1st of every month**, an automated job runs that:

1. **Adds 1 free guest parking night** to every active resident's pass balance
2. **Sends an email** to each resident notifying them of the new pass

### Important Details:
- The job is **safe to run multiple times** — running it twice in the same month will not add duplicate passes
- New residents who register mid-month receive their first pass immediately at registration, so they don't have to wait for the next month
- The guest vehicle one-time free pass is **not affected** by this job — those are one-time only and never reset

---

## 12. Key Business Rules & Safeguards

### One Plate, One Unit
A vehicle license plate can only have an active parking request at **one unit at a time**. If someone tries to register a plate that already has a pending or active stay at a different unit, the request is rejected.

### Plate Format
- License plates must be 2–8 characters (letters and numbers only)
- Plates are automatically cleaned up: spaces and dashes are removed, letters are uppercased
- "abc-123" and "ABC123" are treated as the same plate

### Unit Numbers
- Must be exactly 4 digits (e.g. 1101, 0205)
- Only numeric characters are accepted

### Date Rules
- Start date cannot be in the past (uses Mountain Standard Time)
- End date must be on or after the start date
- A same-day booking (start = end) counts as 1 night

### Who Can Do What

| Action | Resident | Staff | Admin |
|---|---|---|---|
| Submit guest parking request | Own unit | Any unit | Any unit |
| Approve/reject a request | Own unit | Any unit | Any unit |
| View guest stays | Own unit | All units | All units |
| Purchase pass bundles | Yes | No | No |
| View pass balance | Own only | Any resident | Any resident |
| Override/bypass payment | No | Yes | Yes |
| Manage residents | No | View & create | Full control |
| Manage units | No | No | Full control |
| Activate accounts | No | No | Yes |
| Log unauthorized vehicles | No | Yes | Yes |
| Send tow warnings | No | Yes | Yes |

### Financial Safeguards
- Pass deductions use database-level locks to prevent the same pass from being used twice when multiple requests are processed simultaneously
- Stripe payments are verified server-to-server (not just relying on the client)
- Duplicate payments are prevented — each stay can only be charged once
- Bundle purchase credits are applied exactly once, even if confirmation messages are received multiple times

### Data Validation
- All text inputs (names, plates, emails) are trimmed of leading/trailing spaces before processing
- Guest email is the **only optional field** on the guest parking form — all other fields are required
- Server-side validation mirrors client-side validation as a safety net

---

*Document generated from platform source code analysis — March 2026*
