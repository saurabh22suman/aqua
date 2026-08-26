import { Client } from "pg";
import { v7 as uuidv7 } from "uuid";

const FEATURES: ReadonlyArray<{
  key: string;
  name: string;
  category: string;
  status: "ga" | "beta" | "internal";
}> = [
  { key: "members", name: "Members", category: "core", status: "ga" },
  { key: "attendance", name: "Attendance", category: "core", status: "ga" },
  { key: "programs", name: "Programs and batches", category: "core", status: "ga" },
  { key: "enquiries", name: "Enquiries and trials", category: "growth", status: "ga" },
  { key: "billing", name: "Invoicing and payments", category: "money", status: "ga" },
  { key: "staff", name: "Staff", category: "staff", status: "ga" },
  { key: "reports", name: "Reports", category: "insight", status: "ga" },
  { key: "settings", name: "Settings and configuration", category: "platform", status: "ga" },
  { key: "messaging", name: "WhatsApp and email", category: "comms", status: "ga" },
  { key: "pool.booking", name: "Facility booking", category: "facility", status: "ga" },
  { key: "swim.levels", name: "Swimming skill levels", category: "vertical", status: "ga" },
  { key: "cafe.pos", name: "Café POS", category: "commerce", status: "internal" },
  { key: "analytics.advanced", name: "Advanced analytics", category: "insight", status: "internal" },
];

export async function seedPlatformCatalogue(
  connectionString: string,
): Promise<void> {
  const client = new Client({ connectionString });
  await client.connect();

  try {
    for (const f of FEATURES) {
      await client.query(
        `insert into features (key, name, category, status)
         values ($1, $2, $3, $4)
         on conflict (key) do update
           set name = excluded.name,
               category = excluded.category,
               status = excluded.status`,
        [f.key, f.name, f.category, f.status],
      );
    }

    // price_paise stays NULL: the pricing-model decision (scope §2.5) is
    // deliberately not encoded here. Never seed a price.
    await client.query(
      `insert into plans (id, key, name, status, price_paise, currency, is_default, sort_order)
       values ($1, 'standard', 'Standard', 'active', null, 'INR', true, 0)
       on conflict (key) do update
         set name = excluded.name,
             status = excluded.status,
             price_paise = null,
             currency = excluded.currency,
             is_default = excluded.is_default,
             sort_order = excluded.sort_order,
             updated_at = now()`,
      [uuidv7()],
    );

    // mechanical rule: every ga feature, empty limits. The internal
    // features are catalogued but unplanned — a maturity gate, not a tier.
    await client.query(
      `insert into plan_features (plan_id, feature_key, limits)
       select p.id, f.key, '{}'::jsonb
       from plans p
       cross join features f
       where p.key = 'standard' and f.status = 'ga'
       on conflict do nothing`,
    );

    await client.query(
      `update tenants
       set plan_id = (select id from plans where key = 'standard')
       where plan_id is null`,
    );
  } finally {
    await client.end();
  }
}
