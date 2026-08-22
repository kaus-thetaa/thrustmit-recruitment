# V6 Changelog

## Robustness / data integrity
- Added automatic, upgrade-safe schema check at backend startup.
- Added written-round finalization lock and explicit reopen flow.
- Existing live campaign state is preserved if it already has the configured number of qualified candidates.
- Prevented written marks and attendance edits after finalization.
- Fixed candidate-add flow so new candidates automatically attach to the active recruitment campaign.
- Fixed interview-phase listing so it defaults to the active campaign.
- Improved database health endpoint with connection latency.

## Needs attention
- `Written unmarked` = candidates in the active campaign whose written attendance is still UNKNOWN.
- `Written marks missing` = PRESENT candidates with no written-test record or no marks.
- `Interview remarks missing` = PRESENT results in active phases with a blank remark.
- `Written absent` = candidates with written attendance ABSENT.
- Needs-attention cards now open Candidates with the matching filters.

## Candidates
- Server-side pagination at 50 rows/page.
- Better global search and filter combinations.
- Select-all-matching remains available across all pages.
- Added filters for missing written marks and missing interview remarks.
- Bulk absent action confirms the exact number of currently unmarked matches before changing anything.
- Bulk absent action is blocked while the written round is finalized.

## Admin
- Added basic user management: create/deactivate team accounts.
- Added written finalization controls to Dashboard.

## Written export
- Official written-results export is now only available after finalization.
- Export includes manual set-percentile audit columns: set size, candidates below, candidates equal, and a spreadsheet formula for the midrank percentile.
- Export overview records whether the written round is finalized.
