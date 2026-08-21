# V5 — Final operations / search pass

## Candidate operations
- Added **+ Add candidate** admin action.
- Candidate creation automatically attaches the active recruitment campaign.
- Added better multi-field search: name, learner/college mail, registration number, phone, personal email, and branch.
- Added filters for status, branch, written attendance, interview phase, and archived records.
- Added quick filters for written attendance and written clearance.
- Added select-all checkbox for the current result page plus a **Select all N matching** action.
- Added bulk archive endpoint and UI.
- Added **Mark unmarked as absent** action. It affects only candidates whose written attendance is still UNKNOWN and only within the current search/filter scope.
- Archive remains reversible and preserves the prior status/history.

## Dashboard
- Added a clear **Not marked** written-attendance count.
- Added branch distribution chart.
- Improved funnel and written-set charts.
- Dark-mode chart colors now have visible grid lines, axis labels, tooltips, and bars.
- Added clearer needs-attention cards.

## Reliability / API
- Candidate list endpoint supports larger result pages and additional filters.
- Added bulk archive and bulk written-absent endpoints.
- Added active-campaign fallback when creating a candidate.
- Added `MYSQL_URL` support so the same backend can connect to Railway or another MySQL provider without code changes.

## Workflow
- MySQL remains the source of truth.
- Google Sheets / Excel remain optional bulk-input tools.
- Individual candidate entry happens in the application.
- Database schema did not need a destructive migration for V5.

## Written qualified export
- Added a protected `/api/written/export` endpoint that generates an XLSX workbook for the active campaign's qualified written-test candidates.
- Workbook includes a Written Summary sheet with cutoff percentile, cutoff raw marks/set, configured qualification count, and per-set statistics.
- Workbook includes a Qualified Candidates sheet with rank, personal details, set, marks, set percentile, normalized percentile, and qualification status.
- Added a Dashboard button: `Download written results`.
