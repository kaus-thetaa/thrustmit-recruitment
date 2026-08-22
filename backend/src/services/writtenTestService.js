import { pool } from '../db.js';

export const METHOD_VERSION = 'SET-MIDRANK-PERCENTILE-v1';

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

function compareRank(a, b) {
  return (Number(b.setPercentile) - Number(a.setPercentile)) ||
    (Number(b.normalizedZ) - Number(a.normalizedZ)) ||
    (Number(b.marks) - Number(a.marks));
}

function sameBoundary(a, b) {
  const eps = 1e-9;
  return Math.abs(Number(a.setPercentile) - Number(b.setPercentile)) < eps &&
    Math.abs(Number(a.normalizedZ) - Number(b.normalizedZ)) < eps &&
    Math.abs(Number(a.marks) - Number(b.marks)) < eps;
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
 * Fairness model used for the official ranking:
 * 1) Compare candidates within their own set using a midrank percentile.
 * 2) Use the set z-score only as a secondary tie-break/audit signal.
 * 3) Use raw marks as a final performance tie-break.
 * 4) If candidates are still identical on all three measures at the cutoff,
 *    all tied candidates are qualified rather than using candidate ID/order.
 *
 * This avoids arbitrary ordering by database ID and avoids assuming that all
 * four score distributions are normally shaped for the primary comparison.
 */
export async function recalculateWrittenTests(campaignId = null) {
  const params = [];
  let where = 'w.marks IS NOT NULL AND w.set_number IS NOT NULL AND c.attendance = \'PRESENT\' AND c.deleted_at IS NULL';
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

  let qualifiedCount = 150;
  let campaignFinalized = false;
  let campaign = null;
  if (campaignId) {
    const [[cfg]] = await pool.query('SELECT * FROM campaigns WHERE id=?', [campaignId]);
    campaign = cfg || null;
  } else {
    const [[cfg]] = await pool.query('SELECT * FROM campaigns WHERE active=1 ORDER BY recruitment_year DESC,id DESC LIMIT 1');
    campaign = cfg || null;
  }
  qualifiedCount = Number(campaign?.written_qualified_count || process.env.WRITTEN_QUALIFIED_COUNT || 150);
  campaignFinalized = Number(campaign?.written_finalized || 0) === 1;

  const ranked = [...scored].sort(compareRank);
  const enoughForFinalizedQualification = ranked.length >= qualifiedCount;
  const qualificationMismatch = campaignFinalized && !enoughForFinalizedQualification;
  const qualifiedById = new Map();
  let cutoffRow = null;
  let tieAtCutoff = false;

  if (campaignFinalized && enoughForFinalizedQualification) {
    cutoffRow = ranked[qualifiedCount - 1];
    tieAtCutoff = ranked.filter(r => sameBoundary(r, cutoffRow)).length > 1;
    for (let index = 0; index < ranked.length; index++) {
      const shouldQualify = index < qualifiedCount || sameBoundary(ranked[index], cutoffRow);
      qualifiedById.set(ranked[index].id, shouldQualify);
    }
  }

  if (scored.length) {
    const ids = scored.map(r => r.id);
    const setPctCase = ids.map(() => 'WHEN id=? THEN ?').join(' ');
    const zCase = ids.map(() => 'WHEN id=? THEN ?').join(' ');
    const normPctCase = ids.map(() => 'WHEN id=? THEN ?').join(' ');
    const updateParams = [];
    for (const row of scored) updateParams.push(row.id, row.setPercentile);
    for (const row of scored) updateParams.push(row.id, row.normalizedZ);
    for (const row of scored) updateParams.push(row.id, normalizedPct(row.normalizedZ));

    if (campaignFinalized && enoughForFinalizedQualification) {
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

  if (scored.length && !qualificationMismatch && campaignFinalized && enoughForFinalizedQualification) {
    const ids = [...new Set(scored.map(r => r.candidate_id))];
    const placeholders = ids.map(() => '?').join(',');
    const values = [];
    const cases = ids.map(id => {
      const row = scored.find(x => x.candidate_id === id);
      values.push(id, qualifiedById.get(row?.id) ? 1 : 0);
      return 'WHEN c.id=? THEN ?';
    }).join(' ');
    await pool.query(
      `UPDATE candidates c
          SET c.status=CASE ${cases} ELSE c.status END
        WHERE c.id IN (${placeholders})
          AND c.attendance='PRESENT'
          AND c.status IN ('APPLIED FOR WRITTEN','GAVE WRITTEN','WRITTEN CLEARED','WRITTEN REJECTED')`,
      [...values, ...ids]
    );
  }

  let existingQualified = 0;
  if (campaignFinalized) {
    const qParams = [];
    let qWhere = 'w.qualified=1 AND c.deleted_at IS NULL';
    if (campaignId) { qWhere += ' AND c.campaign_id=?'; qParams.push(campaignId); }
    const [qRows] = await pool.query(`SELECT COUNT(*) qualified FROM written_tests w JOIN candidates c ON c.id=w.candidate_id WHERE ${qWhere}`, qParams);
    existingQualified = Number(qRows[0]?.qualified || 0);
  }

  const cutoffPercentile = cutoffRow ? Number(cutoffRow.setPercentile) : null;
  const normalizedCutoffPercentile = cutoffRow ? normalizedPct(cutoffRow.normalizedZ) : null;
  const setStats = [...bySet.entries()].sort((a,b)=>a[0]-b[0]).map(([setNumber, values])=>({
    set_number:Number(setNumber), candidates:values.length,
    average:Number(values.reduce((a,b)=>a+b,0)/values.length || 0),
    median:Number([...values].sort((a,b)=>a-b)[Math.floor(values.length/2)] ?? 0),
    min:Number(Math.min(...values)), max:Number(Math.max(...values)),
    sd:Number(Math.sqrt(values.reduce((a,b)=>a+(b-values.reduce((x,y)=>x+y,0)/values.length)**2,0)/values.length) || 0)
  }));

  return {
    methodVersion: METHOD_VERSION,
    scored: ranked.length,
    qualified: campaignFinalized ? (qualificationMismatch ? existingQualified : [...qualifiedById.values()].filter(Boolean).length) : 0,
    finalized: campaignFinalized,
    qualificationMismatch,
    tieAtCutoff,
    readyToFinalize: !campaignFinalized && ranked.length >= qualifiedCount,
    requiredForFinalization: qualifiedCount,
    cutoffZ: cutoffRow ? cutoffRow.normalizedZ : null,
    cutoffPercentile,
    normalizedCutoffPercentile,
    cutoffMarks: cutoffRow ? cutoffRow.marks : null,
    cutoffSet: cutoffRow ? cutoffRow.set_number : null,
    setStats,
    ranking: ranked.map((r, i) => ({rank:i+1,candidate_id:r.candidate_id,set_number:r.set_number,marks:r.marks,set_percentile:r.setPercentile,normalized_z:r.normalizedZ,normalized_percentile:normalizedPct(r.normalizedZ),qualified:campaignFinalized ? Boolean(qualifiedById.get(r.id)) : null}))
  };
}

export async function writtenSummary(campaignId = null) {
  const params = [];
  let where = "c.deleted_at IS NULL";
  if (campaignId) { where += ' AND c.campaign_id=?'; params.push(campaignId); }

  const [rows] = await pool.query(
    `SELECT w.set_number,COUNT(*) total,SUM(w.marks IS NOT NULL) scored,
            AVG(w.marks) avg_marks,MIN(w.marks) min_marks,MAX(w.marks) max_marks
       FROM written_tests w
       JOIN candidates c ON c.id=w.candidate_id
      WHERE ${where}
      GROUP BY w.set_number
      ORDER BY w.set_number`, params);

  const [[cut]] = await pool.query(
    `SELECT MIN(w.set_percentile) cutoff_percentile
       FROM written_tests w JOIN candidates c ON c.id=w.candidate_id
      WHERE ${where} AND w.qualified=1`, params);
  const [[counts]] = await pool.query(
    `SELECT SUM(w.marks IS NOT NULL AND c.attendance='PRESENT') scored_count,
            SUM(w.qualified=1) qualified_count
       FROM written_tests w JOIN candidates c ON c.id=w.candidate_id WHERE ${where}`, params);

  for (const r of rows) {
    r.avg_marks = Number(r.avg_marks || 0);
    r.min_marks = r.min_marks == null ? null : Number(r.min_marks);
    r.max_marks = r.max_marks == null ? null : Number(r.max_marks);
  }
  return {
    methodVersion: METHOD_VERSION,
    sets: rows,
    scoredCount:Number(counts?.scored_count||0),
    qualifiedCount:Number(counts?.qualified_count||0),
    cutoffPercentile:cut?.cutoff_percentile==null?null:Number(cut.cutoff_percentile)
  };
}

export async function cutoffWhatIf(topN, campaignId = null) {
  const n = Math.max(1, Number(topN || 150));
  const params = [];
  let where = "w.marks IS NOT NULL AND c.attendance='PRESENT' AND c.deleted_at IS NULL";
  if (campaignId) { where += ' AND c.campaign_id=?'; params.push(campaignId); }
  const [rows] = await pool.query(`SELECT w.candidate_id,w.set_number,w.marks,w.set_percentile,w.normalized_z,w.normalized_percentile FROM written_tests w JOIN candidates c ON c.id=w.candidate_id WHERE ${where}`,params);
  const ranked = rows.sort((a,b)=>(Number(b.set_percentile)-Number(a.set_percentile))||(Number(b.normalized_z)-Number(a.normalized_z))||(Number(b.marks)-Number(a.marks)));
  const selected = ranked.slice(0,n);
  const cutoff = selected.length ? selected[selected.length-1] : null;
  return {requested:n,totalScored:ranked.length,selected:selected.length,cutoffPercentile:cutoff?Number(cutoff.normalized_percentile):null,cutoffMarks:cutoff?Number(cutoff.marks):null,cutoffMarksSet:cutoff?Number(cutoff.set_number):null,top:selected.slice(0,10),methodVersion:METHOD_VERSION};
}
