<p align="center"><img src="public/assets/img/aura-apache-primary-logo.webp" alt="Aura Apache Parking" height="80"></p>

# Aura Apache Parking

![License: MIT](https://img.shields.io/badge/license-MIT-green) ![Next.js](https://img.shields.io/badge/Next.js-16-black) ![React](https://img.shields.io/badge/React-19-61dafb) ![TypeScript](https://img.shields.io/badge/TypeScript-5-3178c6) ![PostgreSQL](https://img.shields.io/badge/PostgreSQL-Neon-336791)

A full-stack parking management system for apartment communities. Residents register guest vehicles, consume monthly free parking passes, and pay for additional nights via Stripe. Staff monitor lots for unauthorized vehicles, and admins manage units, residents, users, and violations from a single dashboard.

## Tech Stack

| Layer | Technology |
|-------|-----------|
| Framework | Next.js 16 (App Router) / React 19 / TypeScript 5 |
| Styling | Tailwind CSS 4 |
| State | Zustand 5 |
| Database | PostgreSQL (Neon) |
| Auth | JWT (HTTP-only cookies) + bcrypt |
| Payments | Stripe Checkout + Webhooks |
| Email | Nodemailer (SMTP) |
| SMS | Twilio Verify |
| Uploads | UploadThing |
| Testing | Vitest (unit) / Playwright (E2E) |
| Hosting | Vercel |

## Features

### Residents
- Register / login and manage profile
- Add guests with vehicle plate, make, color, and stay dates
- 1 free parking night per resident per month (auto-refilled)
- Purchase additional pass bundles via Stripe
- View pass balance, usage history, and guest status
- Download printable guest parking permits

### Guests
- Public parking request form (no login required)
- Email notifications for request status and payment links
- Stripe-powered checkout for billable nights

### Staff
- Read-only monitoring of all active guest stays
- Report unauthorized vehicles with photos
- Generate tow warnings

### Admin
- Full CRUD for units, residents, admin/staff users
- Approve or reject guest parking requests (with payment bypass)
- Track parking violations and unauthorized vehicles
- Dashboard with stats, recent activity, and quick actions
- Audit history of admin actions
- Activate pending resident registrations

### Platform
- Mobile-first responsive design (bottom nav + sidebar)
- Role-based middleware routing (resident / staff / admin)
- Cursor-based pagination for large datasets
- In-memory rate limiting on auth endpoints
- 21 HTML email templates for every workflow event
- Monthly cron job for free pass allocation
- CSP and security headers configured

## Project Structure

```
app/
  (public)/          Public routes: login, register, guest form, payment
  (app)/             Protected routes: dashboards by role
    admin/           Admin pages (dashboard, guests, residents, users, units, parking, history)
    staff/           Staff pages (dashboard, parking, profile)
    dashboard/       Resident pages (guests, passes, vehicles, profile)
  api/               ~44 API routes (auth, CRUD, billing, webhooks, cron)
components/
  layout/            AppShell, Sidebar, BottomNav, TopBar
  shared/            GuestCard, VehicleCard, StripeCheckout, SupportWidget
  ui/                Button, Input, Card, Badge, DatePicker, Toast, etc.
lib/                 db, auth, api, billing, mailer, stripe, twilio, validation, helpers
stores/              Zustand stores (auth, guest, parking)
scripts/             init-db, seed-data, test-apis
templates/           HTML email templates
```

## Database Schema

| Table | Purpose |
|-------|---------|
| `units` | Apartment units (building code + number) |
| `residents` | Building residents linked to units |
| `guests` | Visitor records |
| `guest_stays` | Parking requests with dates, status, billing |
| `resident_free_pass_months` | Monthly free night allocation per resident |
| `resident_pass_purchases` | Bonus pass bundle purchases via Stripe |
| `auth_users` | Login accounts (resident / admin / staff roles) |
| `auth_password_resets` | Password reset tokens |
| `staff` | Staff member profiles |
| `unauthorized_vehicles` | Parking violations and tow warnings |
| `guest_vehicle_free_pass` | Per-vehicle free pass tracking |

Schema is defined in `scripts/init-db.ts` with indexes, triggers, and cascade deletes.

## Billing Logic

- Each resident receives **1 free parking night per month** (auto-refilled via cron)
- Additional nights cost **$5.00/night**
- Guest stays spanning multiple months are split at month boundaries
- Bonus passes (from Stripe bundle purchases) are applied before charging
- Same-day stays count as a minimum of 1 night
- Flow: `pending` &rarr; `NEEDS_PAYMENT` (if billable) &rarr; `approved` (after payment or admin bypass)

## Getting Started

### Prerequisites

- Node.js 18+
- PostgreSQL database (or a [Neon](https://neon.tech) account)
- Stripe account (test mode for development)

### 1. Install dependencies

```bash
npm install
```

### 2. Configure environment

Create a `.env.local` file in the project root:

```env
# Database (Neon PostgreSQL)
DATABASE_URL=postgresql://user:password@host/dbname?sslmode=require

# JWT
JWT_SECRET=your-256-bit-hex-secret

# Server
FRONTEND_URL=http://localhost:3000

# Stripe
NEXT_PUBLIC_STRIPE_PUBLISHABLE_KEY=pk_test_...
STRIPE_SECRET_KEY=sk_test_...

# Twilio (SMS verification)
TWILIO_ACCOUNT_SID=AC...
TWILIO_AUTH_TOKEN=...
TWILIO_VERIFY_SERVICE_SID=VA...
TWILIO_TEST_MODE=true

# Email / SMTP
EMAIL_SMTP_HOST=localhost
EMAIL_SMTP_PORT=1025
EMAIL_SMTP_SECURE=false
EMAIL_USER=test
EMAIL_PASS=test
EMAIL_FROM=parking@aura-apache.local
EMAIL_FROM_NAME=Aura Apache Parking

# Notification Emails
ADMIN_NOTIFICATION_EMAIL=admin@example.com
SUPPORT_INBOX_EMAIL=support@example.com

# Vercel Cron
CRON_SECRET=your-cron-secret

# UploadThing
UPLOADTHING_TOKEN=your-uploadthing-token
```

For local email testing, use [Mailpit](https://mailpit.axllent.org/) (`docker compose up -d`) to catch outgoing emails at `localhost:8025`.

### 3. Initialize the database

```bash
SEED_ADMIN_PASSWORD=<choose-a-dev-password> npx tsx scripts/init-db.ts
```

The script creates demo admin, staff and resident accounts on `@example.com` addresses (for example `admin@example.com`) using the password you supply (`--password` or `SEED_ADMIN_PASSWORD`).

### 4. Seed sample data (optional)

Populates 30 units, 25 residents, multiple admin/staff accounts, and 1 year of guest stay history:

```bash
SEED_PASSWORD=<choose-a-dev-password> npx tsx scripts/seed-data.ts
```

### 5. Run the dev server

```bash
npm run dev
```

Open [http://localhost:3000](http://localhost:3000).

## Scripts

| Command | Description |
|---------|-------------|
| `npm run dev` | Start development server |
| `npm run build` | Production build |
| `npm run start` | Start production server |
| `npm run lint` | Run ESLint |
| `npm run test` | Run unit tests (Vitest) |
| `npm run test:watch` | Run tests in watch mode |
| `npx tsx scripts/init-db.ts` | Create database schema |
| `npx tsx scripts/seed-data.ts` | Seed sample data |
| `npx tsx scripts/test-apis.ts` | Test API endpoints |

## Authentication

Three login entry points:

| URL | Roles | Purpose |
|-----|-------|---------|
| `/login` | Resident | Resident login |
| `/ops` | Staff, Admin | Operations portal |
| `/admin/login` | Admin | Direct admin access |

JWT tokens are stored in HTTP-only cookies (`aura_token`) with a 7-day expiry (30 days in development). Middleware enforces role-based routing: residents are redirected to `/dashboard`, staff to `/staff/dashboard`, and admins to `/admin/dashboard`.

## API Overview

All endpoints live under `/api/`. Key groups:

- **`/api/auth/*`** &mdash; Login, logout, register, password reset, phone verification
- **`/api/guest-stays/*`** &mdash; CRUD, approve, payment confirmation
- **`/api/residents/*`** &mdash; Resident profiles, free pass months, pass balance
- **`/api/admin/*`** &mdash; User and unit management, activation
- **`/api/unauthorized-vehicles/*`** &mdash; Violation reporting and resolution
- **`/api/checkout-session/*`** &mdash; Stripe session creation (stays and bundles)
- **`/api/pass-bundles/*`** &mdash; Bundle purchase confirmation
- **`/api/cron/*`** &mdash; Monthly free pass refill (Vercel cron)
- **`/api/webhooks/*`** &mdash; Stripe webhook handler

## Deployment

The app is configured for Vercel:

1. Connect your repository to Vercel
2. Set all environment variables in the Vercel dashboard
3. The monthly cron job (`/api/cron/monthly-reset`) runs automatically via `vercel.json` or Vercel Cron configuration
4. Configure the Stripe webhook endpoint to point to your production `/api/webhooks/stripe` URL

Security headers (CSP, X-Frame-Options, etc.) are configured in `next.config.ts`.

## License

Released under the [MIT License](LICENSE). The Satoshi font (Fontshare) and the illustrations under `public/assets/img` (apache-* characters) are third-party assets governed by their own terms.
