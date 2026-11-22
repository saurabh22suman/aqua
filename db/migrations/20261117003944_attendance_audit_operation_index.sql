-- PROPOSAL ONLY: forward migration; do not apply without approval.
CREATE INDEX audit_log_attendance_operation_idx
  ON audit_log (tenant_id, (("after" ->> 'clientId')))
  WHERE action = 'attendance.mark' AND entity_type = 'attendance';
