// E-06 retention — the pure decision half of the operator script.
//
// scripts/retention-activity-events.ts is the only path that may DROP
// an activity_events partition. Keeping the eligibility rule in this
// pure function means the boundary cases (ends exactly at the cutoff,
// straddles it, future) are pinned by tests that never touch a database
// and never execute DDL.

export type RetentionPartition = {
  name: string;
  /** Inclusive lower bound of the partition range. */
  from: Date;
  /** Exclusive upper bound of the partition range (Postgres `FOR VALUES ... TO (...)`). */
  to: Date;
};

// "The partition's whole range is older than the cutoff." Because `to`
// is the exclusive upper bound, a partition ending exactly at the
// cutoff contains no row at or after it and is droppable.
export function selectDroppablePartitions(
  partitions: RetentionPartition[],
  cutoff: Date,
): RetentionPartition[] {
  return partitions.filter(
    (partition) => partition.to.getTime() <= cutoff.getTime(),
  );
}
