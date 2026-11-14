-- Reject legacy writers at explicitly enabled sites. Normal services acquire
-- the tenant anchor before reading effective identity or locking order/counter.
-- Trigger queries run as the invoker under tenant RLS, never as a definer.
create function lock_facility_billing_settings_tenant() returns trigger
language plpgsql set search_path = public, pg_temp as $$
declare anchor_id uuid;
begin
  if tg_op = 'DELETE' then anchor_id := old.tenant_id;
  else anchor_id := new.tenant_id;
  end if;
  -- A real MVCC tuple update also invalidates repeatable-read snapshots that
  -- predate an enablement. A lock alone would leave those snapshots usable.
  update public.tenants set updated_at = clock_timestamp() where id = anchor_id;
  if not found and tg_op <> 'DELETE' then
    raise exception 'tenant unavailable for issuer validation' using errcode = '23514';
  end if;
  -- A tenant-removal cascade may already have removed the parent. No future
  -- issuer insert can survive that tenant's FK; preserve owned-row cleanup.
  if tg_op = 'DELETE' then return old; end if;
  return new;
end $$;
revoke all on function lock_facility_billing_settings_tenant() from public;
create trigger location_billing_settings_tenant_anchor_trg
  before insert or update or delete on public.location_billing_settings
  for each row execute function lock_facility_billing_settings_tenant();

create function guard_facility_issuer_insert() returns trigger
language plpgsql set search_path = public, pg_temp as $$
declare enabled boolean;
begin
  perform 1 from public.tenants where id = new.tenant_id for update;
  if not found then
    raise exception 'tenant unavailable for issuer validation' using errcode = '23514';
  end if;
  select s.facility_billing_enabled into enabled
    from public.location_billing_settings s
    where s.tenant_id = new.tenant_id and s.location_id = new.location_id;
  if coalesce(enabled, false) and new.issuer_snapshot_version <> 1 then
    raise exception 'enabled site requires issuer snapshot version 1' using errcode = '23514';
  end if;
  return new;
end $$;
revoke all on function guard_facility_issuer_insert() from public;
create trigger invoices_facility_issuer_insert_trg before insert on public.invoices
  for each row execute function guard_facility_issuer_insert();
create trigger orders_facility_issuer_insert_trg before insert on public.orders
  for each row execute function guard_facility_issuer_insert();
