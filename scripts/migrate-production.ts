import pg from "pg";
import bcrypt from "bcryptjs";
import dotenv from "dotenv";

dotenv.config({ path: ".env.production" });

const { Pool } = pg;

async function main() {
  if (!process.env.DATABASE_URL) {
    throw new Error("Missing DATABASE_URL in .env.production");
  }

  console.log("Connecting to production database...");

  const pool = new Pool({
    connectionString: process.env.DATABASE_URL,
    ssl: { rejectUnauthorized: false },
  });

  // ──────────────────────────────────────────────
  // 1. Drop all tables (fresh start)
  // ──────────────────────────────────────────────
  console.log("Dropping all existing tables...");
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

  // ──────────────────────────────────────────────
  // 2. Create trigger function
  // ──────────────────────────────────────────────
  await pool.query(`
    CREATE OR REPLACE FUNCTION update_updated_at_column()
    RETURNS TRIGGER AS $$
    BEGIN
      NEW.updated_at = NOW();
      RETURN NEW;
    END;
    $$ LANGUAGE plpgsql;
  `);

  // ──────────────────────────────────────────────
  // 3. Create all tables
  // ──────────────────────────────────────────────
  console.log("Creating tables...");

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
      bonus_free_nights INTEGER NOT NULL DEFAULT 0,
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

  // ──────────────────────────────────────────────
  // 4. Create updated_at triggers
  // ──────────────────────────────────────────────
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

  // ──────────────────────────────────────────────
  // 5. Seed Admin + Staff accounts
  // ──────────────────────────────────────────────
  console.log("Seeding admin and staff accounts...");

  const seedPassword = process.env.SEED_PASSWORD;
  if (!seedPassword) throw new Error("Set SEED_PASSWORD");
  const passwordHash = await bcrypt.hash(seedPassword, 10);

  // Admin
  const adminAuth = await pool.query(
    `INSERT INTO auth_users (resident_id, email, password_hash, role, status)
     VALUES (NULL, 'admin@example.com', $1, 'admin', 'ACTIVE')
     RETURNING id`,
    [passwordHash]
  );
  await pool.query(
    `INSERT INTO staff (auth_user_id, full_name, email, role)
     VALUES ($1, 'Admin', 'admin@example.com', 'admin')`,
    [adminAuth.rows[0].id]
  );
  console.log("  Admin:  admin@example.com");

  // Staff
  const staffAuth = await pool.query(
    `INSERT INTO auth_users (resident_id, email, password_hash, role, status)
     VALUES (NULL, 'staff@example.com', $1, 'staff', 'ACTIVE')
     RETURNING id`,
    [passwordHash]
  );
  await pool.query(
    `INSERT INTO staff (auth_user_id, full_name, email, role)
     VALUES ($1, 'Staff', 'staff@example.com', 'staff')`,
    [staffAuth.rows[0].id]
  );
  console.log("  Staff:  staff@example.com");

  await pool.end();

  console.log("\n--- Production migration complete! ---");
  console.log("\nAccounts created:");
  console.log("  Admin: admin@example.com");
  console.log("  Staff: staff@example.com");
}

main().catch((err) => {
  console.error("[migrate-production] failed:", err.message);
  process.exitCode = 1;
});