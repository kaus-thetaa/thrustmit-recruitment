# LMS Written Round — Final Fairness Method

## Purpose
The written round uses four test sets. Candidates are compared primarily within the set they actually took so that a harder/easier set does not unfairly determine qualification by raw marks alone.

## Official ranking rule
1. Only candidates with `PRESENT` written attendance and a valid mark are in the scored pool.
2. For each set, calculate **midrank percentile**:

   `100 * (below + 0.5 * equal) / set_size`

   This gives tied marks the same percentile and avoids arbitrary ordering among equal marks.
3. Rank all scored candidates by **set-wise percentile**, highest first.
4. Use the set z-score only as a secondary tie-break signal.
5. Use raw marks as a tertiary tie-break signal.
6. Never use candidate ID, database insertion order, name, or any unrelated personal field to break a performance tie.
7. If candidates remain exactly tied on percentile + z-score + raw marks at the qualification boundary, **all tied candidates are included**. The final qualified count can therefore be slightly above the target; no arbitrary person is rejected solely because of database order.

## Why this is fairer than raw marks
A raw score such as 14/20 has meaning only relative to the difficulty of the set. A set-wise percentile asks how the candidate performed compared with people who answered that same set. This is less sensitive to different raw score distributions and does not require assuming that the four sets are normally distributed.

The z-score remains visible in the audit as a secondary signal. It is not the primary qualification criterion.

## Finalization
Before finalization, the dashboard shows the live scored pool and projected cutoff. An Admin must explicitly finalize the written round. Finalization records:

- campaign and year
- method version
- scored pool size
- target qualification count
- final qualified count
- cutoff set percentile
- normalized percentile at cutoff
- cutoff raw marks and set
- whether a tie at the cutoff was included
- set statistics
- complete ranking snapshot
- Admin, timestamp and reason

## Reopening
An Admin can reopen the written round with a reason. Existing qualification records are retained as **provisional history**; they are not silently deleted. The next finalization recomputes the ranking using the same documented method and writes a new audit snapshot.

## Attendance rule
`PRESENT` + valid mark = eligible for written ranking.

`ABSENT` = written record is cleared from the live written table; the deletion is retained in the audit log.

`UNKNOWN` = not included in ranking and must be resolved before finalization.

## Audit export
The dashboard includes a **Download audit** action that exports:

- Audit Summary
- Set Analysis
- Ranking Snapshot

This provides an independent record of how the final written decision was produced.
