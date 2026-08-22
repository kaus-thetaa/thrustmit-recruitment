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

/**
 * Recalculate written-test percentiles efficiently.
 *
 * Important behavior:
 * - Percentiles are updated as marks arrive.
 * - Nobody is marked WRITTEN CLEARED/REJECTED until at least the configured
 *   number of candidates (default 150) have scored marks in the campaign.
 *   This prevents the dashboard's "Written cleared" count from simply
 *   following 60 -> 80 -> 115 as marks are entered.
 * - Once the pool reaches the qualification count, exactly the top N are
 *   qualified on the current normalized ranking.
 * - Existing candidates already beyond the written round keep their later
 *   status; only written-stage candidates are updated.
 * - Database updates are batched instead of issuing one query per candidate,
 *   which fixes the "Saving…" spinner on larger batches.
 */
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

  let qualifiedCount = Number(process.env.WRITTEN_QUALIFIED_COUNT || 150);
  let campaignFinalized = false;
  if (campaignId) {
    const [[cfg]] = await pool.query('SELECT written_qualified_count,written_finalized FROM campaigns WHERE id=?', [campaignId]);
    qualifiedCount = Number(cfg?.written_qualified_count || qualifiedCount);
    campaignFinalized = Number(cfg?.written_finalized||0)===1;
  } else {
    const [[cfg]] = await pool.query('SELECT written_qualified_count,written_finalized FROM campaigns WHERE active=1 ORDER BY id DESC LIMIT 1');
    qualifiedCount = Number(cfg?.written_qualified_count || qualifiedCount);
    campaignFinalized = Number(cfg?.written_finalized||0)===1;
  }

  const ranked = [...scored].sort((a, b) =>
    b.normalizedZ - a.normalizedZ ||
    b.setPercentile - a.setPercentile ||
    a.candidate_id - b.candidate_id
  );
  const finalized = campaignFinalized;
  const enoughForFinalizedQualification = ranked.length >= qualifiedCount;
  const qualificationMismatch = finalized && !enoughForFinalizedQualification;
  const qualifiedById = new Map();
  if (finalized && enoughForFinalizedQualification) {
    for (let index = 0; index < ranked.length; index++) {
      qualifiedById.set(ranked[index].id, index < qualifiedCount);
    }
  }

  // Batch written-test updates into a single CASE statement.
  // Never clear an existing qualification merely because the current scored pool
  // is temporarily incomplete; that would make a late data-entry correction
  // silently destroy an already-finalized result.
  if (scored.length) {
    const ids = scored.map(r => r.id);
    const setPctCase = ids.map(() => 'WHEN id=? THEN ?').join(' ');
    const zCase = ids.map(() => 'WHEN id=? THEN ?').join(' ');
    const normPctCase = ids.map(() => 'WHEN id=? THEN ?').join(' ');
    const updateParams = [];

    for (const row of scored) updateParams.push(row.id, row.setPercentile);
    for (const row of scored) updateParams.push(row.id, row.normalizedZ);
    for (const row of scored) updateParams.push(row.id, normalizedPct(row.normalizedZ));

    if (finalized && enoughForFinalizedQualification) {
      const qualCase = ids.map(() => 'WHEN id=? THEN ?').join(' ');
      for (const row of scored) updateParams.push(row.id, qualifiedById.get(row.id) ? 1 : 0);
      updateParams.push(...ids);
      await pool.query(
        `UPDATE written_tests
            SET set_percentile=CASE ${setPctCase} END,
                normalized_z=CASE ${zCase} END,
                normalized_percentile=CASE ${normPctCase} END,
                qualified=CASE ${qualCase} END
          WHERE id IN (${ids.map(() => '?').join(',')})`,
        updateParams
      );
    } else {
      // Keep existing qualified values intact until the round has a complete
      // qualification pool, while refreshing the percentile calculations.
      updateParams.push(...ids);
      await pool.query(
        `UPDATE written_tests
            SET set_percentile=CASE ${setPctCase} END,
                normalized_z=CASE ${zCase} END,
                normalized_percentile=CASE ${normPctCase} END
          WHERE id IN (${ids.map(() => '?').join(',')})`,
        updateParams
      );
    }
  }

  // Keep candidate workflow statuses consistent in one database operation.
  if (scored.length && !qualificationMismatch) {
    const ids = [...new Set(scored.map(r => r.candidate_id))];
    const candidatePlaceholders = ids.map(() => '?').join(',');
    await pool.query(
      `UPDATE candidates c
          JOIN written_tests w ON w.candidate_id=c.id
          SET c.status=CASE
            WHEN c.status IN ('APPLIED FOR WRITTEN','GAVE WRITTEN','WRITTEN CLEARED','WRITTEN REJECTED')
              THEN CASE
                WHEN w.qualified=1 THEN 'WRITTEN CLEARED'
                WHEN w.qualified=0 THEN 'WRITTEN REJECTED'
                ELSE 'GAVE WRITTEN'
              END
            ELSE c.status
          END
        WHERE c.id IN (${candidatePlaceholders})
          AND c.attendance <> 'ABSENT'`,
      ids
    );
  }

  let existingQualified = 0;
  if (finalized) {
    const [qRows] = await pool.query(`SELECT COUNT(*) qualified FROM written_tests w JOIN candidates c ON c.id=w.candidate_id WHERE w.qualified=1 AND c.deleted_at IS NULL${campaignId ? ' AND c.campaign_id=?' : ''}`, campaignId ? [campaignId] : []);
    existingQualified = Number(qRows[0]?.qualified || 0);
  }
  const cutoff = finalized && enoughForFinalizedQualification ? ranked[qualifiedCount - 1].normalizedZ : null;
  return {
    scored: ranked.length,
    qualified: finalized ? (qualificationMismatch ? existingQualified : Math.min(qualifiedCount, ranked.length)) : 0,
    finalized,
    qualificationMismatch,
    readyToFinalize: !finalized && ranked.length >= qualifiedCount,
    requiredForFinalization: qualifiedCount,
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
  const [[counts]] = await pool.query(
    `SELECT
       SUM(w.marks IS NOT NULL AND c.attendance='PRESENT') scored_count,
       SUM(w.qualified=1) qualified_count
       FROM written_tests w
       JOIN candidates c ON c.id=w.candidate_id
      WHERE ${where}`, params
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

  const scoredCount=Number(counts?.scored_count||0);
  const qualifiedCount=Number(counts?.qualified_count||0);
  return {
    sets: rows,
    scoredCount,
    qualifiedCount,
    qualificationMismatch: qualifiedCount>scoredCount,
    cutoffPercentile: qualifiedCount>scoredCount ? null : (cut?.cutoff_percentile == null ? null : Number(cut.cutoff_percentile)),
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
