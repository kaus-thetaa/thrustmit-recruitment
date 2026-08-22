# V6 Final Review

## Data audit performed before V6 changes

### Live dashboard snapshot provided by the user
- Written unmarked: 0
- Written marks missing: 43
- Interview remarks missing: 0
- Written absent: 42

These counts are internally plausible. With 536 current candidates, the snapshot implies 42 absent + 43 present-without-marks, leaving 451 candidates with written marks. The separate qualified export contains exactly 150 qualified candidates.

### Qualified-candidate workbook audit
The uploaded `written-qualified-candidates (1).xlsx` was checked before V6 work:
- 150 qualified rows
- All 150 marked PRESENT
- Four written sets: 41 / 41 / 45 / 23 qualified candidates respectively
- Registration numbers have no duplicates in the qualified export
- Candidate rank is monotonic by normalized percentile
- Rank 150 is `Krishiv Arora`
- Final normalized percentile at rank 150: 17.7596
- Rank-150 marks: 8/20, Set 3
- The summary cutoff percentile (17.7596) matches the rank-150 candidate

The low cutoff percentile is not, by itself, an error: it reflects the current cross-set normalization/ranking calculation and the current score distribution.

### Source workbook audit
The original `Avionics Slots (2).xlsx` contains 552 data rows, 550 nonblank names, 14 duplicate registration-number keys, and 2 blank registration numbers. The original slot attendance column is sparse (97 `P` entries and 455 blanks), which explains why the website's live attendance workflow is needed instead of treating source blanks as confirmed absences.

## V6 data-safety design
- No candidate tables are dropped or recreated.
- No Excel re-import is required.
- V6 auto-adds only three campaign metadata columns at backend startup if they are missing: `written_finalized`, `written_finalized_at`, and `written_finalized_by`.
- If the current active campaign already has at least the configured number of qualified candidates, V6 automatically treats that current state as finalized, preserving the existing 150-qualified state.
- Written marks/attendance are locked after finalization until an Admin explicitly reopens the written round.
