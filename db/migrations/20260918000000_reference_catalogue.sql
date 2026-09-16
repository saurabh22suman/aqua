-- 20260918000000_reference_catalogue
--
-- Third occurrence of the catalogue seeding pattern (the first two:
-- #125 deploy-order failures on the permissions / policy_versions FK
-- chain, and the staff-records / coach-me-page / invite-link-reset-
-- purpose suite failures that came from the same cause). Until this
-- migration, db/seed-platform.ts::seedPlatformCatalogue() — run only
-- by `pnpm test` (pretest) and `pnpm db:seed` / `pnpm demo:reset` —
-- was the only path that populated the closed reference catalogues.
-- `pnpm db:deploy`, the real production entry point, did not.
--
-- A fresh production database after `pnpm db:deploy` therefore had
-- empty `permissions`, `features`, `plan_features`, `plans`,
-- `presets`, `config_keys`, and `policy_versions` tables. The first
-- call to requirePermission('settings.manage') in lib/actions/
-- branding.ts:60 hit the role_permissions FK and crashed with a
-- "violates foreign key constraint" — exactly the staff-records
-- / coach-me-page / invite-link-reset-purpose suite-failure class.
--
-- This migration inserts the same rows the seed script did, with
-- ON CONFLICT DO NOTHING so a freshly-migrated database ends up
-- correct without any script and a freshly-reset database that
-- already has these rows leaves them in place. seedPlatformCatalogue
-- becomes a no-op against a database that has run this migration.
--
-- Source-of-truth: db/seed-platform.ts (PERMISSIONS, FEATURES,
-- PRESETS), db/config-definitions.ts (CONFIG_KEYS), and the inline
-- policy_versions literal at seedPlatformCatalogue(). All five are
-- exported and read by scripts/build-catalogue-migration.ts, which
-- generated this file. New catalogue entries land in the TS source
-- first; rerun the generator to refresh the migration. Editing this
-- file by hand is the same drift this migration was added to remove.
--
-- AUTO-GENERATED — do not edit by hand.

-- features
insert into features (key, name, category, status) values ('members', 'Members', 'core', 'ga') on conflict (key) do nothing;
insert into features (key, name, category, status) values ('attendance', 'Attendance', 'core', 'ga') on conflict (key) do nothing;
insert into features (key, name, category, status) values ('programs', 'Programs and batches', 'core', 'ga') on conflict (key) do nothing;
insert into features (key, name, category, status) values ('enquiries', 'Enquiries and trials', 'growth', 'ga') on conflict (key) do nothing;
insert into features (key, name, category, status) values ('billing', 'Invoicing and payments', 'money', 'ga') on conflict (key) do nothing;
insert into features (key, name, category, status) values ('staff', 'Staff', 'staff', 'ga') on conflict (key) do nothing;
insert into features (key, name, category, status) values ('reports', 'Reports', 'insight', 'ga') on conflict (key) do nothing;
insert into features (key, name, category, status) values ('settings', 'Settings and configuration', 'platform', 'ga') on conflict (key) do nothing;
insert into features (key, name, category, status) values ('messaging', 'WhatsApp and email', 'comms', 'ga') on conflict (key) do nothing;
insert into features (key, name, category, status) values ('pool.booking', 'Swimming lane booking', 'facility', 'ga') on conflict (key) do nothing;
insert into features (key, name, category, status) values ('court.booking', 'Badminton / racquet court booking', 'facility', 'beta') on conflict (key) do nothing;
insert into features (key, name, category, status) values ('pitch.booking', 'Football pitch booking', 'facility', 'beta') on conflict (key) do nothing;
insert into features (key, name, category, status) values ('studio.booking', 'Studio / dance booking', 'facility', 'beta') on conflict (key) do nothing;
insert into features (key, name, category, status) values ('swim.levels', 'Swimming skill levels', 'vertical', 'ga') on conflict (key) do nothing;
insert into features (key, name, category, status) values ('cafe.pos', 'Café POS', 'commerce', 'internal') on conflict (key) do nothing;
insert into features (key, name, category, status) values ('analytics.advanced', 'Advanced analytics', 'insight', 'internal') on conflict (key) do nothing;

-- permissions
insert into permissions (key, module, description) values ('members.read', 'members', 'View member records') on conflict (key) do nothing;
insert into permissions (key, module, description) values ('members.read.assigned', 'members', 'View only members assigned to the coach''s own batches') on conflict (key) do nothing;
insert into permissions (key, module, description) values ('members.write', 'members', 'Create and edit member records') on conflict (key) do nothing;
insert into permissions (key, module, description) values ('members.delete', 'members', 'Archive member records') on conflict (key) do nothing;
insert into permissions (key, module, description) values ('attendance.read', 'attendance', 'View attendance registers') on conflict (key) do nothing;
insert into permissions (key, module, description) values ('attendance.mark', 'attendance', 'Mark and correct attendance') on conflict (key) do nothing;
insert into permissions (key, module, description) values ('programs.read', 'programs', 'View programs and batches') on conflict (key) do nothing;
insert into permissions (key, module, description) values ('programs.write', 'programs', 'Create and edit programs and batches') on conflict (key) do nothing;
insert into permissions (key, module, description) values ('enquiries.read', 'enquiries', 'View enquiries and trials') on conflict (key) do nothing;
insert into permissions (key, module, description) values ('enquiries.write', 'enquiries', 'Create and progress enquiries and trials') on conflict (key) do nothing;
insert into permissions (key, module, description) values ('invoices.read', 'billing', 'View invoices') on conflict (key) do nothing;
insert into permissions (key, module, description) values ('invoices.write', 'billing', 'Raise and edit invoices') on conflict (key) do nothing;
insert into permissions (key, module, description) values ('payments.read', 'billing', 'View payments') on conflict (key) do nothing;
insert into permissions (key, module, description) values ('payments.record', 'billing', 'Record a payment against an invoice') on conflict (key) do nothing;
insert into permissions (key, module, description) values ('staff.read', 'staff', 'View staff records') on conflict (key) do nothing;
insert into permissions (key, module, description) values ('staff.write', 'staff', 'Create and edit staff records') on conflict (key) do nothing;
insert into permissions (key, module, description) values ('staff.invite', 'staff', 'Invite a staff member to the tenant') on conflict (key) do nothing;
insert into permissions (key, module, description) values ('staff.attendance', 'staff', 'Mark staff attendance') on conflict (key) do nothing;
insert into permissions (key, module, description) values ('staff.roster', 'staff', 'View and edit the staff roster') on conflict (key) do nothing;
insert into permissions (key, module, description) values ('staff.pay.read', 'staff', 'View staff pay and earnings') on conflict (key) do nothing;
insert into permissions (key, module, description) values ('staff.pay.write', 'staff', 'Set staff pay rates and record payouts') on conflict (key) do nothing;
insert into permissions (key, module, description) values ('reports.operational', 'reports', 'View attendance and utilisation reports') on conflict (key) do nothing;
insert into permissions (key, module, description) values ('dashboard.view', 'reports', 'View the owner dashboard (tenant + daily-operations roll-up)') on conflict (key) do nothing;
insert into permissions (key, module, description) values ('reports.financial', 'reports', 'View revenue, cost and profitability reports') on conflict (key) do nothing;
insert into permissions (key, module, description) values ('settings.read', 'settings', 'View tenant settings') on conflict (key) do nothing;
insert into permissions (key, module, description) values ('settings.manage', 'settings', 'Change tenant settings, branding and terminology') on conflict (key) do nothing;
insert into permissions (key, module, description) values ('messaging.send', 'messaging', 'Send WhatsApp and email messages') on conflict (key) do nothing;
insert into permissions (key, module, description) values ('messaging.templates', 'messaging', 'Create and edit message templates') on conflict (key) do nothing;
insert into permissions (key, module, description) values ('bookings.read', 'pool.booking', 'View facility bookings') on conflict (key) do nothing;
insert into permissions (key, module, description) values ('bookings.write', 'pool.booking', 'Create and cancel facility bookings') on conflict (key) do nothing;
insert into permissions (key, module, description) values ('levels.read', 'swim.levels', 'View skill levels and assessments') on conflict (key) do nothing;
insert into permissions (key, module, description) values ('levels.assess', 'swim.levels', 'Record a skill assessment') on conflict (key) do nothing;

-- plans (the one Standard plan)
-- The plan id is deterministic-cryptographic but stable across migrations; the
-- UUID is fixed so applyPreset / applyPreset-from-config-value lookups resolve
-- consistently. Re-runs against an existing database are no-ops via on conflict.
insert into plans (id, key, name, status, price_paise, currency, is_default, sort_order)
  values ('00000000-0000-0000-0000-000000000001', 'standard', 'Standard', 'active', null, 'INR', true, 0)
  on conflict (key) do nothing;

-- plan_features: every ga feature on the standard plan, empty limits
insert into plan_features (plan_id, feature_key, limits) values ('00000000-0000-0000-0000-000000000001', 'members', '{}'::jsonb) on conflict do nothing;
insert into plan_features (plan_id, feature_key, limits) values ('00000000-0000-0000-0000-000000000001', 'attendance', '{}'::jsonb) on conflict do nothing;
insert into plan_features (plan_id, feature_key, limits) values ('00000000-0000-0000-0000-000000000001', 'programs', '{}'::jsonb) on conflict do nothing;
insert into plan_features (plan_id, feature_key, limits) values ('00000000-0000-0000-0000-000000000001', 'enquiries', '{}'::jsonb) on conflict do nothing;
insert into plan_features (plan_id, feature_key, limits) values ('00000000-0000-0000-0000-000000000001', 'billing', '{}'::jsonb) on conflict do nothing;
insert into plan_features (plan_id, feature_key, limits) values ('00000000-0000-0000-0000-000000000001', 'staff', '{}'::jsonb) on conflict do nothing;
insert into plan_features (plan_id, feature_key, limits) values ('00000000-0000-0000-0000-000000000001', 'reports', '{}'::jsonb) on conflict do nothing;
insert into plan_features (plan_id, feature_key, limits) values ('00000000-0000-0000-0000-000000000001', 'settings', '{}'::jsonb) on conflict do nothing;
insert into plan_features (plan_id, feature_key, limits) values ('00000000-0000-0000-0000-000000000001', 'messaging', '{}'::jsonb) on conflict do nothing;
insert into plan_features (plan_id, feature_key, limits) values ('00000000-0000-0000-0000-000000000001', 'pool.booking', '{}'::jsonb) on conflict do nothing;
insert into plan_features (plan_id, feature_key, limits) values ('00000000-0000-0000-0000-000000000001', 'swim.levels', '{}'::jsonb) on conflict do nothing;

-- presets (v1 catalogue)
insert into presets (key, version, name, description, definition, status) values ('swimming', 1, 'Swimming academy', 'Aqua + lane booking + skill levels. Three swim-stroke programs, Beginner/Intermediate/Advanced ladder with rubrics, monthly and quarterly plan shapes, four-lane pool facility.', '{"features":["members","attendance","programs","billing","pool.booking","swim.levels","staff","reports","settings","messaging","enquiries"],"terminology":{"member":{"en":{"one":"swimmer","other":"swimmers"}},"coach":{"en":{"one":"coach","other":"coaches"}},"facility":{"en":{"one":"lane","other":"lanes"}},"session":{"en":{"one":"session","other":"sessions"}}},"roles":[{"name":"Head coach","permissions":["members.read","members.write","attendance.read","attendance.mark","programs.read","levels.read","levels.assess"]},{"name":"Assistant coach","permissions":["members.read","attendance.read","attendance.mark","programs.read","levels.read","levels.assess"]}],"programs":[{"name":"Learn to swim","activity":"swimming"},{"name":"Stroke development","activity":"swimming"},{"name":"Junior competitive","activity":"swimming"}],"skillLevels":[{"name":"Beginner","ordinal":1,"skills":[{"name":"Water confidence","rubric":{"1":"Holds pool edge; needs constant reassurance","2":"Floats with support; hesitant to submerge","3":"Floats independently; submerges and resurfaces at will","4":"Comfortable in deep end; relaxed breathing pattern"}},{"name":"Freestyle","rubric":{"1":"Cannot coordinate arms and legs","2":"Short bursts with breathing breaks","3":"Continuous laps with bilateral breathing","4":"Efficient stroke, 25 m unbroken at steady pace"}}]},{"name":"Intermediate","ordinal":2,"skills":[{"name":"Freestyle","rubric":{"1":"Short bursts with breathing breaks","2":"Continuous laps with bilateral breathing","3":"50 m unbroken under one minute","4":"Efficient stroke with flip turn"}},{"name":"Backstroke","rubric":{"1":"Cannot coordinate arm stroke","2":"Continuous 25 m with arm breaks","3":"50 m with body rotation","4":"Efficient 100 m at steady pace"}},{"name":"Breaststroke","rubric":{"1":"Cannot coordinate kick","2":"Short 15 m with breathing breaks","3":"Continuous 25 m with timing","4":"Efficient 50 m with glide"}},{"name":"Breathing","rubric":{"1":"Mouth above water with strain","2":"Comfortable exhale underwater","3":"Bilateral rotation; rhythmic inhale","4":"Adaptable to varied conditions and effort"}}]},{"name":"Advanced","ordinal":3,"skills":[{"name":"Butterfly","rubric":{"1":"Cannot coordinate dolphin kick","2":"Short 25 m with breathing breaks","3":"50 m unbroken","4":"Sustained butterfly with strong rhythm"}},{"name":"Endurance","rubric":{"1":"100 m continuous","2":"400 m continuous","3":"1 km continuous","4":"2 km continuous at conversational pace"}}]}],"planShapes":[{"name":"Monthly","kind":"duration","durationDays":30,"amountPaise":null},{"name":"Quarterly","kind":"duration","durationDays":90,"amountPaise":null}],"facilities":[{"name":"Main pool","kind":"pool","capacity":40,"subUnits":[{"name":"Lane 1"},{"name":"Lane 2"},{"name":"Lane 3"},{"name":"Lane 4"}]}],"exampleBatches":[{"programName":"Learn to swim","name":"Beginners MWF 06:00","daysOfWeek":[1,3,5],"startTime":"06:00","capacity":16},{"programName":"Junior competitive","name":"Junior TTS 17:00","daysOfWeek":[2,4,6],"startTime":"17:00","capacity":16}],"messageTemplates":["session_reminder","fee_due","swim_progress_note"],"dashboardCards":["todays_lanes","dues","attention"]}'::jsonb, 'active') on conflict (key, version) do nothing;
insert into presets (key, version, name, description, definition, status) values ('multi-sport', 1, 'Multi-sport club', 'All program modules and multiple facilities, no vertical-specific content. Operator adds the sport(s) from the catalogue after onboarding; we provide the empty shell and the standard plan shapes.', '{"features":["members","attendance","programs","billing","pool.booking","staff","reports","settings","messaging","enquiries"],"terminology":{"member":{"en":{"one":"member","other":"members"}},"coach":{"en":{"one":"trainer","other":"trainers"}},"facility":{"en":{"one":"studio","other":"studios"}},"session":{"en":{"one":"slot","other":"slots"}},"batch":{"en":{"one":"slot","other":"slots"}}},"roles":[],"programs":[],"skillLevels":[],"planShapes":[{"name":"Monthly","kind":"duration","durationDays":30,"amountPaise":null},{"name":"Quarterly","kind":"duration","durationDays":90,"amountPaise":null}],"facilities":[],"exampleBatches":[],"messageTemplates":["session_reminder","fee_due"],"dashboardCards":["dues","attention"]}'::jsonb, 'active') on conflict (key, version) do nothing;
insert into presets (key, version, name, description, definition, status) values ('start-from-scratch', 1, 'Start from scratch', 'Empty catalogue: GA features only, no programs, no skill ladder, no facilities. The operator configures everything from scratch during onboarding; the two standard plan shapes stay so a fresh tenant can move from trial to active without re-seed.', '{"features":["members","attendance","programs","billing","staff","reports","settings"],"terminology":{},"roles":[],"programs":[],"skillLevels":[],"planShapes":[{"name":"Monthly","kind":"duration","durationDays":30,"amountPaise":null},{"name":"Quarterly","kind":"duration","durationDays":90,"amountPaise":null}],"facilities":[],"exampleBatches":[],"messageTemplates":[],"dashboardCards":["dues","attention"]}'::jsonb, 'active') on conflict (key, version) do nothing;
insert into presets (key, version, name, description, definition, status) values ('badminton', 1, 'Badminton / racquet', 'Court booking + drop-in and monthly plan shapes. Junior and adult coaching programs. Vocabulary overridden: session → match, facility → court, batch → session.', '{"features":["members","attendance","programs","billing","court.booking","staff","reports","settings","messaging","enquiries"],"terminology":{"member":{"en":{"one":"member","other":"members"}},"batch":{"en":{"one":"session","other":"sessions"}},"coach":{"en":{"one":"coach","other":"coaches"}},"session":{"en":{"one":"match","other":"matches"}},"facility":{"en":{"one":"court","other":"courts"}}},"roles":[],"programs":[{"name":"Junior Coaching","activity":"badminton"},{"name":"Adult Coaching","activity":"badminton"}],"skillLevels":[],"planShapes":[{"name":"Drop-in","kind":"sessions","sessions":1,"amountPaise":null},{"name":"Monthly","kind":"duration","durationDays":30,"amountPaise":null}],"facilities":[],"exampleBatches":[],"messageTemplates":["session_reminder","fee_due"],"dashboardCards":["dues","attention"]}'::jsonb, 'active') on conflict (key, version) do nothing;
insert into presets (key, version, name, description, definition, status) values ('gym', 1, 'Gym / fitness', 'Class booking + drop-in and monthly plan shapes. Strength and cardio programs. Vocabulary overridden: coach → trainer, facility → studio, session → class, batch → slot.', '{"features":["members","attendance","programs","billing","staff","reports","settings","messaging","enquiries"],"terminology":{"member":{"en":{"one":"member","other":"members"}},"batch":{"en":{"one":"slot","other":"slots"}},"coach":{"en":{"one":"trainer","other":"trainers"}},"session":{"en":{"one":"class","other":"classes"}},"facility":{"en":{"one":"studio","other":"studios"}}},"roles":[],"programs":[{"name":"Strength Training","activity":"fitness"},{"name":"Cardio","activity":"fitness"}],"skillLevels":[],"planShapes":[{"name":"Drop-in","kind":"sessions","sessions":1,"amountPaise":null},{"name":"Monthly","kind":"duration","durationDays":30,"amountPaise":null}],"facilities":[],"exampleBatches":[],"messageTemplates":["session_reminder","fee_due"],"dashboardCards":["dues","attendance"]}'::jsonb, 'active') on conflict (key, version) do nothing;
insert into presets (key, version, name, description, definition, status) values ('football', 1, 'Football', 'Pitch booking + termly plan shape. Junior academy and adult skills programs. Vocabulary overridden: member → player, facility → pitch, batch → squad.', '{"features":["members","attendance","programs","billing","pitch.booking","staff","reports","settings","messaging","enquiries"],"terminology":{"member":{"en":{"one":"player","other":"players"}},"batch":{"en":{"one":"squad","other":"squads"}},"coach":{"en":{"one":"coach","other":"coaches"}},"session":{"en":{"one":"session","other":"sessions"}},"facility":{"en":{"one":"pitch","other":"pitches"}}},"roles":[],"programs":[{"name":"Junior Academy","activity":"football"},{"name":"Adult Skills","activity":"football"}],"skillLevels":[],"planShapes":[{"name":"Termly","kind":"duration","durationDays":90,"amountPaise":null}],"facilities":[],"exampleBatches":[],"messageTemplates":["session_reminder","fee_due"],"dashboardCards":["attendance","dues"]}'::jsonb, 'active') on conflict (key, version) do nothing;
insert into presets (key, version, name, description, definition, status) values ('dance-ma', 1, 'Dance / martial arts', 'Studio booking + termly plan shape. Ballet and Karate programs. Single skill ladder (Belt). Vocabulary overridden: member → student, coach → instructor, facility → studio, session → class, program → style.', '{"features":["members","attendance","programs","billing","studio.booking","staff","swim.levels","reports","settings","messaging","enquiries"],"terminology":{"member":{"en":{"one":"student","other":"students"}},"batch":{"en":{"one":"session","other":"sessions"}},"coach":{"en":{"one":"instructor","other":"instructors"}},"session":{"en":{"one":"class","other":"classes"}},"program":{"en":{"one":"style","other":"styles"}},"facility":{"en":{"one":"studio","other":"studios"}}},"roles":[],"programs":[{"name":"Ballet","activity":"dance"},{"name":"Karate","activity":"martial_arts"}],"skillLevels":[{"name":"Belt","ordinal":1,"skills":[{"name":"Form","rubric":{"1":"Cannot yet demonstrate the form","2":"Demonstrates with prompts","3":"Demonstrates unprompted","4":"Demonstrates unprompted and corrects others"}}]}],"planShapes":[{"name":"Termly","kind":"duration","durationDays":90,"amountPaise":null}],"facilities":[],"exampleBatches":[],"messageTemplates":["session_reminder","fee_due"],"dashboardCards":["attendance","dues"]}'::jsonb, 'active') on conflict (key, version) do nothing;

-- config_keys (O-04 catalogue)
insert into config_keys (key, value_schema, default_value, visibility, risk, description) values ('attendance.absence_alert_threshold_pct', '{"type":"integer","minimum":0,"maximum":100}'::jsonb, '50'::jsonb, 'owner_edit', 'safe', 'The share of a member''s recorded marks that can be absences before the monthly low-attendance alert fires. 0-100.') on conflict (key) do nothing;
insert into config_keys (key, value_schema, default_value, visibility, risk, description) values ('billing.gst_rate_bp', '{"type":"integer","minimum":0,"maximum":10000}'::jsonb, '1800'::jsonb, 'ops_only', 'sensitive', 'GST rate in basis points (1800 = 18%). Inherited platform -> tenant -> facility -> activity; invoices snapshot the resolved rate.') on conflict (key) do nothing;
insert into config_keys (key, value_schema, default_value, visibility, risk, description) values ('billing.sac_code', '{"type":"string","pattern":"^\\d{4,8}$"}'::jsonb, '"999723"'::jsonb, 'ops_only', 'sensitive', 'SAC code printed on invoice lines (4-8 digits). Default 999723 (sports and recreation services) — confirm with the tenant''s accountant.') on conflict (key) do nothing;
insert into config_keys (key, value_schema, default_value, visibility, risk, description) values ('access.location_scoped_staff', '{"type":"boolean"}'::jsonb, 'false'::jsonb, 'owner_read', 'sensitive', 'When on, staff see only the locations they are attached to. An access control inside one academy, not tenant isolation.') on conflict (key) do nothing;
insert into config_keys (key, value_schema, default_value, visibility, risk, description) values ('attendance.offline_sync_enabled', '{"type":"boolean"}'::jsonb, 'false'::jsonb, 'ops_only', 'sensitive', 'Kill switch for the offline attendance queue. Ops only — a tenant must not be able to disable its own write path.') on conflict (key) do nothing;

-- policy_versions
insert into policy_versions (version, content) values ('2026.1', 'Placeholder consent notice — replace with the real DPDP-compliant privacy notice before go-live.') on conflict (version) do nothing;
