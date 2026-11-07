// Demo units: the sample products.csv names one unit per product, the smallest sold one. A pharmacy sells and buys in
// several, so this derives the pack ladder from each packageDescription ("Hộp 10 Vỉ x 10 Viên" is Viên < Vỉ < Hộp <
// Thùng) and adds the missing rungs through the unit endpoint, as the Pharmacy Manager would. The base unit stays the
// default sale unit, so no price, cart or order changes. Idempotent: a unit that exists is left alone.

const cartonSize = 12; // packs per Thùng, the wholesale unit

const word = (value) => value.charAt(0).toUpperCase() + value.slice(1).toLowerCase();

/** The units above the base unit, as [name, factor to the base unit], smallest first. */
export const derivePackUnits = (packageDescription, baseUnitName) => {
  const text = String(packageDescription ?? "")
    .trim()
    .toLowerCase()
    .replace(/\s+/g, " ");
  const base = String(baseUnitName ?? "").toLowerCase();
  const ladder = [];
  // "hộp 10 vỉ x 10 viên": strip, blister, then the base unit
  const nested = text.match(/^([\p{L}]+) (\d+) ([\p{L}]+) x (\d+) ([\p{L}]+)/u);
  if (nested && nested[5] === base) {
    ladder.push([word(nested[3]), Number(nested[4])]);
    ladder.push([word(nested[1]), Number(nested[2]) * Number(nested[4])]);
  } else {
    // "lốc 10 cuộn", "hộp 20 gói x 4.1g": one pack of N base units
    const flat = text.match(/^([\p{L}]+) (\d+) ([\p{L}]+)/u);
    if (flat && flat[3] === base && flat[1] !== base) ladder.push([word(flat[1]), Number(flat[2])]);
  }
  const top = ladder.at(-1) ?? [word(base), 1];
  if (top[0] === "Hộp" || top[0] === "Chai" || top[0] === "Lốc") ladder.push(["Thùng", top[1] * cartonSize]);
  return ladder.filter(([name, factor]) => name.toLowerCase() !== base && factor > 1);
};

/** An EAN-13 in the 29x range GS1 reserves for in-store use, so a sample code can never be mistaken for a real product. */
export const sampleBarcode = (sku, unitName) => {
  let hash = 7;
  for (const char of `${sku}|${unitName}`) hash = (hash * 31 + char.codePointAt(0)) % 1_000_000_000;
  const digits = `299${String(hash).padStart(9, "0")}`;
  const sum = [...digits].reduce((total, digit, index) => total + Number(digit) * (index % 2 === 0 ? 1 : 3), 0);
  return `${digits}${(10 - (sum % 10)) % 10}`;
};

// The pack a pharmacy orders in; the base unit stays the sale default, so a shopper still buys one tablet.
const purchaseUnitName = "hộp";

export const seedDemoUnits = async ({ manager, admin }) => {
  let changed = 0;
  for (const product of await admin.call("/api/products?limit=100")) {
    const base = product.units?.find((unit) => unit.isBaseUnit) ?? product.units?.[0];
    if (!base) continue;
    const units = [...product.units];
    let sortOrder = Math.max(...units.map((unit) => unit.sortOrder ?? 0)) + 1;
    for (const [unitName, factor] of derivePackUnits(product.packageDescription, base.unitName)) {
      if (units.some((unit) => unit.unitName.toLowerCase() === unitName.toLowerCase())) continue;
      units.push(
        await manager.call(`/api/products/${product.id}/units`, {
          method: "POST",
          body: {
            unitName,
            conversionFactorToBaseUnit: factor,
            isBaseUnit: false,
            isDefaultSaleUnit: false,
            isDefaultPurchaseUnit: false,
            barcode: sampleBarcode(product.sku, unitName),
            sortOrder: sortOrder++,
          },
        }),
      );
      changed += 1;
    }
    const update = async (unit, body) => {
      await manager.call(`/api/products/${product.id}/units/${unit.id}`, { method: "PUT", body });
      changed += 1;
    };
    // Barcodes for pack units made by an earlier seed run, which left them empty.
    for (const unit of units)
      if (!unit.isBaseUnit && !unit.barcode) await update(unit, { barcode: sampleBarcode(product.sku, unit.unitName) });
    const pack = units.find((unit) => unit.unitName.toLowerCase() === purchaseUnitName && !unit.isBaseUnit);
    if (pack && !pack.isDefaultPurchaseUnit) {
      await update(pack, { isDefaultPurchaseUnit: true });
      if (base.isDefaultPurchaseUnit) await update(base, { isDefaultPurchaseUnit: false });
    }
  }
  return changed;
};
