import { pool } from '../db.js';

function midrankPercentile(values, score) {
  const n = values.length;
  if (!n) return null;
  let below = 0, equal = 0;
  for (const v of values) {
    if (v < score) below++;
    else if (v === score) equal++;
  }
  return 100 * (below + 0.5 * equal) / n;
}

function zScore(values, score) {
  if (!values.length) return null;
  const mean = values.reduce((a, b) => a + b, 0) / values.length;
  const variance = values.reduce((a, b) => a + (b - mean) ** 2, 0) / values.length;
  const sd = Math.sqrt(variance);
  return sd === 0 ? 0 : (score - mean) / sd;
}

export async function syncCandidateWorkflowStatus(candidateId) {
  const [[candidate]] = await pool.query('SELECT * FROM candidates WHERE id=?', [candidateId]);
  if (!candidate) return null;
  if (['SELECTED', 'REJECTED', 'WITHDRAWN'].includes(candidate.status)) return candidate.status;

  const [[written]] = await pool.query(
    'SELECT qualified,marks,set_number FROM written_tests WHERE candidate_id=?',
    [candidateId]
  );
  const [interviews] = await pool.query(
    `SELECT p.phase_order, r.attendance
       FROM interview_results r
       JOIN interview_phases p ON p.id=r.phase_id
      WHERE r.candidate_id=?
      ORDER BY p.phase_order ASC`,
    [candidateId]
  );

  let status;
  const firstInterview = interviews.find(r => Number(r.phase_order) === 1);
  const taskphasePresent = interviews.some(r => Number(r.phase_order) > 1 && r.attendance === 'PRESENT');
  const firstInterviewPresent = firstInterview?.attendance === 'PRESENT';

  if (taskphasePresent) status = 'TASKPHASE';
  else if (firstInterviewPresent) status = 'APPEARED FOR FIRST INTERVIEW';
  else if (written?.qualified === 1 || written?.qualified === true) status = 'WRITTEN CLEARED';
  else if (written?.qualified === 0 || written?.qualified === false) status = 'WRITTEN REJECTED';
  else if (candidate.attendance === 'ABSENT') status = 'ABSENT FOR WRITTEN';
  else if (candidate.attendance === 'PRESENT') status = 'GAVE WRITTEN';
  else status = 'APPLIED FOR WRITTEN';

  if (status !== candidate.status) await pool.query('UPDATE candidates SET status=? WHERE id=?', [status, candidateId]);
  return status;
}

export async function recalculateWrittenTests(campaignId = null) {
  const params = [];
  let where = 'w.marks IS NOT NULL AND w.set_number IS NOT NULL AND c.attendance <> \'ABSENT\' AND c.deleted_at IS NULL';
  if (campaignId) {
    where += ' AND c.campaign_id=?';
    params.push(campaignId);
  }

  const [rows] = await pool.query(
    `SELECT w.id,w.candidate_id,w.set_number,w.marks
       FROM written_tests w
       JOIN candidates c ON c.id=w.candidate_id
      WHERE ${where}`,
    params
  );

  const bySet = new Map();
  for (const row of rows) {
    const k = Number(row.set_number);
    if (!bySet.has(k)) bySet.set(k, []);
    bySet.get(k).push(Number(row.marks));
  }

  const scored = rows.map(row => {
    const values = bySet.get(Number(row.set_number)) || [];
    return {
      ...row,
      marks: Number(row.marks),
      setPercentile: midrankPercentile(values, Number(row.marks)),
      normalizedZ: zScore(values, Number(row.marks))
    };
  });

  const sortedZ = scored.map(x => x.normalizedZ).filter(Number.isFinite).sort((a, b) => a - b);
  const normalizedPct = z => midrankPercentile(sortedZ, z);

  for (const row of scored) {
    await pool.query(
      'UPDATE written_tests SET set_percentile=?,normalized_z=?,normalized_percentile=?,qualified=NULL WHERE id=?',
      [row.setPercentile, row.normalizedZ, normalizedPct(row.normalizedZ), row.id]
    );
  }

  let qualifiedCount = Number(process.env.WRITTEN_QUALIFIED_COUNT || 150);
  if (campaignId) {
    const [[cfg]] = await pool.query('SELECT written_qualified_count FROM campaigns WHERE id=?', [campaignId]);
    qualifiedCount = Number(cfg?.written_qualified_count || qualifiedCount);
  } else {
    const [[cfg]] = await pool.query('SELECT written_qualified_count FROM campaigns WHERE active=1 ORDER BY id DESC LIMIT 1');
    qualifiedCount = Number(cfg?.written_qualified_count || qualifiedCount);
  }

  const ranked = [...scored].sort((a, b) => b.normalizedZ - a.normalizedZ || b.setPercentile - a.setPercentile || a.candidate_id - b.candidate_id);
  const cutoff = ranked.length ? ranked[Math.min(qualifiedCount, ranked.length) - 1].normalizedZ : null;

  for (let index = 0; index < ranked.length; index++) {
    await pool.query('UPDATE written_tests SET qualified=? WHERE id=?', [index < qualifiedCount, ranked[index].id]);
  }

  const affected = new Set(ranked.map(row => row.candidate_id));
  for (const row of ranked) affected.add(row.candidate_id);
  for (const id of affected) await syncCandidateWorkflowStatus(id);

  return {
    scored: ranked.length,
    qualified: Math.min(qualifiedCount, ranked.length),
    cutoffZ: cutoff,
    cutoffPercentile: cutoff == null ? null : normalizedPct(cutoff)
  };
}

export async function writtenSummary(campaignId = null) {
  const params = [];
  let where = '1=1';
  if (campaignId) { where += ' AND c.campaign_id=?'; params.push(campaignId); }
  where += " AND c.deleted_at IS NULL";

  const [rows] = await pool.query(
    `SELECT w.set_number,COUNT(*) total,SUM(w.marks IS NOT NULL) scored,
            AVG(w.marks) avg_marks,MIN(w.marks) min_marks,MAX(w.marks) max_marks
       FROM written_tests w
       JOIN candidates c ON c.id=w.candidate_id
      WHERE ${where}
      GROUP BY w.set_number
      ORDER BY w.set_number`,
    params
  );

  const [[cut]] = await pool.query(
    `SELECT MIN(w.normalized_percentile) cutoff_percentile
       FROM written_tests w
       JOIN candidates c ON c.id=w.candidate_id
      WHERE ${where} AND w.qualified=1`,
    params
  );

  const [scores] = await pool.query(
    `SELECT w.set_number,w.marks,w.normalized_percentile,w.qualified
       FROM written_tests w
       JOIN candidates c ON c.id=w.candidate_id
      WHERE ${where} AND w.marks IS NOT NULL AND c.attendance <> 'ABSENT'
      ORDER BY w.normalized_percentile DESC`,
    params
  );

  for (const r of rows) {
    r.avg_marks = Number(r.avg_marks || 0);
    r.min_marks = r.min_marks == null ? null : Number(r.min_marks);
    r.max_marks = r.max_marks == null ? null : Number(r.max_marks);
  }

  return {
    sets: rows,
    cutoffPercentile: cut?.cutoff_percentile == null ? null : Number(cut.cutoff_percentile),
    scores
  };
}

export async function cutoffWhatIf(topN, campaignId = null) {
  const n = Math.max(1, Number(topN || 150));
  const params = [];
  let where = "w.marks IS NOT NULL AND c.attendance <> 'ABSENT' AND c.deleted_at IS NULL";
  if (campaignId) { where += ' AND c.campaign_id=?'; params.push(campaignId); }
  const [rows] = await pool.query(
    `SELECT w.candidate_id,w.normalized_percentile,w.normalized_z,w.marks,w.set_number
       FROM written_tests w
       JOIN candidates c ON c.id=w.candidate_id
      WHERE ${where}
      ORDER BY w.normalized_z DESC,w.set_percentile DESC,candidate_id ASC`,
    params
  );
  const selected = rows.slice(0, n);
  const cutoff = selected.length ? Number(selected[selected.length - 1].normalized_percentile) : null;
  const cutoffCandidate = selected.length ? selected[selected.length - 1] : null;
  return {
    requested: n,
    totalScored: rows.length,
    selected: selected.length,
    cutoffPercentile: cutoff,
    cutoffMarks: cutoffCandidate ? Number(cutoffCandidate.marks) : null,
    cutoffMarksSet: cutoffCandidate ? Number(cutoffCandidate.set_number) : null,
    top: selected.slice(0, 10)
  };
}
