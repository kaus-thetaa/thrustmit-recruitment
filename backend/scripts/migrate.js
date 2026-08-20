import fs from 'node:fs/promises';
import dotenv from 'dotenv';
import { pool } from '../src/db.js';

dotenv.config();

async function hasColumn(table, column) {
  const [rows] = await pool.query(
    `SELECT COUNT(*) count FROM INFORMATION_SCHEMA.COLUMNS
      WHERE TABLE_SCHEMA=DATABASE() AND TABLE_NAME=? AND COLUMN_NAME=?`,
    [table, column]
  );
  return Number(rows[0].count) > 0;
}

async function hasIndex(table, index) {
  const [rows] = await pool.query(
    `SELECT COUNT(*) count FROM INFORMATION_SCHEMA.STATISTICS
      WHERE TABLE_SCHEMA=DATABASE() AND TABLE_NAME=? AND INDEX_NAME=?`,
    [table, index]
  );
  return Number(rows[0].count) > 0;
}

async function ensureColumn(table, column, ddl) {
  if (!(await hasColumn(table, column))) {
    await pool.query(ddl);
    console.log(`Added ${table}.${column}`);
  }
}

const sql = await fs.readFile(new URL('../sql/schema.sql', import.meta.url), 'utf8');
const statements = sql
  .split(/;\s*(?=CREATE|INSERT|USE)/i)
  .map(s => s.trim())
  .filter(Boolean);

const baseStatements = statements.filter(s => !/^INSERT INTO (campaigns|interview_phases)/i.test(s));
for (const statement of baseStatements) await pool.query(statement);

// We deliberately disable safe-update mode only for this migration process so
// existing records can be upgraded deterministically. It is restored before exit.
await pool.query('SET SQL_SAFE_UPDATES=0');

await ensureColumn('candidates', 'campaign_id', 'ALTER TABLE candidates ADD COLUMN campaign_id BIGINT UNSIGNED NULL');
await ensureColumn('candidates', 'learner_id', 'ALTER TABLE candidates ADD COLUMN learner_id VARCHAR(100) NULL');
await ensureColumn('candidates', 'deleted_at', 'ALTER TABLE candidates ADD COLUMN deleted_at TIMESTAMP NULL');
await ensureColumn('candidates', 'archived_status', 'ALTER TABLE candidates ADD COLUMN archived_status VARCHAR(80) NULL');
await ensureColumn('interview_phases', 'campaign_id', 'ALTER TABLE interview_phases ADD COLUMN campaign_id BIGINT UNSIGNED NULL');
await ensureColumn('interview_phases', 'phase_type', "ALTER TABLE interview_phases ADD COLUMN phase_type ENUM('REC_INTERVIEW','TASKPHASE') NOT NULL DEFAULT 'TASKPHASE'");
await ensureColumn('interview_phases', 'active', 'ALTER TABLE interview_phases ADD COLUMN active BOOLEAN NOT NULL DEFAULT TRUE');
await ensureColumn('interview_results', 'interviewer_names', 'ALTER TABLE interview_results ADD COLUMN interviewer_names JSON NULL');
await ensureColumn('interview_results', 'interview_date', 'ALTER TABLE interview_results ADD COLUMN interview_date DATE NULL');

// Normalize the interview schema without maintaining duplicate compatibility columns.
if (await hasColumn('interview_results', 'attendance_new')) {
  await pool.query(`UPDATE interview_results
    SET attendance = CASE
      WHEN attendance_new IS NOT NULL THEN attendance_new
      WHEN attendance='APPEARED' THEN 'PRESENT'
      ELSE attendance
    END
    WHERE attendance_new IS NOT NULL OR attendance='APPEARED'`);
}
if (await hasColumn('interview_results', 'remarks_new')) {
  await pool.query(`UPDATE interview_results SET remarks=remarks_new WHERE remarks_new IS NOT NULL AND (remarks IS NULL OR remarks='')`);
}
if (await hasColumn('interview_results', 'interviewer_names')) {
  await pool.query(`UPDATE interview_results SET interviewer_names=JSON_ARRAY() WHERE interviewer_names IS NULL`);
}

await pool.query(`INSERT INTO campaigns(name,recruitment_year,active,written_max_marks,written_qualified_count)
  SELECT 'ThrustMIT Recruitment', YEAR(CURDATE()), 1, 20, 150
  WHERE NOT EXISTS (SELECT 1 FROM campaigns WHERE recruitment_year=YEAR(CURDATE()))`);

const [[campaign]] = await pool.query('SELECT id FROM campaigns WHERE recruitment_year=YEAR(CURDATE()) ORDER BY id DESC LIMIT 1');
if (!campaign?.id) throw new Error('Could not determine the active recruitment campaign.');
const campaignId = Number(campaign.id);

await pool.query('UPDATE candidates SET campaign_id=? WHERE campaign_id IS NULL', [campaignId]);
await pool.query('UPDATE interview_phases SET campaign_id=? WHERE campaign_id IS NULL', [campaignId]);

await pool.query(`INSERT INTO interview_phases(campaign_id,name,phase_type,description,phase_order,active)
  SELECT ?, 'Recruitment Interview','REC_INTERVIEW','First interview after written round',1,1
  WHERE NOT EXISTS (SELECT 1 FROM interview_phases WHERE campaign_id=? AND phase_order=1)`, [campaignId, campaignId]);

// Clean duplicate interview results before enforcing uniqueness.
try {
  await pool.query(`DELETE r1 FROM interview_results r1
    INNER JOIN interview_results r2
      ON r1.phase_id=r2.phase_id
     AND r1.candidate_id=r2.candidate_id
     AND r1.id>r2.id`);
} catch (error) {
  console.warn(`Duplicate interview cleanup skipped: ${error.message}`);
}

if (!(await hasIndex('interview_results', 'uq_interview_candidate_phase'))) {
  try {
    await pool.query('ALTER TABLE interview_results ADD UNIQUE KEY uq_interview_candidate_phase (candidate_id, phase_id)');
  } catch (error) {
    console.warn(`Interview uniqueness index could not be added: ${error.message}`);
  }
}

if (await hasIndex('interview_phases', 'uq_phase_order')) {
  try { await pool.query('ALTER TABLE interview_phases DROP INDEX uq_phase_order'); } catch {}
}

try { await pool.query("ALTER TABLE candidates MODIFY status VARCHAR(80) NOT NULL DEFAULT 'APPLIED FOR WRITTEN'"); } catch {}

// Import-era attendance cleanup.
await pool.query(`UPDATE candidates
  SET status = CASE
    WHEN attendance='ABSENT' THEN 'ABSENT FOR WRITTEN'
    WHEN attendance='PRESENT' AND status='APPLIED' THEN 'APPLIED FOR WRITTEN'
    ELSE status
  END
  WHERE id IS NOT NULL`);

await pool.query('SET SQL_SAFE_UPDATES=1');
console.log(`V4 migration complete. Active campaign id: ${campaignId}.`);
await pool.end();
