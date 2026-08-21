import React,{useEffect,useMemo,useState} from 'react';
import {createRoot} from 'react-dom/client';
import {BarChart,Bar,XAxis,YAxis,Tooltip,ResponsiveContainer,CartesianGrid,Cell,PieChart,Pie} from 'recharts';
import {api} from './api.js';
import './styles.css';

const STATUSES=['ALL','APPLIED FOR WRITTEN','ABSENT FOR WRITTEN','GAVE WRITTEN','WRITTEN CLEARED','WRITTEN REJECTED','APPEARED FOR FIRST INTERVIEW','TASKPHASE','SELECTED','REJECTED','WITHDRAWN'];
const INTERVIEW_ATTENDANCE=['PRESENT','ABSENT','RESCHEDULED','EXCUSED'];
const WRITTEN_ATTENDANCE=['UNKNOWN','PRESENT','ABSENT'];

function useTheme(){
  const [theme,setTheme]=useState(()=>localStorage.getItem('theme')||'dark');
  useEffect(()=>{
    const sync=()=>setTheme(localStorage.getItem('theme')||'dark');
    window.addEventListener('themechange',sync);
    document.documentElement.dataset.theme=theme;
    localStorage.setItem('theme',theme);
    return()=>window.removeEventListener('themechange',sync);
  },[theme]);
  return theme;
}
function ThemeToggle(){
  const theme=useTheme();
  function toggle(){const next=theme==='dark'?'light':'dark';localStorage.setItem('theme',next);document.documentElement.dataset.theme=next;window.dispatchEvent(new Event('themechange'));}
  return <button className="theme-btn" onClick={toggle}>{theme==='dark'?'☀ Light':'☾ Dark'}</button>;
}
function ChartTheme(){const theme=useTheme();return theme==='dark'?{grid:'#2d333b',axis:'#aab4bf',bar:'#8ab4f8',bar2:'#6ea8fe',tooltip:'#171b20'}:{grid:'#e2e6ea',axis:'#68727e',bar:'#334155',bar2:'#4f6b95',tooltip:'#ffffff'};}
function Stat({label,value,sub}){return <div className="stat"><span>{label}</span><b>{value??0}</b>{sub&&<small>{sub}</small>}</div>}
function ErrorBox({message,onRetry}){return <div className="error-box"><b>Couldn’t load this section</b><span>{message}</span>{onRetry&&<button className="secondary" onClick={onRetry}>Retry</button>}</div>}
function Loading({label='Loading…'}){return <div className="loading"><span className="spinner"/> {label}</div>}
function Modal({title,onClose,children,wide=false}){return <div className="modal-backdrop" onMouseDown={e=>e.target===e.currentTarget&&onClose()}><div className={`modal ${wide?'modal-wide':''}`}><div className="modal-head"><div><div className="eyebrow">RECRUITMENT</div><h2>{title}</h2></div><button className="icon-btn" onClick={onClose}>×</button></div>{children}</div></div>}

function Login({onLogin}){
  const [email,setEmail]=useState('admin@example.com'),[password,setPassword]=useState('ChangeMe123!'),[error,setError]=useState(''),[busy,setBusy]=useState(false);
  async function submit(e){e.preventDefault();setBusy(true);setError('');try{const x=await api('/auth/login',{method:'POST',body:{email,password}});localStorage.setItem('token',x.token);onLogin(x.user)}catch(e){setError(e.message)}finally{setBusy(false)}}
  return <div className="login"><div className="login-card"><div className="login-header"><div><div className="eyebrow">THRUSTMIT</div><h1>Recruitment</h1></div><ThemeToggle/></div><p className="muted">A single source of truth for the entire recruitment cycle.</p><form onSubmit={submit} className="stack"><label>Email<input value={email} onChange={e=>setEmail(e.target.value)} autoComplete="username"/></label><label>Password<input value={password} onChange={e=>setPassword(e.target.value)} type="password" autoComplete="current-password"/></label>{error&&<div className="error-box"><span>{error}</span></div>}<button disabled={busy}>{busy?'Signing in…':'Sign in'}</button></form></div></div>
}

function Dashboard({token,refreshKey}){
  async function downloadWrittenQualified(){
    const apiBase=import.meta.env.VITE_API_BASE_URL||'http://localhost:4000/api';
    const res=await fetch(`${apiBase}/written/export`,{headers:{Authorization:`Bearer ${token}`}});
    if(!res.ok){const d=await res.json().catch(()=>({}));throw new Error(d.error||`Export failed (${res.status})`)}
    const blob=await res.blob();
    const href=URL.createObjectURL(blob);
    const a=document.createElement('a');a.href=href;a.download='written-qualified-candidates.xlsx';document.body.appendChild(a);a.click();a.remove();URL.revokeObjectURL(href);
  }
  
  const [data,setData]=useState(null),[attention,setAttention]=useState(null),[whatIf,setWhatIf]=useState(null),[topN,setTopN]=useState(150),[error,setError]=useState('');
  const chart=ChartTheme();
  async function load(){setError('');try{const [d,a,w]=await Promise.all([api('/dashboard',{token}),api('/needs-attention',{token}),api(`/written/what-if?topN=${Math.max(1,Number(topN)||150)}`,{token})]);setData(d);setAttention(a);setWhatIf(w)}catch(e){setError(e.message)}}
  useEffect(()=>{const t=setTimeout(load,180);return()=>clearTimeout(t)},[topN,refreshKey]);
  if(error&&!data)return <ErrorBox message={error} onRetry={load}/>;
  if(!data)return <Loading label="Loading dashboard…"/>;
  const funnel=[{name:'Applied',v:data.stats.applications},{name:'Written',v:data.stats.appeared},{name:'Cleared',v:data.stats.written_qualified},{name:'1st interview',v:data.stats.first_interview},{name:'Taskphase',v:data.stats.taskphase},{name:'Selected',v:data.stats.selected}];
  const sets=(data.written.sets||[]).map(x=>({...x,set:`Set ${x.set_number}`}));
  const branches=data.branchStats||[];
  return <div>
    <div className="page-title"><div><div className="eyebrow">LIVE OVERVIEW</div><h1>Dashboard</h1><p className="muted">{data.campaign?.name||'Recruitment'} · {data.campaign?.recruitment_year||''}</p></div><div className="title-actions"><button className="secondary" onClick={async()=>{try{await downloadWrittenQualified()}catch(e){alert(e.message)}}}>Download written results</button><button className="secondary" onClick={load}>Refresh</button></div></div>
    <div className="stats"><Stat label="Applications" value={data.stats.applications}/><Stat label="Written present" value={data.stats.appeared}/><Stat label="Written absent" value={data.stats.absent}/><Stat label="Not marked" value={data.stats.unmarked}/><Stat label="Written cleared" value={data.stats.written_qualified}/><Stat label="Taskphase" value={data.stats.taskphase}/><Stat label="Selected" value={data.stats.selected}/></div>
    <div className="grid-3">
      <section className="panel chart-panel"><div className="panel-title"><h2>Recruitment funnel</h2></div><ResponsiveContainer width="100%" height={290}><BarChart data={funnel}><CartesianGrid strokeDasharray="3 3" stroke={chart.grid}/><XAxis dataKey="name" tick={{fill:chart.axis,fontSize:11}} axisLine={{stroke:chart.grid}}/><YAxis allowDecimals={false} tick={{fill:chart.axis,fontSize:11}} axisLine={{stroke:chart.grid}}/><Tooltip contentStyle={{background:chart.tooltip,border:`1px solid ${chart.grid}`,borderRadius:10,color:chart.axis}}/><Bar dataKey="v" fill={chart.bar} radius={[6,6,0,0]}/></BarChart></ResponsiveContainer></section>
      <section className="panel chart-panel"><div className="panel-title"><h2>Written intelligence</h2><span>Cutoff {data.written.cutoffPercentile==null?'—':Number(data.written.cutoffPercentile).toFixed(2)}</span></div>{sets.length?<ResponsiveContainer width="100%" height={290}><BarChart data={sets}><CartesianGrid strokeDasharray="3 3" stroke={chart.grid}/><XAxis dataKey="set" tick={{fill:chart.axis,fontSize:11}} axisLine={{stroke:chart.grid}}/><YAxis tick={{fill:chart.axis,fontSize:11}} axisLine={{stroke:chart.grid}}/><Tooltip contentStyle={{background:chart.tooltip,border:`1px solid ${chart.grid}`,borderRadius:10,color:chart.axis}}/><Bar dataKey="avg_marks" name="Average marks" fill={chart.bar2} radius={[6,6,0,0]}/></BarChart></ResponsiveContainer>:<div className="empty">No written scores yet.</div>}</section>
      <section className="panel chart-panel"><div className="panel-title"><h2>By branch</h2><span>Top 8</span></div>{branches.length?<ResponsiveContainer width="100%" height={290}><BarChart data={branches} layout="vertical" margin={{left:12,right:12}}><CartesianGrid strokeDasharray="3 3" stroke={chart.grid}/><XAxis type="number" allowDecimals={false} tick={{fill:chart.axis,fontSize:11}} axisLine={{stroke:chart.grid}}/><YAxis dataKey="branch" type="category" width={90} tick={{fill:chart.axis,fontSize:10}} axisLine={{stroke:chart.grid}}/><Tooltip contentStyle={{background:chart.tooltip,border:`1px solid ${chart.grid}`,borderRadius:10,color:chart.axis}}/><Bar dataKey="count" fill={chart.bar} radius={[0,6,6,0]}/></BarChart></ResponsiveContainer>:<div className="empty">No branch data.</div>}</section>
    </div>
    <div className="grid-2">
      <section className="panel"><div className="panel-title"><h2>Needs attention</h2><button className="secondary" onClick={load}>Refresh</button></div><div className="attention"><div><span>Written unmarked</span><b>{attention?.writtenUnmarked??0}</b></div><div><span>Written marks missing</span><b>{attention?.missingWrittenMarks??0}</b></div><div><span>Interview remarks missing</span><b>{attention?.interviewsMissingRemarks??0}</b></div><div><span>Written absent</span><b>{attention?.writtenAbsent??0}</b></div></div></section>
      <section className="panel"><div className="panel-title"><h2>What-if cutoff</h2><span>Simulation only</span></div><div className="inline-form"><label>Top candidates<input type="number" min="1" value={topN} onChange={e=>setTopN(e.target.value)}/></label></div>{whatIf&&<div className="what-if"><div><b>{whatIf.cutoffPercentile==null?'—':whatIf.cutoffPercentile.toFixed(2)}</b><span>Percentile</span></div><div><b>{whatIf.cutoffMarks==null?'—':whatIf.cutoffMarks}</b><span>Raw marks · Set {whatIf.cutoffMarksSet??'—'}</span></div><div><b>{whatIf.selected}</b><span>Would qualify</span></div></div>}</section>
    </div>
    <section className="panel"><div className="panel-title"><h2>Interview pipeline</h2><span>{data.phases.length} active phase(s)</span></div>{data.phases.length?data.phases.map(p=><div className="phase-row" key={p.id}><div><b>{p.phase_order}. {p.name}</b><span>{p.phase_type}</span></div><div className="phase-counts">Present {p.present||0} · Absent {p.absent||0} · Rescheduled {p.rescheduled||0} · Excused {p.excused||0}</div></div>):<div className="empty">No interview phases configured.</div>}</section>
  </div>
}

function AddCandidate({token,onClose,onCreated}){
  const [form,setForm]=useState({name:'',learnerId:'',registrationNumber:'',email:'',phone:'',branch:'',notes:''}),[busy,setBusy]=useState(false),[error,setError]=useState('');
  function set(k,v){setForm(f=>({...f,[k]:v}))}
  async function save(e){e.preventDefault();setBusy(true);setError('');try{await api('/candidates',{method:'POST',token,body:form});onCreated()}catch(e){setError(e.message)}finally{setBusy(false)}}
  return <Modal title="Add candidate" onClose={onClose}><form className="form-grid" onSubmit={save}>{error&&<div className="wide"><ErrorBox message={error}/></div>}<label>Full name*<input value={form.name} onChange={e=>set('name',e.target.value)} required autoFocus/></label><label>Learner ID / college mail<input value={form.learnerId} onChange={e=>set('learnerId',e.target.value)}/></label><label>Registration no.<input value={form.registrationNumber} onChange={e=>set('registrationNumber',e.target.value)}/></label><label>Personal email<input type="email" value={form.email} onChange={e=>set('email',e.target.value)}/></label><label>Phone / WhatsApp<input value={form.phone} onChange={e=>set('phone',e.target.value)}/></label><label>Branch<input value={form.branch} onChange={e=>set('branch',e.target.value)}/></label><label className="wide">Internal notes<textarea rows="3" value={form.notes} onChange={e=>set('notes',e.target.value)}/></label><div className="wide modal-actions"><button className="secondary" type="button" onClick={onClose}>Cancel</button><button disabled={busy}>{busy?'Adding…':'Add candidate'}</button></div></form></Modal>
}

function PersonalDetails({candidate,token,user,onChanged}){
  const initial={name:candidate.name||'',learner_id:candidate.learner_id||'',registration_number:candidate.registration_number||'',email:candidate.email||'',phone:candidate.phone||'',branch:candidate.branch||'',notes:candidate.notes||''};
  const [form,setForm]=useState(initial),[busy,setBusy]=useState(false),[message,setMessage]=useState('');
  useEffect(()=>setForm(initial),[candidate.id,candidate.updated_at]);
  if(user.role!=='ADMIN') return <div className="info-grid"><Info label="Name" value={candidate.name}/><Info label="Learner ID / college mail" value={candidate.learner_id}/><Info label="Registration no." value={candidate.registration_number}/><Info label="Personal email" value={candidate.email}/><Info label="Phone / WhatsApp" value={candidate.phone}/><Info label="Branch" value={candidate.branch}/>{candidate.notes&&<Info label="Internal notes" value={candidate.notes}/>}</div>;
  async function save(e){e.preventDefault();setBusy(true);setMessage('');try{await api(`/candidates/${candidate.id}`,{method:'PUT',token,body:form});setMessage('Saved');onChanged()}catch(e){setMessage(e.message)}finally{setBusy(false)}}
  return <form className="form-grid" onSubmit={save}><label>Full name<input value={form.name} onChange={e=>setForm({...form,name:e.target.value})}/></label><label>Learner ID / college mail<input value={form.learner_id} onChange={e=>setForm({...form,learner_id:e.target.value})}/></label><label>Registration no.<input value={form.registration_number} onChange={e=>setForm({...form,registration_number:e.target.value})}/></label><label>Personal email<input type="email" value={form.email} onChange={e=>setForm({...form,email:e.target.value})}/></label><label>Phone / WhatsApp<input value={form.phone} onChange={e=>setForm({...form,phone:e.target.value})}/></label><label>Branch<input value={form.branch} onChange={e=>setForm({...form,branch:e.target.value})}/></label><label className="wide">Internal notes<textarea rows="3" value={form.notes} onChange={e=>setForm({...form,notes:e.target.value})}/></label><div className="wide inline-end"><button disabled={busy}>{busy?'Saving…':'Save details'}</button>{message&&<span className="muted">{message}</span>}</div></form>
}
function Info({label,value}){return <div><span>{label}</span><b>{value||'—'}</b></div>}

function WrittenSection({data,token,user,onChanged}){
  const existing=data.written; const current=data.candidate.attendance||'UNKNOWN';
  const [attendance,setAttendance]=useState(current),[form,setForm]=useState({setNumber:existing?.set_number||1,marks:existing?.marks??'',remarks:existing?.remarks||''}),[busy,setBusy]=useState(false),[error,setError]=useState('');
  const canEdit=user.role==='ADMIN'||user.role==='TEST_CHECKER';
  useEffect(()=>{setAttendance(data.candidate.attendance||'UNKNOWN');setForm({setNumber:existing?.set_number||1,marks:existing?.marks??'',remarks:existing?.remarks||''})},[data.candidate.id,data.candidate.attendance,existing?.updated_at]);
  async function saveAttendance(next){setBusy(true);setError('');try{await api(`/written-tests/${data.candidate.id}/attendance`,{method:'PUT',token,body:{attendance:next}});setAttendance(next);await onChanged()}catch(e){setError(e.message)}finally{setBusy(false)}}
  async function save(e){e.preventDefault();setBusy(true);setError('');try{await api(`/written-tests/${data.candidate.id}`,{method:'PUT',token,body:{...form,setNumber:Number(form.setNumber),marks:Number(form.marks)}});await onChanged()}catch(e){setError(e.message)}finally{setBusy(false)}}
  return <section className="section"><div className="section-head"><div><h2>Written round</h2><p className="muted">Only PRESENT candidates enter percentile and cutoff calculations.</p></div><span className={`status-pill ${attendance.toLowerCase()}`}>{attendance}</span></div>{error&&<ErrorBox message={error}/>} {canEdit&&<div className="attendance-switch"><span>Attendance</span>{WRITTEN_ATTENDANCE.map(x=><button key={x} type="button" className={attendance===x?x==='ABSENT'?'danger-selected':'selected':''} disabled={busy} onClick={()=>saveAttendance(x)}>{x==='UNKNOWN'?'Not marked':x.charAt(0)+x.slice(1).toLowerCase()}</button>)}</div>}
    {attendance==='UNKNOWN'&&<div className="notice warning">Written-test attendance has not been marked yet. Use the Candidates bulk action to mark everyone left unmarked as absent after checking the slot sheet.</div>}
    {canEdit&&attendance==='PRESENT'&&<form className="form-grid" onSubmit={save}><label>Set<select value={form.setNumber} onChange={e=>setForm({...form,setNumber:e.target.value})}>{[1,2,3,4].map(n=><option key={n}>{n}</option>)}</select></label><label>Marks / 20<input type="number" min="0" max="20" step="0.01" value={form.marks} onChange={e=>setForm({...form,marks:e.target.value})} required/></label><label className="wide">Remark<textarea rows="3" value={form.remarks} onChange={e=>setForm({...form,remarks:e.target.value})}/></label><button className="wide" type="submit" disabled={busy}>{busy?'Saving…':'Save written result'}</button></form>}
    {attendance==='ABSENT'?<div className="notice">Candidate is absent for the written round. Existing score data remains in history but is excluded from the current written calculation.</div>:existing?<div className="metrics"><Info label="Set" value={existing.set_number}/><Info label="Marks" value={`${existing.marks}/20`}/><Info label="Set percentile" value={existing.set_percentile==null?'—':Number(existing.set_percentile).toFixed(2)}/><Info label="Normalized percentile" value={existing.normalized_percentile==null?'—':Number(existing.normalized_percentile).toFixed(2)}/><Info label="Qualified" value={existing.qualified==null?'Pending':existing.qualified?'Yes':'No'}/></div>:<div className="empty">No written score recorded.</div>}
  </section>
}

function InterviewForm({token,candidateId,phases,onChanged,user,existingInterviews}){
  const firstExisting=existingInterviews?.[0];
  const [phaseId,setPhaseId]=useState(phases[0]?.id||''),[names,setNames]=useState(['']),[attendance,setAttendance]=useState('PRESENT'),[date,setDate]=useState(''),[remarks,setRemarks]=useState(''),[busy,setBusy]=useState(false),[error,setError]=useState('');
  useEffect(()=>{if(!phaseId&&phases[0])setPhaseId(phases[0].id)},[phases,phaseId]);
  function setName(i,v){setNames(ns=>ns.map((x,j)=>j===i?v:x))}
  function loadExisting(){const r=existingInterviews?.find(x=>Number(x.phase_id)===Number(phaseId));if(!r){setNames(['']);setAttendance('PRESENT');setDate('');setRemarks('');return}let parsed=[];try{parsed=Array.isArray(r.interviewer_names)?r.interviewer_names:JSON.parse(r.interviewer_names||'[]')}catch{}setNames(parsed.length?parsed:['']);setAttendance(r.attendance||'PRESENT');setDate(r.interview_date||'');setRemarks(r.remarks||'')}
  useEffect(()=>{loadExisting()},[phaseId]);
  async function save(e){e.preventDefault();if(!phaseId)return;setBusy(true);setError('');try{await api(`/interviews/${candidateId}`,{method:'POST',token,body:{phaseId:Number(phaseId),interviewerNames:names,attendance,interviewDate:date,remarks}});await onChanged()}catch(e){setError(e.message)}finally{setBusy(false)}}
  if(user.role==='TEST_CHECKER')return null;
  return <section className="section"><div className="section-head"><div><h2>Add / update interview</h2><p className="muted">Simple record: phase, attendance, interviewer names and one remark.</p></div></div>{error&&<ErrorBox message={error}/>}<form className="form-grid" onSubmit={save}><label>Phase<select value={phaseId} onChange={e=>setPhaseId(e.target.value)}>{phases.filter(p=>p.active!==0).map(p=><option key={p.id} value={p.id}>{p.name}</option>)}</select></label><label>Attendance<select value={attendance} onChange={e=>setAttendance(e.target.value)}>{INTERVIEW_ATTENDANCE.map(x=><option key={x}>{x}</option>)}</select></label><label>Date<input type="date" value={date} onChange={e=>setDate(e.target.value)}/></label><div><span className="field-title">Interviewers</span>{names.map((n,i)=><div className="name-row" key={i}><input value={n} placeholder={`Interviewer ${i+1}`} onChange={e=>setName(i,e.target.value)}/>{i>0&&<button type="button" className="icon-btn" onClick={()=>setNames(ns=>ns.filter((_,j)=>j!==i))}>×</button>}</div>)}<button type="button" className="secondary" onClick={()=>setNames(ns=>[...ns,''])}>+ Add interviewer</button></div><label className="wide">Remark<textarea rows="3" value={remarks} onChange={e=>setRemarks(e.target.value)}/></label><button className="wide" disabled={busy}>{busy?'Saving…':'Save interview result'}</button></form></section>
}

function CandidateDrawer({id,token,user,phases,onClose,onChanged}){
  const [data,setData]=useState(null),[error,setError]=useState('');
  async function load(){setError('');try{setData(await api(`/candidates/${id}`,{token}))}catch(e){setError(e.message)}}
  useEffect(()=>{load()},[id]);
  if(error)return <div className="overlay"><aside className="drawer"><button className="close" onClick={onClose}>×</button><ErrorBox message={error} onRetry={load}/></aside></div>;
  if(!data)return <div className="overlay"><aside className="drawer"><button className="close" onClick={onClose}>×</button><Loading label="Loading candidate…"/></aside></div>;
  const c=data.candidate;
  async function archive(){if(!confirm(`Archive ${c.name}?`))return;try{await api(`/candidates/${id}`,{method:'DELETE',token});await load();onChanged()}catch(e){setError(e.message)}}
  async function restore(){try{await api(`/candidates/${id}/restore`,{method:'POST',token});await load();onChanged()}catch(e){setError(e.message)}}
  return <div className="overlay" onClick={e=>e.target===e.currentTarget&&onClose()}><aside className="drawer"><button className="close" onClick={onClose}>×</button><div className="drawer-head"><div><div className="eyebrow">CANDIDATE PROFILE</div><h1>{c.name}</h1><div className="muted">{c.registration_number||'No registration'} · {c.branch||'No branch'}</div></div><span className={`status-pill ${c.deleted_at?'absent':''}`}>{c.deleted_at?'ARCHIVED':c.status}</span></div>
    <section className="section"><div className="section-head"><h2>Personal details</h2></div><PersonalDetails candidate={c} token={token} user={user} onChanged={async()=>{await load();onChanged()}}/></section>
    <WrittenSection data={data} token={token} user={user} onChanged={async()=>{await load();onChanged()}}/>
    <section className="section"><div className="section-head"><div><h2>Interview history</h2><p className="muted">Recruitment Interview → Taskphase rounds.</p></div></div>{data.interviews.length?data.interviews.map(r=>{let names=[];try{names=Array.isArray(r.interviewer_names)?r.interviewer_names:JSON.parse(r.interviewer_names||'[]')}catch{}return <div className="history" key={r.id}><div className="history-top"><b>{r.phase_name}</b><span className={`status-pill ${String(r.attendance).toLowerCase()}`}>{r.attendance}</span></div><div className="muted">{r.interview_date||'No date'} · {names.filter(Boolean).join(', ')||'No interviewer names'}</div><p>{r.remarks||'No remark.'}</p></div>}):<div className="empty">No interview results yet.</div>}</section>
    <InterviewForm token={token} candidateId={id} phases={phases} existingInterviews={data.interviews} onChanged={async()=>{await load();onChanged()}} user={user}/>
    <section className="section"><div className="section-head"><div><h2>Timeline</h2><p className="muted">Audit trail.</p></div></div>{data.audit.length?data.audit.map(x=><div className="timeline" key={x.id}><b>{x.action}</b><span>{new Date(x.created_at).toLocaleString()}</span><small>{x.user_name||'System'} · {x.field_name||x.object_type}</small></div>):<div className="empty">No audit history.</div>}</section>
    {user.role==='ADMIN'&&<section className="section danger-zone"><div className="section-head"><h2>Candidate controls</h2></div>{c.deleted_at?<button className="secondary" onClick={restore}>Restore candidate</button>:<button className="danger" onClick={archive}>Archive candidate</button>}</section>}
  </aside></div>
}

function Candidates({token,user,onOpen,refreshKey,phases=[]}){
  const [q,setQ]=useState(''),[status,setStatus]=useState('ALL'),[branch,setBranch]=useState(''),[writtenAttendance,setWrittenAttendance]=useState(''),[phaseId,setPhaseId]=useState(''),[includeDeleted,setIncludeDeleted]=useState(false),[rows,setRows]=useState([]),[meta,setMeta]=useState({total:0,branches:[],phases:[]}),[selected,setSelected]=useState([]),[loading,setLoading]=useState(true),[error,setError]=useState(''),[showAdd,setShowAdd]=useState(false),[bulkBusy,setBulkBusy]=useState(false),[bulkMessage,setBulkMessage]=useState('');
  const canEdit=user.role==='ADMIN'||user.role==='TEST_CHECKER';
  function query(){const p=new URLSearchParams({q,page:1,pageSize:250,includeDeleted});if(status!=='ALL')p.set('status',status);if(branch)p.set('branch',branch);if(writtenAttendance)p.set('writtenAttendance',writtenAttendance);if(phaseId)p.set('phaseId',phaseId);return p}
  async function load(){setLoading(true);setError('');try{const x=await api(`/candidates?${query()}`,{token});setRows(x.data);setMeta(x)}catch(e){setError(e.message)}finally{setLoading(false)}}
  useEffect(()=>{load();setSelected([])},[q,status,branch,writtenAttendance,phaseId,includeDeleted,refreshKey]);
  function toggle(id){setSelected(s=>s.includes(id)?s.filter(x=>x!==id):[...s,id])}
  function togglePage(){const ids=rows.map(r=>r.id);const all=ids.length>0&&ids.every(id=>selected.includes(id));setSelected(s=>all?s.filter(id=>!ids.includes(id)):[...new Set([...s,...ids])])}
  async function selectAllMatching(){setBulkMessage('Loading all matching candidates…');const out=[];let page=1;while(out.length<meta.total&&page<=20){const p=query();p.set('page',page);const x=await api(`/candidates?${p}`,{token});out.push(...x.data.map(r=>r.id));if(!x.data.length)break;page+=1}setSelected(out.slice(0,meta.total));setBulkMessage(`${Math.min(out.length,meta.total)} candidates selected`)}
  async function archiveSelected(){if(!selected.length)return;if(!confirm(`Archive ${selected.length} candidates?`))return;setBulkBusy(true);setBulkMessage('');try{const x=await api('/candidates/bulk-archive',{method:'POST',token,body:{ids:selected}});setSelected([]);setBulkMessage(`${x.archived} archived`);await load()}catch(e){setBulkMessage(e.message)}finally{setBulkBusy(false)}}
  async function markUnmarkedAbsent(){if(!confirm('Mark every currently unmarked written-test candidate matching these filters as ABSENT?'))return;setBulkBusy(true);setBulkMessage('');try{const x=await api('/written-tests/bulk-mark-absent',{method:'POST',token,body:{q,status,branch,phaseId:Number(phaseId)||0}});setBulkMessage(`${x.marked} candidate(s) marked absent`);setSelected([]);await load()}catch(e){setBulkMessage(e.message)}finally{setBulkBusy(false)}}
  async function exportCsv(){
    const p=new URLSearchParams();
    if(q)p.set('q',q);
    if(status!=='ALL')p.set('status',status);
    if(branch)p.set('branch',branch);
    if(writtenAttendance)p.set('writtenAttendance',writtenAttendance);
    if(phaseId)p.set('phaseId',phaseId);
    p.set('includeDeleted',includeDeleted);
    const data=await api(`/reports/candidates?${p}`,{token});
    const keys=['name','learner_id','registration_number','email','phone','branch','attendance','status'];
    const csv=[keys.join(','),...data.map(r=>keys.map(k=>`\"${String(r[k]??'').replaceAll('\"','\"\"')}\"`).join(','))].join('\n');
    const a=document.createElement('a');a.href=URL.createObjectURL(new Blob([csv],{type:'text/csv'}));a.download='recruitment-candidates.csv';a.click();
  }
  const allShown=rows.length>0&&rows.every(r=>selected.includes(r.id));
  return <div>
    {showAdd&&<AddCandidate token={token} onClose={()=>setShowAdd(false)} onCreated={()=>{setShowAdd(false);load()}}/>}
    <div className="page-title"><div><div className="eyebrow">SEARCHABLE DATABASE</div><h1>Candidates</h1><p className="muted">Search names, IDs, registration numbers, phone, email and branch.</p></div><div className="title-actions">{user.role==='ADMIN'&&<button onClick={()=>setShowAdd(true)}>+ Add candidate</button>}<button className="secondary" onClick={load}>Refresh</button></div></div>
    <section className="panel search-panel"><div className="search-row"><input className="search" value={q} onChange={e=>setQ(e.target.value)} placeholder="Search candidate…"/><button className="secondary" onClick={()=>{setQ('');setStatus('ALL');setBranch('');setWrittenAttendance('');setPhaseId('');setIncludeDeleted(false)}}>Clear</button></div><div className="filter-row"><select value={status} onChange={e=>setStatus(e.target.value)}><option value="ALL">All statuses</option>{STATUSES.filter(x=>x!=='ALL').map(s=><option key={s}>{s}</option>)}</select><select value={branch} onChange={e=>setBranch(e.target.value)}><option value="">All branches</option>{meta.branches.map(b=><option key={b}>{b}</option>)}</select><select value={writtenAttendance} onChange={e=>setWrittenAttendance(e.target.value)}><option value="">Written attendance: all</option><option value="UNMARKED">Written: not marked</option><option value="PRESENT">Written: present</option><option value="ABSENT">Written: absent</option></select><select value={phaseId} onChange={e=>setPhaseId(e.target.value)}><option value="">All interview phases</option>{phases.map(p=><option key={p.id} value={p.id}>{p.name}</option>)}</select><label className="check"><input type="checkbox" checked={includeDeleted} onChange={e=>setIncludeDeleted(e.target.checked)}/> Show archived</label></div></section>
    <div className="quick-row"><button className={writtenAttendance==='UNMARKED'?'chip active':'chip'} onClick={()=>setWrittenAttendance(writtenAttendance==='UNMARKED'?'':'UNMARKED')}>Needs written attendance</button><button className={status==='ABSENT FOR WRITTEN'?'chip active':'chip'} onClick={()=>setStatus(status==='ABSENT FOR WRITTEN'?'ALL':'ABSENT FOR WRITTEN')}>Written absent</button><button className={status==='WRITTEN CLEARED'?'chip active':'chip'} onClick={()=>setStatus(status==='WRITTEN CLEARED'?'ALL':'WRITTEN CLEARED')}>Written cleared</button><button className="chip" onClick={markUnmarkedAbsent} disabled={bulkBusy||!canEdit}>Mark unmarked as absent</button></div>
    {bulkMessage&&<div className="notice">{bulkMessage}</div>}{error&&<ErrorBox message={error} onRetry={load}/>} 
    {selected.length>0&&<div className="bulkbar"><div><b>{selected.length}</b> selected {selected.length<meta.total&&<button className="link-btn" onClick={selectAllMatching}>Select all {meta.total} matching</button>}</div>{user.role==='ADMIN'&&<button className="danger" disabled={bulkBusy} onClick={archiveSelected}>{bulkBusy?'Working…':'Archive selected'}</button>}</div>}
    <div className="table-wrap"><table><thead><tr><th className="checkbox-col"><input type="checkbox" checked={allShown} onChange={togglePage} aria-label="Select all shown"/></th><th>Candidate</th><th>Learner ID</th><th>Reg no.</th><th>Phone</th><th>Branch</th><th>Written</th><th>Status</th></tr></thead><tbody>{loading?<tr><td colSpan="8"><Loading label="Loading candidates…"/></td></tr>:rows.length?rows.map(r=><tr key={r.id} className={r.deleted_at?'archived':''} onClick={()=>onOpen(r.id)}><td className="checkbox-col" onClick={e=>e.stopPropagation()}><input type="checkbox" checked={selected.includes(r.id)} onChange={()=>toggle(r.id)}/></td><td><b>{r.name}</b><small>{r.email||'No personal email'}</small></td><td>{r.learner_id||'—'}</td><td>{r.registration_number||'—'}</td><td>{r.phone||'—'}</td><td>{r.branch||'—'}</td><td><span className={`status-pill ${String(r.attendance||'UNKNOWN').toLowerCase()}`}>{r.attendance==='UNKNOWN'?'Not marked':r.attendance}</span></td><td>{r.deleted_at?'Archived':r.status}</td></tr>):<tr><td colSpan="8"><div className="empty">No candidates match these filters.</div></td></tr>}</tbody></table><div className="table-foot">{meta.total} matching candidate(s)</div></div>
    <div className="footer-actions"><button className="secondary" onClick={exportCsv}>Export filtered list</button><span className="muted">Archive removes candidates from the normal working list without deleting their history.</span></div>
  </div>
}

function PhaseManager({token,phases,onChanged}){
  const [name,setName]=useState(''),[type,setType]=useState('TASKPHASE'),[error,setError]=useState('');
  async function add(){if(!name.trim())return;setError('');try{await api('/interview-phases',{method:'POST',token,body:{name:name.trim(),phaseType:type}});setName('');onChanged()}catch(e){setError(e.message)}}
  return <section className="panel"><div className="section-head"><div><div className="eyebrow">PIPELINE</div><h2>Interview phases</h2><p className="muted">Keep Recruitment Interview first, then add as many Taskphase rounds as needed.</p></div></div>{error&&<div className="error-box">{error}</div>}<div className="phase-add"><input value={name} onChange={e=>setName(e.target.value)} placeholder="e.g. Taskphase 3"/><select value={type} onChange={e=>setType(e.target.value)}><option value="REC_INTERVIEW">Recruitment Interview</option><option value="TASKPHASE">Taskphase</option></select><button onClick={add}>Add phase</button></div>{phases.map(p=><div className="phase-row" key={p.id}><div><b>{p.phase_order}. {p.name}</b><span>{p.phase_type}</span></div><div>{p.records||0} records</div></div>)}</section>
}
function Admin({token,phases,onChanged}){
  const [year,setYear]=useState(new Date().getFullYear()),[name,setName]=useState('ThrustMIT Recruitment'),[message,setMessage]=useState('');
  async function create(){setMessage('');try{await api('/campaigns',{method:'POST',token,body:{name,recruitmentYear:Number(year),writtenMaxMarks:20,writtenQualifiedCount:150}});setMessage('Campaign created and activated.');onChanged()}catch(e){setMessage(e.message)}}
  return <div><div className="page-title"><div><div className="eyebrow">ADMIN</div><h1>System setup</h1><p className="muted">Recruitment years, interview phases and operational controls.</p></div></div><section className="panel"><div className="section-head"><div><h2>Recruitment campaign</h2><p className="muted">Keep candidate data separated by recruitment year.</p></div></div><div className="phase-add"><input value={name} onChange={e=>setName(e.target.value)}/><input type="number" value={year} onChange={e=>setYear(e.target.value)}/><button onClick={create}>Add campaign</button></div>{message&&<div className="success">{message}</div>}</section><PhaseManager token={token} phases={phases} onChanged={onChanged}/><section className="panel"><div className="section-head"><div><h2>Operational notes</h2><p className="muted">V5 keeps the database as the source of truth. Use Add candidate for individual records and bulk import for larger batches.</p></div></div><div className="note-grid"><div><b>Written attendance</b><span>Use “Mark unmarked as absent” after reconciling the slot sheet.</span></div><div><b>Archive</b><span>Removes a person from the normal working list but preserves history and allows restore.</span></div><div><b>Search</b><span>Filter by status, branch, written attendance and interview phase, then select in bulk.</span></div></div></section></div>
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
  return <div className="app"><nav className="sidebar"><div className="brand"><span className="brand-mark">T</span><div><b>Recruitment</b><small>ThrustMIT</small></div></div><div className="nav-group"><button className={page==='dashboard'?'nav-active':''} onClick={()=>setPage('dashboard')}>Dashboard</button><button className={page==='candidates'?'nav-active':''} onClick={()=>setPage('candidates')}>Candidates</button>{user.role==='ADMIN'&&<button className={page==='admin'?'nav-active':''} onClick={()=>setPage('admin')}>Admin</button>}</div><div className="sidebar-bottom"><ThemeToggle/><div className="user-block"><b>{user.name}</b><span>{user.role.replace('_',' ')}</span></div><button className="signout" onClick={logout}>Sign out</button></div></nav><main className="content">{page==='dashboard'?<Dashboard token={token} refreshKey={refresh}/>:page==='candidates'?<Candidates token={token} user={user} phases={phases} onOpen={setCandidateId} refreshKey={refresh}/>:<Admin token={token} phases={phases} onChanged={onChanged}/>}</main>{candidateId&&<CandidateDrawer id={candidateId} token={token} user={user} phases={phases} onClose={()=>setCandidateId(null)} onChanged={onChanged}/>}</div>
}


class AppErrorBoundary extends React.Component {
  constructor(props){super(props);this.state={hasError:false,error:null}}
  static getDerivedStateFromError(error){return {hasError:true,error}}
  componentDidCatch(error,info){console.error('Recruitment UI error',error,info)}
  render(){
    if(this.state.hasError){
      return <div className="error-page"><div className="error-card"><div className="eyebrow">RECRUITMENT</div><h1>Something went wrong</h1><p className="muted">The page hit an unexpected error. Refresh to continue.</p><pre className="error-detail">{String(this.state.error?.message||this.state.error||'Unknown error')}</pre><button onClick={()=>location.reload()}>Refresh</button></div></div>
    }
    return this.props.children
  }
}

createRoot(document.getElementById('root')).render(<AppErrorBoundary><App/></AppErrorBoundary>);
