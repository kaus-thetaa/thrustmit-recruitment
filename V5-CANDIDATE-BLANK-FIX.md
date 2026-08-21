# V5 Candidate Blank-Screen Fix

Fixed the Candidates page crash caused by the frontend replacing its metadata state with an API response that did not contain `phases`. The phase dropdown now receives phases from App state directly.

Also fixed the backend candidates endpoint so the V5 filters for written attendance and interview phase actually work.

Added a React error boundary so unexpected UI runtime errors show a useful recovery screen instead of leaving the app blank.

Update the GitHub repository with these files; the frontend/backend deployments should redeploy automatically.
