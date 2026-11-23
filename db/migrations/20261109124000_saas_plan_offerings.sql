-- Three signup offers; Trial remains the existing tenant lifecycle status.
-- No prices, duration, paid activation, quotas, new grants or RLS policy.
alter table plans add column available_for_new_tenants boolean not null default false;

-- Do not deprecate Standard: its active status preserves existing access.
update plans set available_for_new_tenants=false, is_default=false
where key='standard';

insert into plans (id,key,name,status,price_paise,currency,is_default,sort_order,available_for_new_tenants)
values
  (gen_random_uuid(),'starter','Starter','active',null,'INR',false,10,true),
  (gen_random_uuid(),'growth','Growth','active',null,'INR',false,20,true),
  (gen_random_uuid(),'multi_site','Multi-site','active',null,'INR',false,30,true)
on conflict (key) do nothing;

-- Technical local access parity only, not final commercial packaging.
-- Preserve every existing plan-feature row and its limits JSON.
insert into plan_features (plan_id,feature_key,limits)
select target.id,baseline.feature_key,baseline.limits
from plans target cross join plan_features baseline
join plans legacy on legacy.id=baseline.plan_id
where target.key in ('starter','growth','multi_site') and legacy.key='standard'
on conflict do nothing;

-- Switch only the legacy default, or fill a missing default. Keep a configured
-- non-legacy default intact; the constraint below requires it to be eligible.
update plans set is_default=true where key='starter'
and status='active' and available_for_new_tenants
and not exists (select 1 from plans where is_default);

alter table plans add constraint plans_signup_default_check
check (not is_default or (status='active' and available_for_new_tenants));

comment on column plans.available_for_new_tenants is
  'Sale eligibility only. False keeps active legacy plan entitlements for existing clubs.';
