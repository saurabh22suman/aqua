-- C-12 to C-15: enquiries -> trial -> conversion. Numbered 0019, not
-- 0018 -- 0018 is reserved on a sibling branch (C-04's staff table);
-- picked to avoid a collision once both merge, not because this
-- branch's own history has a gap.
create table enquiries (
  id          uuid primary key,
  tenant_id   uuid not null references tenants(id),
  full_name   text not null,
  phone       text,
  source      text not null,
  stage       text not null default 'new',
  -- Bare user id, no FK -- same interim shape as batches.coach_id
  -- before C-04 (migration 0014's comment). This task doesn't depend
  -- on C-04 (the user's own task list doesn't list that dependency),
  -- so it doesn't pull staff in; migrate onto staff.id later, same as
  -- coach_id did.
  assigned_to_user_id uuid,
  -- Set once a real member exists for this enquiry -- at trial
  -- booking (status starts 'trial') if one happened, or at direct
  -- conversion (status 'active') if it didn't. One column either way:
  -- it's the same member row through that transition, not two.
  member_id   uuid,
  trial_batch_id uuid,
  notes       text,
  deleted_at  timestamptz,
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now(),
  created_by  uuid,
  updated_by  uuid,
  check (source in ('walk-in', 'phone', 'referral', 'online', 'other')),
  check (stage in ('new', 'contacted', 'trial_scheduled', 'trial_completed', 'converted', 'lost')),
  foreign key (member_id, tenant_id) references members (id, tenant_id),
  foreign key (trial_batch_id, tenant_id) references batches (id, tenant_id)
);

create unique index enquiries_id_tenant_key on enquiries (id, tenant_id);
create index on enquiries (tenant_id) where deleted_at is null;
create index on enquiries (tenant_id, stage) where deleted_at is null;

alter table enquiries enable row level security;
alter table enquiries force row level security;

create policy tenant_isolation on enquiries
  using (tenant_id = nullif(current_setting('app.tenant_id', true), '')::uuid)
  with check (tenant_id = nullif(current_setting('app.tenant_id', true), '')::uuid);

create table enquiry_follow_ups (
  id          uuid primary key,
  tenant_id   uuid not null references tenants(id),
  enquiry_id  uuid not null,
  due_at      timestamptz not null,
  note        text,
  done_at     timestamptz,
  assigned_to_user_id uuid,
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now(),
  created_by  uuid,
  updated_by  uuid,
  foreign key (enquiry_id, tenant_id) references enquiries (id, tenant_id)
);

create index on enquiry_follow_ups (tenant_id, due_at) where done_at is null;

alter table enquiry_follow_ups enable row level security;
alter table enquiry_follow_ups force row level security;

create policy tenant_isolation on enquiry_follow_ups
  using (tenant_id = nullif(current_setting('app.tenant_id', true), '')::uuid)
  with check (tenant_id = nullif(current_setting('app.tenant_id', true), '')::uuid);
