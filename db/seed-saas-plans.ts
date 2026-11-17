import type { Client } from "pg";
import { v7 as uuidv7 } from "uuid";

const OFFERS = [
  { key: "starter", name: "Starter", order: 10 },
  { key: "growth", name: "Growth", order: 20 },
  { key: "multi_site", name: "Multi-site", order: 30 },
] as const;

// Local technical access parity is explicit; commercial packaging, prices and
// quotas remain unconfigured. Existing recorded prices/defaults are preserved.
// One transaction protects the default-plan unique index and catalogue segment.
export async function seedSaasPlans(client: Client): Promise<void> {
  await client.query("begin");
  try {
    await client.query(`insert into plans
      (id,key,name,status,price_paise,currency,is_default,sort_order,available_for_new_tenants)
      values ($1,'standard','Standard','active',null,'INR',false,0,false)
      on conflict (key) do nothing`, [uuidv7()]);
    await client.query(`update plans set available_for_new_tenants=false, is_default=false
      where key='standard' and (available_for_new_tenants or is_default)`);
    await client.query(`insert into plan_features (plan_id,feature_key,limits)
      select p.id,f.key,'{}'::jsonb from plans p cross join features f
      where p.key='standard' and f.status='ga' on conflict do nothing`);
    for (const offer of OFFERS) {
      await client.query(`insert into plans
        (id,key,name,status,price_paise,currency,is_default,sort_order,available_for_new_tenants)
        values ($1,$2,$3,'active',null,'INR',false,$4,true)
        on conflict (key) do nothing`, [uuidv7(),offer.key,offer.name,offer.order]);
      await client.query(`insert into plan_features (plan_id,feature_key,limits)
        select target.id,baseline.feature_key,baseline.limits
        from plans target cross join plan_features baseline
        join plans legacy on legacy.id=baseline.plan_id
        where target.key=$1 and legacy.key='standard' on conflict do nothing`, [offer.key]);
    }
    await client.query(`update plans set is_default=true where key='starter'
      and status='active' and available_for_new_tenants
      and not exists (select 1 from plans where is_default)`);
    await client.query("commit");
  } catch (error) {
    await client.query("rollback");
    throw error;
  }
}
