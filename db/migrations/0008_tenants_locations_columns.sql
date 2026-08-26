alter table tenants
  add column currency          text not null default 'INR',
  add column gstin             text,
  add column branding          jsonb not null default '{}',
  add column terminology       jsonb not null default '{}',
  add column preset_key        text,
  add column preset_version    int,
  add column preset_applied_at timestamptz;

alter table locations
  add column address jsonb;

-- presets (key, version) is the referenced PK from 0007. Both columns are
-- nullable and MATCH SIMPLE (the default) skips the FK when either is null.
alter table tenants
  add constraint tenants_preset_fkey
  foreign key (preset_key, preset_version)
  references presets (key, version);

-- a half-filled pair would silently bypass the FK; require both or neither.
alter table tenants
  add constraint tenants_preset_pair_check
  check ((preset_key is null) = (preset_version is null));
