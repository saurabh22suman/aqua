import { sql } from "drizzle-orm";
import type { TenantTx } from "@/db/tenant";
import type { TenantId } from "@/lib/ids";
import { FACILITY_SCOPED_ROLE_KEYS } from "@/lib/services/facility-scope";

// One snapshot. Account phone is compared only for the exact tenant-bound
// source link; a standing staff attestation independently carries pairing.
export function readShowcasePublicationSnapshot(
  tx: TenantTx,
  args: { tenantId: TenantId; key: string; byProfile: boolean },
) {
  const facilityRoles = sql.join(FACILITY_SCOPED_ROLE_KEYS.map((key) => sql`${key}`), sql`, `);
  return tx.execute(sql`
    with member_subject as (
      select
        m.id               as member_id,
        m.person_id       as subject_person_id,
        per.date_of_birth as date_of_birth,
        t.name            as tenant_name,
        t.branding        as branding,
        t.timezone        as timezone,
        p.id              as profile_id,
        p.chosen_name     as chosen_name
      from members m
      join persons per
        on per.id = m.person_id
       and per.tenant_id = m.tenant_id
       and per.deleted_at is null
      join tenants t
        on t.id = m.tenant_id
       and t.status in ('trial', 'active')
      left join showcase_profiles p
        on p.member_id = m.id
       and p.tenant_id = m.tenant_id
       and p.subject_person_id = m.person_id
      where m.tenant_id = ${args.tenantId}
        and m.deleted_at is null
        and (case when ${args.byProfile}::boolean
                  then p.id = ${args.key}::uuid
                  else m.id = ${args.key}::uuid end)
    ),
    live_confirmers as (
      select tm.user_id as user_id, tm.id as membership_id, tm.all_locations, r.key as role_key
      from tenant_memberships tm
      join users confirmer_user
        on confirmer_user.id = tm.user_id
       and confirmer_user.deleted_at is null
      join roles r
        on r.id = tm.role_id
       and r.tenant_id = tm.tenant_id
       and r.deleted_at is null
      where tm.tenant_id = ${args.tenantId}
        and tm.status = 'active'
        and tm.deleted_at is null
        and exists (
          select 1
          from role_permissions rp
          where rp.tenant_id = tm.tenant_id
            and rp.role_id = tm.role_id
            and rp.permission_key = 'members.link.confirm'
        )
    ),
    standing_attestations as (
      select 'member'::text as link_kind, ml.id as link_id, ml.tenant_id as tenant_id
      from member_account_links ml
      join live_confirmers lc
        on lc.user_id = ml.account_binding_confirmed_by_user_id
      where ml.tenant_id = ${args.tenantId}
        and ml.account_binding_confirmed_by_user_id is not null
        and ml.account_binding_confirmed_at is not null
        and (
          (
            ml.account_binding_basis = 'owner_attestation'
            and ml.account_binding_facility_id is null
            and lc.role_key = 'owner'
          )
          or (
            ml.account_binding_basis = 'facility_manager_attestation'
            and ml.account_binding_facility_id is not null
            and (
              lc.role_key = 'owner'
              or (lc.all_locations and lc.role_key in (${facilityRoles}) and exists (
                select 1 from locations live_location
                where live_location.tenant_id = ml.tenant_id
                  and live_location.id = ml.account_binding_facility_id
                  and live_location.deleted_at is null
              ))
              or exists (
                 select 1
                 from membership_locations mloc
                 join locations assigned_location
                   on assigned_location.id = mloc.location_id
                  and assigned_location.tenant_id = mloc.tenant_id
                  and assigned_location.deleted_at is null
                 where mloc.tenant_id = ml.tenant_id
                  and mloc.membership_id = lc.membership_id
                  and mloc.location_id = ml.account_binding_facility_id
              )
            )
          )
        )
      union all
      select 'guardian'::text as link_kind, gl.id as link_id, gl.tenant_id as tenant_id
      from guardian_child_links gl
      join live_confirmers lc
        on lc.user_id = gl.account_binding_confirmed_by_user_id
      where gl.tenant_id = ${args.tenantId}
        and gl.account_binding_confirmed_by_user_id is not null
        and gl.account_binding_confirmed_at is not null
        and (
          (
            gl.account_binding_basis = 'owner_attestation'
            and gl.account_binding_facility_id is null
            and lc.role_key = 'owner'
          )
          or (
            gl.account_binding_basis = 'facility_manager_attestation'
            and gl.account_binding_facility_id is not null
            and (
              lc.role_key = 'owner'
              or (lc.all_locations and lc.role_key in (${facilityRoles}) and exists (
                select 1 from locations live_location
                where live_location.tenant_id = gl.tenant_id
                  and live_location.id = gl.account_binding_facility_id
                  and live_location.deleted_at is null
              ))
              or exists (
                 select 1
                 from membership_locations mloc
                 join locations assigned_location
                   on assigned_location.id = mloc.location_id
                  and assigned_location.tenant_id = mloc.tenant_id
                  and assigned_location.deleted_at is null
                 where mloc.tenant_id = gl.tenant_id
                  and mloc.membership_id = lc.membership_id
                  and mloc.location_id = gl.account_binding_facility_id
              )
            )
          )
        )
    ),
    subject_decision as (
      select
        d.decision        as decision,
        d.decider_user_id as decider_user_id,
        d.member_link_id  as member_link_id,
        d.member_id       as member_id
      from showcase_decisions d
      join member_subject s on s.member_id = d.member_id
      where d.tenant_id = ${args.tenantId}
        and d.decider_role = 'subject'
        and d.decider_person_id = s.subject_person_id
      order by d.decision_seq desc
      limit 1
    ),
    subject_identity as (
      select
        (select sd.decision from subject_decision sd) as decision,
        exists (
          select 1
          from member_account_links ml
          join users account_user on account_user.id = ml.user_id and account_user.deleted_at is null
          join persons sp
            on sp.id = (select subject_person_id from member_subject)
           and sp.tenant_id = ml.tenant_id
           and sp.deleted_at is null
          join subject_decision sd on sd.member_link_id = ml.id
          where ml.tenant_id = ${args.tenantId}
            and ml.user_id = sd.decider_user_id
            and ml.member_id = sd.member_id
            and ml.status = 'active'
            and ml.revoked_at is null
            and ml.verified_phone is not null
            and ml.verified_phone = sp.phone
            and (
              account_user.phone = ml.verified_phone
              or exists (
                select 1
                from standing_attestations sa
                where sa.link_kind = 'member' and sa.link_id = ml.id
              )
            )
        ) as identity_current
    ),
    guardian_latest as (
      select distinct on (d.decider_person_id)
        d.decider_person_id as decider_person_id,
        d.decision          as decision,
        d.guardian_link_id  as guardian_link_id,
        d.decider_user_id   as decider_user_id,
        d.member_id         as member_id
      from showcase_decisions d
      join member_subject s on s.member_id = d.member_id
      join guardianships g
        on g.tenant_id = d.tenant_id
       and g.minor_id = s.subject_person_id
       and g.guardian_id = d.decider_person_id
       and g.deleted_at is null
      join persons gp
        on gp.id = d.decider_person_id
       and gp.tenant_id = d.tenant_id
       and gp.deleted_at is null
      where d.tenant_id = ${args.tenantId}
        and d.decider_role = 'guardian'
        and d.subject_person_id = s.subject_person_id
      order by d.decider_person_id, d.decision_seq desc
    ),
    guardian_identity as (
      select
        gl.decider_person_id as decider_person_id,
        exists (
          select 1
          from guardian_child_links cl
          join users account_user on account_user.id = cl.user_id and account_user.deleted_at is null
          join persons gp
            on gp.id = gl.decider_person_id
           and gp.tenant_id = cl.tenant_id
           and gp.deleted_at is null
          where cl.id = gl.guardian_link_id
            and cl.tenant_id = ${args.tenantId}
            and cl.user_id = gl.decider_user_id
            and cl.member_id = gl.member_id
            and cl.status = 'active'
            and cl.revoked_at is null
            and cl.verified_phone is not null
            and cl.verified_phone = gp.phone
            and exists (
              select 1
              from guardianships g2
              where g2.id = cl.guardianship_id
                and g2.tenant_id = cl.tenant_id
                and g2.deleted_at is null
                and g2.guardian_id = gl.decider_person_id
                and g2.minor_id = (select subject_person_id from member_subject)
            )
            and (
              account_user.phone = cl.verified_phone
              or exists (
                select 1
                from standing_attestations sa
                where sa.link_kind = 'guardian' and sa.link_id = cl.id
              )
            )
        ) as identity_current
      from guardian_latest gl
    ),
    guardian_standings as (
      select coalesce(
        json_agg(
          json_build_object(
            'deciderPersonId', gl.decider_person_id,
            'decision', gl.decision,
            'identityCurrent', coalesce(gi.identity_current, false)
          )
          order by gl.decider_person_id
        ),
        '[]'::json
      ) as standings
      from guardian_latest gl
      left join guardian_identity gi
        on gi.decider_person_id = gl.decider_person_id
    ),
    ranked_assessments as (
      select
        n.name as label,
        coalesce(nullif(n.rubric ->> a.band::text, ''), 'Band ' || a.band::text) as level,
        row_number() over (
          partition by a.node_id
          order by a.assessed_at desc, a.id desc
        ) as rn
      from assessments a
      join member_subject s on s.member_id = a.member_id
      join skill_nodes n
        on n.id = a.node_id
       and n.tenant_id = a.tenant_id
      where a.tenant_id = ${args.tenantId}
    )
    select
      s.member_id,
      s.subject_person_id,
      s.date_of_birth,
      s.timezone,
      s.tenant_name,
      s.branding,
      s.profile_id,
      s.chosen_name,
      si.decision as subject_decision,
      coalesce(si.identity_current, false) as subject_identity_current,
      gs.standings as guardian_standings,
      coalesce(
        (select json_agg(json_build_object('label', ra.label, 'level', ra.level))
         from ranked_assessments ra where ra.rn = 1),
        '[]'::json
      ) as achievements
    from member_subject s
    left join subject_identity si on true
    left join guardian_standings gs on true
  `);
}
