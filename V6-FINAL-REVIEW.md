# V6 Final Review — Recruitment System

## Data-safety principles
- No candidate records are deleted by startup or deployment.
- No Excel re-import is required for a code-only update.
- Written qualification state is never auto-finalized at backend startup.
- A candidate's written score is removed when their written attendance is changed to ABSENT, with an audit entry preserving the previous score metadata.
- Interview phases with existing results can be archived/deactivated, not deleted.

## Written-round rules
- Present candidates with marks are the scoring pool.
- Unmarked candidates are excluded from written ranking.
- Absent candidates are excluded and have no active written-test row after marking absent.
- Qualification remains pending until the configured minimum number of scores (default 150) is reached.
- Finalization locks written attendance and marks until an Admin reopens the round.
- A mismatch between qualified records and valid scored records is surfaced as a data-integrity warning rather than silently rewriting qualification.

## Dashboard semantics
- Applications = active candidates in the campaign.
- Written present/absent/unmarked are independent attendance states.
- Marks entered = present candidates with a non-null written score.
- Written cleared = written-test rows with `qualified=1`.
- The dashboard explicitly shows `cleared of scored`.
- Data Health reports qualified-without-valid-score, absent-with-written-data, missing branch, and duplicate-registration checks.

## Phase management
- Add Recruitment Interview / Taskphase rounds.
- Archive/deactivate phases with history.
- Permanently delete only empty phases.

## Deployment
- Code-only updates are intended to be deployed by Git push.
- Existing `backend/.env` remains local/private and is not replaced.
- GitHub Pages / Render should rebuild from the pushed commit.

## Validation performed
- Backend `server.js` syntax check: passed.
- Backend `writtenTestService.js` syntax check: passed.
- Frontend JSX parsing through TypeScript transpiler: passed.
- Full Vite dependency installation/build was not available in this environment; run the existing GitHub Actions build as the production verification step.
