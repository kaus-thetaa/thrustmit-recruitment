# V5 Written Save / Qualification Fix

## Fixed
- The written "cleared" count no longer simply follows the number of marks entered (e.g. 60 -> 80 -> 115). Candidates remain in `GAVE WRITTEN` until at least the configured qualification count (150 by default) have scored marks.
- Once the pool reaches 150 scored candidates, exactly the top 150 are marked `WRITTEN CLEARED`; the rest are `WRITTEN REJECTED` for the written stage.
- Candidates already in later phases (`APPEARED FOR FIRST INTERVIEW`, `TASKPHASE`, `SELECTED`, etc.) are not overwritten by written recalculation.
- Written percentile/recalculation database updates are batched instead of issuing one query per candidate, fixing the long-lived `Saving…` state after saving marks with larger candidate pools.
- Existing data is preserved. No re-import is required.

## Deployment
Code-only change. No database migration is required.
