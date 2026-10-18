import pg from "pg";
import bcrypt from "bcryptjs";
import dotenv from "dotenv";

dotenv.config({ path: ".env.local" });

const { Pool } = pg;

const DEFAULT_PASSWORD = process.env.SEED_PASSWORD ?? "";
if (!DEFAULT_PASSWORD) throw new Error("Set SEED_PASSWORD");

// ── Date helpers ──
// Reference date: Feb 25, 2026 (configurable via SEED_REFERENCE_DATE env var)
const REFERENCE_DATE = process.env.SEED_REFERENCE_DATE
  ? new Date(process.env.SEED_REFERENCE_DATE + "T12:00:00Z")
  : new Date(Date.UTC(2026, 1, 25, 12, 0, 0)); // Feb 25, 2026
const today = REFERENCE_DATE;

function d(offset: number) {
  const dt = new Date(today);
  dt.setDate(dt.getDate() + offset);
  return dt.toISOString().slice(0, 10);
}
function monthStart(monthsAgo: number) {
  return new Date(
    Date.UTC(today.getUTCFullYear(), today.getUTCMonth() - monthsAgo, 1)
  )
    .toISOString()
    .slice(0, 10);
}

async function main() {
  if (!process.env.DATABASE_URL) {
    throw new Error("Missing DATABASE_URL in .env.local");
  }

  const pool = new Pool({
    connectionString: process.env.DATABASE_URL,
    ssl: { rejectUnauthorized: false },
  });

  const passwordHash = await bcrypt.hash(DEFAULT_PASSWORD, 10);

  console.log("Cleaning existing data...\n");

  // ──────────────────────────────────────────────
  // 0. Clean all data (child tables first to respect FK constraints)
  // ──────────────────────────────────────────────
  await pool.query(`DELETE FROM resident_pass_purchases`);
  await pool.query(`DELETE FROM unauthorized_vehicles`);
  await pool.query(`DELETE FROM guest_vehicle_free_pass`);
  await pool.query(`DELETE FROM resident_free_pass_months`);
  await pool.query(`DELETE FROM guest_stays`);
  await pool.query(`DELETE FROM guests`);
  await pool.query(`DELETE FROM auth_password_resets`);
  await pool.query(`DELETE FROM staff`);
  await pool.query(`DELETE FROM auth_users`);
  await pool.query(`DELETE FROM residents`);
  await pool.query(`DELETE FROM units`);

  console.log("Seeding comprehensive data...\n");

  // ──────────────────────────────────────────────
  // 1. Units (30 apartments across 3 buildings)
  //    4-digit format: Building(1-3) + Floor(1-4) + Unit(01-03)
  //    e.g. Building A, Floor 1, Unit 01 = 1101
  // ──────────────────────────────────────────────
  const unitValues: string[] = [];
  const unitList: { building: string; number: string }[] = [];

  const bldgDigit: Record<string, number> = { A: 1, B: 2, C: 3 };

  for (const bldg of ["A", "B", "C"]) {
    for (const floor of [1, 2, 3]) {
      for (const num of [1, 2, 3]) {
        const unitNum = `${bldgDigit[bldg]}${floor}0${num}`;
        unitValues.push(`('${bldg}', '${unitNum}')`);
        unitList.push({ building: bldg, number: unitNum });
      }
    }
  }
  // Add 3 more for 30 total (floor 4, unit 01)
  for (const bldg of ["A", "B", "C"]) {
    const unitNum = `${bldgDigit[bldg]}401`;
    unitValues.push(`('${bldg}', '${unitNum}')`);
    unitList.push({ building: bldg, number: unitNum });
  }

  const unitRows = await pool.query(`
    INSERT INTO units (building_code, unit_number) VALUES
      ${unitValues.join(",\n      ")}
    RETURNING id, unit_number
  `);
  const unitMap: Record<string, number> = {};
  for (const row of unitRows.rows) unitMap[row.unit_number] = Number(row.id);
  console.log(`  Units: ${unitRows.rows.length} created`);

  // ──────────────────────────────────────────────
  // 2. Residents (25 residents across various units)
  // ──────────────────────────────────────────────
  interface ResidentDef {
    unit: string; name: string; email: string; phone: string | null;
    primary: boolean; bonus: number; status: string;
  }

  const residentDefs: ResidentDef[] = [
    // Building A (1xxx)
    { unit: "1101", name: "Maria Santos",        email: "r01@example.com", phone: "+16025551001", primary: true,  bonus: 0, status: "ACTIVE" },
    { unit: "1101", name: "Carlos Santos",        email: "r02@example.com", phone: "+16025551002", primary: false, bonus: 0, status: "ACTIVE" },
    { unit: "1102", name: "James Rivera",         email: "r03@example.com", phone: "+16025551003", primary: true,  bonus: 0, status: "ACTIVE" },
    { unit: "1103", name: "Elena Rodriguez",      email: "r04@example.com", phone: "+16025551004", primary: true,  bonus: 0, status: "ACTIVE" },
    { unit: "1201", name: "Sarah Kim",            email: "r05@example.com", phone: "+16025551005", primary: true,  bonus: 0, status: "ACTIVE" },
    { unit: "1202", name: "David Nguyen",         email: "r06@example.com", phone: "+16025551006", primary: true,  bonus: 3, status: "ACTIVE" },
    { unit: "1203", name: "Aisha Patel",          email: "r07@example.com", phone: "+16025551007", primary: true,  bonus: 0, status: "ACTIVE" },
    { unit: "1301", name: "Kevin O'Brien",        email: "r08@example.com", phone: "+16025551008", primary: true,  bonus: 0, status: "ACTIVE" },
    { unit: "1302", name: "Rachel Green",         email: "r09@example.com", phone: "+16025551009", primary: true,  bonus: 5, status: "ACTIVE" },
    // Building B (2xxx)
    { unit: "2101", name: "Emily Johnson",        email: "r10@example.com", phone: "+16025552001", primary: true,  bonus: 0, status: "ACTIVE" },
    { unit: "2102", name: "Michael Chen",         email: "r11@example.com", phone: "+16025552002", primary: true,  bonus: 2, status: "ACTIVE" },
    { unit: "2103", name: "Fatima Al-Hassan",     email: "r12@example.com", phone: "+16025552003", primary: true,  bonus: 0, status: "ACTIVE" },
    { unit: "2201", name: "Jessica Martinez",     email: "r13@example.com", phone: "+16025552004", primary: true,  bonus: 0, status: "ACTIVE" },
    { unit: "2202", name: "Marcus Thompson",      email: "r14@example.com", phone: "+16025552005", primary: true,  bonus: 0, status: "ACTIVE" },
    { unit: "2203", name: "Linda Park",           email: "r15@example.com", phone: "+16025552006", primary: true,  bonus: 1, status: "ACTIVE" },
    { unit: "2301", name: "Ryan O'Brien",         email: "r16@example.com", phone: "+16025552007", primary: true,  bonus: 0, status: "ACTIVE" },
    { unit: "2302", name: "Sophie Dubois",        email: "r17@example.com", phone: "+16025552008", primary: true,  bonus: 0, status: "ACTIVE" },
    // Building C (3xxx)
    { unit: "3101", name: "Tony Williams",        email: "r18@example.com", phone: "+16025553001", primary: true,  bonus: 0, status: "ACTIVE" },
    { unit: "3102", name: "Priya Sharma",         email: "r19@example.com", phone: "+16025553002", primary: true,  bonus: 0, status: "ACTIVE" },
    { unit: "3103", name: "Omar Farouk",          email: "r20@example.com", phone: "+16025553003", primary: true,  bonus: 0, status: "ACTIVE" },
    { unit: "3201", name: "Kelly Wang",           email: "r21@example.com", phone: "+16025553004", primary: true,  bonus: 0, status: "ACTIVE" },
    { unit: "3202", name: "Ben Foster",           email: "r22@example.com", phone: "+16025553005", primary: true,  bonus: 0, status: "ACTIVE" },
    { unit: "3203", name: "Nadia Hassan",         email: "r23@example.com", phone: "+16025553006", primary: true,  bonus: 0, status: "ACTIVE" },
    // Inactive residents
    { unit: "3301", name: "Paul Stevens",         email: "r24@example.com", phone: "+16025553007", primary: true,  bonus: 0, status: "INACTIVE" },
    { unit: "1401", name: "Lina Morales",         email: "r25@example.com", phone: "+16025553008", primary: true,  bonus: 0, status: "INACTIVE" },
  ];

  const residentMap: Record<string, number> = {};
  for (const r of residentDefs) {
    const result = await pool.query(
      `INSERT INTO residents (unit_id, full_name, email, phone, status, is_primary_contact, bonus_free_nights)
       VALUES ($1, $2, $3, $4, $5, $6, $7)
       RETURNING id`,
      [unitMap[r.unit], r.name, r.email, r.phone, r.status, r.primary, r.bonus]
    );
    residentMap[r.email] = Number(result.rows[0].id);
  }
  console.log(`  Residents: ${residentDefs.length} created`);

  // ──────────────────────────────────────────────
  // 3. Auth users — all residents + 2 staff + 2 admin
  // ──────────────────────────────────────────────
  const authUserMap: Record<string, number> = {};

  // Resident logins
  for (const r of residentDefs) {
    const result = await pool.query(
      `INSERT INTO auth_users (resident_id, email, password_hash, role, status)
       VALUES ($1, $2, $3, 'resident', $4)
       RETURNING id`,
      [residentMap[r.email], r.email, passwordHash, r.status === "ACTIVE" ? "ACTIVE" : "INACTIVE"]
    );
    authUserMap[r.email] = Number(result.rows[0].id);
  }

  // Staff accounts
  for (const s of [
    { email: "staff@example.com", name: "Alex Thompson" },
    { email: "patrol@example.com", name: "Mike Patrol" },
  ]) {
    const result = await pool.query(
      `INSERT INTO auth_users (resident_id, email, password_hash, role, status)
       VALUES (NULL, $1, $2, 'staff', 'ACTIVE')
       RETURNING id`,
      [s.email, passwordHash]
    );
    authUserMap[s.email] = Number(result.rows[0].id);
    await pool.query(
      `INSERT INTO staff (auth_user_id, full_name, email, role) VALUES ($1, $2, $3, 'staff')`,
      [authUserMap[s.email], s.name, s.email]
    );
  }

  // Admin accounts
  for (const a of [
    { email: "admin@example.com", name: "Matthew", status: "ACTIVE" },
    { email: "admin2@example.com", name: "New Admin", status: "INACTIVE" },
  ]) {
    const result = await pool.query(
      `INSERT INTO auth_users (resident_id, email, password_hash, role, status)
       VALUES (NULL, $1, $2, 'admin', $3)
       RETURNING id`,
      [a.email, passwordHash, a.status]
    );
    authUserMap[a.email] = Number(result.rows[0].id);
    await pool.query(
      `INSERT INTO staff (auth_user_id, full_name, email, role) VALUES ($1, $2, $3, 'admin')`,
      [authUserMap[a.email], a.name, a.email]
    );
  }

  const authCount = Object.keys(authUserMap).length;
  console.log(`  Auth users: ${authCount} created (${residentDefs.length} residents + 2 staff + 2 admin)`);

  // ──────────────────────────────────────────────
  // 4. Guests (55 unique guests)
  // ──────────────────────────────────────────────
  const guestsData = [
    { name: "Roberto Garcia",      email: "roberto.garcia@example.com",    phone: "+16025562001" },
    { name: "Anna Petrova",        email: "anna.petrova@example.com",      phone: "+16025562002" },
    { name: "Tom Williams",        email: "tom.williams@example.com",      phone: "+16025562003" },
    { name: "Lisa Chang",          email: "lisa.chang@example.com",        phone: "+16025562004" },
    { name: "Omar Hassan",         email: "omar.h@example.com",            phone: null },
    { name: "Sophie Laurent",      email: "sophie.l@example.com",          phone: "+16025562006" },
    { name: "Yuki Tanaka",         email: "yuki.t@example.com",            phone: null },
    { name: "Priya Nair",          email: "priya.n@example.com",           phone: "+16025562008" },
    { name: "Marcus Brown",        email: "marcus.b@example.com",          phone: "+16025562009" },
    { name: "Daniel Kim",          email: "daniel.k@example.com",          phone: "+16025562010" },
    { name: "Alex Turner",         email: null,                          phone: "+16025562011" },
    { name: "Jamie O'Connor",      email: "jamie.oc@example.com",          phone: null },
    { name: "Rachel Adams",        email: "rachel.a@outlook.com",        phone: "+16025562013" },
    { name: "Mikhail Ivanov",      email: "mikhail.i@example.com",         phone: "+16025562014" },
    { name: "Claire Fontaine",     email: "claire.f@example.com",          phone: null },
    { name: "Noah Jackson",        email: "noah.j@example.com",            phone: "+16025562016" },
    { name: "Camila Reyes",        email: "camila.r@example.com",          phone: "+16025562017" },
    { name: "Ethan Moore",         email: "ethan.m@outlook.com",         phone: null },
    { name: "Zara Okafor",         email: "zara.o@example.com",            phone: "+16025562019" },
    { name: "Oliver Scott",        email: "oliver.s@example.com",          phone: "+16025562020" },
    { name: "Luna Martinez",       email: "luna.m@example.com",            phone: "+16025562021" },
    { name: "Henry Brooks",        email: "henry.b@outlook.com",         phone: null },
    { name: "Mia Sullivan",        email: "mia.s@example.com",             phone: "+16025562023" },
    { name: "Liam Chen",           email: "liam.c@example.com",            phone: "+16025562024" },
    { name: "Sophia Lee",          email: "sophia.lee@example.com",        phone: "+16025562025" },
    { name: "Jack Wilson",         email: "jack.w@example.com",            phone: "+16025562026" },
    { name: "Emma Davis",          email: "emma.d@outlook.com",          phone: null },
    { name: "Aiden Clark",         email: "aiden.c@example.com",           phone: "+16025562028" },
    { name: "Olivia Hall",         email: "olivia.h@example.com",          phone: "+16025562029" },
    { name: "Lucas Young",         email: "lucas.y@example.com",           phone: "+16025562030" },
    { name: "Harper King",         email: "harper.k@example.com",          phone: null },
    { name: "Mason Wright",        email: "mason.w@outlook.com",         phone: "+16025562032" },
    { name: "Ella Lopez",          email: "ella.l@example.com",            phone: "+16025562033" },
    { name: "Logan Hill",          email: "logan.h@example.com",           phone: "+16025562034" },
    { name: "Aria Gonzalez",       email: "aria.g@example.com",            phone: null },
    { name: "Sebastian Baker",     email: "sebastian.b@example.com",       phone: "+16025562036" },
    { name: "Grace Nelson",        email: "grace.n@outlook.com",         phone: "+16025562037" },
    { name: "Leo Carter",          email: "leo.c@example.com",             phone: null },
    { name: "Chloe Mitchell",      email: "chloe.m@example.com",           phone: "+16025562039" },
    { name: "Mateo Perez",         email: "mateo.p@example.com",           phone: "+16025562040" },
    { name: "Avery Robinson",      email: "avery.r@example.com",           phone: "+16025562041" },
    { name: "Jackson Lewis",       email: "jackson.l@outlook.com",       phone: null },
    { name: "Layla Walker",        email: "layla.w@example.com",           phone: "+16025562043" },
    { name: "Carter Allen",        email: "carter.a@example.com",          phone: "+16025562044" },
    { name: "Penelope Harris",     email: "penelope.h@example.com",        phone: null },
    { name: "Dylan Martin",        email: "dylan.m@outlook.com",         phone: "+16025562046" },
    { name: "Riley Garcia",        email: "riley.g@example.com",           phone: "+16025562047" },
    { name: "Violet Anderson",     email: "violet.a@example.com",          phone: "+16025562048" },
    { name: "Nathan Thomas",       email: "nathan.t@example.com",          phone: null },
    { name: "Aurora White",        email: "aurora.w@outlook.com",        phone: "+16025562050" },
    { name: "Caleb Taylor",        email: "caleb.t@example.com",           phone: "+16025562051" },
    { name: "Stella Jackson",      email: "stella.j@example.com",          phone: "+16025562052" },
    { name: "Owen Martinez",       email: "owen.m@example.com",            phone: null },
    { name: "Hazel Thompson",      email: "hazel.t@outlook.com",         phone: "+16025562054" },
    { name: "Wyatt Brown",         email: "wyatt.b@example.com",           phone: "+16025562055" },
  ];

  const guestMap: Record<string, number> = {};
  for (const g of guestsData) {
    const result = await pool.query(
      `INSERT INTO guests (full_name, email, phone) VALUES ($1, $2, $3) RETURNING id`,
      [g.name, g.email, g.phone]
    );
    guestMap[g.name] = Number(result.rows[0].id);
  }
  console.log(`  Guests: ${guestsData.length} created`);

  // ──────────────────────────────────────────────
  // 5. Guest Stays (75+ stays covering all status combos)
  // ──────────────────────────────────────────────
  const vehicles = [
    "Silver Toyota Camry 2020", "White Honda Civic 2019", "Black Ford F-150 2022",
    "Red Mazda CX-5 2021", "Blue Hyundai Tucson 2023", "Gray BMW 3 Series 2020",
    "White Chevrolet Equinox 2021", "Green Subaru Outback 2022", "Black Tesla Model 3 2023",
    "Silver Nissan Altima 2020", "Red Kia Sportage 2024", "Blue Audi A4 2022",
    "White Mercedes C-Class 2023", "Black Jeep Wrangler 2021", "Gray Lexus RX 350 2022",
    "Silver VW Jetta 2021", "Blue Toyota RAV4 2023", "Red Dodge Charger 2020",
    "White Chevy Malibu 2022", "Black Porsche Cayenne 2024", "Gray Honda CR-V 2021",
    "Silver Hyundai Sonata 2023", "Blue Ford Escape 2022", "Red Subaru Forester 2021",
    "White Tesla Model Y 2024",
  ];

  let plateCounter = 1;
  function nextPlate() {
    return `AZ${String(plateCounter++).padStart(5, "0")}`;
  }

  interface StayDef {
    unit: string; guest: string; plate: string; vDesc: string;
    start: string; end: string; status: string; resident: string;
    passes: number; gfp: number; billable: number; amount: number;
    stripeSession?: string;
  }

  const stays: StayDef[] = [];

  // Helper to add a stay
  function addStay(
    unit: string, guest: string, vIdx: number,
    start: string, end: string, status: string, resident: string,
    passes: number, gfp: number, billable: number, amount: number,
    stripeSession?: string
  ) {
    stays.push({
      unit, guest, plate: nextPlate(), vDesc: vehicles[vIdx % vehicles.length],
      start, end, status, resident, passes, gfp, billable, amount, stripeSession,
    });
  }

  // ── INSERT ORDER: oldest first → newest last (so active stays get highest IDs) ──

  // ── HISTORICAL STAYS (spanning 6 months: Aug 25 - Feb 25) — inserted first (lowest IDs) ──
  const activeResidents = residentDefs.filter(r => r.status === "ACTIVE");
  const guestNames = guestsData.map(g => g.name);

  // 6 months of history (monthsAgo = 6, 5, 4, 3, 2)
  for (let monthsAgo = 6; monthsAgo >= 2; monthsAgo--) {
    const baseOffset = -monthsAgo * 30;
    // 8 paid stays per historical month (more realistic volume)
    for (let j = 0; j < 8; j++) {
      const res = activeResidents[(monthsAgo * 8 + j) % activeResidents.length];
      const guest = guestNames[(monthsAgo * 7 + j * 3) % guestNames.length];
      const startOff = baseOffset + j * 3;
      const duration = 2 + (j % 4); // 2-5 nights
      const billable = Math.max(0, duration - 1);
      addStay(
        res.unit, guest, (monthsAgo * 8 + j) % vehicles.length,
        d(startOff), d(startOff + duration),
        "PAID", res.email,
        1, j % 2 === 0 ? 1 : 0, billable, billable * 500,
        `cs_hist_m${monthsAgo}_${j}`
      );
    }
    // 3 approved (expired) stays per historical month
    for (let j = 0; j < 3; j++) {
      const res = activeResidents[(monthsAgo * 3 + j + 5) % activeResidents.length];
      const guest = guestNames[(monthsAgo * 5 + j * 7 + 10) % guestNames.length];
      const startOff = baseOffset + 20 + j * 3;
      const duration = 2 + (j % 3);
      addStay(
        res.unit, guest, (monthsAgo * 3 + j + 10) % vehicles.length,
        d(startOff), d(startOff + duration),
        "APPROVED", res.email,
        1, j % 2, Math.max(0, duration - 1), Math.max(0, duration - 1) * 500
      );
    }
    // 1 cancelled stay per month for realism
    const cancelRes = activeResidents[(monthsAgo * 2 + 7) % activeResidents.length];
    const cancelGuest = guestNames[(monthsAgo * 4 + 15) % guestNames.length];
    addStay(
      cancelRes.unit, cancelGuest, (monthsAgo * 2 + 20) % vehicles.length,
      d(baseOffset + 10), d(baseOffset + 13),
      "CANCELLED", cancelRes.email,
      0, 0, 0, 0
    );
  }

  // ── RETURNING GUESTS (past, lower IDs) ──
  addStay("1102", "Roberto Garcia",   0,  d(-35), d(-32), "APPROVED", "r03@example.com",     1, 1, 2, 1000);
  addStay("3201", "Anna Petrova",     1,  d(-40), d(-37), "APPROVED", "r21@example.com",       1, 0, 2, 1000);
  addStay("2201", "Tom Williams",     2,  d(-8),  d(-5),  "APPROVED", "r13@example.com", 1, 1, 2, 1000);

  // ── PAST / EXPIRED (approved, end date in past) ──
  addStay("1201", "Penelope Harris",  44, d(-28), d(-24), "APPROVED", "r05@example.com",        1, 1, 3, 1500);
  addStay("2202", "Nathan Thomas",    48, d(-26), d(-22), "APPROVED", "r14@example.com",  1, 1, 3, 1500);
  addStay("1103", "Roberto Garcia",   0,  d(-25), d(-22), "APPROVED", "r04@example.com",  1, 0, 2, 1000);
  addStay("3203", "Carter Allen",     43, d(-24), d(-21), "APPROVED", "r23@example.com",     1, 0, 2, 1000);
  addStay("2301", "Avery Robinson",   40, d(-22), d(-19), "APPROVED", "r16@example.com",      1, 1, 2, 1000);
  addStay("2201", "Yuki Tanaka",      6,  d(-21), d(-18), "APPROVED", "r13@example.com", 1, 1, 2, 1000);
  addStay("3101", "Riley Garcia",     46, d(-20), d(-17), "APPROVED", "r18@example.com",    1, 1, 2, 1000);
  addStay("2203", "Layla Walker",     42, d(-19), d(-15), "APPROVED", "r15@example.com",       1, 1, 3, 1500);
  addStay("2102", "Tom Williams",     2,  d(-18), d(-14), "APPROVED", "r11@example.com",     1, 1, 3, 1500);
  addStay("1301", "Jackson Lewis",    41, d(-17), d(-14), "APPROVED", "r08@example.com",     1, 0, 2, 1000);
  addStay("3102", "Anna Petrova",     1,  d(-16), d(-13), "APPROVED", "r19@example.com",     1, 1, 2, 1000);
  addStay("2101", "Dylan Martin",     45, d(-15), d(-12), "APPROVED", "r10@example.com",    1, 0, 2, 1000);
  addStay("1101", "Sophie Laurent",   5,  d(-14), d(-11), "APPROVED", "r01@example.com",     1, 0, 2, 1000);
  addStay("1102", "Violet Anderson",  47, d(-13), d(-10), "APPROVED", "r03@example.com",     1, 0, 2, 1000);
  addStay("3201", "Marcus Brown",     9,  d(-12), d(-8),  "APPROVED", "r21@example.com",       1, 0, 3, 1500);
  addStay("3102", "Aurora White",     49, d(-11), d(-8),  "APPROVED", "r19@example.com",     1, 0, 2, 1000);
  addStay("1202", "Alex Turner",      10, d(-10), d(-7),  "APPROVED", "r06@example.com",     1, 1, 2, 1000);
  addStay("2103", "Caleb Taylor",     50, d(-9),  d(-6),  "APPROVED", "r12@example.com",  1, 1, 2, 1000);
  addStay("1202", "Yuki Tanaka",      6,  d(-30), d(-27), "APPROVED", "r06@example.com",     1, 0, 2, 1000);

  // ── PAID (completed Stripe payment, recent) ──
  addStay("1103", "Logan Hill",       33, d(-20), d(-16), "PAID", "r04@example.com",   1, 1, 3, 1500, "cs_test_paid_008");
  addStay("3201", "Sebastian Baker",  35, d(-18), d(-14), "PAID", "r21@example.com",        1, 0, 3, 1500, "cs_test_paid_010");
  addStay("2302", "Ella Lopez",       32, d(-15), d(-11), "PAID", "r17@example.com",     1, 0, 3, 1500, "cs_test_paid_007");
  addStay("1201", "Yuki Tanaka",      6,  d(-14), d(-10), "PAID", "r05@example.com",         1, 0, 3, 1500, "cs_test_paid_003");
  addStay("2202", "Leo Carter",       37, d(-13), d(-9),  "PAID", "r14@example.com",   1, 0, 3, 1500, "cs_test_paid_012");
  addStay("3202", "Harper King",      30, d(-12), d(-8),  "PAID", "r22@example.com",        1, 0, 3, 1500, "cs_test_paid_005");
  addStay("2103", "Aria Gonzalez",    34, d(-11), d(-7),  "PAID", "r12@example.com",   1, 1, 3, 1500, "cs_test_paid_009");
  addStay("2101", "Marcus Brown",     9,  d(-10), d(-5),  "PAID", "r10@example.com",     1, 1, 4, 2000, "cs_test_paid_002");
  addStay("1302", "Mason Wright",     31, d(-9),  d(-6),  "PAID", "r09@example.com",      1, 1, 2, 1000, "cs_test_paid_006");
  addStay("3101", "Oliver Scott",     19, d(-8),  d(-5),  "PAID", "r18@example.com",     1, 1, 2, 1000, "cs_test_paid_004");
  addStay("2201", "Priya Nair",       8,  d(-7),  d(-4),  "PAID", "r13@example.com",  1, 1, 2, 1000, "cs_test_paid_001");
  addStay("1301", "Grace Nelson",     36, d(-6),  d(-3),  "PAID", "r08@example.com",      1, 1, 2, 1000, "cs_test_paid_011");

  // ── CANCELLED ──
  addStay("1102", "Priya Nair",       8,  d(3),   d(6),   "CANCELLED", "r03@example.com",    0, 0, 0, 0);
  addStay("2101", "Yuki Tanaka",      6,  d(5),   d(8),   "CANCELLED", "r10@example.com",   0, 0, 0, 0);
  addStay("3101", "Jamie O'Connor",   11, d(2),   d(5),   "CANCELLED", "r18@example.com",   0, 0, 0, 0);
  addStay("1203", "Chloe Mitchell",   38, d(4),   d(7),   "CANCELLED", "r07@example.com",     0, 0, 0, 0);
  addStay("2302", "Mateo Perez",      39, d(1),   d(4),   "CANCELLED", "r17@example.com",   0, 0, 0, 0);

  // ── MULTI-MONTH CROSS-BOUNDARY STAY ──
  addStay("1302", "Stella Jackson",   51, d(-5),  d(25),  "NEEDS_PAYMENT", "r09@example.com", 2, 0, 28, 14000);

  // ── NEEDS_PAYMENT (current) ──
  addStay("1201", "Roberto Garcia",   0,  d(3),   d(7),   "NEEDS_PAYMENT", "r05@example.com",       0, 0, 4, 2000);
  addStay("2102", "Sophie Laurent",   5,  d(-5),  d(25),  "NEEDS_PAYMENT", "r11@example.com",    2, 0, 28, 14000);
  addStay("3202", "Jack Wilson",      25, d(-2),  d(5),   "NEEDS_PAYMENT", "r22@example.com",      1, 1, 6, 3000);
  addStay("1202", "Emma Davis",       26, d(1),   d(10),  "NEEDS_PAYMENT", "r06@example.com",    3, 1, 5, 2500);
  addStay("2203", "Aiden Clark",      27, d(-1),  d(6),   "NEEDS_PAYMENT", "r15@example.com",      1, 0, 6, 3000);

  // ── PENDING (awaiting approval) — high IDs so they show up prominently ──
  addStay("1103", "Omar Hassan",      4,  d(1),   d(5),   "PENDING", "r04@example.com",  0, 0, 0, 0);
  addStay("2102", "Sophie Laurent",   5,  d(2),   d(4),   "PENDING", "r11@example.com",     0, 0, 0, 0);
  addStay("1102", "Tom Williams",     2,  d(7),   d(8),   "PENDING", "r03@example.com",     0, 0, 0, 0);
  addStay("1203", "Mikhail Ivanov",   13, d(3),   d(7),   "PENDING", "r07@example.com",      0, 0, 0, 0);
  addStay("3102", "Claire Fontaine",  14, d(2),   d(6),   "PENDING", "r19@example.com",     0, 0, 0, 0);
  addStay("2203", "Ethan Moore",      17, d(1),   d(3),   "PENDING", "r15@example.com",       0, 0, 0, 0);
  addStay("3203", "Luna Martinez",    20, d(4),   d(8),   "PENDING", "r23@example.com",     0, 0, 0, 0);
  addStay("1302", "Henry Brooks",     21, d(2),   d(5),   "PENDING", "r09@example.com",     0, 0, 0, 0);
  addStay("2301", "Mia Sullivan",     22, d(3),   d(6),   "PENDING", "r16@example.com",      0, 0, 0, 0);
  addStay("3101", "Liam Chen",        23, d(5),   d(7),   "PENDING", "r18@example.com",    0, 0, 0, 0);
  addStay("2101", "Roberto Garcia",   0,  d(10),  d(13),  "PENDING", "r10@example.com",    0, 0, 0, 0);

  // ── APPROVED (active, ongoing) — inserted LAST so they get highest IDs ──
  addStay("1101", "Roberto Garcia",   0,  d(-2),  d(3),   "APPROVED", "r01@example.com",    2, 1, 3, 1500);
  addStay("1102", "Anna Petrova",     1,  d(-1),  d(1),   "APPROVED", "r03@example.com",    2, 1, 0, 0);
  addStay("2101", "Tom Williams",     2,  d(0),   d(4),   "APPROVED", "r10@example.com",   2, 1, 2, 1000);
  addStay("1201", "Lisa Chang",       3,  d(-1),  d(2),   "APPROVED", "r05@example.com",       1, 0, 2, 1000);
  addStay("2201", "Daniel Kim",       9,  d(-3),  d(1),   "APPROVED", "r13@example.com", 1, 1, 3, 1500);
  addStay("3101", "Sophia Lee",       24, d(0),   d(2),   "APPROVED", "r18@example.com",   1, 1, 1, 500);
  addStay("2103", "Rachel Adams",     12, d(-1),  d(3),   "APPROVED", "r12@example.com",  2, 1, 2, 1000);
  addStay("3201", "Noah Jackson",     15, d(0),   d(5),   "APPROVED", "r21@example.com",      1, 0, 4, 2000);
  addStay("1301", "Camila Reyes",     16, d(-2),  d(2),   "APPROVED", "r08@example.com",    1, 1, 3, 1500);
  addStay("2302", "Zara Okafor",      18, d(-1),  d(4),   "APPROVED", "r17@example.com",   1, 0, 4, 2000);

  for (const s of stays) {
    const guestId = guestMap[s.guest];
    const unitId = unitMap[s.unit];
    const resId = residentMap[s.resident];
    if (!guestId || !unitId || !resId) {
      console.warn(`  WARN: Skipping stay - missing ref for ${s.guest} @ ${s.unit}`);
      continue;
    }

    await pool.query(
      `INSERT INTO guest_stays
         (unit_id, guest_id, plate_number, vehicle_plate, vehicle_desc,
          start_date, end_date, status, requested_by_resident_id,
          approved_at, passes_applied, guest_free_pass_nights, billable_nights, amount_cents, currency,
          stripe_session_id, resident_email_status, guest_email_status)
       VALUES ($1, $2, $3, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, 'usd', $14, 'SENT', 'SENT')`,
      [
        unitId, guestId, s.plate, s.vDesc,
        s.start, s.end, s.status, resId,
        ["APPROVED", "NEEDS_PAYMENT", "PAID"].includes(s.status) ? new Date().toISOString() : null,
        s.passes, s.gfp, s.billable, s.amount,
        s.stripeSession || null,
      ]
    );
  }
  console.log(`  Guest stays: ${stays.length} created`);

  // ── Admin-created guest stays (show up on /admin/guests page) ──
  const adminUserId = authUserMap["admin@example.com"];

  const adminStays = [
    { unit: "1101", guest: "Wyatt Brown",     vIdx: 0,  start: d(-3),  end: d(2),  status: "APPROVED" },
    { unit: "2101", guest: "Hazel Thompson",  vIdx: 3,  start: d(-1),  end: d(4),  status: "APPROVED" },
    { unit: "3201", guest: "Owen Martinez",   vIdx: 7,  start: d(0),   end: d(3),  status: "APPROVED" },
    { unit: "1302", guest: "Stella Jackson",  vIdx: 11, start: d(1),   end: d(5),  status: "APPROVED" },
    { unit: "2202", guest: "Caleb Taylor",    vIdx: 15, start: d(-5),  end: d(-2), status: "APPROVED" },
    { unit: "1203", guest: "Aurora White",    vIdx: 18, start: d(2),   end: d(6),  status: "APPROVED" },
    { unit: "2301", guest: "Violet Anderson", vIdx: 22, start: d(-7),  end: d(-4), status: "APPROVED" },
    { unit: "3102", guest: "Nathan Thomas",   vIdx: 5,  start: d(-2),  end: d(1),  status: "APPROVED" },
  ];

  for (const s of adminStays) {
    const guestId = guestMap[s.guest];
    const unitId = unitMap[s.unit];
    if (!guestId || !unitId) continue;

    const plate = nextPlate();
    await pool.query(
      `INSERT INTO guest_stays
         (unit_id, guest_id, plate_number, vehicle_plate, vehicle_desc,
          start_date, end_date, status, approved_at,
          passes_applied, guest_free_pass_nights, billable_nights, amount_cents, currency,
          created_by_user_id, resident_email_status, guest_email_status)
       VALUES ($1, $2, $3, $3, $4, $5, $6, $7, NOW(), 0, 0, 0, 0, 'usd', $8, 'SENT', 'SENT')`,
      [
        unitId, guestId, plate, vehicles[s.vIdx % vehicles.length],
        s.start, s.end, s.status, adminUserId,
      ]
    );
  }
  console.log(`  Admin-created stays: ${adminStays.length} created`);

  // ──────────────────────────────────────────────
  // 6. Resident free pass months (accumulated)
  // ──────────────────────────────────────────────
  interface BucketDef {
    resident: string; month: string; total: number; used: number;
  }

  const passBuckets: BucketDef[] = [];

  // For all ACTIVE residents, give them monthly buckets for the last 6 months
  for (const r of residentDefs.filter(r => r.status === "ACTIVE")) {
    for (let m = 0; m < 6; m++) {
      const month = monthStart(m);
      // Current month: ~60% used, older months: ~80% used
      const usedChance = m === 0 ? 0.6 : 0.8;
      const used = Math.random() < usedChance ? 1 : 0;
      passBuckets.push({ resident: r.email, month, total: 1, used });
    }
  }

  // Specific overrides for interesting scenarios:
  const thisMonth = monthStart(0);

  // Maria (1101): all used → 0 remaining
  for (let m = 0; m < 6; m++) {
    const idx = passBuckets.findIndex(b => b.resident === "r01@example.com" && b.month === monthStart(m));
    if (idx >= 0) passBuckets[idx].used = 1;
  }

  // David Nguyen (1202): last 3 months unused + 3 bonus → many accumulated
  for (let m = 0; m < 3; m++) {
    const idx = passBuckets.findIndex(b => b.resident === "r06@example.com" && b.month === monthStart(m));
    if (idx >= 0) passBuckets[idx].used = 0;
  }

  // Rachel Green (1302): last 4 months unused + 5 bonus → power saver
  for (let m = 0; m < 4; m++) {
    const idx = passBuckets.findIndex(b => b.resident === "r09@example.com" && b.month === monthStart(m));
    if (idx >= 0) passBuckets[idx].used = 0;
  }

  // Michael Chen (2102): current month unused + 2 bonus
  const michaelThis = passBuckets.findIndex(b => b.resident === "r11@example.com" && b.month === thisMonth);
  if (michaelThis >= 0) passBuckets[michaelThis].used = 0;

  // Sarah Kim (1201): all used → 0 remaining (needs_payment scenario)
  for (let m = 0; m < 6; m++) {
    const idx = passBuckets.findIndex(b => b.resident === "r05@example.com" && b.month === monthStart(m));
    if (idx >= 0) passBuckets[idx].used = 1;
  }

  for (const b of passBuckets) {
    const resId = residentMap[b.resident];
    if (!resId) continue;
    await pool.query(
      `INSERT INTO resident_free_pass_months (resident_id, month_start, free_nights_total, free_nights_used)
       VALUES ($1, $2, $3, $4)
       ON CONFLICT (resident_id, month_start) DO NOTHING`,
      [resId, b.month, b.total, b.used]
    );
  }
  console.log(`  Free pass buckets: ${passBuckets.length} created`);

  // ──────────────────────────────────────────────
  // 7. Guest vehicle free passes (55 plates)
  // ──────────────────────────────────────────────
  const vehiclePasses: { plate: string; used: boolean }[] = [];
  for (let i = 1; i <= plateCounter - 1; i++) {
    const plate = `AZ${String(i).padStart(5, "0")}`;
    // Mix of used and unused passes
    const used = i <= 45; // first 45 used, rest unused (newer guests)
    vehiclePasses.push({ plate, used });
  }

  for (const vp of vehiclePasses) {
    await pool.query(
      `INSERT INTO guest_vehicle_free_pass (plate_number, free_pass, used)
       VALUES ($1, 1, $2)
       ON CONFLICT (plate_number) DO NOTHING`,
      [vp.plate, vp.used]
    );
  }
  console.log(`  Vehicle free passes: ${vehiclePasses.length} created`);

  // ──────────────────────────────────────────────
  // 8. Resident pass purchases (bonus history)
  // ──────────────────────────────────────────────
  const purchases = [
    { resident: "r06@example.com",  session: "cs_seed_david_3pack",  bundle: "3pack",  count: 3, amount: 1200 },
    { resident: "r11@example.com",  session: "cs_seed_michael_s1",   bundle: "single", count: 1, amount: 500  },
    { resident: "r11@example.com",  session: "cs_seed_michael_s2",   bundle: "single", count: 1, amount: 500  },
    { resident: "r09@example.com",  session: "cs_seed_rachel_5pack", bundle: "5pack",  count: 5, amount: 2000 },
    { resident: "r15@example.com",    session: "cs_seed_linda_single", bundle: "single", count: 1, amount: 500  },
  ];

  for (const p of purchases) {
    const resId = residentMap[p.resident];
    if (!resId) continue;
    await pool.query(
      `INSERT INTO resident_pass_purchases (resident_id, stripe_session_id, bundle_type, pass_count, amount_cents, applied_at)
       VALUES ($1, $2, $3, $4, $5, NOW())`,
      [resId, p.session, p.bundle, p.count, p.amount]
    );
  }
  console.log(`  Pass purchases: ${purchases.length} created`);

  // ──────────────────────────────────────────────
  // 9. Unauthorized vehicles (55+)
  // ──────────────────────────────────────────────
  const reportedBy = authUserMap["admin@example.com"];
  const staffReporter = authUserMap["staff@example.com"];
  const patrolReporter = authUserMap["patrol@example.com"];

  interface UnauthDef {
    plate: string; make: string; color: string; note: string;
    date: string; location: string; action: string; resolved: boolean;
    reporter: number;
  }

  const unauthorizedVehicles: UnauthDef[] = [];

  const makes = ["Honda Accord", "Dodge Charger", "Toyota Corolla", "Chevy Silverado", "Nissan Maxima",
    "Ford Mustang", "Kia Optima", "Hyundai Elantra", "BMW X3", "Mercedes GLC",
    "VW Golf", "Audi Q5", "Subaru WRX", "Mazda 3", "Lexus IS",
    "Tesla Model S", "Jeep Cherokee", "Ram 1500", "GMC Sierra", "Buick Encore",
    "Chrysler 300", "Infiniti Q50", "Acura TLX", "Lincoln MKZ", "Volvo XC60"];
  const colors = ["Red", "Black", "White", "Silver", "Blue", "Gray", "Green", "Beige", "Brown", "Yellow"];
  const lots = ["Lot A", "Lot B", "Lot C", "Fire Lane", "Handicap Zone", "Loading Zone"];
  const notesList = [
    "Parked in reserved spot overnight. No permit found.",
    "Blocking fire lane near building entrance.",
    "No parking permit displayed. First offense.",
    "Expired guest pass. Vehicle stayed past end date.",
    "Second consecutive day without authorization.",
    "Blocking handicap access ramp.",
    "Parked across two spots without permit.",
    "Overnight parking without valid guest registration.",
    "Vehicle abandoned — no movement in 72+ hours.",
    "Tailgated through gate, no registered plate.",
  ];

  // Unresolved — recent (last 14 days)
  for (let i = 0; i < 30; i++) {
    const daysAgo = i % 14;
    unauthorizedVehicles.push({
      plate: `UNK${String(i + 1).padStart(4, "0")}`,
      make: makes[i % makes.length],
      color: colors[i % colors.length],
      note: notesList[i % notesList.length],
      date: d(-daysAgo),
      location: `Building ${["A", "B", "C"][i % 3]} - ${lots[i % lots.length]}, Spot ${10 + i}`,
      action: daysAgo >= 4 ? "tow" : "warn",
      resolved: false,
      reporter: [reportedBy, staffReporter, patrolReporter][i % 3],
    });
  }

  // Resolved — spread across 6 months of history
  let unkCounter = 31;
  for (let monthsAgo = 0; monthsAgo < 6; monthsAgo++) {
    const vehiclesPerMonth = monthsAgo === 0 ? 8 : 6 + (monthsAgo % 3);
    for (let j = 0; j < vehiclesPerMonth; j++) {
      const daysAgo = monthsAgo * 30 + j * 3 + 2;
      const idx = unkCounter - 31;
      unauthorizedVehicles.push({
        plate: `UNK${String(unkCounter++).padStart(4, "0")}`,
        make: makes[(idx + 10) % makes.length],
        color: colors[(idx + 3) % colors.length],
        note: `Resolved: ${notesList[(idx + 2) % notesList.length]} Owner identified and registered.`,
        date: d(-daysAgo),
        location: `Building ${["A", "B", "C"][(idx + 1) % 3]} - ${lots[(idx + 2) % lots.length]}, Spot ${20 + (idx % 30)}`,
        action: daysAgo >= 60 ? "tow" : "warn",
        resolved: true,
        reporter: [reportedBy, staffReporter, patrolReporter][(idx + 1) % 3],
      });
    }
  }

  for (const uv of unauthorizedVehicles) {
    await pool.query(
      `INSERT INTO unauthorized_vehicles
         (plate_number, vehicle_make, vehicle_color, violation_note,
          spotted_date, spotted_location, recommended_action, resolved, reported_by)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)`,
      [uv.plate, uv.make, uv.color, uv.note, uv.date, uv.location, uv.action, uv.resolved, uv.reporter]
    );
  }
  console.log(`  Unauthorized vehicles: ${unauthorizedVehicles.length} created`);

  // ──────────────────────────────────────────────
  // Done
  // ──────────────────────────────────────────────
  await pool.end();

  console.log("\n--- Seed data complete! ---\n");
  console.log("== Record Counts ==");
  console.log(`  Units:                 ${unitList.length}`);
  console.log(`  Residents:             ${residentDefs.length} (${residentDefs.filter(r => r.status === "ACTIVE").length} active, ${residentDefs.filter(r => r.status === "INACTIVE").length} inactive)`);
  console.log(`  Auth users:            ${authCount}`);
  console.log(`  Guests:                ${guestsData.length}`);
  console.log(`  Guest stays:           ${stays.length}`);
  console.log(`  Pass buckets:          ${passBuckets.length}`);
  console.log(`  Vehicle free passes:   ${vehiclePasses.length}`);
  console.log(`  Pass purchases:        ${purchases.length}`);
  console.log(`  Unauthorized vehicles: ${unauthorizedVehicles.length}`);

  console.log("\n== Login Accounts (password: $SEED_PASSWORD) ==");
  console.log(`  Admin:    admin@example.com`);
  console.log(`  Staff:    staff@example.com / patrol@example.com`);
  console.log("  Residents:");
  for (const r of residentDefs.slice(0, 10)) {
    const passInfo = r.bonus > 0 ? ` [${r.bonus} bonus]` : "";
    console.log(`    ${r.name.padEnd(22)} ${r.email.padEnd(35)} (Unit ${r.unit})${passInfo}`);
  }
  console.log(`    ... and ${residentDefs.length - 10} more`);

  console.log("\n== Scenario Coverage ==");
  console.log(`  Reference date          : ${today.toISOString().slice(0, 10)}`);
  console.log("  Recent APPROVED stays   : 10 active + 19 past (recent)");
  console.log("  Historical stays        : ~40 PAID + ~15 APPROVED + ~5 CANCELLED across 6 months");
  console.log("  PENDING stays           : 11 (awaiting approval)");
  console.log("  NEEDS_PAYMENT stays     : 6 (incl. multi-month cross-boundary)");
  console.log("  PAID stays              : 12 recent + ~40 historical");
  console.log("  CANCELLED stays         : 5 recent + ~5 historical");
  console.log("  Returning guests        : Roberto (3 units), Anna (2), Tom (3), Yuki (3)");
  console.log("  Multi-month stay        : Stella (30 days), Sophie (30 days)");
  console.log("  Pass buckets            : 6 months x 23 active residents");
  console.log("  Accumulated passes      : David (3 monthly + 3 bonus), Rachel (4 monthly + 5 bonus)");
  console.log("  Zero-pass residents     : Maria (all used), Sarah (all used)");
  console.log("  Inactive residents      : Paul, Lina");
  console.log("  Inactive admin          : admin2@example.com");
  console.log("  Unauthorized (unresolved): 30 | Unauthorized (resolved): ~45 across 6 months");
}

main().catch((err) => {
  console.error("[seed-data] failed:", err.message);
  process.exitCode = 1;
});
