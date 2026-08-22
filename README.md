# LMS Recruitment System V5


A MySQL-backed recruitment management system for a full recruitment year.

## Current workflow

1. Written Round
2. Recruitment Interview
3. Taskphase Interview 1..N
4. Final selection/rejection

## Candidate details

- Full name
- Learner ID / college mail
- Registration number
- Personal email
- Phone / WhatsApp
- Branch
- Internal notes

## Written round

- Four sets
- Marks out of 20
- Set-wise percentile
- Normalized percentile
- Automatic top-150 qualification
- What-if cutoff simulator
- Attendance control: Present / Absent
- Changing written attendance automatically recalculates ranking and cutoff

## Interview rounds

- Dynamic phases
- Recruitment Interview + unlimited Taskphase interviews
- Attendance: Present / Absent / Rescheduled / Excused
- Multiple interviewer names
- Date
- Single simple remark
- One result per candidate per phase

## Candidate management

- Global search
- Status and branch filters
- Archive/restore
- CSV export
- Audit timeline
- Candidate profile drawer
- Light/dark mode
- Clear error/retry states

## Local setup

### Backend

```powershell
cd backend
npm install
npm run migrate
npm run seed
npm run import:xlsx -- --file "../data/Avionics Slots (2).xlsx"
npm run dev
```

### Frontend

```powershell
cd frontend
npm install
npm run dev
```

Frontend: `http://localhost:5173`
Backend: `http://localhost:4000`

## Important upgrade note

If you are upgrading an existing V3 database, do **not** delete the database and do **not** re-import the workbook. Run:

```powershell
cd backend
npm run migrate
```

Then restart the API.

Keep your existing `backend/.env` file.

## Default accounts

- `admin@example.com`
- `checker@example.com`
- `interviewer@example.com`

Temporary password created by seed: `ChangeMe123!`

Change passwords before production.
