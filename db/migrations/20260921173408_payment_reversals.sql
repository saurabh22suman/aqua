-- payment_reversals
-- PR2-C8 — reversals are new rows, never edits to `payments`. Each
-- row names the payment it corrects and the amount; the service
-- recomputes the invoice in the same transaction. Composite FK keeps
-- the payment and reversal in one tenant; the reason constraint
-- matches the service's 3-300 character rule.

create table payment_reversals (
  id uuid primary key,
  tenant_id uuid not null references tenants (id) on delete cascade,
  payment_id uuid not null,
  amount_paise bigint not null,
  reason text not null,
  reversed_by uuid,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  created_by uuid,
  updated_by uuid,
  constraint payment_reversals_amount_check check (amount_paise > 0),
  constraint payment_reversals_reason_check check (
    char_length(reason) between 3 and 300
  ),
  constraint payment_reversals_id_tenant_key unique (id, tenant_id),
  constraint payment_reversals_payment_tenant_fkey
    foreign key (payment_id, tenant_id) references payments (id, tenant_id)
);

create index payment_reversals_tenant_payment_idx
  on payment_reversals (tenant_id, payment_id);

grant select, insert, update, delete on payment_reversals to app_user;
