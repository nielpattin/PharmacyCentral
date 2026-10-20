import { eq } from "drizzle-orm";

import { aiProviders } from "../contracts/credentials.ts";
import type { CredentialStore, StoredCredential } from "../modules/credentials/credential-store.ts";
import type { ChatDatabase } from "../shared/infrastructure/database.ts";
import { aiCredentials } from "../shared/infrastructure/schema.ts";

export class DrizzleCredentialStore implements CredentialStore {
  private readonly database: ChatDatabase;

  public constructor(database: ChatDatabase) {
    this.database = database;
  }

  public async find(purpose: string): Promise<StoredCredential | undefined> {
    const [row] = await this.database.db
      .select()
      .from(aiCredentials)
      .where(eq(aiCredentials.purpose, purpose))
      .limit(1);
    if (!row) return undefined;
    const provider = aiProviders.find((id) => id === row.provider);
    if (!provider) {
      throw new Error(
        `The ai_credentials row for "${purpose}" holds provider "${row.provider}", which is not a known provider.`,
      );
    }
    return {
      provider,
      model: row.model,
      baseUrl: row.baseUrl,
      ciphertext: row.ciphertext,
      last4: row.last4,
      updatedBy: row.updatedBy,
      updatedAt: row.updatedAt,
    };
  }

  public async save(purpose: string, credential: StoredCredential): Promise<void> {
    await this.database.db
      .insert(aiCredentials)
      .values({ purpose, ...credential })
      .onConflictDoUpdate({ target: aiCredentials.purpose, set: credential });
  }

  public async remove(purpose: string): Promise<void> {
    await this.database.db.delete(aiCredentials).where(eq(aiCredentials.purpose, purpose));
  }
}
