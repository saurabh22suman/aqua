import { sql } from "drizzle-orm";
import { check, customType, pgTable, primaryKey, text, timestamp, uuid } from "drizzle-orm/pg-core";
import { tenants } from "./tenants";

const bytea = customType<{ data: Buffer; driverData: Buffer }>({ dataType: () => "bytea" });

export const brandingAssets = pgTable("branding_assets", {
  tenantId: uuid("tenant_id").notNull().references(() => tenants.id, { onDelete: "cascade" }),
  kind: text("kind").notNull(),
  sha256: text("sha256").notNull(),
  png: bytea("png").notNull(),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
}, (t) => [
  primaryKey({ columns: [t.tenantId, t.kind] }),
  check("branding_assets_kind_check", sql`${t.kind} in ('logo', 'install_icon')`),
  check("branding_assets_sha256_check", sql`${t.sha256} ~ '^[a-f0-9]{64}$'`),
  check("branding_assets_png_check", sql`octet_length(${t.png}) between 1 and 5242880 and substring(${t.png} from 1 for 8) = decode('89504e470d0a1a0a', 'hex')`),
]);
