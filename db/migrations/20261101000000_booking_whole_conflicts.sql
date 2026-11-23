-- FROZEN PROPOSAL ONLY. NOT APPLIED. Requires human schema/architecture approval.
-- Migration runner supplies the transaction; lock closes the preflight/build race.
LOCK TABLE bookings IN ACCESS EXCLUSIVE MODE;
DO $$
BEGIN
  IF EXISTS (
    SELECT 1 FROM bookings a JOIN bookings b
      ON a.tenant_id = b.tenant_id AND a.facility_id = b.facility_id
      AND a.id < b.id
      AND (a.sub_unit_id IS NULL OR b.sub_unit_id IS NULL OR a.sub_unit_id = b.sub_unit_id)
      AND tstzrange(a.starts_at, a.ends_at, '[)') && tstzrange(b.starts_at, b.ends_at, '[)')
    WHERE a.status IN ('held', 'confirmed') AND b.status IN ('held', 'confirmed')
  ) THEN
    RAISE EXCEPTION 'booking overlap preflight failed; resolve legacy conflicts before retrying';
  END IF;
END $$;
-- UUID's normal B-tree order makes each closed singleton disjoint from all
-- other UUID singleton ranges; an unbounded range overlaps every singleton.
CREATE TYPE booking_subunit_uuid_range AS RANGE (subtype = uuid);
ALTER TABLE bookings ADD CONSTRAINT bookings_whole_child_no_overlap_excl
  EXCLUDE USING gist (
    tenant_id WITH =,
    facility_id WITH =,
    booking_subunit_uuid_range(sub_unit_id, sub_unit_id, '[]') WITH &&,
    tstzrange(starts_at, ends_at, '[)') WITH &&
  ) WHERE (status IN ('held', 'confirmed'));
ALTER TABLE bookings DROP CONSTRAINT bookings_no_overlap_excl;
