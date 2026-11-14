-- Preserve the actual tenant owner when they have no staff record.
-- Existing rows satisfy the old check and therefore satisfy this XOR check.
alter table staff_attendance add column marked_by_user_id uuid;
alter table staff_attendance drop constraint staff_attendance_marked_by_check;
alter table staff_attendance add constraint staff_attendance_marked_by_check
  check ((method = 'manual' and ((marked_by is not null) <> (marked_by_user_id is not null)))
      or (method <> 'manual' and marked_by is null and marked_by_user_id is null));
alter table staff_attendance add constraint staff_attendance_marker_membership_fkey
  foreign key (tenant_id, marked_by_user_id) references tenant_memberships (tenant_id, user_id);
