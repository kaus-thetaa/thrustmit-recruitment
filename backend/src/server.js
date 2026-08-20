import express from 'express';
import cors from 'cors';
import bcrypt from 'bcryptjs';
import dotenv from 'dotenv';
import { pool } from './db.js';
import { requireAuth, requireRole, signToken, getUserById } from './auth.js';
import { audit } from './audit.js';
import { recalculateWrittenTests, writtenSummary, cutoffWhatIf, syncCandidateWorkflowStatus } from './services/writtenTestService.js';

dotenv.config();
const app=express();
const allowedOrigins=(process.env.CORS_ORIGIN||'*').split(',').map(s=>s.trim());
app.use(cors({origin(origin,cb){if(!origin||allowedOrigins.includes('*')||allowedOrigins.includes(origin))return cb(null,true);cb(new Error('CORS origin not allowed'));}}));
app.use(express.json({limit:'1mb'}));

const CANDIDATE_STATUSES=['ALL','APPLIED FOR WRITTEN','ABSENT FOR WRITTEN','GAVE WRITTEN','WRITTEN CLEARED','WRITTEN REJECTED','APPEARED FOR FIRST INTERVIEW','TASKPHASE','SELECTED','REJECTED','WITHDRAWN'];
const ATTENDANCE=['PRESENT','ABSENT','RESCHEDULED','EXCUSED'];

app.get('/api/health',async(_req,res)=>{try{await pool.query('SELECT 1');res.json({ok:true})}catch(e){res.status(503).json({ok:false,error:e.message})}});
app.post('/api/auth/login',async(req,res)=>{try{const{email,password}=req.body||{};if(!email||!password)return res.status(400).json({error:'Email and password are required'});const[rows]=await pool.query('SELECT * FROM users WHERE email=? AND active=1 LIMIT 1',[email]);const user=rows[0];if(!user||!(await bcrypt.compare(password,user.password_hash)))return res.status(401).json({error:'Invalid credentials'});res.json({token:signToken(user),user:{id:user.id,name:user.name,email:user.email,role:user.role}})}catch(e){res.status(500).json({error:e.message})}});
app.get('/api/auth/me',requireAuth,async(req,res)=>{const user=await getUserById(req.user.id);if(!user)return res.status(404).json({error:'User not found'});res.json(user)});

app.get('/api/campaigns',requireAuth,async(_req,res)=>{const[r]=await pool.query('SELECT * FROM campaigns ORDER BY recruitment_year DESC,id DESC');res.json(r)});
app.post('/api/campaigns',requireAuth,requireRole('ADMIN'),async(req,res)=>{try{const{name,recruitmentYear,writtenMaxMarks=20,writtenQualifiedCount=150}=req.body||{};if(!name||!recruitmentYear)return res.status(400).json({error:'Campaign name and year are required'});await pool.query('UPDATE campaigns SET active=0 WHERE id IS NOT NULL'); const[r]=await pool.query('INSERT INTO campaigns(name,recruitment_year,written_max_marks,written_qualified_count,active) VALUES(?,?,?,?,1)',[name,Number(recruitmentYear),Number(writtenMaxMarks),Number(writtenQualifiedCount)]);const[rows]=await pool.query('SELECT * FROM campaigns WHERE id=?',[r.insertId]);res.status(201).json(rows[0])}catch(e){res.status(500).json({error:e.code==='ER_DUP_ENTRY'?'Campaign already exists':e.message})}});

app.get('/api/candidates',requireAuth,async(req,res)=>{try{const q=String(req.query.q||'').trim(),status=String(req.query.status||'').trim(),includeDeleted=String(req.query.includeDeleted||'')==='true',branch=String(req.query.branch||'').trim();const page=Math.max(1,Number(req.query.page||1)),pageSize=Math.min(100,Math.max(1,Number(req.query.pageSize||25)));const params=[];let where=includeDeleted?'1=1':'deleted_at IS NULL';if(q){where+=' AND (name LIKE ? OR learner_id LIKE ? OR registration_number LIKE ? OR phone LIKE ? OR email LIKE ?)';const s=`%${q}%`;params.push(s,s,s,s,s)}if(status&&status!=='ALL'){where+=' AND status=?';params.push(status)}if(branch){where+=' AND branch=?';params.push(branch)}const[[{count}]]=await pool.query(`SELECT COUNT(*) count FROM candidates WHERE ${where}`,params);const[rows]=await pool.query(`SELECT * FROM candidates WHERE ${where} ORDER BY name LIMIT ? OFFSET ?`,[...params,pageSize,(page-1)*pageSize]);const[branches]=await pool.query('SELECT DISTINCT branch FROM candidates WHERE branch IS NOT NULL AND branch<>\'\' ORDER BY branch');res.json({data:rows,page,pageSize,total:Number(count),branches:branches.map(x=>x.branch),statuses:CANDIDATE_STATUSES})}catch(e){res.status(500).json({error:e.message})}});

app.post('/api/candidates',requireAuth,requireRole('ADMIN'),async(req,res)=>{try{const{campaignId,name,learnerId,registrationNumber,email,phone,branch,notes}=req.body||{};if(!name)return res.status(400).json({error:'Name is required'});const[r]=await pool.query('INSERT INTO candidates(campaign_id,name,learner_id,registration_number,email,phone,branch,status,notes) VALUES(?,?,?,?,?,?,?,\'APPLIED FOR WRITTEN\',?)',[campaignId||null,name,learnerId||null,registrationNumber||null,email||null,phone||null,branch||null,notes||null]);await audit({userId:req.user.id,candidateId:r.insertId,action:'CREATE',objectType:'candidate',objectId:r.insertId,newValue:name});const[rows]=await pool.query('SELECT * FROM candidates WHERE id=?',[r.insertId]);res.status(201).json(rows[0])}catch(e){res.status(500).json({error:e.code==='ER_DUP_ENTRY'?'Registration number already exists':e.message})}});

app.get('/api/candidates/:id',requireAuth,async(req,res)=>{try{const[cRows]=await pool.query(`SELECT c.*,ca.name campaign_name,ca.recruitment_year FROM candidates c LEFT JOIN campaigns ca ON ca.id=c.campaign_id WHERE c.id=?`,[req.params.id]);if(!cRows[0])return res.status(404).json({error:'Candidate not found'});const[w]=await pool.query('SELECT w.*,u.name scored_by_name FROM written_tests w LEFT JOIN users u ON u.id=w.scored_by WHERE w.candidate_id=?',[req.params.id]);const[i]=await pool.query(`SELECT r.*,p.name phase_name,p.phase_type,p.phase_order,cu.name created_by_name FROM interview_results r JOIN interview_phases p ON p.id=r.phase_id LEFT JOIN users cu ON cu.id=r.created_by WHERE r.candidate_id=? ORDER BY p.phase_order,r.created_at`,[req.params.id]);const[a]=await pool.query('SELECT a.*,u.name user_name FROM audit_logs a LEFT JOIN users u ON u.id=a.user_id WHERE candidate_id=? ORDER BY a.created_at DESC LIMIT 200',[req.params.id]);res.json({candidate:cRows[0],written:w[0]||null,interviews:i,audit:a})}catch(e){res.status(500).json({error:e.message})}});

app.put('/api/candidates/:id',requireAuth,requireRole('ADMIN'),async(req,res)=>{try{const allowed=['name','learner_id','registration_number','phone','email','branch','status','notes','attendance','campaign_id'];const sets=[],values=[];for(const key of allowed)if(Object.hasOwn(req.body,key)){sets.push(`${key}=?`);values.push(req.body[key]??null)}if(!sets.length)return res.status(400).json({error:'Nothing to update'});const[b]=await pool.query('SELECT * FROM candidates WHERE id=?',[req.params.id]);if(!b[0])return res.status(404).json({error:'Candidate not found'});values.push(req.params.id);await pool.query(`UPDATE candidates SET ${sets.join(', ')} WHERE id=?`,values);for(const key of allowed)if(Object.hasOwn(req.body,key)&&String(b[0][key]??'')!==String(req.body[key]??''))await audit({userId:req.user.id,candidateId:req.params.id,action:'UPDATE',objectType:'candidate',objectId:req.params.id,fieldName:key,oldValue:b[0][key],newValue:req.body[key]});const[r]=await pool.query('SELECT * FROM candidates WHERE id=?',[req.params.id]);res.json(r[0])}catch(e){res.status(500).json({error:e.code==='ER_DUP_ENTRY'?'Registration number already exists':e.message})}});
app.delete('/api/candidates/:id',requireAuth,requireRole('ADMIN'),async(req,res)=>{try{const[[c]]=await pool.query('SELECT id,status FROM candidates WHERE id=?',[req.params.id]);if(!c)return res.status(404).json({error:'Candidate not found'});await pool.query("UPDATE candidates SET archived_status=status,deleted_at=NOW() WHERE id=?",[req.params.id]);await audit({userId:req.user.id,candidateId:req.params.id,action:'ARCHIVE',objectType:'candidate',objectId:req.params.id,oldValue:c.status,newValue:'ARCHIVED'});res.json({ok:true})}catch(e){res.status(500).json({error:e.message})}});
app.post('/api/candidates/:id/restore',requireAuth,requireRole('ADMIN'),async(req,res)=>{try{const[[c]]=await pool.query('SELECT id,status,archived_status FROM candidates WHERE id=?',[req.params.id]);if(!c)return res.status(404).json({error:'Candidate not found'});const status=c.archived_status||c.status||'APPLIED FOR WRITTEN';await pool.query('UPDATE candidates SET deleted_at=NULL,status=?,archived_status=NULL WHERE id=?',[status,req.params.id]);await audit({userId:req.user.id,candidateId:req.params.id,action:'RESTORE',objectType:'candidate',objectId:req.params.id,oldValue:'ARCHIVED',newValue:status});res.json({ok:true})}catch(e){res.status(500).json({error:e.message})}});

app.put('/api/written-tests/:candidateId',requireAuth,requireRole('ADMIN','TEST_CHECKER'),async(req,res)=>{
  try{
    const {setNumber,marks,remarks}=req.body||{};
    const maxMarks=Number(process.env.WRITTEN_MAX_MARKS||20);
    if(setNumber==null) return res.status(400).json({error:'Set is required'});
    if(![1,2,3,4].includes(Number(setNumber))) return res.status(400).json({error:'Set must be 1, 2, 3, or 4'});
    const [[candidate]]=await pool.query('SELECT * FROM candidates WHERE id=?',[req.params.candidateId]);
    if(!candidate) return res.status(404).json({error:'Candidate not found'});
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
    const [[candidate]]=await pool.query('SELECT * FROM candidates WHERE id=?',[req.params.candidateId]);
    if(!candidate) return res.status(404).json({error:'Candidate not found'});
    await pool.query('UPDATE candidates SET attendance=? WHERE id=?',[attendance,req.params.candidateId]);
    if(attendance==='ABSENT'){
      await pool.query("UPDATE written_tests SET qualified=NULL,set_percentile=NULL,normalized_z=NULL,normalized_percentile=NULL WHERE candidate_id=?",[req.params.candidateId]);
    }
    if(attendance==='PRESENT' || attendance==='ABSENT') await recalculateWrittenTests(candidate.campaign_id);
    const status=await syncCandidateWorkflowStatus(req.params.candidateId);
    await audit({userId:req.user.id,candidateId:req.params.candidateId,action:'CHANGE_WRITTEN_ATTENDANCE',objectType:'candidate',objectId:req.params.candidateId,oldValue:candidate.attendance,newValue:attendance});
    const [[fresh]]=await pool.query('SELECT * FROM candidates WHERE id=?',[req.params.candidateId]);
    const [[written]]=await pool.query('SELECT * FROM written_tests WHERE candidate_id=?',[req.params.candidateId]);
    res.json({candidate:fresh,written:written||null,status});
  }catch(e){res.status(500).json({error:e.message})}
});

app.get('/api/written/summary',requireAuth,async(req,res)=>{try{res.json(await writtenSummary(req.query.campaignId?Number(req.query.campaignId):null))}catch(e){res.status(500).json({error:e.message})}});
app.get('/api/written/what-if',requireAuth,async(req,res)=>{try{res.json(await cutoffWhatIf(req.query.topN,req.query.campaignId?Number(req.query.campaignId):null))}catch(e){res.status(500).json({error:e.message})}});

app.get('/api/interview-phases',requireAuth,async(req,res)=>{const campaignId=Number(req.query.campaignId||0);const params=[];let where='1=1';if(campaignId){where+=' AND (campaign_id=? OR campaign_id IS NULL)';params.push(campaignId)}const[r]=await pool.query(`SELECT p.*,(SELECT COUNT(*) FROM interview_results r WHERE r.phase_id=p.id) records FROM interview_phases p WHERE ${where} ORDER BY phase_order`,params);res.json(r)});
app.post('/api/interview-phases',requireAuth,requireRole('ADMIN'),async(req,res)=>{try{const{name,phaseType='TASKPHASE',description='',campaignId}=req.body||{};if(!name)return res.status(400).json({error:'Phase name is required'});if(!['REC_INTERVIEW','TASKPHASE'].includes(phaseType))return res.status(400).json({error:'Invalid phase type'});const[[activeCampaign]]=await pool.query('SELECT id FROM campaigns WHERE active=1 ORDER BY recruitment_year DESC,id DESC LIMIT 1');const resolvedCampaignId=campaignId||activeCampaign?.id||null;const[[{nextOrder}]]=await pool.query('SELECT COALESCE(MAX(phase_order),0)+1 nextOrder FROM interview_phases WHERE campaign_id=?',[resolvedCampaignId]);const[r]=await pool.query('INSERT INTO interview_phases(campaign_id,name,phase_type,description,phase_order,active,created_by) VALUES(?,?,?,?,?,1,?)',[resolvedCampaignId,name,phaseType,description||null,nextOrder,req.user.id]);await audit({userId:req.user.id,action:'CREATE',objectType:'interview_phase',objectId:r.insertId,newValue:name});const[rows]=await pool.query('SELECT * FROM interview_phases WHERE id=?',[r.insertId]);res.status(201).json(rows[0])}catch(e){res.status(500).json({error:e.message})}});
app.put('/api/interview-phases/:id',requireAuth,requireRole('ADMIN'),async(req,res)=>{try{const{name,phaseType,description,active}=req.body||{};await pool.query('UPDATE interview_phases SET name=COALESCE(?,name),phase_type=COALESCE(?,phase_type),description=COALESCE(?,description),active=COALESCE(?,active) WHERE id=?',[name||null,phaseType||null,description??null,active==null?null:Boolean(active),req.params.id]);const[r]=await pool.query('SELECT * FROM interview_phases WHERE id=?',[req.params.id]);res.json(r[0])}catch(e){res.status(500).json({error:e.message})}});

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

app.get('/api/dashboard',requireAuth,async(_req,res)=>{
  try{
    const [[activeCampaign]]=await pool.query('SELECT id,name,recruitment_year,written_qualified_count FROM campaigns WHERE active=1 ORDER BY recruitment_year DESC,id DESC LIMIT 1');
    const cid=activeCampaign?.id||null;
    const params=[]; let where='deleted_at IS NULL'; if(cid){where+=' AND campaign_id=?';params.push(cid)}
    const [[s]]=await pool.query(`SELECT COUNT(*) applications,
      SUM(attendance='PRESENT') appeared,SUM(attendance='ABSENT') absent,
      SUM(status='WRITTEN CLEARED') written_qualified,SUM(status='SELECTED') selected,
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
    res.json({campaign:activeCampaign||null,stats:{applications:Number(s.applications||0),appeared:Number(s.appeared||0),absent:Number(s.absent||0),written_qualified:Number(s.written_qualified||0),written_rejected:Number(s.written_rejected||0),first_interview:Number(s.first_interview||0),taskphase:Number(s.taskphase||0),selected:Number(s.selected||0)},attendance:setAttendance,written:await writtenSummary(cid),phases});
  }catch(e){res.status(500).json({error:e.message})}
});

app.get('/api/needs-attention',requireAuth,async(_req,res)=>{
  try{
    const [[a]]=await pool.query("SELECT COUNT(*) n FROM candidates WHERE deleted_at IS NULL AND status IN ('APPLIED FOR WRITTEN','GAVE WRITTEN')");
    const [[b]]=await pool.query("SELECT COUNT(*) n FROM candidates c LEFT JOIN written_tests w ON w.candidate_id=c.id WHERE c.deleted_at IS NULL AND c.attendance='PRESENT' AND w.id IS NULL");
    const [[c]]=await pool.query("SELECT COUNT(*) n FROM interview_results WHERE attendance='PRESENT' AND (remarks IS NULL OR remarks='')");
    const [[d]]=await pool.query("SELECT COUNT(*) n FROM candidates WHERE deleted_at IS NULL AND status='ABSENT FOR WRITTEN'");
    res.json({pendingWritten:Number(a.n||0),missingWrittenMarks:Number(b.n||0),interviewsMissingRemarks:Number(c.n||0),writtenAbsent:Number(d.n||0)});
  }catch(e){res.status(500).json({error:e.message})}
});

app.get('/api/reports/candidates',requireAuth,async(req,res)=>{
  try{
    const status=String(req.query.status||'').trim(); let sql='SELECT * FROM candidates WHERE deleted_at IS NULL'; const params=[];
    if(status){sql+=' AND status=?';params.push(status)}
    const[rows]=await pool.query(sql,params);res.json(rows);
  }catch(e){res.status(500).json({error:e.message})}
});

app.use((err,_req,res,_next)=>{console.error(err);res.status(500).json({error:'Unexpected server error'})});
const port=Number(process.env.PORT||4000);app.listen(port,()=>console.log(`Recruitment API listening on :${port}`));
