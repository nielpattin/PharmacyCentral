import { PGlite } from "@electric-sql/pglite";
import { drizzle } from "drizzle-orm/pglite";
import { migrate } from "drizzle-orm/pglite/migrator";
import { fileURLToPath } from "node:url";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

import type { SalesDatabase } from "../shared/infrastructure/database.ts";
import * as schema from "../shared/infrastructure/schema.ts";
import { SalesRepository } from "./sales-repository.ts";

const migrationsFolder = fileURLToPath(new URL("../../drizzle/migrations", import.meta.url));

/**
 * A counter reader sees the prescriptions of the sites in their scope and nothing else, which the repository
 * expresses as an `IN (...)` of site ids. Running against a real Postgres engine with the real migrations is what
 * shows the clause keeping a colleague's site out and answering nothing at all when the scope is empty.
 */
describe("SalesRepository prescription site filter", () => {
  const client = new PGlite();
  const db = drizzle({ client, schema });
  const repository = new SalesRepository({ db, pool: undefined } as unknown as SalesDatabase);

  const siteA = "00000000-0000-4000-8000-00000000000a";
  const siteB = "00000000-0000-4000-8000-00000000000b";
  const siteC = "00000000-0000-4000-8000-00000000000c";
  const locationA = "00000000-0000-4000-8000-00000000001a";
  const locationB = "00000000-0000-4000-8000-00000000001b";
  const locationC = "00000000-0000-4000-8000-00000000001c";
  const actor = "00000000-0000-4000-8000-00000000002a";
  const prescriptionA = "00000000-0000-4000-8000-00000000003a";
  const prescriptionB = "00000000-0000-4000-8000-00000000003b";
  const prescriptionC = "00000000-0000-4000-8000-00000000003c";

  beforeAll(async () => {
    await migrate(db, { migrationsFolder });
    await db.insert(schema.prescriptions).values([
      {
        id: prescriptionA,
        prescriptionNumber: "RX-A",
        siteId: siteA,
        storageLocationId: locationA,
        patientName: "Nguyễn Thị B",
        createdBy: actor,
      },
      {
        id: prescriptionB,
        prescriptionNumber: "RX-B",
        siteId: siteB,
        storageLocationId: locationB,
        patientName: "Trần Văn C",
        createdBy: actor,
      },
      {
        id: prescriptionC,
        prescriptionNumber: "RX-C",
        siteId: siteC,
        storageLocationId: locationC,
        patientName: "Lê Thị D",
        createdBy: actor,
      },
    ]);
  });

  afterAll(async () => {
    await client.close();
  });

  const idsFor = async (siteIds: string[]): Promise<string[]> =>
    (await repository.listPrescriptions({ siteIds, limit: 100 })).rows.map((row) => row.id).sort();

  it("unions the prescriptions of the reader's sites and excludes every other site", async () => {
    await expect(idsFor([siteA, siteB])).resolves.toEqual([prescriptionA, prescriptionB].sort());
  });

  it("answers one site's prescriptions without the neighbour's", async () => {
    await expect(idsFor([siteB])).resolves.toEqual([prescriptionB]);
  });

  it("answers nothing for an empty site scope", async () => {
    await expect(idsFor([])).resolves.toEqual([]);
  });
});
