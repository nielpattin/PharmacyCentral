import { PGlite } from "@electric-sql/pglite";
import { drizzle } from "drizzle-orm/pglite";
import { migrate } from "drizzle-orm/pglite/migrator";
import { fileURLToPath } from "node:url";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";

import type { SalesDatabase } from "../shared/infrastructure/database.ts";
import * as schema from "../shared/infrastructure/schema.ts";
import { SalesRepository } from "./sales-repository.ts";

const migrationsFolder = fileURLToPath(new URL("../../drizzle/migrations", import.meta.url));

/**
 * The invariants under test are carried by SQL in production: a partial unique index allows one default per
 * shopper. Running the repository against a real Postgres engine with the real migrations is what makes an
 * accidental second default surface as a failed statement instead of as a silently wrong row.
 */
describe("SalesRepository delivery address defaults", () => {
  const client = new PGlite();
  const db = drizzle({ client, schema });
  const repository = new SalesRepository({ db, pool: undefined } as unknown as SalesDatabase);

  const shopper = "00000000-0000-4000-8000-00000000000a";
  const otherShopper = "00000000-0000-4000-8000-00000000000b";

  const addAddress = (customerId: string, label: string, isDefault?: boolean) =>
    repository.createDeliveryAddress({
      customerId,
      label,
      latitude: 10.79,
      longitude: 106.68,
      providerResolvedAddress: `12 Nguyễn Trãi, ${label}`,
      isDefault,
    });

  const defaultLabels = async (customerId: string): Promise<string[]> =>
    (await repository.listDeliveryAddresses(customerId)).filter((row) => row.isDefault).map((row) => row.label);

  beforeAll(async () => {
    await migrate(db, { migrationsFolder });
  });

  beforeEach(async () => {
    await client.exec("DELETE FROM delivery_addresses");
  });

  afterAll(async () => {
    await client.close();
  });

  it("makes a shopper's first address their default without being asked", async () => {
    const first = await addAddress(shopper, "Nhà");

    expect(first?.isDefault).toBe(true);
  });

  it("leaves a later address undefaulted so the shopper keeps the one they already had", async () => {
    await addAddress(shopper, "Nhà");

    const second = await addAddress(shopper, "Văn phòng");

    expect(second?.isDefault).toBe(false);
    await expect(defaultLabels(shopper)).resolves.toEqual(["Nhà"]);
  });

  it("moves the default to a newly created address that asks for it", async () => {
    await addAddress(shopper, "Nhà");

    await addAddress(shopper, "Văn phòng", true);

    await expect(defaultLabels(shopper)).resolves.toEqual(["Văn phòng"]);
  });

  it("promotes a survivor when the default address is deleted", async () => {
    const home = await addAddress(shopper, "Nhà");
    await addAddress(shopper, "Văn phòng");

    await repository.deleteDeliveryAddress(shopper, home?.id ?? "");

    // The shopper still has an address, so one of them has to carry the default flag.
    await expect(defaultLabels(shopper)).resolves.toEqual(["Văn phòng"]);
  });

  it("deletes the only address without promoting anything", async () => {
    const home = await addAddress(shopper, "Nhà");

    const deleted = await repository.deleteDeliveryAddress(shopper, home?.id ?? "");

    expect(deleted?.label).toBe("Nhà");
    await expect(repository.listDeliveryAddresses(shopper)).resolves.toHaveLength(0);
  });

  it("keeps each shopper's default their own when one of them deletes theirs", async () => {
    await addAddress(shopper, "Nhà");
    const stranger = await addAddress(otherShopper, "Nhà người khác");
    await addAddress(otherShopper, "Văn phòng người khác");

    await repository.deleteDeliveryAddress(otherShopper, stranger?.id ?? "");

    await expect(defaultLabels(shopper)).resolves.toEqual(["Nhà"]);
    await expect(defaultLabels(otherShopper)).resolves.toEqual(["Văn phòng người khác"]);
  });

  it("returns nothing when deleting an address that belongs to another shopper", async () => {
    const home = await addAddress(shopper, "Nhà");

    const deleted = await repository.deleteDeliveryAddress(otherShopper, home?.id ?? "");

    expect(deleted).toBeUndefined();
    await expect(repository.listDeliveryAddresses(shopper)).resolves.toHaveLength(1);
  });

  it("hands the default over when an edit promotes another address", async () => {
    await addAddress(shopper, "Nhà");
    const office = await addAddress(shopper, "Văn phòng");

    await repository.updateDeliveryAddress(shopper, office?.id ?? "", { isDefault: true });

    await expect(defaultLabels(shopper)).resolves.toEqual(["Văn phòng"]);
  });

  it("gives the default to a survivor when an edit demotes the only default", async () => {
    const home = await addAddress(shopper, "Nhà");
    await addAddress(shopper, "Văn phòng");

    await repository.updateDeliveryAddress(shopper, home?.id ?? "", { isDefault: false });

    await expect(defaultLabels(shopper)).resolves.toEqual(["Văn phòng"]);
  });
});
