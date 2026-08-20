# V4 Final Review

## Included in V4

- Written attendance correction: Present / Absent.
- Attendance correction recalculates percentile/rank/cutoff for the campaign.
- Absent candidates are excluded from written calculations.
- Existing written marks are retained but ignored while absent.
- Minimal professional UI.
- Light/dark mode.
- Searchable candidate database.
- Candidate profile with personal details.
- Written round metrics and remarks.
- Dynamic Recruitment Interview and Taskphase rounds.
- Multiple interviewer names per result.
- Present / Absent / Rescheduled / Excused interview attendance.
- Archive/restore.
- Audit timeline.
- Written what-if cutoff.
- Recruitment funnel and needs-attention dashboard.
- Campaign-aware database and migrations.
- Idempotent upgrade migration for the previously encountered `campaign_id` / `deleted_at` issues.

## Absolutely needed before production

1. **Proper production authentication**: change default passwords and ensure JWT secret is long/random.
2. **Database backups**: automatic daily backups for MySQL before live recruitment data is entered.
3. **User management**: admin screen to create/deactivate/reset interviewer and checker accounts.
4. **Active campaign selector**: admin should explicitly switch between recruitment years instead of relying only on the newest active campaign.
5. **Final decision controls**: a clear admin-only `SELECTED`, `REJECTED`, and `WITHDRAWN` action with confirmation and audit log.
6. **Import preview**: upload Excel/CSV and review changes before committing them to the live database.
7. **Production error logging/monitoring**: backend errors should be visible to admins without exposing SQL details to end users.
8. **HTTPS-only deployment**: frontend and API must use HTTPS in production.
9. **Privacy rules**: keep the candidate spreadsheet and database credentials out of GitHub.
10. **Real-device testing**: test the interviewer flow on a phone before recruitment starts.

## Nice-to-have later

- Interviewer assignment model with assigned candidate lists.
- Saved filters shared across the team.
- Bulk status/phase actions.
- PDF/Excel reports.
- Email notifications.
- Calendar integration.
- Candidate duplicate/merge workflow.

V4 intentionally avoids adding nonessential complexity until the live workflow is proven stable.
