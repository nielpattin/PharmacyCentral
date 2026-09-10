import { availabilityProjections } from "../../../shared/infrastructure/schema.ts";
import type { CatalogDatabase } from "../../../shared/infrastructure/database.ts";

export class AvailabilityProjection {
  public constructor(private readonly database: CatalogDatabase) {}

  public async apply(input: { productId: string; siteId: string; inStock: boolean }): Promise<void> {
    await this.database.db
      .insert(availabilityProjections)
      .values({ ...input, updatedAt: new Date() })
      .onConflictDoUpdate({
        target: [availabilityProjections.productId, availabilityProjections.siteId],
        set: { inStock: input.inStock, updatedAt: new Date() },
      });
  }
}
