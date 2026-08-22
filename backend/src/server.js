import express from 'express';
import cors from 'cors';
import bcrypt from 'bcryptjs';
import dotenv from 'dotenv';
import XLSX from 'xlsx';
import { pool } from './db.js';
import { requireAuth, requireRole, signToken, getUserById } from './auth.js';
import { audit } from './audit.js';
import { recalculateWrittenTests, writtenSummary, cutoffWhatIf, syncCandidateWorkflowStatus, METHOD_VERSION } from './services/writtenTestService.js';

dotenv.config();
const app=express();
const allowedOrigins=(process.env.CORS_ORIGIN||'*').split(',').map(s=>s.trim());
app.use(cors({origin(origin,cb){if(!origin||allowedOrigins.includes('*')||allowedOrigins.includes(origin))return cb(null,true);cb(new Error('CORS origin not allowed'));}}));
app.use(express.json({limit:'1mb'}));

async function ensureV6Schema(){
  await pool.query(`CREATE TABLE IF NOT EXISTS written_round_audits (
    id BIGINT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
    campaign_id BIGINT UNSIGNED NOT NULL,
    action ENUM('FINALIZE','REOPEN') NOT NULL,
    method_version VARCHAR(120) NOT NULL,
    target_count INT UNSIGNED NOT NULL,
    scored_count INT UNSIGNED NOT NULL,
    qualified_count INT UNSIGNED NOT NULL,
    cutoff_percentile DECIMAL(10,6) NULL,
    cutoff_set_percentile DECIMAL(10,6) NULL,
    normalized_cutoff_percentile DECIMAL(10,6) NULL,
    cutoff_marks DECIMAL(8,2) NULL,
    cutoff_set TINYINT UNSIGNED NULL,
    tie_at_cutoff BOOLEAN NOT NULL DEFAULT FALSE,
    set_stats_json LONGTEXT NULL,
    ranking_json LONGTEXT NULL,
    reason TEXT NULL,
    performed_by BIGINT UNSIGNED NULL,
    created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
    INDEX idx_wra_campaign_created (campaign_id, created_at),
    CONSTRAINT fk_wra_campaign FOREIGN KEY (campaign_id) REFERENCES campaigns(id) ON DELETE CASCADE,
    CONSTRAINT fk_wra_user FOREIGN KEY (performed_by) REFERENCES users(id) ON DELETE SET NULL
  ) ENGINE=InnoDB`);
  const checks=[
    ['campaigns','written_finalized','BOOLEAN NOT NULL DEFAULT FALSE'],
    ['campaigns','written_finalized_at','DATETIME NULL'],
    ['campaigns','written_finalized_by','BIGINT UNSIGNED NULL'],
    ['written_round_audits','cutoff_set_percentile','DECIMAL(10,6) NULL'],
    ['written_round_audits','normalized_cutoff_percentile','DECIMAL(10,6) NULL'],
  ];
  for(const [table,column,definition] of checks){
    const [rows]=await pool.query(`SELECT 1 FROM information_schema.columns WHERE table_schema=DATABASE() AND table_name=? AND column_name=? LIMIT 1`,[table,column]);
    if(!rows.length) await pool.query(`ALTER TABLE \`${table}\` ADD COLUMN \`${column}\` ${definition}`);
  }
  // Keep the visible title neutral; do not alter candidate/recruitment data.
  await pool.query("UPDATE campaigns SET name='LMS Recruitment' WHERE name LIKE '%ThrustMIT%'");
}


const CANDIDATE_STATUSES=['ALL','APPLIED FOR WRITTEN','ABSENT FOR WRITTEN','GAVE WRITTEN','WRITTEN CLEARED','WRITTEN REJECTED','APPEARED FOR FIRST INTERVIEW','TASKPHASE','SELECTED','REJECTED','WITHDRAWN'];
const ATTENDANCE=['PRESENT','ABSENT','RESCHEDULED','EXCUSED'];

app.get('/api/health',async(_req,res)=>{const start=Date.now();try{await pool.query('SELECT 1');res.json({ok:true,dbMs:Date.now()-start})}catch(e){res.status(503).json({ok:false,error:e.message})}});
app.post('/api/auth/login',async(req,res)=>{try{const{email,password}=req.body||{};if(!email||!password)return res.status(400).json({error:'Email and password are required'});const[rows]=await pool.query('SELECT * FROM users WHERE email=? AND active=1 LIMIT 1',[email]);const user=rows[0];if(!user||!(await bcrypt.compare(password,user.password_hash)))return res.status(401).json({error:'Invalid credentials'});res.json({token:signToken(user),user:{id:user.id,name:user.name,email:user.email,role:user.role}})}catch(e){res.status(500).json({error:e.message})}});
app.get('/api/auth/me',requireAuth,async(req,res)=>{const user=await getUserById(req.user.id);if(!user)return res.status(404).json({error:'User not found'});res.json(user)});

app.get('/api/campaigns',requireAuth,async(_req,res)=>{const[r]=await pool.query('SELECT * FROM campaigns ORDER BY recruitment_year DESC,id DESC');res.json(r)});
app.post('/api/campaigns',requireAuth,requireRole('ADMIN'),async(req,res)=>{try{const{name,recruitmentYear,writtenMaxMarks=20,writtenQualifiedCount=150}=req.body||{};if(!name||!recruitmentYear)return res.status(400).json({error:'Campaign name and year are required'});await pool.query('UPDATE campaigns SET active=0 WHERE id IS NOT NULL'); const[r]=await pool.query('INSERT INTO campaigns(name,recruitment_year,written_max_marks,written_qualified_count,active) VALUES(?,?,?,?,1)',[name,Number(recruitmentYear),Number(writtenMaxMarks),Number(writtenQualifiedCount)]);const[rows]=await pool.query('SELECT * FROM campaigns WHERE id=?',[r.insertId]);res.status(201).json(rows[0])}catch(e){res.status(500).json({error:e.code==='ER_DUP_ENTRY'?'Campaign already exists':e.message})}});

app.get('/api/users',requireAuth,requireRole('ADMIN'),async(_req,res)=>{const[r]=await pool.query('SELECT id,name,email,role,active,created_at FROM users ORDER BY active DESC,name');res.json(r)});
app.post('/api/users',requireAuth,requireRole('ADMIN'),async(req,res)=>{try{const{name,email,password,role='INTERVIEWER'}=req.body||{};if(!name||!email||!password)return res.status(400).json({error:'Name, email and password are required'});if(!['ADMIN','TEST_CHECKER','INTERVIEWER'].includes(role))return res.status(400).json({error:'Invalid role'});const hash=await bcrypt.hash(String(password),12);const[r]=await pool.query('INSERT INTO users(name,email,password_hash,role,active) VALUES(?,?,?,?,1)',[name.trim(),email.trim(),hash,role]);const[rows]=await pool.query('SELECT id,name,email,role,active,created_at FROM users WHERE id=?',[r.insertId]);res.status(201).json(rows[0])}catch(e){res.status(500).json({error:e.code==='ER_DUP_ENTRY'?'A user with that email already exists':e.message})}});
app.put('/api/users/:id',requireAuth,requireRole('ADMIN'),async(req,res)=>{try{const{active,role,password,name}=req.body||{};const sets=[];const params=[];if(name!=null){sets.push('name=?');params.push(String(name).trim())}if(active!=null){sets.push('active=?');params.push(Boolean(active))}if(role!=null){if(!['ADMIN','TEST_CHECKER','INTERVIEWER'].includes(role))return res.status(400).json({error:'Invalid role'});sets.push('role=?');params.push(role)}if(password){sets.push('password_hash=?');params.push(await bcrypt.hash(String(password),12))}if(!sets.length)return res.status(400).json({error:'Nothing to update'});params.push(req.params.id);await pool.query(`UPDATE users SET ${sets.join(', ')} WHERE id=?`,params);const[rows]=await pool.query('SELECT id,name,email,role,active,created_at FROM users WHERE id=?',[req.params.id]);res.json(rows[0])}catch(e){res.status(500).json({error:e.message})}});

app.get('/api/candidates',requireAuth,async(req,res)=>{
  try{
    const q=String(req.query.q||'').trim();
    const status=String(req.query.status||'').trim();
    const includeDeleted=String(req.query.includeDeleted||'')==='true';
    const branch=String(req.query.branch||'').trim();
    const writtenAttendance=String(req.query.writtenAttendance||'').trim();
    const phaseId=Number(req.query.phaseId||0);
    const needsWrittenMarks=String(req.query.needsWrittenMarks||'')==='true';
    const needsInterviewRemark=String(req.query.needsInterviewRemark||'')==='true';
    const page=Math.max(1,Number(req.query.page||1));
    const pageSize=Math.min(100,Math.max(1,Number(req.query.pageSize||50)));
    const params=[];
    let where=includeDeleted?'1=1':'deleted_at IS NULL';
    if(q){where+=' AND (name LIKE ? OR learner_id LIKE ? OR registration_number LIKE ? OR phone LIKE ? OR email LIKE ? OR branch LIKE ?)';const s=`%${q}%`;params.push(s,s,s,s,s,s)}
    if(status&&status!=='ALL'){where+=' AND status=?';params.push(status)}
    if(branch){where+=' AND branch=?';params.push(branch)}
    if(writtenAttendance==='UNMARKED') where+=" AND attendance='UNKNOWN'";
    else if(writtenAttendance==='PRESENT'||writtenAttendance==='ABSENT'){where+=' AND attendance=?';params.push(writtenAttendance)}
    if(needsWrittenMarks) where+=" AND attendance='PRESENT' AND (NOT EXISTS (SELECT 1 FROM written_tests wm WHERE wm.candidate_id=candidates.id) OR EXISTS (SELECT 1 FROM written_tests wm2 WHERE wm2.candidate_id=candidates.id AND wm2.marks IS NULL))";
    if(phaseId){where+=' AND EXISTS (SELECT 1 FROM interview_results fxr WHERE fxr.candidate_id=candidates.id AND fxr.phase_id=?)';params.push(phaseId)}
    if(needsInterviewRemark) where+=" AND EXISTS (SELECT 1 FROM interview_results irx JOIN interview_phases ipx ON ipx.id=irx.phase_id WHERE irx.candidate_id=candidates.id AND irx.attendance='PRESENT' AND (irx.remarks IS NULL OR TRIM(irx.remarks)='') AND ipx.active=1)";
    const [[{count}]]=await pool.query(`SELECT COUNT(*) count FROM candidates WHERE ${where}`,params);
    const [rows]=await pool.query(`SELECT * FROM candidates WHERE ${where} ORDER BY name LIMIT ? OFFSET ?`,[...params,pageSize,(page-1)*pageSize]);
    const [branches]=await pool.query("SELECT DISTINCT branch FROM candidates WHERE branch IS NOT NULL AND branch<>'' ORDER BY branch");
    res.json({data:rows,page,pageSize,total:Number(count),branches:branches.map(x=>x.branch),statuses:CANDIDATE_STATUSES,totalPages:Math.max(1,Math.ceil(Number(count)/pageSize))});
  }catch(e){res.status(500).json({error:e.message})}
});
app.post('/api/candidates',requireAuth,requireRole('ADMIN'),async(req,res)=>{try{const{campaignId,name,learnerId,registrationNumber,email,phone,branch,notes}=req.body||{};if(!name)return res.status(400).json({error:'Name is required'});const[[activeCampaign]]=await pool.query('SELECT id FROM campaigns WHERE active=1 ORDER BY recruitment_year DESC,id DESC LIMIT 1');const resolvedCampaignId=campaignId||activeCampaign?.id||null;const[r]=await pool.query('INSERT INTO candidates(campaign_id,name,learner_id,registration_number,email,phone,branch,status,notes) VALUES(?,?,?,?,?,?,?,\'APPLIED FOR WRITTEN\',?)',[resolvedCampaignId,name,learnerId||null,registrationNumber||null,email||null,phone||null,branch||null,notes||null]);await audit({userId:req.user.id,candidateId:r.insertId,action:'CREATE',objectType:'candidate',objectId:r.insertId,newValue:name});const[rows]=await pool.query('SELECT * FROM candidates WHERE id=?',[r.insertId]);res.status(201).json(rows[0])}catch(e){res.status(500).json({error:e.code==='ER_DUP_ENTRY'?'Registration number already exists':e.message})}});

app.get('/api/candidates/:id',requireAuth,async(req,res)=>{try{const[cRows]=await pool.query(`SELECT c.*,ca.name campaign_name,ca.recruitment_year,ca.written_finalized FROM candidates c LEFT JOIN campaigns ca ON ca.id=c.campaign_id WHERE c.id=?`,[req.params.id]);if(!cRows[0])return res.status(404).json({error:'Candidate not found'});const[w]=await pool.query('SELECT w.*,u.name scored_by_name FROM written_tests w LEFT JOIN users u ON u.id=w.scored_by WHERE w.candidate_id=?',[req.params.id]);const[i]=await pool.query(`SELECT r.*,p.name phase_name,p.phase_type,p.phase_order,cu.name created_by_name FROM interview_results r JOIN interview_phases p ON p.id=r.phase_id LEFT JOIN users cu ON cu.id=r.created_by WHERE r.candidate_id=? ORDER BY p.phase_order,r.created_at`,[req.params.id]);const[a]=await pool.query('SELECT a.*,u.name user_name FROM audit_logs a LEFT JOIN users u ON u.id=a.user_id WHERE candidate_id=? ORDER BY a.created_at DESC LIMIT 200',[req.params.id]);res.json({candidate:cRows[0],written:w[0]||null,interviews:i,audit:a})}catch(e){res.status(500).json({error:e.message})}});

app.put('/api/candidates/:id',requireAuth,requireRole('ADMIN'),async(req,res)=>{try{const allowed=['name','learner_id','registration_number','phone','email','branch','status','notes','attendance','campaign_id'];const sets=[],values=[];for(const key of allowed)if(Object.hasOwn(req.body,key)){sets.push(`${key}=?`);values.push(req.body[key]??null)}if(!sets.length)return res.status(400).json({error:'Nothing to update'});const[b]=await pool.query('SELECT * FROM candidates WHERE id=?',[req.params.id]);if(!b[0])return res.status(404).json({error:'Candidate not found'});values.push(req.params.id);await pool.query(`UPDATE candidates SET ${sets.join(', ')} WHERE id=?`,values);for(const key of allowed)if(Object.hasOwn(req.body,key)&&String(b[0][key]??'')!==String(req.body[key]??''))await audit({userId:req.user.id,candidateId:req.params.id,action:'UPDATE',objectType:'candidate',objectId:req.params.id,fieldName:key,oldValue:b[0][key],newValue:req.body[key]});const[r]=await pool.query('SELECT * FROM candidates WHERE id=?',[req.params.id]);res.json(r[0])}catch(e){res.status(500).json({error:e.code==='ER_DUP_ENTRY'?'Registration number already exists':e.message})}});
app.post('/api/candidates/bulk-archive',requireAuth,requireRole('ADMIN'),async(req,res)=>{
  try{
    const ids=Array.isArray(req.body?.ids)?req.body.ids.map(Number).filter(Boolean):[];
    if(!ids.length)return res.status(400).json({error:'No candidates selected'});
    const placeholders=ids.map(()=>'?').join(',');
    const[rows]=await pool.query(`SELECT id,status FROM candidates WHERE deleted_at IS NULL AND id IN (${placeholders})`,ids);
    if(!rows.length)return res.json({archived:0});
    await pool.query(`UPDATE candidates SET archived_status=status,deleted_at=NOW() WHERE deleted_at IS NULL AND id IN (${placeholders})`,ids);
    for(const r of rows)await audit({userId:req.user.id,candidateId:r.id,action:'ARCHIVE',objectType:'candidate',objectId:r.id,oldValue:r.status,newValue:'ARCHIVED'});
    res.json({archived:rows.length})
  }catch(e){res.status(500).json({error:e.message})}
});

app.delete('/api/candidates/:id',requireAuth,requireRole('ADMIN'),async(req,res)=>{try{const[[c]]=await pool.query('SELECT id,status FROM candidates WHERE id=?',[req.params.id]);if(!c)return res.status(404).json({error:'Candidate not found'});await pool.query("UPDATE candidates SET archived_status=status,deleted_at=NOW() WHERE id=?",[req.params.id]);await audit({userId:req.user.id,candidateId:req.params.id,action:'ARCHIVE',objectType:'candidate',objectId:req.params.id,oldValue:c.status,newValue:'ARCHIVED'});res.json({ok:true})}catch(e){res.status(500).json({error:e.message})}});
app.post('/api/candidates/:id/restore',requireAuth,requireRole('ADMIN'),async(req,res)=>{try{const[[c]]=await pool.query('SELECT id,status,archived_status FROM candidates WHERE id=?',[req.params.id]);if(!c)return res.status(404).json({error:'Candidate not found'});const status=c.archived_status||c.status||'APPLIED FOR WRITTEN';await pool.query('UPDATE candidates SET deleted_at=NULL,status=?,archived_status=NULL WHERE id=?',[status,req.params.id]);await audit({userId:req.user.id,candidateId:req.params.id,action:'RESTORE',objectType:'candidate',objectId:req.params.id,oldValue:'ARCHIVED',newValue:status});res.json({ok:true})}catch(e){res.status(500).json({error:e.message})}});

app.post('/api/written-tests/bulk-mark-absent',requireAuth,requireRole('ADMIN','TEST_CHECKER'),async(req,res)=>{
  try{
    const{q='',status='ALL',branch='',phaseId=0}=req.body||{};
    const params=[];
    let where="deleted_at IS NULL AND attendance='UNKNOWN'";
    const term=String(q).trim();
    if(term){where+=' AND (name LIKE ? OR learner_id LIKE ? OR registration_number LIKE ? OR phone LIKE ? OR email LIKE ? OR branch LIKE ?)';const like=`%${term}%`;params.push(like,like,like,like,like,like)}
    if(status&&status!=='ALL'){where+=' AND status=?';params.push(status)}
    if(branch){where+=' AND branch=?';params.push(branch)}
    if(Number(phaseId)){where+=' AND EXISTS (SELECT 1 FROM interview_results z WHERE z.candidate_id=candidates.id AND z.phase_id=?)';params.push(Number(phaseId))}
    const[rows]=await pool.query(`SELECT id,status,campaign_id FROM candidates WHERE ${where} ORDER BY id`,params);
    if(!rows.length)return res.json({marked:0});
    const ids=rows.map(r=>r.id);const placeholders=ids.map(()=>'?').join(',');
    const campaignIds=[...new Set(rows.map(r=>r.campaign_id).filter(Boolean))];
    const [[fin]] = campaignIds.length ? await pool.query(`SELECT COUNT(*) n FROM campaigns WHERE id IN (${campaignIds.map(()=>'?').join(',')}) AND written_finalized=1`,campaignIds) : [[{n:0}]];
    if(Number(fin.n||0)>0) return res.status(409).json({error:'Written round is finalized. Reopen it from the dashboard before changing attendance.'});
    await pool.query(`DELETE FROM written_tests WHERE candidate_id IN (${placeholders})`,ids);
    await pool.query(`UPDATE candidates SET attendance='ABSENT' WHERE deleted_at IS NULL AND attendance='UNKNOWN' AND id IN (${placeholders})`,ids);
    for(const r of rows){
      await audit({userId:req.user.id,candidateId:r.id,action:'MARK_WRITTEN_ABSENT',objectType:'candidate',objectId:r.id,oldValue:'UNKNOWN',newValue:'ABSENT'});
      await syncCandidateWorkflowStatus(r.id);
    }
    for(const cid of campaignIds)await recalculateWrittenTests(cid);
    res.json({marked:rows.length});
  }catch(e){res.status(500).json({error:e.message})}
});
app.put('/api/written-tests/:candidateId',requireAuth,requireRole('ADMIN','TEST_CHECKER'),async(req,res)=>{
  try{
    const {setNumber,marks,remarks}=req.body||{};
    const maxMarks=Number(process.env.WRITTEN_MAX_MARKS||20);
    if(setNumber==null) return res.status(400).json({error:'Set is required'});
    if(![1,2,3,4].includes(Number(setNumber))) return res.status(400).json({error:'Set must be 1, 2, 3, or 4'});
    const [[candidate]]=await pool.query('SELECT c.*,ca.written_finalized FROM candidates c LEFT JOIN campaigns ca ON ca.id=c.campaign_id WHERE c.id=?',[req.params.candidateId]);
    if(!candidate) return res.status(404).json({error:'Candidate not found'});
    if(Number(candidate.written_finalized||0)===1) return res.status(409).json({error:'Written round is finalized. An admin must reopen it before changing marks.'});
    if(marks==null || Number.isNaN(Number(marks))) return res.status(400).json({error:'Marks are required when the candidate is present'});
    if(Number(marks)<0 || Number(marks)>maxMarks) return res.status(400).json({error:`Marks must be between 0 and ${maxMarks}`});
    const [oldRows]=await pool.query('SELECT * FROM written_tests WHERE candidate_id=?',[req.params.candidateId]);
    await pool.query(`INSERT INTO written_tests(candidate_id,set_number,marks,max_marks,remarks,scored_by,scored_at)
      VALUES(?,?,?,?,?,?,NOW())
      ON DUPLICATE KEY UPDATE set_number=VALUES(set_number),marks=VALUES(marks),max_marks=VALUES(max_marks),remarks=VALUES(remarks),scored_by=VALUES(scored_by),scored_at=NOW()`,
      [req.params.candidateId,Number(setNumber),Number(marks),maxMarks,remarks||null,req.user.id]);
    await pool.query("UPDATE candidates SET attendance='PRESENT' WHERE id=?",[req.params.candidateId]);
    await audit({userId:req.user.id,candidateId:req.params.candidateId,action:'SAVE_WRITTEN',objectType:'written_test',objectId:oldRows[0]?.id,newValue:JSON.stringify({setNumber:Number(setNumber),marks:Number(marks)})});
    const recalc=await recalculateWrittenTests(candidate.campaign_id);
    const [[statusCandidate]]=await pool.query('SELECT status FROM candidates WHERE id=?',[req.params.candidateId]);
    const [r]=await pool.query('SELECT * FROM written_tests WHERE candidate_id=?',[req.params.candidateId]);
    res.json({written:r[0],recalculation:recalc,status:statusCandidate.status});
  }catch(e){res.status(500).json({error:e.message})}
});

app.put('/api/written-tests/:candidateId/attendance',requireAuth,requireRole('ADMIN','TEST_CHECKER'),async(req,res)=>{
  try{
    const attendance=String(req.body?.attendance||'').toUpperCase();
    if(!['PRESENT','ABSENT'].includes(attendance)) return res.status(400).json({error:'Written attendance must be PRESENT or ABSENT'});
    const [[candidate]]=await pool.query('SELECT c.*,ca.written_finalized FROM candidates c LEFT JOIN campaigns ca ON ca.id=c.campaign_id WHERE c.id=?',[req.params.candidateId]);
    if(!candidate) return res.status(404).json({error:'Candidate not found'});
    if(Number(candidate.written_finalized||0)===1) return res.status(409).json({error:'Written round is finalized. An admin must reopen it before changing attendance.'});
    if(attendance==='ABSENT'){
      const [[later]] = await pool.query('SELECT COUNT(*) n FROM interview_results WHERE candidate_id=?',[req.params.candidateId]);
      if(Number(later.n||0)>0) return res.status(409).json({error:'This candidate already has interview history. Do not move them back to written absent without first correcting the later phase.'});
      const [oldWritten]=await pool.query('SELECT id,set_number,marks,remarks,qualified,normalized_percentile FROM written_tests WHERE candidate_id=?',[req.params.candidateId]);
      await pool.query('DELETE FROM written_tests WHERE candidate_id=?',[req.params.candidateId]);
      if(oldWritten[0]) await audit({userId:req.user.id,candidateId:req.params.candidateId,action:'DELETE_WRITTEN_ON_ABSENCE',objectType:'written_test',objectId:oldWritten[0].id,oldValue:JSON.stringify(oldWritten[0]),newValue:'DELETED_BECAUSE_ATTENDANCE_SET_ABSENT'});
    }
    await pool.query('UPDATE candidates SET attendance=? WHERE id=?',[attendance,req.params.candidateId]);
    if(attendance==='PRESENT' || attendance==='ABSENT') await recalculateWrittenTests(candidate.campaign_id);
    const status=await syncCandidateWorkflowStatus(req.params.candidateId);
    await audit({userId:req.user.id,candidateId:req.params.candidateId,action:'CHANGE_WRITTEN_ATTENDANCE',objectType:'candidate',objectId:req.params.candidateId,oldValue:candidate.attendance,newValue:attendance});
    const [[fresh]]=await pool.query('SELECT * FROM candidates WHERE id=?',[req.params.candidateId]);
    const [[written]]=await pool.query('SELECT * FROM written_tests WHERE candidate_id=?',[req.params.candidateId]);
    res.json({candidate:fresh,written:written||null,status});
  }catch(e){res.status(500).json({error:e.message})}
});

app.post('/api/written/finalize',requireAuth,requireRole('ADMIN'),async(req,res)=>{
  try{
    const[[campaign]]=await pool.query('SELECT * FROM campaigns WHERE active=1 ORDER BY recruitment_year DESC,id DESC LIMIT 1');
    if(!campaign)return res.status(404).json({error:'No active recruitment campaign'});
    const reason=String(req.body?.reason||'Official written-round finalization').trim();
    const recalc=await recalculateWrittenTests(campaign.id);
    if(Number(recalc.scored)<Number(campaign.written_qualified_count||150)) return res.status(400).json({error:`Need at least ${campaign.written_qualified_count||150} valid written scores before finalization. Currently ${recalc.scored}.`});
    if(recalc.qualificationMismatch) return res.status(409).json({error:'Written data is inconsistent. Resolve the data-health warning before finalization.'});
    await pool.query('UPDATE campaigns SET written_finalized=1,written_finalized_at=NOW(),written_finalized_by=? WHERE id=?',[req.user.id,campaign.id]);
    const final=await recalculateWrittenTests(campaign.id);
    await pool.query(`INSERT INTO written_round_audits(campaign_id,action,method_version,target_count,scored_count,qualified_count,cutoff_percentile,cutoff_set_percentile,normalized_cutoff_percentile,cutoff_marks,cutoff_set,tie_at_cutoff,set_stats_json,ranking_json,reason,performed_by) VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`,[
      campaign.id,'FINALIZE',METHOD_VERSION,Number(campaign.written_qualified_count||150),Number(final.scored||0),Number(final.qualified||0),final.cutoffPercentile,final.cutoffPercentile,final.normalizedCutoffPercentile,final.cutoffMarks,final.cutoffSet,final.tieAtCutoff?1:0,JSON.stringify(final.setStats||[]),JSON.stringify(final.ranking||[]),reason,req.user.id
    ]);
    await audit({userId:req.user.id,action:'FINALIZE_WRITTEN',objectType:'campaign',objectId:campaign.id,newValue:JSON.stringify({method:METHOD_VERSION,scored:final.scored,qualified:final.qualified,cutoffPercentile:final.cutoffPercentile,tieAtCutoff:final.tieAtCutoff,reason})});
    res.json({finalized:true,recalculation:final});
  }catch(e){res.status(500).json({error:e.message})}
});
app.post('/api/written/reopen',requireAuth,requireRole('ADMIN'),async(req,res)=>{
  try{
    const[[campaign]]=await pool.query('SELECT * FROM campaigns WHERE active=1 ORDER BY recruitment_year DESC,id DESC LIMIT 1');
    if(!campaign)return res.status(404).json({error:'No active recruitment campaign'});
    const reason=String(req.body?.reason||'Admin reopened written round for correction').trim();
    const recalc=await recalculateWrittenTests(campaign.id);
    await pool.query('UPDATE campaigns SET written_finalized=0,written_finalized_at=NULL,written_finalized_by=NULL WHERE id=?',[campaign.id]);
    // Preserve existing qualification values as PROVISIONAL history. They will be recomputed on refinalization.
    await pool.query(`INSERT INTO written_round_audits(campaign_id,action,method_version,target_count,scored_count,qualified_count,cutoff_percentile,cutoff_set_percentile,normalized_cutoff_percentile,cutoff_marks,cutoff_set,tie_at_cutoff,set_stats_json,ranking_json,reason,performed_by) VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`,[
      campaign.id,'REOPEN',METHOD_VERSION,Number(campaign.written_qualified_count||150),Number(recalc.scored||0),Number(recalc.qualified||0),recalc.cutoffPercentile,recalc.cutoffPercentile,recalc.normalizedCutoffPercentile,recalc.cutoffMarks,recalc.cutoffSet,recalc.tieAtCutoff?1:0,JSON.stringify(recalc.setStats||[]),JSON.stringify(recalc.ranking||[]),reason,req.user.id
    ]);
    await audit({userId:req.user.id,action:'REOPEN_WRITTEN',objectType:'campaign',objectId:campaign.id,newValue:reason});
    res.json({reopened:true,message:'Written round reopened. Existing qualification is provisional until the round is finalized again.'});
  }catch(e){res.status(500).json({error:e.message})}
});
app.get('/api/written/audit',requireAuth,async(req,res)=>{
  try{
    let campaignId=Number(req.query.campaignId||0);
    if(!campaignId){const[[c]]=await pool.query('SELECT id FROM campaigns WHERE active=1 ORDER BY recruitment_year DESC,id DESC LIMIT 1');campaignId=Number(c?.id||0)}
    const [rows]=await pool.query(`SELECT a.id,a.action,a.method_version,a.target_count,a.scored_count,a.qualified_count,a.cutoff_percentile,a.cutoff_set_percentile,a.normalized_cutoff_percentile,a.cutoff_marks,a.cutoff_set,a.tie_at_cutoff,a.reason,a.created_at,u.name performed_by_name FROM written_round_audits a LEFT JOIN users u ON u.id=a.performed_by WHERE a.campaign_id=? ORDER BY a.created_at DESC LIMIT 20`,[campaignId]);
    res.json(rows);
  }catch(e){res.status(500).json({error:e.message})}
});
app.get('/api/written/audit/export',requireAuth,async(req,res)=>{
  try{
    let campaignId=Number(req.query.campaignId||0);
    if(!campaignId){const[[c]]=await pool.query('SELECT id FROM campaigns WHERE active=1 ORDER BY recruitment_year DESC,id DESC LIMIT 1');campaignId=Number(c?.id||0)}
    const [[campaign]]=await pool.query('SELECT id,name,recruitment_year,written_max_marks,written_qualified_count,written_finalized,written_finalized_at FROM campaigns WHERE id=?',[campaignId]);
    if(!campaign)return res.status(404).json({error:'Campaign not found'});
    const[[latest]]=await pool.query('SELECT * FROM written_round_audits WHERE campaign_id=? ORDER BY created_at DESC LIMIT 1',[campaignId]);
    const auditRows=latest?.ranking_json?JSON.parse(latest.ranking_json):[];
    const setStats=latest?.set_stats_json?JSON.parse(latest.set_stats_json):[];
    const wb=XLSX.utils.book_new();
    const summary=[
      ['WRITTEN ROUND FAIRNESS AUDIT'],
      ['Campaign',campaign.name],['Recruitment year',campaign.recruitment_year],['Method version',latest?.method_version||METHOD_VERSION],
      ['Method','Set-wise midrank percentile; set z-score as secondary tie-break/audit signal; raw marks as tertiary tie-break; no candidate-ID tie-break.'],
      ['Qualification rule',`Top ${Number(campaign.written_qualified_count||150)} scored candidates; complete ties at the cutoff are included.`],
      ['Scored candidates',latest?.scored_count??auditRows.length],['Qualified candidates',latest?.qualified_count??auditRows.filter(r=>r.qualified).length],
      ['Set percentile at cutoff',latest?.cutoff_set_percentile??latest?.cutoff_percentile??''],['Normalized percentile at cutoff',latest?.normalized_cutoff_percentile??''],['Cutoff marks',latest?.cutoff_marks??''],['Cutoff set',latest?.cutoff_set??''],['Tie at cutoff',latest?.tie_at_cutoff?'YES':'NO'],['Last action',latest?.action||'NOT FINALIZED'],['Performed by',latest?.performed_by||''],['Timestamp',latest?.created_at||''],['Reason',latest?.reason||''],[]
    ];
    const ws1=XLSX.utils.aoa_to_sheet(summary); ws1['!cols']=[{wch:28},{wch:105}]; XLSX.utils.book_append_sheet(wb,ws1,'Audit Summary');
    const ss=[['Set','Candidates','Average marks','Median marks','SD','Min','Max'],...setStats.map(s=>[s.set_number,s.candidates,s.average,s.median,s.sd,s.min,s.max])];
    const ws2=XLSX.utils.aoa_to_sheet(ss); ws2['!cols']=[{wch:8},{wch:14},{wch:18},{wch:16},{wch:14},{wch:12},{wch:12}]; XLSX.utils.book_append_sheet(wb,ws2,'Set Analysis');
    const rr=[['Rank','Candidate ID','Set','Marks','Set Percentile','Z-score','Normalized Rank Percentile','Qualified'],...auditRows.map(r=>[r.rank,r.candidate_id,r.set_number,r.marks,r.set_percentile,r.normalized_z,r.normalized_percentile,r.qualified?'YES':'NO'])];
    const ws3=XLSX.utils.aoa_to_sheet(rr); ws3['!autofilter']={ref:`A1:H${rr.length}`}; ws3['!freeze']={xSplit:0,ySplit:1}; ws3['!cols']=[{wch:8},{wch:14},{wch:8},{wch:10},{wch:18},{wch:12},{wch:26},{wch:12}]; XLSX.utils.book_append_sheet(wb,ws3,'Ranking Snapshot');
    const out=XLSX.write(wb,{type:'buffer',bookType:'xlsx'}); res.setHeader('Content-Type','application/vnd.openxmlformats-officedocument.spreadsheetml.sheet'); res.setHeader('Content-Disposition',`attachment; filename=written-fairness-audit-${campaign.recruitment_year}.xlsx`); res.send(out);
  }catch(e){res.status(500).json({error:e.message})}
});
app.get('/api/written/summary',requireAuth,async(req,res)=>{try{res.json(await writtenSummary(req.query.campaignId?Number(req.query.campaignId):null))}catch(e){res.status(500).json({error:e.message})}});
app.get('/api/written/what-if',requireAuth,async(req,res)=>{try{res.json(await cutoffWhatIf(req.query.topN,req.query.campaignId?Number(req.query.campaignId):null))}catch(e){res.status(500).json({error:e.message})}});
app.get('/api/written/export',requireAuth,async(req,res)=>{
  try{
    let campaignId=req.query.campaignId?Number(req.query.campaignId):null;
    if(!campaignId){const[[active]]=await pool.query('SELECT id FROM campaigns WHERE active=1 ORDER BY recruitment_year DESC,id DESC LIMIT 1');campaignId=Number(active?.id||0)||null}
    const params=[];
    let scope="c.deleted_at IS NULL AND w.qualified=1 AND c.attendance='PRESENT'";
    if(campaignId){scope+=' AND c.campaign_id=?';params.push(campaignId)}
    const [[campaign]]=await pool.query('SELECT id,name,recruitment_year,written_max_marks,written_qualified_count,written_finalized FROM campaigns WHERE id=? LIMIT 1',[campaignId||0]);
    if(campaign && !Number(campaign.written_finalized)) return res.status(409).json({error:'Written round is not finalized yet. Finalize it before downloading the official qualified sheet.'});
    const [[integrity]]=await pool.query(`SELECT SUM(w.marks IS NOT NULL AND c.attendance='PRESENT') scored, SUM(w.qualified=1) qualified FROM written_tests w JOIN candidates c ON c.id=w.candidate_id WHERE c.deleted_at IS NULL ${campaignId?'AND c.campaign_id=?':''}`,campaignId?[campaignId]:[]);
    if(Number(integrity?.qualified||0)>Number(integrity?.scored||0)) return res.status(409).json({error:`Written data needs reconciliation: ${Number(integrity.qualified||0)} qualified records but only ${Number(integrity.scored||0)} valid scores are present.`});
    const [rows]=await pool.query(`SELECT c.name,c.learner_id,c.registration_number,c.email,c.phone,c.branch,c.attendance,
      w.set_number,w.marks,w.set_percentile,w.normalized_percentile,w.normalized_z,w.qualified
      FROM candidates c JOIN written_tests w ON w.candidate_id=c.id
      WHERE ${scope}
      ORDER BY w.set_percentile DESC,w.normalized_z DESC,w.marks DESC,c.name ASC`,params);
    const qualified=rows.map((r,i)=>({...r,rank:i+1}));
    const cutoff=qualified.length?qualified[qualified.length-1]:null;
    const [setStats]=await pool.query(`SELECT w.set_number,COUNT(*) total,SUM(w.marks IS NOT NULL) scored,AVG(w.marks) avg_marks,MIN(w.marks) min_marks,MAX(w.marks) max_marks
      FROM written_tests w JOIN candidates c ON c.id=w.candidate_id WHERE c.deleted_at IS NULL AND c.attendance='PRESENT' ${campaignId?'AND c.campaign_id=?':''} GROUP BY w.set_number ORDER BY w.set_number`,campaignId?[campaignId]:[]);
    const [allSetMarks]=await pool.query(`SELECT w.set_number,w.marks FROM written_tests w JOIN candidates c ON c.id=w.candidate_id WHERE c.deleted_at IS NULL AND c.attendance='PRESENT' AND w.marks IS NOT NULL ${campaignId?'AND c.campaign_id=?':''}`,campaignId?[campaignId]:[]);
    const overview=[
      ['WRITTEN TEST — QUALIFIED CANDIDATES'],
      ['Campaign',campaign?.name||'Active recruitment'],
      ['Recruitment year',campaign?.recruitment_year||new Date().getFullYear()],
      ['Generated',new Date().toISOString()],
      ['Qualified candidates',qualified.length],
      ['Configured cutoff count',Number(campaign?.written_qualified_count||150)],
      ['Written round finalized',campaign?.written_finalized?'YES':'NO'],
      ['Cutoff percentile',cutoff?.normalized_percentile==null?'':Number(cutoff.normalized_percentile)],
      ['Cutoff raw marks',cutoff?.marks==null?'':Number(cutoff.marks)],
      ['Cutoff set',cutoff?.set_number==null?'':Number(cutoff.set_number)],
      ['Note','Manual Set Percentile uses 100*(below + 0.5*equal)/set size. Final normalized percentile remains the system-calculated cross-set ranking value.'],
      [],
      ['Set','Candidates','Scored','Average marks','Minimum marks','Maximum marks'],
      ...setStats.map(r=>[Number(r.set_number),Number(r.total),Number(r.scored||0),r.avg_marks==null?'':Number(r.avg_marks),r.min_marks==null?'':Number(r.min_marks),r.max_marks==null?'':Number(r.max_marks)])
    ];
    const allSetStats = {};
    for(const r of allSetMarks){const key=Number(r.set_number);(allSetStats[key] ||= []).push(Number(r.marks))}
    const candidateRows=[['Rank','Name','Learner ID / College Mail','Registration No.','Personal Email','Phone','Branch','Written Attendance','Set','Marks / 20','Set Size','Candidates Below','Candidates Equal','Manual Set Percentile','Normalized Percentile','Qualified']];
    for(const r of qualified){
      const values=allSetStats[Number(r.set_number)]||[];
      const below=values.filter(v=>v<Number(r.marks)).length;
      const equal=values.filter(v=>v===Number(r.marks)).length;
      candidateRows.push([r.rank,r.name,r.learner_id||'',r.registration_number||'',r.email||'',r.phone||'',r.branch||'',r.attendance||'',Number(r.set_number),r.marks==null?'':Number(r.marks),values.length,below,equal,null,r.normalized_percentile==null?'':Number(r.normalized_percentile),r.qualified?'YES':'NO']);
    }
    const wb=XLSX.utils.book_new();
    const ws1=XLSX.utils.aoa_to_sheet(overview);
    ws1['!cols']=[{wch:28},{wch:72},{wch:16},{wch:18},{wch:18},{wch:18}];
    const ws2=XLSX.utils.aoa_to_sheet(candidateRows);
    for(let i=2;i<=candidateRows.length;i++) ws2[`N${i}`]={t:'n',f:`=IF(K${i}=0,\"\",100*(L${i}+0.5*M${i})/K${i})`};
    ws2['!cols']=[{wch:8},{wch:28},{wch:24},{wch:20},{wch:30},{wch:16},{wch:20},{wch:20},{wch:8},{wch:12},{wch:12},{wch:16},{wch:14},{wch:20},{wch:23},{wch:12}];
    ws2['!autofilter']={ref:`A1:P${candidateRows.length}`};
    ws2['!freeze']={xSplit:0,ySplit:1};
    XLSX.utils.book_append_sheet(wb,ws1,'Written Summary');
    XLSX.utils.book_append_sheet(wb,ws2,'Qualified Candidates');
    const out=XLSX.write(wb,{type:'buffer',bookType:'xlsx'});
    const year=campaign?.recruitment_year||new Date().getFullYear();
    res.setHeader('Content-Type','application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
    res.setHeader('Content-Disposition',`attachment; filename=written-qualified-${year}.xlsx`);
    res.send(out);
  }catch(e){res.status(500).json({error:e.message})}
});

app.get('/api/interview-phases',requireAuth,async(req,res)=>{let campaignId=Number(req.query.campaignId||0);if(!campaignId){const[[c]]=await pool.query('SELECT id FROM campaigns WHERE active=1 ORDER BY recruitment_year DESC,id DESC LIMIT 1');campaignId=Number(c?.id||0)}const params=[];let where='1=1';if(campaignId){where+=' AND (campaign_id=? OR campaign_id IS NULL)';params.push(campaignId)}const[r]=await pool.query(`SELECT p.*,(SELECT COUNT(*) FROM interview_results r WHERE r.phase_id=p.id) records FROM interview_phases p WHERE ${where} ORDER BY phase_order`,params);res.json(r)});
app.post('/api/interview-phases',requireAuth,requireRole('ADMIN'),async(req,res)=>{try{const{name,phaseType='TASKPHASE',description='',campaignId}=req.body||{};if(!name)return res.status(400).json({error:'Phase name is required'});if(!['REC_INTERVIEW','TASKPHASE'].includes(phaseType))return res.status(400).json({error:'Invalid phase type'});const[[activeCampaign]]=await pool.query('SELECT id FROM campaigns WHERE active=1 ORDER BY recruitment_year DESC,id DESC LIMIT 1');const resolvedCampaignId=campaignId||activeCampaign?.id||null;const[[{nextOrder}]]=await pool.query('SELECT COALESCE(MAX(phase_order),0)+1 nextOrder FROM interview_phases WHERE campaign_id=?',[resolvedCampaignId]);const[r]=await pool.query('INSERT INTO interview_phases(campaign_id,name,phase_type,description,phase_order,active,created_by) VALUES(?,?,?,?,?,1,?)',[resolvedCampaignId,name,phaseType,description||null,nextOrder,req.user.id]);await audit({userId:req.user.id,action:'CREATE',objectType:'interview_phase',objectId:r.insertId,newValue:name});const[rows]=await pool.query('SELECT * FROM interview_phases WHERE id=?',[r.insertId]);res.status(201).json(rows[0])}catch(e){res.status(500).json({error:e.message})}});
app.put('/api/interview-phases/:id',requireAuth,requireRole('ADMIN'),async(req,res)=>{try{const{name,phaseType,description,active}=req.body||{};await pool.query('UPDATE interview_phases SET name=COALESCE(?,name),phase_type=COALESCE(?,phase_type),description=COALESCE(?,description),active=COALESCE(?,active) WHERE id=?',[name||null,phaseType||null,description??null,active==null?null:Boolean(active),req.params.id]);const[r]=await pool.query('SELECT * FROM interview_phases WHERE id=?',[req.params.id]);res.json(r[0])}catch(e){res.status(500).json({error:e.message})}});
app.delete('/api/interview-phases/:id',requireAuth,requireRole('ADMIN'),async(req,res)=>{try{const[[phase]]=await pool.query('SELECT id,name FROM interview_phases WHERE id=?',[req.params.id]);if(!phase)return res.status(404).json({error:'Interview phase not found'});const[[cnt]]=await pool.query('SELECT COUNT(*) n FROM interview_results WHERE phase_id=?',[req.params.id]);if(Number(cnt.n||0)>0)return res.status(409).json({error:'This phase already has interview records. Archive/deactivate it instead of deleting it.'});await pool.query('DELETE FROM interview_phases WHERE id=?',[req.params.id]);await audit({userId:req.user.id,action:'DELETE',objectType:'interview_phase',objectId:req.params.id,oldValue:phase.name});res.json({deleted:true})}catch(e){res.status(500).json({error:e.message})}});

app.get('/api/users/interviewers',requireAuth,async(_req,res)=>{const[r]=await pool.query("SELECT id,name,email,role FROM users WHERE active=1 AND role IN ('ADMIN','INTERVIEWER') ORDER BY name");res.json(r)});
app.post('/api/interviews/:candidateId',requireAuth,requireRole('ADMIN','INTERVIEWER'),async(req,res)=>{
  try{
    const {phaseId,interviewerNames=[],attendance='PRESENT',interviewDate,remarks}=req.body||{};
    if(!phaseId||!ATTENDANCE.includes(attendance)) return res.status(400).json({error:'Phase and valid attendance are required'});
    const [[candidate]]=await pool.query('SELECT * FROM candidates WHERE id=?',[req.params.candidateId]);
    if(!candidate) return res.status(404).json({error:'Candidate not found'});
    const [[phase]]=await pool.query('SELECT * FROM interview_phases WHERE id=?',[phaseId]);
    if(!phase) return res.status(404).json({error:'Interview phase not found'});
    if(phase.campaign_id && candidate.campaign_id && Number(phase.campaign_id)!==Number(candidate.campaign_id)) return res.status(400).json({error:'Interview phase belongs to a different recruitment campaign'});
    const names=Array.isArray(interviewerNames)?interviewerNames.map(x=>String(x).trim()).filter(Boolean).slice(0,10):[];
    const [existing]=await pool.query('SELECT id FROM interview_results WHERE phase_id=? AND candidate_id=?',[phaseId,req.params.candidateId]);
    let id=existing[0]?.id;
    if(id){
      await pool.query('UPDATE interview_results SET interviewer_names=?,attendance=?,interview_date=?,remarks=? WHERE id=?',[JSON.stringify(names),attendance,interviewDate||null,remarks||null,id]);
    }else{
      const [r]=await pool.query('INSERT INTO interview_results(phase_id,candidate_id,interviewer_names,attendance,interview_date,remarks,created_by) VALUES(?,?,?,?,?,?,?)',[phaseId,req.params.candidateId,JSON.stringify(names),attendance,interviewDate||null,remarks||null,req.user.id]);
      id=r.insertId;
    }
    const status=await syncCandidateWorkflowStatus(req.params.candidateId);
    await audit({userId:req.user.id,candidateId:req.params.candidateId,action:id?'UPDATE_INTERVIEW':'CREATE_INTERVIEW',objectType:'interview_result',objectId:id,newValue:JSON.stringify({phase:phase.name,attendance,status})});
    const [rows]=await pool.query('SELECT * FROM interview_results WHERE id=?',[id]);
    res.status(existing[0]?200:201).json(rows[0]);
  }catch(e){res.status(500).json({error:e.code==='ER_DUP_ENTRY'?'This candidate already has a result for that phase.':e.message})}
});

app.get('/api/data-health',requireAuth,async(_req,res)=>{
  try{
    const [[campaign]]=await pool.query('SELECT id,written_qualified_count,written_finalized FROM campaigns WHERE active=1 ORDER BY recruitment_year DESC,id DESC LIMIT 1');
    const cid=campaign?.id||0;
    const p=cid?[cid]:[]; const scope=cid?' AND c.campaign_id=?':'';
    const [[tot]]=await pool.query(`SELECT COUNT(*) total, SUM(attendance='PRESENT') present, SUM(attendance='ABSENT') absent, SUM(attendance='UNKNOWN') unmarked FROM candidates c WHERE c.deleted_at IS NULL${scope}`,p);
    const [[marks]]=await pool.query(`SELECT COUNT(*) scored FROM written_tests w JOIN candidates c ON c.id=w.candidate_id WHERE c.deleted_at IS NULL AND c.attendance='PRESENT' AND w.marks IS NOT NULL${scope}`,p);
    const [[allWritten]]=await pool.query(`SELECT COUNT(*) n FROM written_tests w JOIN candidates c ON c.id=w.candidate_id WHERE c.deleted_at IS NULL${scope}`,p);
    const [[qualified]]=await pool.query(`SELECT COUNT(*) n FROM written_tests w JOIN candidates c ON c.id=w.candidate_id WHERE c.deleted_at IS NULL AND w.qualified=1${scope}`,p);
    const [[qualifiedNoMarks]]=await pool.query(`SELECT COUNT(*) n FROM written_tests w JOIN candidates c ON c.id=w.candidate_id WHERE c.deleted_at IS NULL AND w.qualified=1 AND (w.marks IS NULL OR c.attendance<>'PRESENT')${scope}`,p);
    const [[absentWithMarks]]=await pool.query(`SELECT COUNT(*) n FROM written_tests w JOIN candidates c ON c.id=w.candidate_id WHERE c.deleted_at IS NULL AND c.attendance='ABSENT'${scope}`,p);
    const [[missingBranch]]=await pool.query(`SELECT COUNT(*) n FROM candidates c WHERE c.deleted_at IS NULL AND (c.branch IS NULL OR TRIM(c.branch)='')${scope}`,p);
    const [dupes]=await pool.query(`SELECT registration_number,COUNT(*) n FROM candidates WHERE deleted_at IS NULL AND registration_number IS NOT NULL AND TRIM(registration_number)<>''${cid?' AND campaign_id=?':''} GROUP BY registration_number HAVING COUNT(*)>1 LIMIT 10`,cid?[cid]:[]);
    const mismatch=Number(qualified.n||0)>Number(marks.scored||0);
    res.json({campaignId:cid,total:Number(tot.total||0),present:Number(tot.present||0),absent:Number(tot.absent||0),unmarked:Number(tot.unmarked||0),marksEntered:Number(marks.scored||0),writtenRows:Number(allWritten.n||0),qualified:Number(qualified.n||0),qualifiedWithoutValidScore:Number(qualifiedNoMarks.n||0),absentWithWrittenData:Number(absentWithMarks.n||0),missingBranch:Number(missingBranch.n||0),duplicateRegistrations:dupes.length,duplicateExamples:dupes,qualificationMismatch:mismatch,finalized:Boolean(Number(campaign?.written_finalized||0)),required:Number(campaign?.written_qualified_count||150)});
  }catch(e){res.status(500).json({error:e.message})}
});

app.get('/api/dashboard',requireAuth,async(_req,res)=>{
  try{
    const [[activeCampaign]]=await pool.query('SELECT id,name,recruitment_year,written_qualified_count,written_finalized,written_finalized_at FROM campaigns WHERE active=1 ORDER BY recruitment_year DESC,id DESC LIMIT 1');
    const cid=activeCampaign?.id||null;
    const params=[]; let where='deleted_at IS NULL'; if(cid){where+=' AND campaign_id=?';params.push(cid)}
    const [[s]]=await pool.query(`SELECT COUNT(*) applications,
      SUM(attendance='PRESENT') appeared,SUM(attendance='ABSENT') absent,
      SUM(status='SELECTED') selected,
      SUM(status='WRITTEN REJECTED') written_rejected,SUM(status='APPEARED FOR FIRST INTERVIEW') first_interview,
      SUM(status='TASKPHASE') taskphase FROM candidates WHERE ${where}`,params);
    const phaseParams=cid?[cid]:[];
    const [phases]=await pool.query(`SELECT ip.id,ip.name,ip.phase_type,ip.phase_order,
      COUNT(ir.id) records,
      SUM(ir.attendance='PRESENT') present,
      SUM(ir.attendance='ABSENT') absent,
      SUM(ir.attendance='RESCHEDULED') rescheduled,
      SUM(ir.attendance='EXCUSED') excused
      FROM interview_phases ip LEFT JOIN interview_results ir ON ir.phase_id=ip.id
      WHERE ip.active=1 ${cid?'AND ip.campaign_id=?':''}
      GROUP BY ip.id ORDER BY ip.phase_order`,phaseParams);
    const [setAttendance]=await pool.query(`SELECT attendance,COUNT(*) count FROM candidates WHERE ${where} GROUP BY attendance`,params);
    const [branchStats]=await pool.query(`SELECT COALESCE(NULLIF(branch,''),'Unspecified') branch,COUNT(*) count FROM candidates WHERE ${where} GROUP BY COALESCE(NULLIF(branch,''),'Unspecified') ORDER BY count DESC LIMIT 8`,params);
    const [wCounts]=await pool.query(`SELECT
        SUM(cc.attendance='PRESENT' AND w.marks IS NOT NULL) scored,
        SUM(w.qualified=1) qualified
      FROM written_tests w JOIN candidates cc ON cc.id=w.candidate_id
      WHERE cc.deleted_at IS NULL ${cid?'AND cc.campaign_id=?':''}`,cid?[cid]:[]);
    const [[latestAudit]]=await pool.query(`SELECT cutoff_percentile,cutoff_set_percentile,normalized_cutoff_percentile,cutoff_marks,cutoff_set,tie_at_cutoff,method_version,action,created_at FROM written_round_audits WHERE campaign_id=? ORDER BY created_at DESC LIMIT 1`,[cid||0]);
    const summary=await writtenSummary(cid);
    if(latestAudit){summary.cutoffPercentile=latestAudit.cutoff_set_percentile==null?summary.cutoffPercentile:Number(latestAudit.cutoff_set_percentile);summary.normalizedCutoffPercentile=latestAudit.normalized_cutoff_percentile==null?null:Number(latestAudit.normalized_cutoff_percentile);summary.cutoffMarks=latestAudit.cutoff_marks==null?null:Number(latestAudit.cutoff_marks);summary.cutoffSet=latestAudit.cutoff_set==null?null:Number(latestAudit.cutoff_set);summary.tieAtCutoff=Boolean(latestAudit.tie_at_cutoff);summary.auditMethod=latestAudit.method_version;summary.lastAuditAction=latestAudit.action;summary.lastAuditAt=latestAudit.created_at;}
    res.json({campaign:activeCampaign||null,stats:{applications:Number(s.applications||0),appeared:Number(s.appeared||0),absent:Number(s.absent||0),unmarked:Number(s.applications||0)-Number(s.appeared||0)-Number(s.absent||0),written_qualified:Number(wCounts[0]?.qualified||0),written_rejected:Number(s.written_rejected||0),first_interview:Number(s.first_interview||0),taskphase:Number(s.taskphase||0),selected:Number(s.selected||0),written_scored:Number(wCounts[0]?.scored||0)},attendance:setAttendance,branchStats,written:summary,phases});
  }catch(e){res.status(500).json({error:e.message})}
});

app.get('/api/needs-attention',requireAuth,async(_req,res)=>{
  try{
    const [[campaign]]=await pool.query('SELECT id,written_qualified_count,written_finalized FROM campaigns WHERE active=1 ORDER BY recruitment_year DESC,id DESC LIMIT 1');
    const cid=campaign?.id||0;
    const scope=cid?' AND c.campaign_id=?':''; const scopeParams=cid?[cid]:[];
    const [[unmarked]]=await pool.query(`SELECT COUNT(*) n FROM candidates c WHERE c.deleted_at IS NULL AND c.attendance='UNKNOWN'${scope}`,scopeParams);
    const [[missingMarks]]=await pool.query(`SELECT COUNT(*) n FROM candidates c LEFT JOIN written_tests w ON w.candidate_id=c.id WHERE c.deleted_at IS NULL AND c.attendance='PRESENT' AND (w.id IS NULL OR w.marks IS NULL)${scope}`,scopeParams);
    const remarkParams=cid?[cid]:[];
    const [[remarks]]=await pool.query(`SELECT COUNT(*) n FROM interview_results r JOIN interview_phases p ON p.id=r.phase_id JOIN candidates c ON c.id=r.candidate_id WHERE c.deleted_at IS NULL AND r.attendance='PRESENT' AND (r.remarks IS NULL OR TRIM(r.remarks)='') AND p.active=1${cid?' AND p.campaign_id=?':''}`,remarkParams);
    const [[absent]]=await pool.query(`SELECT COUNT(*) n FROM candidates c WHERE c.deleted_at IS NULL AND c.attendance='ABSENT'${scope}`,scopeParams);
    const [[pendingFinalize]]=await pool.query(`SELECT COUNT(*) n FROM written_tests w JOIN candidates c ON c.id=w.candidate_id WHERE c.deleted_at IS NULL AND c.attendance='PRESENT' AND w.marks IS NOT NULL${cid?' AND c.campaign_id=?':''}`,scopeParams);
    const [[selected]]=await pool.query(`SELECT COUNT(*) n FROM candidates c WHERE c.deleted_at IS NULL AND c.status='WRITTEN CLEARED'${scope}`,scopeParams);
    res.json({writtenUnmarked:Number(unmarked.n||0),missingWrittenMarks:Number(missingMarks.n||0),interviewsMissingRemarks:Number(remarks.n||0),writtenAbsent:Number(absent.n||0),writtenScored:Number(pendingFinalize.n||0),writtenFinalized:Boolean(Number(campaign?.written_finalized||0)),writtenRequired:Number(campaign?.written_qualified_count||150),writtenReadyToFinalize:Number(pendingFinalize.n||0)>=Number(campaign?.written_qualified_count||150),writtenCleared:Number(selected.n||0)});
  }catch(e){res.status(500).json({error:e.message})}
});
app.get('/api/reports/candidates',requireAuth,async(req,res)=>{
  try{
    const q=String(req.query.q||'').trim(),status=String(req.query.status||'').trim(),branch=String(req.query.branch||'').trim(),writtenAttendance=String(req.query.writtenAttendance||'').trim(),phaseId=Number(req.query.phaseId||0),includeDeleted=String(req.query.includeDeleted||'')==='true';
    const params=[];let where=includeDeleted?'1=1':'deleted_at IS NULL';
    if(q){where+=' AND (name LIKE ? OR learner_id LIKE ? OR registration_number LIKE ? OR phone LIKE ? OR email LIKE ? OR branch LIKE ?)';const like=`%${q}%`;params.push(like,like,like,like,like,like)}
    if(status&&status!=='ALL'){where+=' AND status=?';params.push(status)}
    if(branch){where+=' AND branch=?';params.push(branch)}
    if(writtenAttendance==='PRESENT'||writtenAttendance==='ABSENT'){where+=' AND attendance=?';params.push(writtenAttendance)}
    if(writtenAttendance==='UNMARKED'){where+=" AND attendance='UNKNOWN'"}
    if(phaseId){where+=' AND EXISTS (SELECT 1 FROM interview_results fxr WHERE fxr.candidate_id=candidates.id AND fxr.phase_id=?)';params.push(phaseId)}
    const[rows]=await pool.query(`SELECT * FROM candidates WHERE ${where} ORDER BY name`,params);res.json(rows);
  }catch(e){res.status(500).json({error:e.message})}
});

app.use((err,_req,res,_next)=>{console.error(err);res.status(500).json({error:'Unexpected server error'})});
const port=Number(process.env.PORT||4000);ensureV6Schema().then(()=>app.listen(port,()=>console.log(`Recruitment API listening on :${port}`))).catch(err=>{console.error('Database schema check failed',err);process.exit(1)});
