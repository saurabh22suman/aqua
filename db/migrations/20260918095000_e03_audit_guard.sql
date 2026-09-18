-- E-03 — audit_log tamper evidence, part 1: the append-only guard.
--
-- BEFORE UPDATE OR DELETE trigger raising for every role, including
-- the table owner and superusers — RLS bypass does not bypass
-- triggers. The trigger is the tripwire, not the proof: an operator
-- with database access can disable it (and that is exactly what
-- tests/tier1/audit-tamper-evidence.test.ts does to simulate a hand
-- edit), but the daily digest checkpoint (E-03 part 2,
-- lib/audit/checkpoint.ts) is what remains after the fact.
--
-- The table is a plain table on this branch. H-03 (another branch)
-- rebuilds audit_log as monthly range partitions; a row trigger on a
-- partitioned parent propagates to every partition, so this trigger is
-- deliberately created on the table — never on a partition by name —
-- and keeps working unchanged after that rebuild.

create or replace function audit_log_block_mutation()
returns trigger
language plpgsql
as $$
begin
  raise exception
    'audit_log is append-only: % is not permitted (id=%)',
    TG_OP,
    coalesce(OLD.id::text, '?');
end;
$$;

create trigger audit_log_no_mutate
  before update or delete on audit_log
  for each row
  execute function audit_log_block_mutation();
