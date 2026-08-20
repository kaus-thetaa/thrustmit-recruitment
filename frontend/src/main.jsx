import React,{useEffect,useMemo,useState} from 'react';
import {createRoot} from 'react-dom/client';
import {BarChart,Bar,XAxis,YAxis,Tooltip,ResponsiveContainer,CartesianGrid} from 'recharts';
import {api} from './api.js';
import './styles.css';

const STATUSES=['ALL','APPLIED FOR WRITTEN','ABSENT FOR WRITTEN','GAVE WRITTEN','WRITTEN CLEARED','WRITTEN REJECTED','APPEARED FOR FIRST INTERVIEW','TASKPHASE','SELECTED','REJECTED','WITHDRAWN'];
const INTERVIEW_ATTENDANCE=['PRESENT','ABSENT','RESCHEDULED','EXCUSED'];
const WRITTEN_ATTENDANCE=['PRESENT','ABSENT'];

function ThemeToggle(){
  const [theme,setTheme]=useState(()=>localStorage.getItem('theme')||'light');
  useEffect(()=>{document.documentElement.dataset.theme=theme;localStorage.setItem('theme',theme)},[theme]);
  return <button className="theme-btn" onClick={()=>setTheme(v=>v==='dark'?'light':'dark')} aria-label="Toggle theme">{theme==='dark'?'☀':'☾'} {theme==='dark'?'Light':'Dark'}</button>;
}
function Stat({label,value}){return <div className="stat"><span>{label}</span><b>{value??0}</b></div>}
function ErrorBox({message,onRetry}){return <div className="error-box"><b>Couldn’t load this section</b><span>{message}</span>{onRetry&&<button className="secondary" onClick={onRetry}>Retry</button>}</div>}

function Login({onLogin}){
  const [email,setEmail]=useState('admin@example.com'),[password,setPassword]=useState('ChangeMe123!'),[error,setError]=useState(''),[busy,setBusy]=useState(false);
  async function submit(e){e.preventDefault();setBusy(true);setError('');try{const x=await api('/auth/login',{method:'POST',body:{email,password}});localStorage.setItem('token',x.token);onLogin(x.user)}catch(e){setError(e.message)}finally{setBusy(false)}}
  return <div className="login"><div className="login-card">
    <div className="login-header"><div><div className="eyebrow">THRUSTMIT</div><h1>Recruitment</h1></div><ThemeToggle/></div>
    <p className="muted">One candidate record. Every recruitment phase.</p>
    <form onSubmit={submit} className="stack"><label>Email<input value={email} onChange={e=>setEmail(e.target.value)} autoComplete="username"/></label><label>Password<input value={password} onChange={e=>setPassword(e.target.value)} type="password" autoComplete="current-password"/></label>{error&&<div className="error-box">{error}</div>}<button disabled={busy}>{busy?'Signing in…':'Sign in'}</button></form>
  </div></div>
}

function Dashboard({token}){
  const [data,setData]=useState(null),[attention,setAttention]=useState(null),[whatIf,setWhatIf]=useState(null),[topN,setTopN]=useState(150),[error,setError]=useState('');
  async function load(){setError('');try{const [d,a,w]=await Promise.all([api('/dashboard',{token}),api('/needs-attention',{token}),api(`/written/what-if?topN=${Math.max(1,Number(topN)||150)}`,{token})]);setData(d);setAttention(a);setWhatIf(w)}catch(e){setError(e.message)}}
  useEffect(()=>{const t=setTimeout(load,250);return()=>clearTimeout(t)},[topN]);
  if(error&&!data)return <ErrorBox message={error} onRetry={load}/>;
  if(!data)return <div className="loading">Loading dashboard…</div>;
  const funnel=[{name:'Applied',v:data.stats.applications},{name:'Written',v:data.stats.appeared},{name:'Cleared',v:data.stats.written_qualified},{name:'First interview',v:data.stats.first_interview},{name:'Taskphase',v:data.stats.taskphase},{name:'Selected',v:data.stats.selected}];
  return <div>
    <div className="page-title"><div><div className="eyebrow">LIVE OVERVIEW</div><h1>Dashboard</h1><p className="muted">{data.campaign?.name||'Recruitment'} · {data.campaign?.recruitment_year||''}</p></div></div>
    <div className="stats"><Stat label="Applications" value={data.stats.applications}/><Stat label="Written present" value={data.stats.appeared}/><Stat label="Written absent" value={data.stats.absent}/><Stat label="Written cleared" value={data.stats.written_qualified}/><Stat label="First interview" value={data.stats.first_interview}/><Stat label="Taskphase" value={data.stats.taskphase}/><Stat label="Selected" value={data.stats.selected}/></div>
    <div className="grid-3">
      <section className="panel"><div className="panel-title"><h2>Recruitment funnel</h2></div><ResponsiveContainer width="100%" height={280}><BarChart data={funnel}><CartesianGrid strokeDasharray="3 3"/><XAxis dataKey="name"/><YAxis/><Tooltip/><Bar dataKey="v"/></BarChart></ResponsiveContainer></section>
      <section className="panel"><div className="panel-title"><h2>Written intelligence</h2><span>Cutoff {data.written.cutoffPercentile==null?'—':Number(data.written.cutoffPercentile).toFixed(2)}</span></div>{data.written.sets?.length?<ResponsiveContainer width="100%" height={280}><BarChart data={data.written.sets}><CartesianGrid strokeDasharray="3 3"/><XAxis dataKey="set_number"/><YAxis/><Tooltip/><Bar dataKey="avg_marks" name="Avg marks"/></BarChart></ResponsiveContainer>:<div className="empty">No written scores yet.</div>}</section>
      <section className="panel"><div className="panel-title"><h2>What-if cutoff</h2></div><label>Top candidates<input type="number" min="1" value={topN} onChange={e=>setTopN(e.target.value)}/></label>{whatIf&&<div className="what-if"><div><b>{whatIf.cutoffPercentile==null?'—':whatIf.cutoffPercentile.toFixed(2)}</b><span>Percentile</span></div><div><b>{whatIf.cutoffMarks==null?'—':whatIf.cutoffMarks}</b><span>Raw marks · Set {whatIf.cutoffMarksSet??'—'}</span></div></div>}</section>
    </div>
    <section className="panel"><div className="panel-title"><h2>Needs attention</h2><button className="secondary" onClick={load}>Refresh</button></div><div className="attention"><div>Written pending<b>{attention?.pendingWritten??0}</b></div><div>Missing written marks<b>{attention?.missingWrittenMarks??0}</b></div><div>Interview remarks missing<b>{attention?.interviewsMissingRemarks??0}</b></div><div>Written absent<b>{attention?.writtenAbsent??0}</b></div></div></section>
    <section className="panel"><div className="panel-title"><h2>Interview phases</h2></div>{data.phases.length?data.phases.map(p=><div className="phase-row" key={p.id}><div><b>{p.phase_order}. {p.name}</b><span>{p.phase_type}</span></div><div className="phase-counts">Present {p.present||0} · Absent {p.absent||0} · Rescheduled {p.rescheduled||0} · Excused {p.excused||0}</div></div>):<div className="empty">No interview phases.</div>}</section>
  </div>
}

function PersonalDetails({candidate,token,user,onChanged}){
  const initial={name:candidate.name||'',learner_id:candidate.learner_id||'',registration_number:candidate.registration_number||'',email:candidate.email||'',phone:candidate.phone||'',branch:candidate.branch||'',notes:candidate.notes||''};
  const [form,setForm]=useState(initial),[busy,setBusy]=useState(false),[message,setMessage]=useState('');
  useEffect(()=>setForm(initial),[candidate.id,candidate.updated_at]);
  if(user.role!=='ADMIN') return <div className="info-grid"><div><span>Name</span><b>{candidate.name}</b></div><div><span>Learner ID / college mail</span><b>{candidate.learner_id||'—'}</b></div><div><span>Registration no.</span><b>{candidate.registration_number||'—'}</b></div><div><span>Personal email</span><b>{candidate.email||'—'}</b></div><div><span>Phone / WhatsApp</span><b>{candidate.phone||'—'}</b></div><div><span>Branch</span><b>{candidate.branch||'—'}</b></div></div>;
  async function save(e){e.preventDefault();setBusy(true);setMessage('');try{await api(`/candidates/${candidate.id}`,{method:'PUT',token,body:form});setMessage('Saved');onChanged()}catch(e){setMessage(e.message)}finally{setBusy(false)}}
  return <form className="form-grid" onSubmit={save}><label>Full name<input value={form.name} onChange={e=>setForm({...form,name:e.target.value})}/></label><label>Learner ID / college mail<input value={form.learner_id} onChange={e=>setForm({...form,learner_id:e.target.value})}/></label><label>Registration no.<input value={form.registration_number} onChange={e=>setForm({...form,registration_number:e.target.value})}/></label><label>Personal email<input type="email" value={form.email} onChange={e=>setForm({...form,email:e.target.value})}/></label><label>Phone / WhatsApp<input value={form.phone} onChange={e=>setForm({...form,phone:e.target.value})}/></label><label>Branch<input value={form.branch} onChange={e=>setForm({...form,branch:e.target.value})}/></label><label className="wide">Internal notes<textarea rows="3" value={form.notes} onChange={e=>setForm({...form,notes:e.target.value})}/></label><div className="wide inline-end"><button disabled={busy}>{busy?'Saving…':'Save details'}</button>{message&&<span className="muted">{message}</span>}</div></form>
}

function WrittenSection({data,token,user,onChanged}){
  const existing=data.written; const [attendance,setAttendance]=useState(data.candidate.attendance==='ABSENT'?'ABSENT':'PRESENT');
  const [form,setForm]=useState({setNumber:existing?.set_number||1,marks:existing?.marks??'',remarks:existing?.remarks||''});
  const [busy,setBusy]=useState(false),[error,setError]=useState('');
  useEffect(()=>{setAttendance(data.candidate.attendance==='ABSENT'?'ABSENT':'PRESENT');setForm({setNumber:existing?.set_number||1,marks:existing?.marks??'',remarks:existing?.remarks||''})},[data.candidate.id,data.candidate.attendance,existing?.updated_at]);
  async function saveAttendance(next){setBusy(true);setError('');try{await api(`/written-tests/${data.candidate.id}/attendance`,{method:'PUT',token,body:{attendance:next}});setAttendance(next);await onChanged()}catch(e){setError(e.message)}finally{setBusy(false)}}
  async function save(e){e.preventDefault();setBusy(true);setError('');try{await api(`/written-tests/${data.candidate.id}`,{method:'PUT',token,body:{...form,setNumber:Number(form.setNumber),marks:Number(form.marks)}});await onChanged()}catch(e){setError(e.message)}finally{setBusy(false)}}
  const canEdit=user.role==='ADMIN'||user.role==='TEST_CHECKER';
  return <section className="section"><div className="section-head"><div><h2>Written round</h2><p className="muted">Attendance can be corrected at any time. Only present candidates enter percentile calculations.</p></div><span className={`status-pill ${attendance.toLowerCase()}`}>{attendance}</span></div>{error&&<div className="error-box">{error}</div>}{canEdit&&<div className="attendance-switch"><span>Written attendance</span><button type="button" className={attendance==='PRESENT'?'selected':''} disabled={busy} onClick={()=>saveAttendance('PRESENT')}>Present</button><button type="button" className={attendance==='ABSENT'?'selected danger-selected':''} disabled={busy} onClick={()=>saveAttendance('ABSENT')}>Absent</button></div>}
    {canEdit&&attendance==='PRESENT'&&<form className="form-grid" onSubmit={save}><label>Set<select value={form.setNumber} onChange={e=>setForm({...form,setNumber:e.target.value})}>{[1,2,3,4].map(n=><option key={n} value={n}>Set {n}</option>)}</select></label><label>Marks / 20<input type="number" min="0" max="20" step="0.01" value={form.marks} onChange={e=>setForm({...form,marks:e.target.value})} required/></label><label className="wide">Remark<textarea rows="3" value={form.remarks} onChange={e=>setForm({...form,remarks:e.target.value})}/></label><button className="wide" disabled={busy}>{busy?'Saving…':'Save written result'}</button></form>}
    {attendance==='ABSENT'?<div className="notice">Candidate is marked absent for the written round. Their written record remains stored, but they are excluded from the percentile calculation until marked present.</div>:existing?<div className="metrics"><div><span>Set</span><b>{existing.set_number}</b></div><div><span>Marks</span><b>{existing.marks}/20</b></div><div><span>Set percentile</span><b>{existing.set_percentile==null?'—':Number(existing.set_percentile).toFixed(2)}</b></div><div><span>Normalized percentile</span><b>{existing.normalized_percentile==null?'—':Number(existing.normalized_percentile).toFixed(2)}</b></div><div><span>Qualified</span><b>{existing.qualified==null?'Pending':existing.qualified?'Yes':'No'}</b></div></div>:<div className="empty">No written score recorded.</div>}
  </section>
}

function InterviewForm({token,candidateId,phases,onChanged,user}){
  const [phaseId,setPhaseId]=useState(phases[0]?.id||''),[names,setNames]=useState(['']),[attendance,setAttendance]=useState('PRESENT'),[date,setDate]=useState(''),[remarks,setRemarks]=useState(''),[busy,setBusy]=useState(false),[error,setError]=useState('');
  useEffect(()=>{if(!phaseId&&phases[0])setPhaseId(phases[0].id)},[phases]);
  function setName(i,v){setNames(ns=>ns.map((x,j)=>j===i?v:x))}
  async function save(e){e.preventDefault();if(!phaseId)return;setBusy(true);setError('');try{await api(`/interviews/${candidateId}`,{method:'POST',token,body:{phaseId:Number(phaseId),interviewerNames:names,attendance,interviewDate:date,remarks}});setRemarks('');setAttendance('PRESENT');await onChanged()}catch(e){setError(e.message)}finally{setBusy(false)}}
  if(user.role==='TEST_CHECKER')return null;
  return <section className="section"><div className="section-head"><div><h2>Add / update interview</h2><p className="muted">Simple record: phase, attendance, interviewer names and one remark.</p></div></div>{error&&<div className="error-box">{error}</div>}<form className="form-grid" onSubmit={save}><label>Phase<select value={phaseId} onChange={e=>setPhaseId(e.target.value)}>{phases.filter(p=>p.active!==0).map(p=><option key={p.id} value={p.id}>{p.name}</option>)}</select></label><label>Attendance<select value={attendance} onChange={e=>setAttendance(e.target.value)}>{INTERVIEW_ATTENDANCE.map(x=><option key={x}>{x}</option>)}</select></label><label>Date<input type="date" value={date} onChange={e=>setDate(e.target.value)}/></label><div><span className="field-title">Interviewers</span>{names.map((n,i)=><div className="name-row" key={i}><input value={n} placeholder={`Interviewer ${i+1}`} onChange={e=>setName(i,e.target.value)}/>{i>0&&<button type="button" className="icon-btn" onClick={()=>setNames(ns=>ns.filter((_,j)=>j!==i))}>×</button>}</div>)}<button type="button" className="secondary" onClick={()=>setNames(ns=>[...ns,''])}>+ Add interviewer</button></div><label className="wide">Remark<textarea rows="3" value={remarks} onChange={e=>setRemarks(e.target.value)}/></label><button className="wide" disabled={busy}>{busy?'Saving…':'Save interview result'}</button></form></section>
}

function CandidateDrawer({id,token,user,phases,onClose,onChanged}){
  const [data,setData]=useState(null),[error,setError]=useState('');
  async function load(){setError('');try{setData(await api(`/candidates/${id}`,{token}))}catch(e){setError(e.message)}}
  useEffect(()=>{load()},[id]);
  if(error)return <div className="overlay"><aside className="drawer"><button className="close" onClick={onClose}>×</button><ErrorBox message={error} onRetry={load}/></aside></div>;
  if(!data)return <div className="overlay"><aside className="drawer"><button className="close" onClick={onClose}>×</button><div className="loading">Loading candidate…</div></aside></div>;
  const c=data.candidate;
  async function archive(){if(!confirm(`Archive ${c.name}?`))return;await api(`/candidates/${id}`,{method:'DELETE',token});await load();onChanged()}
  async function restore(){await api(`/candidates/${id}/restore`,{method:'POST',token});await load();onChanged()}
  return <div className="overlay" onClick={e=>e.target===e.currentTarget&&onClose()}><aside className="drawer">
    <button className="close" onClick={onClose}>×</button>
    <div className="drawer-head"><div><div className="eyebrow">CANDIDATE PROFILE</div><h1>{c.name}</h1><div className="muted">{c.registration_number||'No registration'} · {c.branch||'No branch'}</div></div><span className="status-pill">{c.deleted_at?'ARCHIVED':c.status}</span></div>
    <section className="section"><div className="section-head"><h2>Personal details</h2></div><PersonalDetails candidate={c} token={token} user={user} onChanged={async()=>{await load();onChanged()}}/></section>
    <WrittenSection data={data} token={token} user={user} onChanged={async()=>{await load();onChanged()}}/>
    <section className="section"><div className="section-head"><div><h2>Interview history</h2><p className="muted">All interviews across the recruitment year.</p></div></div>{data.interviews.length?data.interviews.map(r=>{let names=[];try{names=Array.isArray(r.interviewer_names)?r.interviewer_names:(typeof r.interviewer_names==='string'?JSON.parse(r.interviewer_names):[])}catch{}return <div className="history" key={r.id}><div className="history-top"><b>{r.phase_name}</b><span className={`status-pill ${String(r.attendance).toLowerCase()}`}>{r.attendance}</span></div><div className="muted">{r.interview_date||'No date'} · {names.filter(Boolean).join(', ')||'No interviewer names'}</div><p>{r.remarks||'No remark.'}</p></div>}):<div className="empty">No interview results yet.</div>}</section>
    <InterviewForm token={token} candidateId={id} phases={phases} onChanged={async()=>{await load();onChanged()}} user={user}/>
    <section className="section"><div className="section-head"><div><h2>Timeline</h2><p className="muted">Audit trail of changes.</p></div></div>{data.audit.length?data.audit.map(x=><div className="timeline" key={x.id}><b>{x.action}</b><span>{new Date(x.created_at).toLocaleString()}</span><small>{x.user_name||'System'} · {x.field_name||x.object_type}</small></div>):<div className="empty">No audit history.</div>}</section>
    {user.role==='ADMIN'&&<section className="section danger-zone"><div className="section-head"><h2>Candidate controls</h2></div>{c.deleted_at?<button className="secondary" onClick={restore}>Restore candidate</button>:<button className="danger" onClick={archive}>Archive candidate</button>}</section>}
  </aside></div>
}

function Candidates({token,user,onOpen,refreshKey}){
  const [q,setQ]=useState(''),[status,setStatus]=useState('ALL'),[branch,setBranch]=useState(''),[includeDeleted,setIncludeDeleted]=useState(false),[rows,setRows]=useState([]),[meta,setMeta]=useState({total:0,branches:[]}),[selected,setSelected]=useState([]),[error,setError]=useState('');
  async function load(){setError('');try{const p=new URLSearchParams({q,page:1,pageSize:100,includeDeleted});if(status!=='ALL')p.set('status',status);if(branch)p.set('branch',branch);const x=await api(`/candidates?${p}`,{token});setRows(x.data);setMeta(x)}catch(e){setError(e.message)}}
  useEffect(()=>{load()},[q,status,branch,includeDeleted,refreshKey]);
  function toggle(id){setSelected(s=>s.includes(id)?s.filter(x=>x!==id):[...s,id])}
  async function bulkArchive(){if(!selected.length)return;if(!confirm(`Archive ${selected.length} candidates?`))return;for(const id of selected)await api(`/candidates/${id}`,{method:'DELETE',token});setSelected([]);load()}
  async function exportCsv(){const data=await api(`/reports/candidates${status!=='ALL'?`?status=${encodeURIComponent(status)}`:''}`,{token});const keys=['name','learner_id','registration_number','email','phone','branch','attendance','status'];const csv=[keys.join(','),...data.map(r=>keys.map(k=>`"${String(r[k]??'').replaceAll('"','""')}"`).join(','))].join('\n');const a=document.createElement('a');a.href=URL.createObjectURL(new Blob([csv],{type:'text/csv'}));a.download='recruitment-candidates.csv';a.click()}
  return <div><div className="page-title"><div><div className="eyebrow">SEARCHABLE DATABASE</div><h1>Candidates</h1><p className="muted">Search by name, learner ID, registration number, phone or email.</p></div></div><div className="toolbar"><input className="search" value={q} onChange={e=>setQ(e.target.value)} placeholder="Search candidate…"/><select value={status} onChange={e=>setStatus(e.target.value)}>{STATUSES.map(s=><option key={s}>{s}</option>)}</select><select value={branch} onChange={e=>setBranch(e.target.value)}><option value="">All branches</option>{meta.branches.map(b=><option key={b}>{b}</option>)}</select><label className="check"><input type="checkbox" checked={includeDeleted} onChange={e=>setIncludeDeleted(e.target.checked)}/> Archived</label><button className="secondary" onClick={exportCsv}>Export CSV</button></div>{selected.length>0&&user.role==='ADMIN'&&<div className="bulkbar"><b>{selected.length} selected</b><button className="danger" onClick={bulkArchive}>Archive selected</button></div>}{error&&<ErrorBox message={error} onRetry={load}/>}<div className="table-wrap"><table><thead><tr><th></th><th>Candidate</th><th>Learner ID</th><th>Reg no.</th><th>Phone</th><th>Branch</th><th>Written</th><th>Status</th></tr></thead><tbody>{rows.map(r=><tr key={r.id} className={r.deleted_at?'archived':''} onClick={()=>onOpen(r.id)}><td onClick={e=>e.stopPropagation()}><input type="checkbox" checked={selected.includes(r.id)} onChange={()=>toggle(r.id)}/></td><td><b>{r.name}</b><small>{r.email||'No personal email'}</small></td><td>{r.learner_id||'—'}</td><td>{r.registration_number||'—'}</td><td>{r.phone||'—'}</td><td>{r.branch||'—'}</td><td>{r.attendance==='ABSENT'?'Absent':r.attendance==='PRESENT'?'Present':'—'}</td><td>{r.deleted_at?'Archived':r.status}</td></tr>)}</tbody></table><div className="table-foot">{meta.total} matching candidate(s)</div></div></div>
}

function PhaseManager({token,phases,onChanged}){
  const [name,setName]=useState(''),[type,setType]=useState('TASKPHASE'),[error,setError]=useState('');
  async function add(){if(!name.trim())return;setError('');try{await api('/interview-phases',{method:'POST',token,body:{name:name.trim(),phaseType:type}});setName('');onChanged()}catch(e){setError(e.message)}}
  return <section className="panel"><div className="section-head"><div><div className="eyebrow">PIPELINE</div><h2>Interview phases</h2><p className="muted">Start with Recruitment Interview, then add as many Taskphase interviews as needed.</p></div></div>{error&&<div className="error-box">{error}</div>}<div className="phase-add"><input value={name} onChange={e=>setName(e.target.value)} placeholder="e.g. Taskphase 3"/><select value={type} onChange={e=>setType(e.target.value)}><option value="REC_INTERVIEW">Recruitment Interview</option><option value="TASKPHASE">Taskphase</option></select><button onClick={add}>Add phase</button></div>{phases.map(p=><div className="phase-row" key={p.id}><div><b>{p.phase_order}. {p.name}</b><span>{p.phase_type}</span></div><div>{p.records||0} records</div></div>)}</section>
}

function Admin({token,phases,onChanged}){
  const [year,setYear]=useState(new Date().getFullYear()),[name,setName]=useState('ThrustMIT Recruitment'),[message,setMessage]=useState('');
  async function create(){setMessage('');try{await api('/campaigns',{method:'POST',token,body:{name,recruitmentYear:Number(year),writtenMaxMarks:20,writtenQualifiedCount:150}});setMessage('Campaign created. Refresh to activate it from the database.');onChanged()}catch(e){setMessage(e.message)}}
  return <div><div className="page-title"><div><div className="eyebrow">ADMIN</div><h1>System setup</h1></div></div><section className="panel"><div className="section-head"><div><h2>Recruitment campaign</h2><p className="muted">Create future recruitment years without mixing candidate data.</p></div></div><div className="phase-add"><input value={name} onChange={e=>setName(e.target.value)}/><input type="number" value={year} onChange={e=>setYear(e.target.value)}/><button onClick={create}>Add campaign</button></div>{message&&<div className="success">{message}</div>}</section><PhaseManager token={token} phases={phases} onChanged={onChanged}/></div>
}

function App(){
  const token=localStorage.getItem('token');
  const [user,setUser]=useState(null),[page,setPage]=useState('dashboard'),[candidateId,setCandidateId]=useState(null),[phases,setPhases]=useState([]),[refresh,setRefresh]=useState(0);
  useEffect(()=>{if(token)api('/auth/me',{token}).then(setUser).catch(()=>{localStorage.removeItem('token');location.reload()})},[token]);
  async function loadPhases(){if(token){try{setPhases(await api('/interview-phases',{token}))}catch{setPhases([])}}}
  useEffect(()=>{loadPhases()},[token,refresh]);
  if(!user)return <Login onLogin={setUser}/>;
  function logout(){localStorage.removeItem('token');location.reload()}
  const onChanged=()=>setRefresh(x=>x+1);
  return <div className="app"><nav className="sidebar"><div className="brand"><span className="brand-mark">T</span><span>Recruitment</span></div><button className={page==='dashboard'?'nav-active':''} onClick={()=>setPage('dashboard')}>Dashboard</button><button className={page==='candidates'?'nav-active':''} onClick={()=>setPage('candidates')}>Candidates</button>{user.role==='ADMIN'&&<button className={page==='admin'?'nav-active':''} onClick={()=>setPage('admin')}>Admin</button>}<div className="sidebar-bottom"><ThemeToggle/><div className="user-block"><b>{user.name}</b><span>{user.role.replace('_',' ')}</span></div><button className="signout" onClick={logout}>Sign out</button></div></nav><main className="content">{page==='dashboard'?<Dashboard token={token}/>:page==='candidates'?<Candidates token={token} user={user} onOpen={setCandidateId} refreshKey={refresh}/>:<Admin token={token} phases={phases} onChanged={onChanged}/>}</main>{candidateId&&<CandidateDrawer id={candidateId} token={token} user={user} phases={phases} onClose={()=>setCandidateId(null)} onChanged={onChanged}/>}</div>
}

createRoot(document.getElementById('root')).render(<App/>);
