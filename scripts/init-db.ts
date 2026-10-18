import pg from "pg";
import bcrypt from "bcryptjs";
import dotenv from "dotenv";

dotenv.config({ path: ".env.local" });

const { Pool } = pg;

function getArgValue(flag: string): string | null {
  const idx = process.argv.indexOf(flag);
  if (idx === -1) return null;
  return process.argv[idx + 1] || null;
}

async function main() {
  if (!process.env.DATABASE_URL) {
    throw new Error("Missing DATABASE_URL in .env.local");
  }

  const pool = new Pool({
    connectionString: process.env.DATABASE_URL,
    ssl: { rejectUnauthorized: false },
  });

  const isFresh = process.argv.includes("--fresh");

  const seedPassword =
    getArgValue("--password") || getArgValue("-p") || process.env.SEED_ADMIN_PASSWORD;
  if (!seedPassword) throw new Error("Provide --password or set SEED_ADMIN_PASSWORD");

  if (isFresh) {
    console.log("Dropping all tables (--fresh)...");
    await pool.query(`
      DROP TABLE IF EXISTS resident_pass_purchases CASCADE;
      DROP TABLE IF EXISTS unauthorized_vehicles CASCADE;
      DROP TABLE IF EXISTS guest_vehicle_free_pass CASCADE;
      DROP TABLE IF EXISTS auth_password_resets CASCADE;
      DROP TABLE IF EXISTS staff CASCADE;
      DROP TABLE IF EXISTS resident_free_pass_months CASCADE;
      DROP TABLE IF EXISTS guest_stays CASCADE;
      DROP TABLE IF EXISTS guests CASCADE;
      DROP TABLE IF EXISTS auth_users CASCADE;
      DROP TABLE IF EXISTS residents CASCADE;
      DROP TABLE IF EXISTS units CASCADE;
    `);
  }

  // Trigger function for updated_at
  await pool.query(`
    CREATE OR REPLACE FUNCTION update_updated_at_column()
    RETURNS TRIGGER AS $$
    BEGIN
      NEW.updated_at = NOW();
      RETURN NEW;
    END;
    $$ LANGUAGE plpgsql;
  `);

  // Create tables
  await pool.query(`
    CREATE TABLE IF NOT EXISTS units (
      id BIGSERIAL PRIMARY KEY,
      building_code VARCHAR(32) NULL,
      unit_number VARCHAR(32) NOT NULL UNIQUE,
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    );
  `);

  await pool.query(`
    CREATE TABLE IF NOT EXISTS residents (
      id BIGSERIAL PRIMARY KEY,
      unit_id BIGINT NOT NULL REFERENCES units(id) ON DELETE CASCADE,
      full_name VARCHAR(120) NOT NULL,
      email VARCHAR(255) NOT NULL UNIQUE,
      phone VARCHAR(40) NULL UNIQUE,
      status VARCHAR(20) NOT NULL DEFAULT 'ACTIVE',
      is_primary_contact BOOLEAN NOT NULL DEFAULT TRUE,
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    );
  `);
  await pool.query(`CREATE INDEX IF NOT EXISTS idx_residents_unit_id ON residents(unit_id);`);
  await pool.query(`CREATE INDEX IF NOT EXISTS idx_residents_status ON residents(status);`);

  await pool.query(`
    CREATE TABLE IF NOT EXISTS guests (
      id BIGSERIAL PRIMARY KEY,
      full_name VARCHAR(120) NOT NULL,
      email VARCHAR(255) NULL,
      phone VARCHAR(40) NULL,
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    );
  `);
  await pool.query(`CREATE INDEX IF NOT EXISTS idx_guests_email ON guests(email);`);

  await pool.query(`
    CREATE TABLE IF NOT EXISTS guest_stays (
      id BIGSERIAL PRIMARY KEY,
      unit_id BIGINT NOT NULL REFERENCES units(id) ON DELETE CASCADE,
      guest_id BIGINT NOT NULL REFERENCES guests(id) ON DELETE CASCADE,
      plate_number VARCHAR(32) NOT NULL,
      vehicle_plate VARCHAR(64) NULL,
      vehicle_desc VARCHAR(255) NULL,
      start_date DATE NOT NULL,
      end_date DATE NOT NULL,
      status VARCHAR(20) NOT NULL DEFAULT 'pending',
      requested_by_resident_id INTEGER NULL,
      created_by_user_id INTEGER NULL,
      approved_at TIMESTAMPTZ NULL,
      passes_applied INTEGER NOT NULL DEFAULT 0,
      guest_free_pass_nights INTEGER NOT NULL DEFAULT 0,
      billable_nights INTEGER NOT NULL DEFAULT 0,
      amount_cents INTEGER NOT NULL DEFAULT 0,
      currency VARCHAR(8) NOT NULL DEFAULT 'usd',
      stripe_session_id VARCHAR(255) NULL,
      admin_bypass_note VARCHAR(255) NULL,
      public_token VARCHAR(64) NULL UNIQUE,
      resident_email_status VARCHAR(16) NULL,
      resident_email_error TEXT NULL,
      guest_email_status VARCHAR(16) NULL,
      guest_email_error TEXT NULL,
      email_last_attempt_at TIMESTAMPTZ NULL,
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    );
  `);
  await pool.query(`CREATE INDEX IF NOT EXISTS idx_guest_stays_unit_id ON guest_stays(unit_id);`);
  await pool.query(`CREATE INDEX IF NOT EXISTS idx_guest_stays_guest_id ON guest_stays(guest_id);`);
  await pool.query(`CREATE INDEX IF NOT EXISTS idx_guest_stays_plate ON guest_stays(plate_number);`);
  await pool.query(`CREATE INDEX IF NOT EXISTS idx_guest_stays_dates ON guest_stays(start_date, end_date);`);
  await pool.query(`CREATE INDEX IF NOT EXISTS idx_guest_stays_status ON guest_stays(status);`);
  await pool.query(`CREATE INDEX IF NOT EXISTS idx_guest_stays_resident ON guest_stays(requested_by_resident_id);`);
  await pool.query(`CREATE INDEX IF NOT EXISTS idx_guest_stays_status_dates ON guest_stays(status, start_date, end_date);`);
  await pool.query(`CREATE INDEX IF NOT EXISTS idx_guest_stays_stripe ON guest_stays(stripe_session_id) WHERE stripe_session_id IS NOT NULL;`);
  await pool.query(`ALTER TABLE guest_stays ADD COLUMN IF NOT EXISTS created_by_user_id INTEGER NULL;`);
  await pool.query(`CREATE INDEX IF NOT EXISTS idx_guest_stays_created_by ON guest_stays(created_by_user_id) WHERE created_by_user_id IS NOT NULL;`);

  await pool.query(`
    CREATE TABLE IF NOT EXISTS resident_free_pass_months (
      id BIGSERIAL PRIMARY KEY,
      resident_id BIGINT NOT NULL REFERENCES residents(id) ON DELETE CASCADE,
      month_start DATE NOT NULL,
      free_nights_total INTEGER NOT NULL DEFAULT 1,
      free_nights_used INTEGER NOT NULL DEFAULT 0,
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      UNIQUE (resident_id, month_start)
    );
  `);
  await pool.query(`CREATE INDEX IF NOT EXISTS idx_resident_month ON resident_free_pass_months(resident_id, month_start);`);

  await pool.query(`
    CREATE TABLE IF NOT EXISTS auth_users (
      id BIGSERIAL PRIMARY KEY,
      resident_id BIGINT NULL REFERENCES residents(id) ON DELETE SET NULL,
      email VARCHAR(255) NOT NULL UNIQUE,
      password_hash VARCHAR(255) NOT NULL,
      role VARCHAR(20) NOT NULL DEFAULT 'resident',
      status VARCHAR(20) NOT NULL DEFAULT 'ACTIVE',
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    );
  `);
  await pool.query(`CREATE INDEX IF NOT EXISTS idx_auth_users_resident_id ON auth_users(resident_id);`);
  await pool.query(`CREATE INDEX IF NOT EXISTS idx_auth_users_role_status ON auth_users(role, status);`);

  await pool.query(`
    CREATE TABLE IF NOT EXISTS auth_password_resets (
      id BIGSERIAL PRIMARY KEY,
      user_id BIGINT NOT NULL REFERENCES auth_users(id) ON DELETE CASCADE,
      reset_token_hash CHAR(64) NOT NULL UNIQUE,
      expires_at TIMESTAMPTZ NOT NULL,
      used_at TIMESTAMPTZ NULL,
      ip VARCHAR(64) NULL,
      user_agent VARCHAR(255) NULL,
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    );
  `);
  await pool.query(`CREATE INDEX IF NOT EXISTS idx_resets_user_id ON auth_password_resets(user_id);`);
  await pool.query(`CREATE INDEX IF NOT EXISTS idx_resets_expires ON auth_password_resets(expires_at);`);

  await pool.query(`
    CREATE TABLE IF NOT EXISTS staff (
      id BIGSERIAL PRIMARY KEY,
      auth_user_id BIGINT NOT NULL REFERENCES auth_users(id) ON DELETE CASCADE,
      full_name VARCHAR(120) NOT NULL,
      email VARCHAR(255) NOT NULL UNIQUE,
      role VARCHAR(100) NULL DEFAULT 'staff',
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    );
  `);
  await pool.query(`CREATE INDEX IF NOT EXISTS idx_staff_auth_user_id ON staff(auth_user_id);`);

  await pool.query(`
    CREATE TABLE IF NOT EXISTS guest_vehicle_free_pass (
      id BIGSERIAL PRIMARY KEY,
      plate_number VARCHAR(32) NOT NULL UNIQUE,
      free_pass SMALLINT NOT NULL DEFAULT 1,
      used BOOLEAN NOT NULL DEFAULT FALSE,
      guest_stay_id BIGINT NULL,
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    );
  `);
  await pool.query(`CREATE INDEX IF NOT EXISTS idx_plate_used ON guest_vehicle_free_pass(plate_number, used);`);

  await pool.query(`
    CREATE TABLE IF NOT EXISTS unauthorized_vehicles (
      id BIGSERIAL PRIMARY KEY,
      plate_number VARCHAR(32) NOT NULL,
      vehicle_make VARCHAR(100) NULL,
      vehicle_color VARCHAR(40) NULL,
      violation_note TEXT NULL,
      image_url VARCHAR(512) NULL,
      spotted_date DATE NOT NULL,
      spotted_location VARCHAR(255) NULL,
      recommended_action VARCHAR(100) NOT NULL DEFAULT 'warn',
      resolved BOOLEAN NOT NULL DEFAULT FALSE,
      reported_by BIGINT NULL REFERENCES auth_users(id) ON DELETE SET NULL,
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    );
  `);
  await pool.query(`CREATE INDEX IF NOT EXISTS idx_unauthorized_plate ON unauthorized_vehicles(plate_number);`);
  await pool.query(`CREATE INDEX IF NOT EXISTS idx_unauthorized_spotted_date ON unauthorized_vehicles(spotted_date);`);
  await pool.query(`CREATE INDEX IF NOT EXISTS idx_unauthorized_resolved ON unauthorized_vehicles(resolved);`);
  await pool.query(`CREATE INDEX IF NOT EXISTS idx_unauthorized_reported_by ON unauthorized_vehicles(reported_by);`);

  // Bonus pass purchases
  await pool.query(`ALTER TABLE residents ADD COLUMN IF NOT EXISTS bonus_free_nights INTEGER NOT NULL DEFAULT 0;`);

  await pool.query(`
    CREATE TABLE IF NOT EXISTS resident_pass_purchases (
      id BIGSERIAL PRIMARY KEY,
      resident_id BIGINT NOT NULL REFERENCES residents(id) ON DELETE CASCADE,
      stripe_session_id VARCHAR(255) NOT NULL UNIQUE,
      bundle_type VARCHAR(20) NOT NULL,
      pass_count INTEGER NOT NULL,
      amount_cents INTEGER NOT NULL,
      applied_at TIMESTAMPTZ NULL,
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    );
  `);
  await pool.query(`CREATE INDEX IF NOT EXISTS idx_pass_purchases_resident ON resident_pass_purchases(resident_id);`);

  // Create updated_at triggers for all tables with updated_at
  const tablesWithUpdatedAt = [
    "units", "residents", "guests", "guest_stays", "resident_free_pass_months",
    "auth_users", "staff", "guest_vehicle_free_pass", "unauthorized_vehicles",
  ];
  for (const table of tablesWithUpdatedAt) {
    await pool.query(`
      DROP TRIGGER IF EXISTS trg_${table}_updated_at ON ${table};
      CREATE TRIGGER trg_${table}_updated_at
        BEFORE UPDATE ON ${table}
        FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();
    `);
  }

  // Seed accounts — 1 admin, 1 staff, 1 resident
  const passwordHash = await bcrypt.hash(seedPassword, 10);

  // 1. Admin
  const adminAuth = await pool.query(
    `INSERT INTO auth_users (resident_id, email, password_hash, role, status)
     VALUES (NULL, 'admin@example.com', $1, 'admin', 'ACTIVE')
     ON CONFLICT (email) DO UPDATE SET password_hash = EXCLUDED.password_hash, role = 'admin', status = 'ACTIVE', updated_at = NOW()
     RETURNING id`,
    [passwordHash]
  );
  await pool.query(
    `INSERT INTO staff (auth_user_id, full_name, email, role)
     VALUES ($1, 'Admin User', 'admin@example.com', 'admin')
     ON CONFLICT (email) DO UPDATE SET full_name = EXCLUDED.full_name, role = 'admin', updated_at = NOW()`,
    [adminAuth.rows[0].id]
  );

  // 2. Staff
  const staffAuth = await pool.query(
    `INSERT INTO auth_users (resident_id, email, password_hash, role, status)
     VALUES (NULL, 'staff@example.com', $1, 'staff', 'ACTIVE')
     ON CONFLICT (email) DO UPDATE SET password_hash = EXCLUDED.password_hash, role = 'staff', status = 'ACTIVE', updated_at = NOW()
     RETURNING id`,
    [passwordHash]
  );
  await pool.query(
    `INSERT INTO staff (auth_user_id, full_name, email, role)
     VALUES ($1, 'Staff User', 'staff@example.com', 'staff')
     ON CONFLICT (email) DO UPDATE SET full_name = EXCLUDED.full_name, role = 'staff', updated_at = NOW()`,
    [staffAuth.rows[0].id]
  );

  // 3. Resident — needs a unit first
  const unitResult = await pool.query(
    `INSERT INTO units (building_code, unit_number)
     VALUES ('A', '1001')
     ON CONFLICT (unit_number) DO UPDATE SET building_code = EXCLUDED.building_code
     RETURNING id`
  );
  const unitId = unitResult.rows[0].id;

  const residentResult = await pool.query(
    `INSERT INTO residents (unit_id, full_name, email, phone, status, is_primary_contact)
     VALUES ($1, 'Resident User', 'r01@example.com', NULL, 'ACTIVE', TRUE)
     ON CONFLICT (email) DO UPDATE SET full_name = EXCLUDED.full_name, unit_id = EXCLUDED.unit_id, status = 'ACTIVE'
     RETURNING id`,
    [unitId]
  );
  const residentId = residentResult.rows[0].id;

  await pool.query(
    `INSERT INTO auth_users (resident_id, email, password_hash, role, status)
     VALUES ($1, 'r01@example.com', $2, 'resident', 'ACTIVE')
     ON CONFLICT (email) DO UPDATE SET password_hash = EXCLUDED.password_hash, resident_id = EXCLUDED.resident_id, role = 'resident', status = 'ACTIVE', updated_at = NOW()`,
    [residentId, passwordHash]
  );

  // ─── Additional realistic seed data ───────────────────────────────

  // Helper: upsert unit and return id
  async function upsertUnit(building: string, number: string) {
    const r = await pool.query(
      `INSERT INTO units (building_code, unit_number)
       VALUES ($1, $2)
       ON CONFLICT (unit_number) DO UPDATE SET building_code = EXCLUDED.building_code
       RETURNING id`,
      [building, number]
    );
    return Number(r.rows[0].id);
  }

  // Helper: upsert resident and return id
  async function upsertResident(
    unitId: number, name: string, email: string,
    phone: string | null, status: string, isPrimary: boolean
  ) {
    const r = await pool.query(
      `INSERT INTO residents (unit_id, full_name, email, phone, status, is_primary_contact)
       VALUES ($1, $2, $3, $4, $5, $6)
       ON CONFLICT (email) DO UPDATE SET full_name = EXCLUDED.full_name, unit_id = EXCLUDED.unit_id, status = EXCLUDED.status
       RETURNING id`,
      [unitId, name, email, phone, status, isPrimary]
    );
    return Number(r.rows[0].id);
  }

  // Helper: upsert auth user for resident
  async function upsertResidentAuth(resId: number, email: string) {
    await pool.query(
      `INSERT INTO auth_users (resident_id, email, password_hash, role, status)
       VALUES ($1, $2, $3, 'resident', 'ACTIVE')
       ON CONFLICT (email) DO UPDATE SET password_hash = EXCLUDED.password_hash, resident_id = EXCLUDED.resident_id, status = 'ACTIVE'`,
      [resId, email, passwordHash]
    );
  }

  // Helper: insert guest and return id
  async function insertGuest(name: string, email: string | null, phone: string | null) {
    const r = await pool.query(
      `INSERT INTO guests (full_name, email, phone) VALUES ($1, $2, $3) RETURNING id`,
      [name, email, phone]
    );
    return Number(r.rows[0].id);
  }

  console.log("Seeding additional realistic data...");

  // ── Units (4-digit: Building(1-3) + Floor(0-3) + Unit(01-04)) ──
  const u102 = await upsertUnit("A", "1002");
  const u103 = await upsertUnit("A", "1003");
  const u104 = await upsertUnit("A", "1004");
  const u105 = await upsertUnit("A", "1005");
  const u201 = await upsertUnit("B", "2001");
  const u202 = await upsertUnit("B", "2002");
  const u203 = await upsertUnit("B", "2003");
  const u204 = await upsertUnit("B", "2004");
  const u301 = await upsertUnit("C", "3001");
  const u302 = await upsertUnit("C", "3002");
  const u303 = await upsertUnit("C", "3003");

  // ── Residents ──
  const rMaria   = await upsertResident(u102, "Maria Santos",      "maria.santos@email.com",    "+15551020001", "ACTIVE", true);
  const rJames   = await upsertResident(u103, "James Wilson",      "james.wilson@email.com",    "+15551030001", "ACTIVE", true);
  const rAisha   = await upsertResident(u104, "Aisha Patel",       "aisha.patel@email.com",     "+15551040001", "ACTIVE", true);
  const rDavid   = await upsertResident(u105, "David Kim",         "david.kim@email.com",       "+15551050001", "ACTIVE", true);
  const rSarah   = await upsertResident(u201, "Sarah Johnson",     "sarah.johnson@email.com",   "+15552010001", "ACTIVE", true);
  const rMarcus  = await upsertResident(u202, "Marcus Thompson",   "marcus.thompson@email.com", "+15552020001", "ACTIVE", true);
  const rElena   = await upsertResident(u203, "Elena Rodriguez",   "elena.rodriguez@email.com", "+15552030001", "INACTIVE", true);
  const rRyan    = await upsertResident(u301, "Ryan O'Brien",      "ryan.obrien@email.com",     "+15553010001", "ACTIVE", true);
  const rFatima  = await upsertResident(u302, "Fatima Al-Hassan",  "fatima.alhassan@email.com", "+15553020001", "ACTIVE", true);

  // Auth users for new residents
  await upsertResidentAuth(rMaria,  "maria.santos@email.com");
  await upsertResidentAuth(rJames,  "james.wilson@email.com");
  await upsertResidentAuth(rAisha,  "aisha.patel@email.com");
  await upsertResidentAuth(rDavid,  "david.kim@email.com");
  await upsertResidentAuth(rSarah,  "sarah.johnson@email.com");
  await upsertResidentAuth(rMarcus, "marcus.thompson@email.com");
  await upsertResidentAuth(rElena,  "elena.rodriguez@email.com");
  await upsertResidentAuth(rRyan,   "ryan.obrien@email.com");
  await upsertResidentAuth(rFatima, "fatima.alhassan@email.com");

  // ── Additional staff ──
  const staff2Auth = await pool.query(
    `INSERT INTO auth_users (resident_id, email, password_hash, role, status)
     VALUES (NULL, 'patrol@example.com', $1, 'staff', 'ACTIVE')
     ON CONFLICT (email) DO UPDATE SET password_hash = EXCLUDED.password_hash, status = 'ACTIVE'
     RETURNING id`,
    [passwordHash]
  );
  await pool.query(
    `INSERT INTO staff (auth_user_id, full_name, email, role)
     VALUES ($1, 'Mike Patrol', 'patrol@example.com', 'staff')
     ON CONFLICT (email) DO UPDATE SET full_name = EXCLUDED.full_name`,
    [staff2Auth.rows[0].id]
  );

  // Inactive admin (for testing activate flow)
  await pool.query(
    `INSERT INTO auth_users (resident_id, email, password_hash, role, status)
     VALUES (NULL, 'admin2@example.com', $1, 'admin', 'INACTIVE')
     ON CONFLICT (email) DO UPDATE SET status = 'INACTIVE'`,
    [passwordHash]
  );

  // ── Guests ──
  const gTony     = await insertGuest("Tony Martinez",   "tony.m@example.com",    "+15559001001");
  const gCarlos   = await insertGuest("Carlos Reyes",    "carlos.r@example.com",  "+15559001002");
  const gLinda    = await insertGuest("Linda Park",      "linda.park@yahoo.com", null);
  const gMikeChen = await insertGuest("Mike Chen",       "mike.chen@example.com", "+15559001004");
  const gEmma     = await insertGuest("Emma Williams",   "emma.w@outlook.com",  null);
  const gAlex     = await insertGuest("Alex Turner",     null,                  "+15559001006");
  const gPreeti   = await insertGuest("Preeti Sharma",   "preeti.s@example.com",  "+15559001007");
  const gJamie    = await insertGuest("Jamie O'Connor",  "jamie.oc@example.com",  null);
  const gNadia    = await insertGuest("Nadia Hassan",    "nadia.h@email.com",   "+15559001009");
  const gBen      = await insertGuest("Ben Foster",      "ben.foster@email.com", null);
  const gSophia   = await insertGuest("Sophia Lee",      "sophia.lee@example.com", "+15559001011");
  const gDaniel   = await insertGuest("Daniel Brown",    null,                  "+15559001012");
  const gRachel   = await insertGuest("Rachel Green",    "rachel.g@email.com",  null);
  const gOmar     = await insertGuest("Omar Farouk",     "omar.f@outlook.com",  "+15559001014");
  const gKelly    = await insertGuest("Kelly Wang",      "kelly.w@example.com",   null);

  // ── Guest Stays ──
  // Uses SQL date arithmetic so data is always relative to today

  // 1. Active stay — Tony visiting Resident User (Unit 1001), currently here, approved+paid
  await pool.query(
    `INSERT INTO guest_stays (unit_id, guest_id, plate_number, vehicle_plate, vehicle_desc,
       start_date, end_date, status, requested_by_resident_id, approved_at,
       passes_applied, billable_nights, amount_cents)
     VALUES ($1, $2, 'ABC1234', 'ABC-1234', '2022 Toyota Camry Silver',
       CURRENT_DATE - INTERVAL '1 day', CURRENT_DATE + INTERVAL '2 days', 'PAID', $3, NOW(),
       1, 2, 1000)`,
    [unitId, gTony, residentId]
  );

  // 2. Active stay — Carlos visiting Maria (Unit 1002), approved
  await pool.query(
    `INSERT INTO guest_stays (unit_id, guest_id, plate_number, vehicle_plate, vehicle_desc,
       start_date, end_date, status, requested_by_resident_id, approved_at,
       passes_applied, billable_nights, amount_cents)
     VALUES ($1, $2, 'XYZ5678', 'XYZ-5678', '2023 Honda Civic Black',
       CURRENT_DATE, CURRENT_DATE + INTERVAL '3 days', 'APPROVED', $3, NOW(),
       0, 4, 2000)`,
    [u102, gCarlos, rMaria]
  );

  // 3. Active stay — Linda visiting James (Unit 1003), needs payment
  await pool.query(
    `INSERT INTO guest_stays (unit_id, guest_id, plate_number, vehicle_plate, vehicle_desc,
       start_date, end_date, status, requested_by_resident_id, approved_at,
       passes_applied, billable_nights, amount_cents)
     VALUES ($1, $2, 'LPK9012', 'LPK-9012', '2021 Nissan Altima White',
       CURRENT_DATE - INTERVAL '2 days', CURRENT_DATE + INTERVAL '1 day', 'NEEDS_PAYMENT', $3, NOW(),
       1, 3, 1500)`,
    [u103, gLinda, rJames]
  );

  // 4. Upcoming stay — Mike Chen visiting Aisha (Unit 1004), approved
  await pool.query(
    `INSERT INTO guest_stays (unit_id, guest_id, plate_number, vehicle_plate, vehicle_desc,
       start_date, end_date, status, requested_by_resident_id, approved_at,
       passes_applied, billable_nights, amount_cents)
     VALUES ($1, $2, 'MCH3456', 'MCH-3456', '2024 Tesla Model 3 Red',
       CURRENT_DATE + INTERVAL '3 days', CURRENT_DATE + INTERVAL '5 days', 'APPROVED', $3, NOW(),
       0, 3, 1500)`,
    [u104, gMikeChen, rAisha]
  );

  // 5. Upcoming stay — Emma visiting David (Unit 1005), pending approval
  await pool.query(
    `INSERT INTO guest_stays (unit_id, guest_id, plate_number, vehicle_plate, vehicle_desc,
       start_date, end_date, status, requested_by_resident_id,
       passes_applied, billable_nights, amount_cents)
     VALUES ($1, $2, 'EMW7890', 'EMW-7890', '2020 Subaru Outback Blue',
       CURRENT_DATE + INTERVAL '5 days', CURRENT_DATE + INTERVAL '7 days', 'PENDING', $3,
       0, 0, 0)`,
    [u105, gEmma, rDavid]
  );

  // 6. Past stay — Alex visited Sarah (Unit 2001), paid
  await pool.query(
    `INSERT INTO guest_stays (unit_id, guest_id, plate_number, vehicle_plate, vehicle_desc,
       start_date, end_date, status, requested_by_resident_id, approved_at,
       passes_applied, billable_nights, amount_cents)
     VALUES ($1, $2, 'ALT1122', 'ALT-1122', '2019 Ford F-150 Gray',
       CURRENT_DATE - INTERVAL '14 days', CURRENT_DATE - INTERVAL '11 days', 'PAID', $3, NOW() - INTERVAL '14 days',
       1, 3, 1500)`,
    [u201, gAlex, rSarah]
  );

  // 7. Past stay — Preeti visited Marcus (Unit 2002), paid
  await pool.query(
    `INSERT INTO guest_stays (unit_id, guest_id, plate_number, vehicle_plate, vehicle_desc,
       start_date, end_date, status, requested_by_resident_id, approved_at,
       passes_applied, billable_nights, amount_cents)
     VALUES ($1, $2, 'PRS3344', 'PRS-3344', '2023 Mazda CX-5 Pearl White',
       CURRENT_DATE - INTERVAL '10 days', CURRENT_DATE - INTERVAL '7 days', 'PAID', $3, NOW() - INTERVAL '10 days',
       0, 4, 2000)`,
    [u202, gPreeti, rMarcus]
  );

  // 8. Cancelled stay — Jamie was going to visit Ryan (Unit 3001)
  await pool.query(
    `INSERT INTO guest_stays (unit_id, guest_id, plate_number, vehicle_plate, vehicle_desc,
       start_date, end_date, status, requested_by_resident_id,
       passes_applied, billable_nights, amount_cents)
     VALUES ($1, $2, 'JOC5566', 'JOC-5566', '2022 Chevy Malibu Black',
       CURRENT_DATE + INTERVAL '1 day', CURRENT_DATE + INTERVAL '3 days', 'CANCELLED', $3,
       0, 0, 0)`,
    [u301, gJamie, rRyan]
  );

  // 9. Active stay — Nadia visiting Fatima (Unit 3002), paid
  await pool.query(
    `INSERT INTO guest_stays (unit_id, guest_id, plate_number, vehicle_plate, vehicle_desc,
       start_date, end_date, status, requested_by_resident_id, approved_at,
       passes_applied, billable_nights, amount_cents)
     VALUES ($1, $2, 'NAH7788', 'NAH-7788', '2024 Hyundai Tucson Green',
       CURRENT_DATE - INTERVAL '1 day', CURRENT_DATE + INTERVAL '4 days', 'PAID', $3, NOW(),
       1, 5, 2500)`,
    [u302, gNadia, rFatima]
  );

  // 10. Pending stay — Ben wants to visit Maria (Unit 1002)
  await pool.query(
    `INSERT INTO guest_stays (unit_id, guest_id, plate_number, vehicle_plate, vehicle_desc,
       start_date, end_date, status, requested_by_resident_id,
       passes_applied, billable_nights, amount_cents)
     VALUES ($1, $2, 'BNF9900', 'BNF-9900', '2021 VW Jetta Silver',
       CURRENT_DATE + INTERVAL '2 days', CURRENT_DATE + INTERVAL '4 days', 'PENDING', $3,
       0, 0, 0)`,
    [u102, gBen, rMaria]
  );

  // 11. Active stay — Sophia visiting Sarah (Unit 2001), needs payment
  await pool.query(
    `INSERT INTO guest_stays (unit_id, guest_id, plate_number, vehicle_plate, vehicle_desc,
       start_date, end_date, status, requested_by_resident_id, approved_at,
       passes_applied, billable_nights, amount_cents)
     VALUES ($1, $2, 'SPL2233', 'SPL-2233', '2023 Kia Sportage White',
       CURRENT_DATE - INTERVAL '3 days', CURRENT_DATE, 'NEEDS_PAYMENT', $3, NOW(),
       0, 4, 2000)`,
    [u201, gSophia, rSarah]
  );

  // 12. Past stay — Daniel visited Resident User (Unit 1001), paid (returning guest)
  await pool.query(
    `INSERT INTO guest_stays (unit_id, guest_id, plate_number, vehicle_plate, vehicle_desc,
       start_date, end_date, status, requested_by_resident_id, approved_at,
       passes_applied, billable_nights, amount_cents)
     VALUES ($1, $2, 'DNB4455', 'DNB-4455', '2020 BMW 3 Series Black',
       CURRENT_DATE - INTERVAL '21 days', CURRENT_DATE - INTERVAL '19 days', 'PAID', $3, NOW() - INTERVAL '21 days',
       1, 2, 1000)`,
    [unitId, gDaniel, residentId]
  );

  // 13. Active stay — Rachel visiting Marcus (Unit 2002), approved
  await pool.query(
    `INSERT INTO guest_stays (unit_id, guest_id, plate_number, vehicle_plate, vehicle_desc,
       start_date, end_date, status, requested_by_resident_id, approved_at,
       passes_applied, billable_nights, amount_cents)
     VALUES ($1, $2, 'RCG6677', 'RCG-6677', '2022 Audi A4 Navy',
       CURRENT_DATE, CURRENT_DATE + INTERVAL '2 days', 'APPROVED', $3, NOW(),
       1, 2, 1000)`,
    [u202, gRachel, rMarcus]
  );

  // 14. Upcoming stay — Omar visiting Ryan (Unit 3001), pending
  await pool.query(
    `INSERT INTO guest_stays (unit_id, guest_id, plate_number, vehicle_plate, vehicle_desc,
       start_date, end_date, status, requested_by_resident_id,
       passes_applied, billable_nights, amount_cents)
     VALUES ($1, $2, 'OMF8899', 'OMF-8899', '2023 Lexus RX 350 Gray',
       CURRENT_DATE + INTERVAL '7 days', CURRENT_DATE + INTERVAL '10 days', 'PENDING', $3,
       0, 0, 0)`,
    [u301, gOmar, rRyan]
  );

  // 15. Returning guest — Tony visiting Resident User again (different dates, second stay)
  await pool.query(
    `INSERT INTO guest_stays (unit_id, guest_id, plate_number, vehicle_plate, vehicle_desc,
       start_date, end_date, status, requested_by_resident_id, approved_at,
       passes_applied, billable_nights, amount_cents)
     VALUES ($1, $2, 'ABC1234', 'ABC-1234', '2022 Toyota Camry Silver',
       CURRENT_DATE - INTERVAL '30 days', CURRENT_DATE - INTERVAL '28 days', 'PAID', $3, NOW() - INTERVAL '30 days',
       0, 3, 1500)`,
    [unitId, gTony, residentId]
  );

  // 16. Kelly visiting James (Unit 1003), active, paid
  await pool.query(
    `INSERT INTO guest_stays (unit_id, guest_id, plate_number, vehicle_plate, vehicle_desc,
       start_date, end_date, status, requested_by_resident_id, approved_at,
       passes_applied, billable_nights, amount_cents)
     VALUES ($1, $2, 'KLW1100', 'KLW-1100', '2024 Mercedes C-Class Silver',
       CURRENT_DATE, CURRENT_DATE + INTERVAL '1 day', 'PAID', $3, NOW(),
       1, 1, 500)`,
    [u103, gKelly, rJames]
  );

  // ── Unauthorized Vehicles ──
  // staffAuthId for reported_by
  const staffAuthId = staffAuth.rows[0].id;

  // Recent — spotted today, just monitoring
  await pool.query(
    `INSERT INTO unauthorized_vehicles (plate_number, vehicle_make, vehicle_color,
       violation_note, spotted_date, spotted_location, recommended_action, resolved, reported_by)
     VALUES ('UNK001', 'Honda Accord', 'Red',
       'Parked in visitor spot without pass', CURRENT_DATE, 'Lot A - Spot 12', 'warn', FALSE, $1)`,
    [staffAuthId]
  );

  // 2 days ago — second sighting
  await pool.query(
    `INSERT INTO unauthorized_vehicles (plate_number, vehicle_make, vehicle_color,
       violation_note, spotted_date, spotted_location, recommended_action, resolved, reported_by)
     VALUES ('UNK002', 'Dodge Charger', 'Black',
       'No parking permit, second time seen this week', CURRENT_DATE - INTERVAL '2 days', 'Lot B - Spot 5', 'warn', FALSE, $1)`,
    [staffAuthId]
  );

  // 4 days ago — repeated offender, tow recommended
  await pool.query(
    `INSERT INTO unauthorized_vehicles (plate_number, vehicle_make, vehicle_color,
       violation_note, spotted_date, spotted_location, recommended_action, resolved, reported_by)
     VALUES ('UNK003', 'Chevy Silverado', 'White',
       'Fourth consecutive day parked without authorization. Warning letter placed twice.', CURRENT_DATE - INTERVAL '4 days', 'Lot A - Spot 8', 'tow', FALSE, $1)`,
    [staffAuthId]
  );

  // 5 days ago — resolved (owner was guest of unit 201, pass issued)
  await pool.query(
    `INSERT INTO unauthorized_vehicles (plate_number, vehicle_make, vehicle_color,
       violation_note, spotted_date, spotted_location, recommended_action, resolved, reported_by)
     VALUES ('ALT1122', 'Ford F-150', 'Gray',
       'Initially flagged, confirmed as guest of Unit 2001', CURRENT_DATE - INTERVAL '5 days', 'Lot C - Spot 2', 'warn', TRUE, $1)`,
    [staffAuthId]
  );

  // 1 day ago — monitor
  await pool.query(
    `INSERT INTO unauthorized_vehicles (plate_number, vehicle_make, vehicle_color,
       violation_note, spotted_date, spotted_location, recommended_action, resolved, reported_by)
     VALUES ('UNK004', 'Toyota Corolla', 'Blue',
       'Overnight parking without permit', CURRENT_DATE - INTERVAL '1 day', 'Lot B - Spot 18', 'warn', FALSE, $1)`,
    [staffAuthId]
  );

  // 6 days ago — tow, unresolved
  await pool.query(
    `INSERT INTO unauthorized_vehicles (plate_number, vehicle_make, vehicle_color,
       violation_note, spotted_date, spotted_location, recommended_action, resolved, reported_by)
     VALUES ('UNK005', 'Nissan Maxima', 'Silver',
       'Repeated unauthorized parking. Owner not identified. Tow warning email sent.', CURRENT_DATE - INTERVAL '6 days', 'Lot A - Spot 3', 'tow', FALSE, $1)`,
    [staffAuthId]
  );

  // ── Guest Vehicle Free Passes ──
  // Tony's plate — used on first stay
  await pool.query(
    `INSERT INTO guest_vehicle_free_pass (plate_number, free_pass, used)
     VALUES ('ABC1234', 1, TRUE)
     ON CONFLICT (plate_number) DO NOTHING`
  );
  // Carlos's plate — used
  await pool.query(
    `INSERT INTO guest_vehicle_free_pass (plate_number, free_pass, used)
     VALUES ('XYZ5678', 1, TRUE)
     ON CONFLICT (plate_number) DO NOTHING`
  );
  // Linda's plate — used
  await pool.query(
    `INSERT INTO guest_vehicle_free_pass (plate_number, free_pass, used)
     VALUES ('LPK9012', 1, TRUE)
     ON CONFLICT (plate_number) DO NOTHING`
  );
  // Daniel's plate — used
  await pool.query(
    `INSERT INTO guest_vehicle_free_pass (plate_number, free_pass, used)
     VALUES ('DNB4455', 1, TRUE)
     ON CONFLICT (plate_number) DO NOTHING`
  );
  // Nadia's plate — used
  await pool.query(
    `INSERT INTO guest_vehicle_free_pass (plate_number, free_pass, used)
     VALUES ('NAH7788', 1, TRUE)
     ON CONFLICT (plate_number) DO NOTHING`
  );
  // Kelly's plate — used
  await pool.query(
    `INSERT INTO guest_vehicle_free_pass (plate_number, free_pass, used)
     VALUES ('KLW1100', 1, TRUE)
     ON CONFLICT (plate_number) DO NOTHING`
  );
  // Rachel's plate — used
  await pool.query(
    `INSERT INTO guest_vehicle_free_pass (plate_number, free_pass, used)
     VALUES ('RCG6677', 1, TRUE)
     ON CONFLICT (plate_number) DO NOTHING`
  );

  // ── Resident Free Pass Months (current month) ──
  // Resident User — used their monthly free night on Tony's stay
  await pool.query(
    `INSERT INTO resident_free_pass_months (resident_id, month_start, free_nights_total, free_nights_used)
     VALUES ($1, DATE_TRUNC('month', CURRENT_DATE)::date, 1, 1)
     ON CONFLICT (resident_id, month_start) DO UPDATE SET free_nights_used = 1`,
    [residentId]
  );
  // Maria — free night unused
  await pool.query(
    `INSERT INTO resident_free_pass_months (resident_id, month_start, free_nights_total, free_nights_used)
     VALUES ($1, DATE_TRUNC('month', CURRENT_DATE)::date, 1, 0)
     ON CONFLICT (resident_id, month_start) DO NOTHING`,
    [rMaria]
  );
  // James — used
  await pool.query(
    `INSERT INTO resident_free_pass_months (resident_id, month_start, free_nights_total, free_nights_used)
     VALUES ($1, DATE_TRUNC('month', CURRENT_DATE)::date, 1, 1)
     ON CONFLICT (resident_id, month_start) DO UPDATE SET free_nights_used = 1`,
    [rJames]
  );
  // Sarah — used
  await pool.query(
    `INSERT INTO resident_free_pass_months (resident_id, month_start, free_nights_total, free_nights_used)
     VALUES ($1, DATE_TRUNC('month', CURRENT_DATE)::date, 1, 1)
     ON CONFLICT (resident_id, month_start) DO UPDATE SET free_nights_used = 1`,
    [rSarah]
  );
  // Marcus — used
  await pool.query(
    `INSERT INTO resident_free_pass_months (resident_id, month_start, free_nights_total, free_nights_used)
     VALUES ($1, DATE_TRUNC('month', CURRENT_DATE)::date, 1, 1)
     ON CONFLICT (resident_id, month_start) DO UPDATE SET free_nights_used = 1`,
    [rMarcus]
  );
  // Fatima — used
  await pool.query(
    `INSERT INTO resident_free_pass_months (resident_id, month_start, free_nights_total, free_nights_used)
     VALUES ($1, DATE_TRUNC('month', CURRENT_DATE)::date, 1, 1)
     ON CONFLICT (resident_id, month_start) DO UPDATE SET free_nights_used = 1`,
    [rFatima]
  );

  // ── Bonus Pass Purchases ──
  // Sarah bought a 3-pack
  await pool.query(
    `UPDATE residents SET bonus_free_nights = 2 WHERE id = $1`,
    [rSarah]
  );
  await pool.query(
    `INSERT INTO resident_pass_purchases (resident_id, stripe_session_id, bundle_type, pass_count, amount_cents, applied_at)
     VALUES ($1, 'cs_seed_sarah_3pack', '3-pass', 3, 1275, NOW() - INTERVAL '7 days')
     ON CONFLICT (stripe_session_id) DO NOTHING`,
    [rSarah]
  );

  // Fatima bought a 5-pack
  await pool.query(
    `UPDATE residents SET bonus_free_nights = 4 WHERE id = $1`,
    [rFatima]
  );
  await pool.query(
    `INSERT INTO resident_pass_purchases (resident_id, stripe_session_id, bundle_type, pass_count, amount_cents, applied_at)
     VALUES ($1, 'cs_seed_fatima_5pack', '5-pass', 5, 2000, NOW() - INTERVAL '3 days')
     ON CONFLICT (stripe_session_id) DO NOTHING`,
    [rFatima]
  );

  await pool.end();

  console.log("Database initialized successfully.");
  console.log(`Password for all accounts: ${seedPassword}`);
  console.log("Seeded accounts:");
  console.log("  Admin:    admin@example.com");
  console.log("  Staff:    staff@example.com / patrol@example.com");
  console.log("  Resident: r01@example.com (Unit 1001)");
  console.log("  + 9 additional residents (maria.santos, james.wilson, aisha.patel, david.kim,");
  console.log("    sarah.johnson, marcus.thompson, elena.rodriguez, ryan.obrien, fatima.alhassan)");
  console.log("  + 15 guests with 16 stays (active, upcoming, past, pending, cancelled)");
  console.log("  + 6 unauthorized vehicles (2 tow, 3 warn, 1 resolved)");
  console.log("  + 2 pass bundle purchases (Sarah 3-pack, Fatima 5-pack)");
  console.log("  Inactive admin: admin2@example.com (for testing activate flow)");
}

main().catch((err) => {
  console.error("[init-db] failed:", err.message);
  process.exitCode = 1;
});
