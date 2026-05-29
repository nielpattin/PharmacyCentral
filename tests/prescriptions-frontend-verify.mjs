import { readFileSync, existsSync } from "node:fs";
import { resolve } from "node:path";

const root = resolve(import.meta.dirname, "..");
const rel = (path) => resolve(root, path);

const requiredFiles = [
  "src/Frontend/src/pages/shared/prescriptionForms.ts",
  "src/Frontend/src/features/prescriptions/PrescriptionTable.tsx",
  "src/Frontend/src/features/prescriptions/PrescriptionForm.tsx",
  "src/Frontend/src/features/prescriptions/PrescriptionDetail.tsx",
  "src/Frontend/src/pages/PrescriptionPage.tsx",
];

const modifiedFiles = [
  "src/Frontend/src/api/pharmacyClient.ts",
  "src/Frontend/src/App.tsx",
  "src/Frontend/src/lib/i18n.ts",
];

const failures = [];

for (const file of requiredFiles) {
  if (!existsSync(rel(file))) {
    failures.push(`Missing required file: ${file}`);
  }
}

for (const file of modifiedFiles) {
  if (!existsSync(rel(file))) {
    failures.push(`Missing modified file: ${file}`);
  }
}

const app = readFileSync(rel("src/Frontend/src/App.tsx"), "utf8");
if (!app.includes('import PrescriptionPage from "./pages/PrescriptionPage"')) {
  failures.push("App.tsx missing PrescriptionPage import.");
}
if (!app.includes('case "/dashboard/prescriptions":')) {
  failures.push("App.tsx missing /dashboard/prescriptions route case.");
}
if (!app.includes("<PrescriptionPage />")) {
  failures.push("App.tsx not rendering PrescriptionPage.");
}

const client = readFileSync(rel("src/Frontend/src/api/pharmacyClient.ts"), "utf8");
const clientChecks = [
  ["PrescriptionLineDetails", "pharmacyClient missing PrescriptionLineDetails DTO."],
  ["PrescriptionDetails", "pharmacyClient missing PrescriptionDetails DTO."],
  ["PrescriptionCreateRequest", "pharmacyClient missing PrescriptionCreateRequest DTO."],
  ["PrescriptionDispenseRequest", "pharmacyClient missing PrescriptionDispenseRequest DTO."],
  ["loadPrescriptions(", "pharmacyClient missing loadPrescriptions."],
  ["loadPrescription(", "pharmacyClient missing loadPrescription."],
  ["createPrescription(", "pharmacyClient missing createPrescription."],
  ["dispensePrescription(", "pharmacyClient missing dispensePrescription."],
  ["cancelPrescription(", "pharmacyClient missing cancelPrescription."],
];
for (const [needle, message] of clientChecks) {
  if (!client.includes(needle)) {
    failures.push(message);
  }
}

const i18n = readFileSync(rel("src/Frontend/src/lib/i18n.ts"), "utf8");
const i18nChecks = [
  ['"prescription.title": "Prescription"', "i18n missing English prescription.title."],
  ['"prescription.status.Draft": "Draft"', "i18n missing English prescription.status.Draft."],
  ['"prescription.status.PartiallyDispensed": "Partially Dispensed"', "i18n missing English prescription.status.PartiallyDispensed."],
  ['"prescription.validationHeader"', "i18n missing prescription validation key."],
  ['"prescription.title": "Đơn thuốc"', "i18n missing Vietnamese prescription.title."],
  ['"prescription.status.Draft": "Nháp"', "i18n missing Vietnamese prescription.status.Draft."],
];
for (const [needle, message] of i18nChecks) {
  if (!i18n.includes(needle)) {
    failures.push(message);
  }
}

const page = readFileSync(rel("src/Frontend/src/pages/PrescriptionPage.tsx"), "utf8");
if (!page.includes("useMountEffect")) {
  failures.push("PrescriptionPage not using useMountEffect.");
}
if (!page.includes('active="prescriptions"')) {
  failures.push("PrescriptionPage missing AppShell active=prescriptions.");
}
if (!page.includes('t("nav.prescription")')) {
  failures.push("PrescriptionPage missing nav.prescription breadcrumb.");
}

if (failures.length === 0) {
  console.log("Prescription frontend verification passed.");
  process.exit(0);
}

for (const failure of failures) {
  console.error(`FAIL: ${failure}`);
}
process.exit(1);
