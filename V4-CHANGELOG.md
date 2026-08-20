# V4 CHANGELOG

## Product changes

- Added a dedicated written-round attendance control in each candidate profile.
- Written attendance can be changed between `PRESENT` and `ABSENT` by Admin/Test Checker.
- Absent written candidates are excluded from set percentiles, normalized percentiles, ranking, and the written cutoff.
- Changing a written candidate from absent to present recalculates the campaign.
- Present written candidates with a score are recorded as `GAVE WRITTEN` until recalculation advances them to `WRITTEN CLEARED` or `WRITTEN REJECTED`.
- Retains written score data when attendance is switched to absent for auditability; the score is ignored by written calculations until the candidate is present again.
- Simplified the interface into a minimal professional dashboard, searchable candidate table, and focused candidate drawer.
- Added clear error/retry states instead of indefinite loading.
- Candidate profile now keeps personal details, written round, interview history, add/update interview, audit timeline, and archive/restore in one place.
- Light/dark theme retained.

## Data integrity fixes

- Migration is idempotent and explicitly handles existing V1/V2/V3 databases.
- Migration temporarily disables MySQL safe-update mode only during controlled upgrade updates and restores it before exit.
- Existing candidate and interview records are assigned to the current campaign when campaign_id is missing.
- New campaigns become the active campaign.
- New candidates default to the active campaign.
- New interview phases default to the active campaign and get their order within that campaign.
- Written recalculation is campaign-scoped and ignores archived or absent written candidates.
- Candidate workflow status no longer changes an already progressed candidate back to a written-stage status when old written results are recalculated.
- Removing a written candidate from attendance triggers a full campaign recalculation so the cutoff and ranks remain correct.
