# Recruitment System V3

## Stability and workflow fixes

- Fixed the V2 frontend JSX compile error.
- Added clear error + retry states for dashboard, candidate profiles, written saves, and interview saves.
- Fixed interview status progression:
  - `PRESENT` advances workflow.
  - `ABSENT`, `RESCHEDULED`, and `EXCUSED` do not falsely mark a candidate as having appeared.
  - Existing `SELECTED`, `REJECTED`, and `WITHDRAWN` statuses are preserved.
- Written-test recalculation no longer overwrites candidates who have already progressed into interviews/taskphase.
- Written-test recalculation is scoped to the candidate's recruitment campaign.
- Dashboard and written analytics are scoped to the active campaign.
- What-if cutoff is debounced and reports the set associated with the displayed raw cutoff mark.
- Archive now stores the candidate's previous status; restore returns that status instead of resetting everyone to `APPLIED FOR WRITTEN`.
- Candidate/interview phase campaign mismatch is rejected.
- Duplicate interview results are cleaned during migration and a unique `(candidate_id, phase_id)` constraint is enforced.
- Added `archived_status` migration for existing databases.
- Improved missing-written-mark dashboard attention count to include candidates with no written row.

## Database migration

For an existing local database, run:

```powershell
cd "D:\Clubs and SPs\LMS\recruitment-system\recruitment-system\backend"
npm run migrate
```

Do not rerun `seed` or `import:xlsx` unless you intentionally want to create/update those records.
