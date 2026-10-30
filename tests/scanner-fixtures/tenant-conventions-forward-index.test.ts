import { describe, expect, it } from "vitest";
import { scanTenantConventions } from "@/scripts/lib/tenant-conventions-scan";
const original="CREATE INDEX message_log_person_idx ON message_log (person_id) WHERE person_id IS NOT NULL;";
const file="db/migrations/20261030062320_message_log_failure_visibility.sql";
describe("immutable index migrations with a forward correction",()=>{
 it("accepts an exact later drop and tenant-first replacement",()=>{expect(scanTenantConventions(original,file,"DROP INDEX public.message_log_person_idx; CREATE INDEX message_log_tenant_person_idx ON message_log (tenant_id, person_id);")).toEqual([]);});
 it.each(["DROP INDEX other_idx;","-- DROP INDEX message_log_person_idx;","/* DROP INDEX message_log_person_idx; */","SELECT 'DROP INDEX message_log_person_idx;';","DO $$ BEGIN RAISE NOTICE 'DROP INDEX message_log_person_idx;'; END $$;","DROP INDEX other_schema.message_log_person_idx;"])("does not waive an index for unrelated/nonexecuting SQL: %s",sql=>{expect(scanTenantConventions(original,file,sql)).toHaveLength(1);});
 it("still rejects an incorrect later replacement",()=>{const later="DROP INDEX message_log_person_idx; CREATE INDEX message_log_tenant_person_idx ON message_log(person_id);";const violations=[...scanTenantConventions(original,file,later),...scanTenantConventions(later,"db/migrations/20261030160000_bad_replacement.sql")];expect(violations).toHaveLength(1);expect(violations[0]?.file).toContain("bad_replacement");});
});
