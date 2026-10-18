# Aura Apache Parking - Full System Analysis & Flow

## Tech Stack Overview

| Layer | Technology |
|-------|-----------|
| **Framework** | Next.js 16 (App Router) |
| **Language** | TypeScript 5, React 19 |
| **Styling** | Tailwind CSS 4 |
| **State** | Zustand 5 |
| **Database** | PostgreSQL (Neon) via `pg` |
| **Auth** | JWT (jose + jsonwebtoken), bcryptjs |
| **Payments** | Stripe (checkout + webhooks) |
| **Email** | Nodemailer (21 HTML templates) |
| **SMS/OTP** | Twilio Verify |
| **Uploads** | UploadThing |
| **Hosting** | Vercel |

---

## 1. High-Level System Architecture

```mermaid
graph TB
    subgraph Clients["Client Layer"]
        RES[/"Resident App<br/>/dashboard/*"/]
        ADM[/"Admin Portal<br/>/admin/*"/]
        STF[/"Staff Portal<br/>/staff/*"/]
        PUB[/"Public Pages<br/>/, /guest, /permit"/]
    end

    subgraph Middleware["Next.js Middleware (proxy.ts)"]
        MW{JWT Verify<br/>+ Role Check}
    end

    subgraph AppLayer["Next.js App Router"]
        subgraph API["API Routes (/api/*)"]
            AUTH[Auth API<br/>login, register,<br/>OTP, reset]
            ADMIN_API[Admin API<br/>units, users,<br/>counts]
            RES_API[Residents API<br/>CRUD, pass-balance,<br/>guest-stays]
            GS_API[Guest Stays API<br/>CRUD, approve,<br/>permit, payment]
            VEH_API[Vehicles API<br/>unauthorized,<br/>violations]
            PAY_API[Checkout API<br/>sessions, bundles]
            CRON[Cron API<br/>monthly-reset]
            WH[Webhook API<br/>Stripe events]
        end

        subgraph Services["Service Layer (lib/)"]
            BILLING[billing.ts<br/>calculateStayBilling<br/>refreshPendingBilling]
            DB[db.ts<br/>dbQuery, dbTransaction<br/>PostgreSQL Pool]
            AUTHLIB[auth.ts<br/>JWT sign/verify<br/>cookies, hashing]
            MAIL[mailer.ts<br/>sendParkingEmail<br/>21 templates]
            TWIL[twilio.ts<br/>OTP verification]
            STRLIB[stripe.ts<br/>Stripe server client]
        end
    end

    subgraph StateLayer["Client State (Zustand)"]
        ASTORE[authStore<br/>session, role,<br/>login/logout]
        GSTORE[guestStore<br/>guests, freePass,<br/>CRUD + pagination]
        PSTORE[parkingStore<br/>vehicles, tabs,<br/>CRUD + pagination]
    end

    subgraph External["External Services"]
        STRIPE[Stripe<br/>Payments]
        TWILSVC[Twilio<br/>SMS/OTP]
        SMTP[SMTP Server<br/>Email]
        NEON[(Neon PostgreSQL<br/>Database)]
        UT[UploadThing<br/>File Uploads]
    end

    RES & ADM & STF & PUB --> MW
    MW --> API
    RES --> ASTORE & GSTORE & PSTORE
    ADM --> ASTORE
    STF --> ASTORE & PSTORE

    AUTH --> AUTHLIB & TWIL & DB
    ADMIN_API --> DB
    RES_API --> DB & BILLING
    GS_API --> DB & BILLING & MAIL & STRLIB
    VEH_API --> DB & UT
    PAY_API --> STRLIB
    CRON --> DB & MAIL
    WH --> DB & BILLING

    DB --> NEON
    MAIL --> SMTP
    TWIL --> TWILSVC
    STRLIB --> STRIPE
    STRIPE -->|webhook| WH

    style Clients fill:#e8f5e9,stroke:#2e7d32
    style External fill:#fff3e0,stroke:#e65100
    style StateLayer fill:#e3f2fd,stroke:#1565c0
    style API fill:#fce4ec,stroke:#c62828
    style Services fill:#f3e5f5,stroke:#6a1b9a
```

---

## 2. Database Entity Relationship Diagram

```mermaid
erDiagram
    units {
        int id PK
        varchar building_code
        varchar unit_number
        timestamp created_at
    }

    residents {
        int id PK
        int unit_id FK
        varchar full_name
        varchar email
        varchar phone
        varchar status
        int bonus_free_nights
        timestamp created_at
    }

    auth_users {
        int id PK
        varchar email UK
        varchar password_hash
        varchar role
        int resident_id FK
        varchar status
        timestamp created_at
    }

    staff {
        int id PK
        int auth_user_id FK
        varchar full_name
        varchar phone
        timestamp created_at
    }

    guests {
        int id PK
        varchar full_name
        varchar email
        timestamp created_at
    }

    guest_stays {
        int id PK
        int unit_id FK
        int guest_id FK
        int requested_by_resident_id FK
        date start_date
        date end_date
        varchar status
        varchar plate_number
        varchar vehicle_description
        int total_nights
        int passes_applied
        int guest_free_pass_nights
        int billable_nights
        int amount_cents
        varchar stripe_session_id
        varchar public_token
        timestamp created_at
    }

    resident_free_pass_months {
        int id PK
        int resident_id FK
        date month_start
        int free_nights_total
        int free_nights_used
    }

    resident_pass_purchases {
        int id PK
        int resident_id FK
        varchar stripe_session_id UK
        int nights_purchased
        int amount_cents
        timestamp created_at
    }

    guest_vehicle_free_pass {
        int id PK
        varchar plate_number UK
        boolean free_pass
        boolean used
    }

    unauthorized_vehicles {
        int id PK
        varchar plate_number
        varchar image_url
        varchar violation_note
        varchar status
        int reported_by FK
        timestamp created_at
    }

    auth_password_resets {
        int id PK
        int user_id FK
        varchar token_hash
        timestamp expires_at
    }

    units ||--o{ residents : "has"
    residents ||--o| auth_users : "login"
    residents ||--o{ guest_stays : "requests"
    residents ||--o{ resident_free_pass_months : "monthly passes"
    residents ||--o{ resident_pass_purchases : "bonus purchases"
    guests ||--o{ guest_stays : "visits"
    units ||--o{ guest_stays : "parked at"
    auth_users ||--o| staff : "profile"
    auth_users ||--o{ auth_password_resets : "resets"
```

---

## 3. Guest Parking Request - Complete Lifecycle

```mermaid
stateDiagram-v2
    [*] --> PENDING: Resident creates<br/>guest stay request

    PENDING --> BillingCalc: System calculates billing

    state BillingCalc <<choice>>
    BillingCalc --> APPROVED: amountCents = 0<br/>(free passes cover all nights)
    BillingCalc --> NEEDS_PAYMENT: amountCents > 0<br/>(billable nights remain)

    NEEDS_PAYMENT --> StripeCheckout: Resident/Guest<br/>initiates payment
    NEEDS_PAYMENT --> APPROVED: Admin bypasses<br/>payment
    NEEDS_PAYMENT --> CANCELLED: Resident cancels

    StripeCheckout --> APPROVED: Payment confirmed<br/>via Stripe webhook
    StripeCheckout --> NEEDS_PAYMENT: Payment cancelled/<br/>abandoned

    APPROVED --> [*]: Guest parks<br/>(permit downloadable)
    CANCELLED --> [*]: Request removed

    note right of PENDING
        Billing splits nights by month.
        Applies: guest vehicle pass,
        then bonus passes,
        then monthly buckets.
    end note

    note right of APPROVED
        Emails sent to guest + resident.
        Free pass buckets decremented.
        Permit generated with public token.
    end note
```

---

## 4. Authentication & Authorization Flow

```mermaid
sequenceDiagram
    actor U as User
    participant FE as Frontend
    participant MW as Middleware<br/>(proxy.ts)
    participant API as /api/auth/*
    participant TW as Twilio
    participant DB as PostgreSQL
    participant JWT as JWT Service

    Note over U,JWT: Registration Flow (Resident)
    U->>FE: Fill registration form
    FE->>API: POST /auth/send-verification {phone}
    API->>TW: Send OTP via Verify
    TW-->>U: SMS with 6-digit code
    U->>FE: Enter OTP + details
    FE->>API: POST /auth/register-resident
    API->>TW: Verify OTP code
    TW-->>API: verified
    API->>DB: Create unit (if needed)
    API->>DB: Create resident (status=PENDING)
    API->>DB: Create auth_user (role=resident)
    API->>JWT: Sign token {sub, email, role, residentId}
    API-->>FE: Set aura_token cookie
    FE->>MW: Redirect to /dashboard

    Note over U,JWT: Login Flow
    U->>FE: Enter email + password
    FE->>API: POST /auth/login
    API->>DB: Find auth_user by email
    API->>API: bcrypt.compare(password, hash)
    API->>JWT: Sign token (30d dev / 7d prod)
    API-->>FE: Set HTTP-only cookie
    FE->>MW: Navigate to protected route

    Note over U,JWT: Route Protection
    FE->>MW: Request /admin/dashboard
    MW->>MW: Extract aura_token cookie
    MW->>JWT: jwtVerify(token, secret)
    alt No token or invalid
        MW-->>FE: Redirect to /ops (login)
    else Wrong role
        MW-->>FE: Redirect to role's dashboard
    else Valid + correct role
        MW-->>FE: NextResponse.next()
    end
```

---

## 5. Payment & Billing Flow

```mermaid
sequenceDiagram
    actor R as Resident
    participant FE as Frontend
    participant GS as /api/guest-stays
    participant BL as billing.ts
    participant CS as /api/checkout-session
    participant ST as Stripe
    participant WH as /api/webhooks/stripe
    participant DB as PostgreSQL
    participant ML as Mailer

    R->>FE: Add guest (dates, plate, vehicle)
    FE->>GS: POST /api/guest-stays
    GS->>BL: calculateStayBilling(residentId, dates, plate)
    BL->>DB: Check guest_vehicle_free_pass
    BL->>DB: Get resident.bonus_free_nights
    BL->>DB: Get resident_free_pass_months (oldest first)
    BL->>BL: Apply: vehicle pass then bonus then monthly
    BL-->>GS: BillingResult {billableNights, amountCents}

    alt amountCents = 0
        GS->>DB: Insert stay (status=APPROVED)
        GS->>DB: Decrement free pass buckets
        GS->>ML: Send approval emails
        GS-->>FE: {status: APPROVED}
    else amountCents > 0
        GS->>DB: Insert stay (status=PENDING)
        GS-->>FE: {status: PENDING, billing}
        R->>FE: Click Pay Now
        FE->>CS: POST /api/checkout-session
        CS->>ST: Create checkout.session
        ST-->>CS: session_id
        CS-->>FE: {url, sessionId}
        FE->>FE: Open Stripe Checkout
        R->>ST: Complete payment
        ST->>WH: checkout.session.completed
        WH->>DB: Update stay to APPROVED
        WH->>DB: Decrement free passes
        WH->>BL: refreshPendingStayBilling()
        WH->>ML: Send approval emails
    end
```

---

## 6. Monthly Pass & Bundle Purchase Flow

```mermaid
sequenceDiagram
    participant CRON as Vercel Cron
    participant API as /api/cron/monthly-reset
    participant DB as PostgreSQL
    participant ML as Mailer
    actor R as Resident
    participant FE as Frontend
    participant CS as /api/checkout-session/bundle
    participant ST as Stripe
    participant WH as /api/webhooks/stripe
    participant BL as billing.ts

    Note over CRON,ML: Monthly Auto-Refill (1st of month)
    CRON->>API: POST /api/cron/monthly-reset
    API->>DB: Get all ACTIVE residents
    loop Each resident
        API->>DB: INSERT resident_free_pass_months<br/>(1 free night, ON CONFLICT DO NOTHING)
        API->>ML: Send monthly pass refill email
    end

    Note over R,BL: Bonus Pass Bundle Purchase
    R->>FE: Navigate to /dashboard/passes
    FE->>FE: Select bundle (e.g. 5 nights)
    R->>FE: Click purchase
    FE->>CS: POST /api/checkout-session/bundle
    CS->>ST: Create checkout session
    ST-->>FE: Redirect to Stripe
    R->>ST: Complete payment
    ST->>WH: checkout.session.completed
    WH->>DB: INSERT resident_pass_purchases<br/>(ON CONFLICT DO NOTHING)
    WH->>DB: UPDATE residents SET<br/>bonus_free_nights += purchased
    WH->>BL: refreshPendingStayBilling(residentId)
    Note over BL,DB: Recalculates all PENDING stays<br/>to reflect new pass balance
```

---

## 7. Middleware Routing Decision Tree

```mermaid
flowchart TD
    REQ[Incoming Request] --> EXTRACT[Extract aura_token cookie]
    EXTRACT --> VERIFY{JWT Valid?}

    VERIFY -->|Yes| ROUTE_CHECK{Which route?}
    VERIFY -->|No / Missing| UNAUTH_CHECK{Which route?}

    ROUTE_CHECK -->|Public auth page<br/>/, /login, /register, etc.| REDIRECT_DASH[Redirect to<br/>role dashboard]
    ROUTE_CHECK -->|/admin/*| ADMIN_CHECK{role = admin?}
    ROUTE_CHECK -->|/staff/*| STAFF_CHECK{role = staff?}
    ROUTE_CHECK -->|/dashboard/*| RES_CHECK{role = resident?}
    ROUTE_CHECK -->|/guest, /permit, /payment| PASS[Pass through]

    ADMIN_CHECK -->|Yes| PASS
    ADMIN_CHECK -->|No| REDIRECT_DASH
    STAFF_CHECK -->|Yes| PASS
    STAFF_CHECK -->|No| REDIRECT_DASH
    RES_CHECK -->|Yes| PASS
    RES_CHECK -->|No| REDIRECT_DASH

    UNAUTH_CHECK -->|Public auth page| PASS
    UNAUTH_CHECK -->|/admin/* or /staff/*| REDIRECT_OPS[Redirect to /ops]
    UNAUTH_CHECK -->|/dashboard/*| REDIRECT_LOGIN[Redirect to /login]
    UNAUTH_CHECK -->|/guest, /permit, /payment| PASS

    style REQ fill:#e3f2fd
    style PASS fill:#e8f5e9
    style REDIRECT_DASH fill:#fff3e0
    style REDIRECT_OPS fill:#fce4ec
    style REDIRECT_LOGIN fill:#fce4ec
```

---

## 8. Billing Calculation - Pass Consumption Order

```mermaid
flowchart TD
    START[Calculate Stay Billing] --> SPLIT[Split nights by month<br/>via splitNightsByMonth]
    SPLIT --> TOTAL[Sum total nights]

    TOTAL --> GFP{Guest vehicle<br/>has free pass?}
    GFP -->|Yes and unused| APPLY_GFP[Apply 1 guest<br/>vehicle free night]
    GFP -->|No| BONUS

    APPLY_GFP --> CHECK1{totalNights = 1<br/>and GFP applied?}
    CHECK1 -->|Yes| FREE[amountCents = 0<br/>Fully covered]
    CHECK1 -->|No| BONUS

    BONUS[Check resident<br/>bonus_free_nights] --> APPLY_BONUS[Apply min of<br/>remaining nights, bonus available]
    APPLY_BONUS --> MONTHLY

    MONTHLY[Load ALL monthly buckets<br/>oldest first] --> LOOP[For each month chunk]
    LOOP --> COVERED[Subtract already-covered<br/>nights from chunk]
    COVERED --> CONSUME[Consume from global<br/>pass pool oldest to newest]
    CONSUME --> CALC[billable = chunk - covered - freeApplied]
    CALC --> MORE{More months?}
    MORE -->|Yes| LOOP
    MORE -->|No| RESULT["amountCents =<br/>billableNights x $5.00"]

    style FREE fill:#e8f5e9
    style RESULT fill:#fff3e0
```

---

## 9. Zustand State Management Flow

```mermaid
flowchart LR
    subgraph Components["React Components"]
        LOGIN[Login Page]
        DASH[Dashboard]
        GLIST[Guest List]
        GFORM[Add Guest Form]
        VLIST[Vehicle List]
        VFORM[Report Vehicle]
    end

    subgraph Stores["Zustand Stores"]
        AUTH[authStore<br/>session, role<br/>initialized]
        GUEST[guestStore<br/>guests, freePass<br/>search, pagination]
        PARK[parkingStore<br/>vehicles<br/>activeTab, search]
    end

    subgraph APILayer["API Layer (lib/api.ts)"]
        FETCH["apiFetch&lt;T&gt;<br/>credentials: include<br/>error handling"]
    end

    LOGIN -->|login| AUTH
    DASH -->|initialize| AUTH
    GLIST -->|fetchGuests| GUEST
    GFORM -->|addGuest| GUEST
    VLIST -->|fetchVehicles| PARK
    VFORM -->|addUnauthorized| PARK

    AUTH -->|GET /auth/me| FETCH
    GUEST -->|GET/POST /guest-stays| FETCH
    PARK -->|GET/POST /unauthorized-vehicles| FETCH

    FETCH -->|HTTP + JWT cookie| SERVER[Next.js API Routes]

    style Components fill:#e3f2fd
    style Stores fill:#f3e5f5
    style APILayer fill:#fff3e0
```

---

## 10. Public Guest Request Flow

```mermaid
sequenceDiagram
    actor G as Guest
    participant PUB as /guest page
    participant API as API Routes
    participant DB as PostgreSQL
    participant ST as Stripe
    participant ML as Mailer

    G->>PUB: Visit /guest
    PUB->>PUB: Step 1 - Verify Resident
    G->>PUB: Enter resident email or unit + name
    PUB->>API: POST /api/verify-resident
    API->>DB: Lookup resident by email or unit
    API-->>PUB: {resident, unit} or error

    PUB->>PUB: Step 2 - Enter Guest Details
    G->>PUB: Fill name, email, plate, vehicle, dates
    PUB->>API: POST /api/guest-stays (public)
    API->>DB: Create guest + guest_stay (PENDING)
    API->>ML: Email resident about new request
    API->>ML: Email guest confirmation
    API-->>PUB: {stayId, status}

    PUB->>PUB: Step 3 - Confirmation
    alt Needs payment
        G->>PUB: Click Pay Now
        PUB->>API: POST /api/checkout-session/public
        API->>ST: Create checkout session
        ST-->>PUB: Redirect to payment
        G->>ST: Complete payment
        ST->>API: Webhook - payment complete
        API->>DB: Update stay APPROVED
        API->>ML: Send approval emails
    else No payment needed
        PUB->>PUB: Show confirmation with permit link
    end
```

---

## 11. API Endpoints Summary

### Authentication (11 endpoints)
| Method | Endpoint | Description |
|--------|----------|-------------|
| POST | `/api/auth/login` | Login, set JWT cookie |
| POST | `/api/auth/register-resident` | Register resident (email + Twilio OTP) |
| POST | `/api/auth/register-admin` | Register admin user |
| POST | `/api/auth/register-staff` | Register staff user |
| POST | `/api/auth/logout` | Logout, clear cookie |
| GET | `/api/auth/me` | Get current user session |
| POST | `/api/auth/change-password` | Change password |
| POST | `/api/auth/forgot-password` | Request password reset email |
| POST | `/api/auth/forgot-password-phone` | Request reset via SMS |
| POST | `/api/auth/reset-password` | Reset password with token |
| POST | `/api/auth/send-verification` | Send OTP via Twilio |

### Admin (10 endpoints)
| Method | Endpoint | Description |
|--------|----------|-------------|
| GET | `/api/admin/counts` | Dashboard statistics |
| GET | `/api/admin/units` | List all units |
| POST | `/api/admin/units` | Create unit |
| GET | `/api/admin/units/[id]` | Get unit details |
| PATCH | `/api/admin/units/[id]` | Update unit |
| GET | `/api/admin/users` | List admin/staff users |
| POST | `/api/admin/users` | Create user |
| GET | `/api/admin/users/[id]` | Get user details |
| PATCH | `/api/admin/users/[id]` | Update user |
| POST | `/api/admin/users/[id]/activate` | Activate pending user |

### Residents (8 endpoints)
| Method | Endpoint | Description |
|--------|----------|-------------|
| GET | `/api/residents` | List all residents |
| POST | `/api/residents` | Create resident |
| GET | `/api/residents/[id]` | Get resident details |
| PATCH | `/api/residents/[id]` | Update resident |
| DELETE | `/api/residents/[id]` | Delete resident |
| GET | `/api/residents/[id]/guest-stays` | Get resident's guest stays |
| GET | `/api/residents/[id]/pass-balance` | Get pass balance |
| GET | `/api/residents/[id]/free-pass-months` | Get monthly pass buckets |

### Guest Stays (9 endpoints)
| Method | Endpoint | Description |
|--------|----------|-------------|
| GET | `/api/guest-stays` | List guest stays with filters |
| POST | `/api/guest-stays` | Create guest stay |
| GET | `/api/guest-stays/[id]` | Get stay details |
| PATCH | `/api/guest-stays/[id]` | Update stay |
| DELETE | `/api/guest-stays/[id]` | Delete/cancel stay |
| POST | `/api/guest-stays/[id]/approve` | Approve stay |
| POST | `/api/guest-stays/[id]/admin-bypass-payment` | Admin bypass payment |
| GET | `/api/guest-stays/[id]/permit` | Get permit data |
| GET | `/api/guest-stays/[id]/payment-info` | Get payment details |

### Checkout & Payments (5 endpoints)
| Method | Endpoint | Description |
|--------|----------|-------------|
| POST | `/api/checkout-session` | Create Stripe checkout |
| GET | `/api/checkout-session/[id]` | Get session status |
| POST | `/api/checkout-session/bundle` | Create pass bundle checkout |
| POST | `/api/checkout-session/public` | Create public guest checkout |
| POST | `/api/webhooks/stripe` | Stripe webhook handler |

### Vehicles & Other (8 endpoints)
| Method | Endpoint | Description |
|--------|----------|-------------|
| GET | `/api/unauthorized-vehicles` | List violations |
| POST | `/api/unauthorized-vehicles` | Report vehicle |
| GET | `/api/unauthorized-vehicles/[id]` | Get violation details |
| DELETE | `/api/unauthorized-vehicles/[id]` | Delete violation |
| PATCH | `/api/unauthorized-vehicles/[id]/resolve` | Resolve violation |
| GET | `/api/guest-vehicle-free-pass/[plate]` | Check plate free pass |
| POST | `/api/verify-resident` | Verify resident for guest form |
| POST | `/api/cron/monthly-reset` | Monthly pass allocation |

---

## 12. Security Summary

| Feature | Implementation |
|---------|---------------|
| **Authentication** | JWT in HTTP-only cookies (jose + jsonwebtoken) |
| **Password Storage** | bcryptjs with salt rounds |
| **Phone Verification** | Twilio Verify OTP |
| **Route Protection** | Middleware role-based gating (proxy.ts) |
| **Rate Limiting** | In-memory sliding window (5 login/15min, 3 SMS/10min) |
| **SQL Injection** | Named parameterized queries via dbQuery |
| **Password Reset** | SHA-256 hashed tokens with expiry |
| **CSP Headers** | Content Security Policy in next.config.ts |
| **Idempotency** | ON CONFLICT DO NOTHING for Stripe webhooks |
| **Token Expiry** | 7 days (prod) / 30 days (dev) |
