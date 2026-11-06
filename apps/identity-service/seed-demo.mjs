// Demo seed (B), accounts part: the demo staff and shopper accounts, with the password from DEMO_ACCOUNT_PASSWORD.
// It runs from `pnpm run seed:demo`, after the default seed (A) and after the sites are imported, because the site
// access of an account names a catalog site. The Platform Admin is not here: the default seed owns it.
import { Client } from "pg";
import { databaseUrl, requireEnvironmentVariable, seedAccounts } from "./seed-support.mjs";

if (process.argv.includes("--dry-run")) {
  console.log(JSON.stringify({ service: "identity-service", status: "dry-run", seed: "demo" }));
  process.exit(0);
}

// The five pharmacies. SITE-RTL is served by the shared manager and pharmacist below; each of the other four has its own
// manager and pharmacist, who reach that store alone.
const retailSites = ["SITE-RTL", "SITE-RTL2", "SITE-RTL3", "SITE-RTL4", "SITE-RTL5"];

// The managers and the warehouse account do the work Platform Admin used to do, so they reach every site that holds
// stock or master data: the managers every site, the warehouse account the ones that hold stock.
const stockSites = ["SITE-WH", "SITE-HUB", ...retailSites];
const allSites = ["SITE-HQ", ...stockSites];

/** The staff of one pharmacy: the ids are fixed so a reseed updates the same account. */
const storeStaff = [
  {
    siteCode: "SITE-RTL2",
    manager: { id: 13, email: "manager.rtl2@pharmacycentral.vn", displayName: "Đỗ Thanh Tùng" },
    pharmacist: { id: 14, email: "pharmacist.rtl2@pharmacycentral.vn", displayName: "Ngô Thị Thu" },
  },
  {
    siteCode: "SITE-RTL3",
    manager: { id: 15, email: "manager.rtl3@pharmacycentral.vn", displayName: "Bùi Quang Huy" },
    pharmacist: { id: 16, email: "pharmacist.rtl3@pharmacycentral.vn", displayName: "Đinh Thị Hạnh" },
  },
  {
    siteCode: "SITE-RTL4",
    manager: { id: 17, email: "manager.rtl4@pharmacycentral.vn", displayName: "Vũ Hoàng Long" },
    pharmacist: { id: 18, email: "pharmacist.rtl4@pharmacycentral.vn", displayName: "Lương Thị Mỹ" },
  },
  {
    siteCode: "SITE-RTL5",
    manager: { id: 19, email: "manager.rtl5@pharmacycentral.vn", displayName: "Trịnh Đức Anh" },
    pharmacist: { id: 20, email: "pharmacist.rtl5@pharmacycentral.vn", displayName: "Phan Thị Yến" },
  },
];
const accountId = (number) => `00000000-0000-4000-8000-${String(number).padStart(12, "0")}`;
// The phone numbers of the accounts above end at 0902000005, so the store staff continue from the next one.
const FIRST_STORE_STAFF_PHONE = 902_000_006;
const storeStaffAccounts = storeStaff.flatMap(({ siteCode, manager, pharmacist }, storeIndex) =>
  [
    { person: manager, role: "Pharmacy Manager" },
    { person: pharmacist, role: "Pharmacist" },
  ].map(({ person, role }, personIndex) => ({
    id: accountId(person.id),
    actorType: "employee",
    email: person.email,
    displayName: person.displayName,
    phoneNumber: `0${FIRST_STORE_STAFF_PHONE + storeIndex * 2 + personIndex}`,
    roles: [role],
    siteCodes: [siteCode],
  })),
);

/**
 * One account per staff role, each holding only that role, so signing in as one shows exactly what the role may do.
 * A second Pharmacy Manager exists for separation of duties. Site access names `catalog_service` site codes from
 * `data/import-samples/sites.csv`.
 */
const demoAccounts = [
  {
    id: "00000000-0000-4000-8000-000000000002",
    actorType: "customer",
    email: "khachhang@pharmacycentral.vn",
    displayName: "Trần Thu Hà",
    roles: [],
    siteCodes: [],
  },
  {
    id: "00000000-0000-4000-8000-000000000003",
    actorType: "employee",
    email: "manager@pharmacycentral.vn",
    displayName: "Lê Minh Châu",
    phoneNumber: "0902000002",
    roles: ["Pharmacy Manager"],
    siteCodes: allSites,
  },
  {
    id: "00000000-0000-4000-8000-000000000004",
    actorType: "employee",
    email: "pharmacist@pharmacycentral.vn",
    displayName: "Phạm Thị Lan",
    phoneNumber: "0902000003",
    roles: ["Pharmacist"],
    siteCodes: ["SITE-RTL"],
  },
  {
    id: "00000000-0000-4000-8000-000000000005",
    actorType: "employee",
    email: "warehouse@pharmacycentral.vn",
    displayName: "Võ Văn Hùng",
    phoneNumber: "0902000004",
    roles: ["Warehouse Staff"],
    siteCodes: stockSites,
  },
  // A second manager: nobody approves their own purchase order or price, so the first manager approves this one's.
  {
    id: "00000000-0000-4000-8000-000000000012",
    actorType: "employee",
    email: "manager2@pharmacycentral.vn",
    displayName: "Hoàng Quốc Bảo",
    phoneNumber: "0902000005",
    roles: ["Pharmacy Manager"],
    siteCodes: allSites,
  },
  // More shoppers, so the order lists and the pharmacist queue show different people rather than one account.
  {
    id: "00000000-0000-4000-8000-000000000006",
    actorType: "customer",
    email: "nguyen.lan@example.com",
    displayName: "Nguyễn Thị Lan Anh",
    roles: [],
    siteCodes: [],
  },
  {
    id: "00000000-0000-4000-8000-000000000007",
    actorType: "customer",
    email: "tran.minh.khoa@example.com",
    displayName: "Trần Minh Khoa",
    roles: [],
    siteCodes: [],
  },
  {
    id: "00000000-0000-4000-8000-000000000008",
    actorType: "customer",
    email: "le.thanh.huong@example.com",
    displayName: "Lê Thanh Hương",
    roles: [],
    siteCodes: [],
  },
  {
    id: "00000000-0000-4000-8000-000000000009",
    actorType: "customer",
    email: "pham.quoc.viet@example.com",
    displayName: "Phạm Quốc Việt",
    roles: [],
    siteCodes: [],
  },
  {
    id: "00000000-0000-4000-8000-000000000010",
    actorType: "customer",
    email: "vo.ngoc.mai@example.com",
    displayName: "Võ Ngọc Mai",
    roles: [],
    siteCodes: [],
  },
  {
    id: "00000000-0000-4000-8000-000000000011",
    actorType: "customer",
    email: "dang.hoang.nam@example.com",
    displayName: "Đặng Hoàng Nam",
    roles: [],
    siteCodes: [],
  },
  ...storeStaffAccounts,
];
// Sites are imported master data with generated ids, so the seed looks their codes up rather than inventing ids.
const siteCodes = [...new Set(demoAccounts.flatMap((account) => account.siteCodes))];
const catalog = new Client({ connectionString: databaseUrl("catalog_service", "CATALOG_DB_PASSWORD") });
await catalog.connect();
let siteIdsByCode;
try {
  const sites = await catalog.query("SELECT id, code FROM sites WHERE code = ANY($1)", [siteCodes]);
  siteIdsByCode = new Map(sites.rows.map((row) => [row.code, row.id]));
} finally {
  await catalog.end();
}
const missingSites = siteCodes.filter((code) => !siteIdsByCode.has(code));
if (missingSites.length) {
  throw new Error(
    `Sites ${missingSites.join(", ")} are not in the catalog. Import data/import-samples/sites.csv first.`,
  );
}

await seedAccounts({
  accounts: demoAccounts,
  password: requireEnvironmentVariable("DEMO_ACCOUNT_PASSWORD"),
  siteIdsByCode,
});
console.log(JSON.stringify({ service: "identity-service", status: "seeded", seed: "demo", scope: "accounts" }));
console.table(
  demoAccounts.map((account) => ({
    email: account.email,
    phone: account.phoneNumber ?? "-",
    roles: account.roles.join(", ") || "(customer)",
    sites: account.siteCodes.join(", ") || "-",
  })),
);
