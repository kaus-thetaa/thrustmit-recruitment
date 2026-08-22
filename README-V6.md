# Recruitment System V6

V6 is a code-only, upgrade-safe hardening release for the existing recruitment system.

## Important
Do not recreate the database and do not re-import the Excel workbook.
Keep the existing `backend/.env`.

The backend now performs a small schema check on startup and adds only the written-finalization metadata columns if they are missing.

Normal deployment:

```powershell
git add .
git commit -m "V6 final recruitment hardening"
git push
```

GitHub Pages / Render should redeploy from the existing repository setup.

## New operational flow
1. Team enters written attendance and marks.
2. Dashboard shows Needs Attention counts.
3. Once at least 150 scored candidates exist, Admin can click Finalize Written Round.
4. Finalization locks written marks and attendance.
5. Official written export becomes available.
6. Admin can reopen only when a genuine correction is required.

## Data safety
The current candidate database is the source of truth. V6 does not delete/reimport candidate data.
