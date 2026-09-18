-- 20260918142000_v10_framework_bridge
--
-- V-09 — bridge the preset-shaped skill ladders into the generic
-- framework. The presets seed `skill_levels` (a level per ordinal)
-- and `skills` (a skill with a four-band rubric, FK to its level).
-- M-03 added the generic `skill_frameworks` / `skill_nodes`, but
-- nothing populated them. This migration populates them from every
-- ladder that exists at deploy time, and `applyPreset` bridges the
-- ladder it seeds from here on (lib/services/skill-ladder.ts).
--
-- Mapping (one framework per tenant ladder — skill_levels carries no
-- program/activity column, so the tenant is the only honest scope):
--   * framework id = md5('<tenant_id>:v10:ladder')::uuid — stable
--     across re-runs and independent of the display name, which the
--     owner can edit.
--   * activity_type_key comes from the tenant's preset binding:
--       swimming            -> swimming
--       dance-ma            -> fitness  (the M-01 catalogue has no
--                               dance/martial-arts key; fitness is the
--                               closest progress-capable type)
--       any other key that already names an activity type -> itself
--       otherwise the first catalogue key by (sort_order, key) so the
--       fallback is deterministic, never random
--   * skill_levels row -> top-level skill_nodes row: id = level.id,
--     ordinal = level.ordinal, rubric = '{}'.
--   * skills row -> child skill_nodes row: id = skill.id, parent =
--     its level node, ordinal = row_number() within the level ordered
--     by (name, id), rubric = skill.rubric.
--
-- Idempotency is structural, not name-based: every node reuses its
-- source row's id. A re-run (or a re-run after an owner renamed a node
-- in /owner/settings/skills) conflicts on the primary key and inserts
-- nothing.
--
-- The swim-shaped tables stay intact — this migration only reads them.
-- V-09's editor owns the generic ladder from here on; applyPreset keeps
-- writing the preset's version to skill_levels/skills as before.

with ladder as (
  select
    t.id as tenant_id,
    coalesce(
      t.preset_key,
      (
        select lp.preset_key
        from location_presets lp
        where lp.tenant_id = t.id
        order by lp.applied_at, lp.preset_key
        limit 1
      )
    ) as preset_key
  from tenants t
  where exists (
    select 1 from skill_levels sl where sl.tenant_id = t.id
  )
),
resolved as (
  select
    l.tenant_id,
    case
      when l.preset_key in (select key from activity_types) then l.preset_key
      when l.preset_key = 'dance-ma' then 'fitness'
      else (select key from activity_types order by sort_order, key limit 1)
    end as activity_type_key
  from ladder l
)
insert into skill_frameworks (
  id, tenant_id, activity_type_key, name, version,
  is_active, created_by, updated_by
)
select
  md5(r.tenant_id::text || ':v10:ladder')::uuid,
  r.tenant_id,
  r.activity_type_key,
  a.name || ' skill ladder',
  1,
  true,
  null,
  null
from resolved r
join activity_types a on a.key = r.activity_type_key
on conflict (id, tenant_id) do nothing;

-- Level nodes: one per skill_levels row, reusing its id.
insert into skill_nodes (
  id, tenant_id, framework_id, parent_id, name, ordinal, rubric,
  created_by, updated_by
)
select
  sl.id,
  sl.tenant_id,
  md5(sl.tenant_id::text || ':v10:ladder')::uuid,
  null,
  sl.name,
  sl.ordinal,
  '{}'::jsonb,
  null,
  null
from skill_levels sl
on conflict (id, tenant_id) do nothing;

-- Skill nodes: one per skills row, reusing its id and hanging off the
-- level node inserted above. The level node's id IS the source
-- skill_level_id, so the join needs no name matching.
with ranked as (
  select
    s.id,
    s.tenant_id,
    s.skill_level_id,
    s.name,
    s.rubric,
    row_number() over (
      partition by s.tenant_id, s.skill_level_id
      order by s.name, s.id
    ) as ordinal
  from skills s
)
insert into skill_nodes (
  id, tenant_id, framework_id, parent_id, name, ordinal, rubric,
  created_by, updated_by
)
select
  r.id,
  r.tenant_id,
  parent.framework_id,
  r.skill_level_id,
  r.name,
  r.ordinal,
  r.rubric,
  null,
  null
from ranked r
join skill_nodes parent
  on parent.id = r.skill_level_id
 and parent.tenant_id = r.tenant_id
on conflict (id, tenant_id) do nothing;
