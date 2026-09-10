import { defineConfig } from "drizzle-kit";

export default defineConfig({
  dialect: "postgresql",
  schema: "./src/shared/infrastructure/schema.ts",
  out: "./drizzle/migrations",
  dbCredentials: {
    url:
      process.env.DATABASE_URL ??
      `postgres://${process.env.POSTGRES_USER ?? "pharmacycentral"}:${process.env.POSTGRES_PASSWORD ?? "change_this_password"}@${process.env.POSTGRES_HOST ?? "localhost"}:${process.env.POSTGRES_PORT ?? "5432"}/sales_service`,
  },
});
