import { availabilityProjections } from "../../../shared/infrastructure/schema.ts";
import type { CatalogDatabase } from "../../../shared/infrastructure/database.ts";

export type AvailabilityProjectionOptions = {
  /** Runs after every stored change, so the shared availability cache drops its entries. */
  onApplied?: (() => Promise<void>) | undefined;
};

export class AvailabilityProjection {
  public constructor(
    private readonly database: CatalogDatabase,
    private readonly options: AvailabilityProjectionOptions = {},
  ) {}

  public async apply(input: { productId: string; siteId: string; inStock: boolean }): Promise<void> {
    await this.database.db
      .insert(availabilityProjections)
      .values({ ...input, updatedAt: new Date() })
      .onConflictDoUpdate({
        target: [availabilityProjections.productId, availabilityProjections.siteId],
        set: { inStock: input.inStock, updatedAt: new Date() },
      });
    await this.options.onApplied?.();
  }
}
