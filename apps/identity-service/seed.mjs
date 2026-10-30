// Default seed (A): exactly one account, the Platform Admin, with the password from ADMIN_PASSWORD. Nothing else.
// Safe to run on every start and every release: it updates that one account by id. The demo dataset (B) is
// seed-demo.mjs and needs this admin first.
import { requireEnvironmentVariable, seedAccounts } from "./seed-support.mjs";

if (process.argv.includes("--dry-run")) {
  console.log(JSON.stringify({ service: "identity-service", status: "dry-run", seed: "default" }));
  process.exit(0);
}

const admin = {
  id: "00000000-0000-4000-8000-000000000001",
  actorType: "employee",
  email: "admin@pharmacycentral.vn",
  displayName: "Nguyễn Quốc Bảo",
  phoneNumber: "0902000001",
  roles: ["Platform Admin"],
  siteCodes: [],
};

await seedAccounts({ accounts: [admin], password: requireEnvironmentVariable("ADMIN_PASSWORD") });
console.log(
  JSON.stringify({ service: "identity-service", status: "seeded", seed: "default", accounts: [admin.email] }),
);
