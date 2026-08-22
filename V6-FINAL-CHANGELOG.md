# V6 Final Changelog

## Written round
- Added explicit `Marks entered` count on the dashboard.
- Dashboard now shows `Written cleared` as `X of Y scored`.
- Added `Written unmarked` metric.
- Added data-integrity warning when qualified records exceed valid scored records.
- Removed automatic written-finalization mutation during backend startup.
- Finalization is explicit and Admin-only.
- Finalized rounds cannot be modified until reopened.
- Recalculation no longer clears existing qualification merely because the scored pool is temporarily incomplete.
- Written absentee handling now deletes the active written-test row and keeps a detailed audit record.
- Bulk `Mark unmarked as absent` performs the same cleanup.

## Dashboard / data health
- Added `/api/data-health` for read-only integrity checks.
- Added missing branch count and duplicate-registration checks.
- Branch chart now shows a clear message when branch data is unavailable instead of a misleading single `Unspecified` bar.
- Funnel now includes Present → Scored → Cleared.

## Interview phase management
- Admin can archive/deactivate active interview phases.
- Archived phases can be restored.
- Phases with existing results cannot be deleted.
- Empty phases may be permanently deleted by Admin.

## Data safety
- No startup data reset.
- No Excel re-import requirement.
- Existing candidate/interview data is preserved.
- Normal deployment flow remains `git add` → `git commit` → `git push`.
