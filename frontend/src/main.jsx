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
function Info({label,value}){return <div className="info-card"><span>{label}</span><b>{value??'—'}</b></div>}
function ErrorBox({message,onRetry}){return <div className="error-box"><b>Couldn’t load this section</b><span>{message}</span>{onRetry&&<button className="secondary" onClick={onRetry}>Retry</button>}</div>}
function Loading({label='Loading…'}){return <div className="loading"><span className="spinner"/> {label}</div>}
function Modal({title,onClose,children,wide=false}){return <div className="modal-backdrop" onMouseDown={e=>e.target===e.currentTarget&&onClose()}><div className={`modal ${wide?'modal-wide':''}`}><div className="modal-head"><div><div className="eyebrow">RECRUITMENT</div><h2>{title}</h2></div><button className="icon-btn" onClick={onClose}>×</button></div>{children}</div></div>}

function Login({onLogin}){
  const [email,setEmail]=useState('admin@example.com'),[password,setPassword]=useState('ChangeMe123!'),[error,setError]=useState(''),[busy,setBusy]=useState(false);
  async function submit(e){e.preventDefault();setBusy(true);setError('');try{const x=await api('/auth/login',{method:'POST',body:{email,password}});localStorage.setItem('token',x.token);onLogin(x.user)}catch(e){setError(e.message)}finally{setBusy(false)}}
  return <div className="login"><div className="login-card"><div className="login-header"><div><div className="eyebrow">THRUSTMIT</div><h1>Recruitment</h1></div><ThemeToggle/></div><p className="muted">A single source of truth for the entire recruitment cycle.</p><form onSubmit={submit} className="stack"><label>Email<input value={email} onChange={e=>setEmail(e.target.value)} autoComplete="username"/></label><label>Password<input value={password} onChange={e=>setPassword(e.target.value)} type="password" autoComplete="current-password"/></label>{error&&<div className="error-box"><span>{error}</span></div>}<button disabled={busy}>{busy?'Signing in…':'Sign in'}</button></form></div></div>
}

function Dashboard({token,refreshKey,onNavigate,user}){
  async function downloadWrittenQualified(){
    const apiBase=import.meta.env.VITE_API_BASE_URL||'http://localhost:4000/api';
    const res=await fetch(`${apiBase}/written/export`,{headers:{Authorization:`Bearer ${token}`}});
    if(!res.ok){const d=await res.json().catch(()=>({}));throw new Error(d.error||`Export failed (${res.status})`)}
    const blob=await res.blob(); const href=URL.createObjectURL(blob); const a=document.createElement('a'); a.href=href; a.download='written-qualified-candidates.xlsx'; document.body.appendChild(a); a.click(); a.remove(); URL.revokeObjectURL(href);
  }
  const [data,setData]=useState(null),[attention,setAttention]=useState(null),[whatIf,setWhatIf]=useState(null),[health,setHealth]=useState(null),[topN,setTopN]=useState(150),[error,setError]=useState(''),[busy,setBusy]=useState(false),[actionMessage,setActionMessage]=useState('');
  const chart=ChartTheme();
  async function load(){
    setError('');
    try{
      const apiBase=import.meta.env.VITE_API_BASE_URL||'http://localhost:4000/api';
      const [d,a,w,h,dh]=await Promise.all([
        api('/dashboard',{token}),
        api('/needs-attention',{token}),
        api(`/written/what-if?topN=${Math.max(1,Number(topN)||150)}`,{token}),
        fetch(`${apiBase}/health`).then(r=>r.json()).catch(()=>({ok:false})),
        api('/data-health',{token})
      ]);
      setData(d); setAttention(a); setWhatIf(w); setHealth(h); setHealthDetails(dh);
    }catch(e){setError(e.message)}
  }
  const [healthDetails,setHealthDetails]=useState(null);
  useEffect(()=>{const t=setTimeout(load,180);return()=>clearTimeout(t)},[topN,refreshKey]);
  async function finalize(){
    const required=Number(data?.campaign?.written_qualified_count||150), scored=Number(data?.stats?.written_scored||0);
    if(scored<required){setActionMessage(`Cannot finalize yet: ${scored} valid written scores are recorded; ${required} are required.`);return}
    if(!confirm(`Finalize the written round for the top ${required} candidates? This locks written marks and attendance until an admin reopens it.`))return;
    setBusy(true);setActionMessage('');try{const x=await api('/written/finalize',{method:'POST',token});setActionMessage(x.recalculation?.qualificationMismatch?'Written round remains flagged for data reconciliation.':'Written round finalized successfully.');await load()}catch(e){setActionMessage(e.message)}finally{setBusy(false)}
  }
  async function reopen(){if(!confirm('Reopen the written round? Existing written qualification will be cleared until the round is finalized again.'))return;setBusy(true);setActionMessage('');try{await api('/written/reopen',{method:'POST',token});setActionMessage('Written round reopened.');await load()}catch(e){setActionMessage(e.message)}finally{setBusy(false)}}
  if(error&&!data)return <ErrorBox message={error} onRetry={load}/>;
  if(!data)return <Loading label="Loading dashboard…"/>;
  const funnel=[
    {name:'Applied',v:Number(data.stats.applications||0)},
    {name:'Present',v:Number(data.stats.appeared||0)},
    {name:'Scored',v:Number(data.stats.written_scored||0)},
    {name:'Cleared',v:Number(data.stats.written_qualified||0)},
    {name:'1st interview',v:Number(data.stats.first_interview||0)},
    {name:'Taskphase',v:Number(data.stats.taskphase||0)},
    {name:'Selected',v:Number(data.stats.selected||0)}
  ];
  const sets=(data.written?.sets||[]).map(x=>({...x,set:`Set ${x.set_number}`}));
  const branches=data.branchStats||[];
  const finalized=Boolean(data.campaign?.written_finalized);
  const scored=Number(data.stats.written_scored||0);
  const required=Number(data.campaign?.written_qualified_count||150);
  const cleared=Number(data.stats.written_qualified||0);
  const readyToFinalize=!finalized && scored>=required;
  const mismatch=Boolean(healthDetails?.qualificationMismatch);
  const unmarked=Number(data.stats.unmarked||0);
  const markMissing=Number(attention?.missingWrittenMarks||0);
  const branchMissing=Number(healthDetails?.missingBranch||0);
  const phaseCards=(data.phases||[]).filter(p=>Number(p.active)!==0);
  return <div>
    <div className="page-title"><div><div className="eyebrow">LIVE OVERVIEW</div><h1>Dashboard</h1><p className="muted">{data.campaign?.name||'Recruitment'} · {data.campaign?.recruitment_year||''} <span className={`health-dot ${health?.ok?'online':'offline'}`}>● {health?.ok?'Database online':'Database unavailable'}</span></p></div><div className="title-actions"><button className="secondary" onClick={async()=>{try{await downloadWrittenQualified()}catch(e){alert(e.message)}}}>Download written results</button><button className="secondary" onClick={load}>Refresh</button></div></div>
    {actionMessage&&<div className={/Cannot|error|failed|reconciliation/i.test(actionMessage)?'error-box':'success'}><span>{actionMessage}</span></div>}
    {mismatch&&<div className="error-box"><b>Written data needs reconciliation.</b><span>{cleared} candidates are marked qualified, but only {scored} valid written scores are currently present in the active campaign. No qualification data was automatically deleted.</span></div>}
    <div className="stats">
      <Stat label="Applications" value={data.stats.applications}/>
      <Stat label="Written present" value={data.stats.appeared}/>
      <Stat label="Written absent" value={data.stats.absent}/>
      <Stat label="Written unmarked" value={unmarked}/>
      <Stat label="Marks entered" value={scored} sub={`${Math.max(0,Number(data.stats.appeared||0)-scored)} present candidates still need marks`}/>
      <Stat label="Written cleared" value={cleared} sub={`${cleared} of ${scored} scored`}/>
      <Stat label="Taskphase" value={data.stats.taskphase}/>
      <Stat label="Selected" value={data.stats.selected}/>
    </div>
    <section className="panel finalize-panel"><div><div className="eyebrow">WRITTEN ROUND CONTROL</div><h2>{finalized?'Written round finalized':'Written round in progress'}</h2><p className="muted">{finalized?`Official qualification is ${cleared} of ${scored} scored candidates.`:`${scored} valid scores entered · ${required} required before finalization.`}</p></div><div className="title-actions">{user?.role==='ADMIN'&&finalized&&<button className="secondary" disabled={busy} onClick={reopen}>Reopen written round</button>}{user?.role==='ADMIN'&&!finalized&&<button disabled={busy||!readyToFinalize} onClick={finalize}>{busy?'Working…':'Finalize written round'}</button>}</div></section>
    <div className="grid-3">
      <section className="panel chart-panel"><div className="panel-title"><h2>Recruitment funnel</h2></div><ResponsiveContainer width="100%" height={300}><BarChart data={funnel}><CartesianGrid strokeDasharray="3 3" stroke={chart.grid}/><XAxis dataKey="name" tick={{fill:chart.axis,fontSize:10}} axisLine={{stroke:chart.grid}}/><YAxis allowDecimals={false} tick={{fill:chart.axis,fontSize:11}} axisLine={{stroke:chart.grid}}/><Tooltip contentStyle={{background:chart.tooltip,border:`1px solid ${chart.grid}`,borderRadius:10,color:chart.axis}} labelStyle={{color:chart.axis}} formatter={(v)=>[v,'Candidates']}/><Bar dataKey="v" fill={chart.bar} radius={[6,6,0,0]} label={{fill:chart.axis,fontSize:10,position:'top'}}/></BarChart></ResponsiveContainer></section>
      <section className="panel chart-panel"><div className="panel-title"><h2>Written intelligence</h2><span>Cutoff {data.written?.cutoffPercentile==null?'—':Number(data.written.cutoffPercentile).toFixed(2)}</span></div>{sets.length?<ResponsiveContainer width="100%" height={300}><BarChart data={sets}><CartesianGrid strokeDasharray="3 3" stroke={chart.grid}/><XAxis dataKey="set" tick={{fill:chart.axis,fontSize:11}} axisLine={{stroke:chart.grid}}/><YAxis allowDecimals={false} tick={{fill:chart.axis,fontSize:11}} axisLine={{stroke:chart.grid}}/><Tooltip contentStyle={{background:chart.tooltip,border:`1px solid ${chart.grid}`,borderRadius:10,color:chart.axis}} labelStyle={{color:chart.axis}} formatter={(v,n)=>[v,n==='scored'?'Scored':'Candidates']}/><Bar dataKey="scored" fill={chart.bar2} radius={[6,6,0,0]} label={{fill:chart.axis,fontSize:10,position:'top'}}/></BarChart></ResponsiveContainer>:<div className="empty">No written marks have been entered yet.</div>}</section>
      <section className="panel chart-panel"><div className="panel-title"><h2>By branch</h2><span>Top 8</span></div>{branches.length&&!(branches.length===1&&String(branches[0].branch)==='Unspecified')?<ResponsiveContainer width="100%" height={300}><BarChart data={branches} layout="vertical" margin={{left:40,right:20}}><CartesianGrid strokeDasharray="3 3" stroke={chart.grid}/><XAxis type="number" allowDecimals={false} tick={{fill:chart.axis,fontSize:11}} axisLine={{stroke:chart.grid}}/><YAxis type="category" dataKey="branch" width={110} tick={{fill:chart.axis,fontSize:11}} axisLine={{stroke:chart.grid}}/><Tooltip contentStyle={{background:chart.tooltip,border:`1px solid ${chart.grid}`,borderRadius:10,color:chart.axis}} labelStyle={{color:chart.axis}}/><Bar dataKey="count" fill={chart.bar} radius={[0,6,6,0]}/></BarChart></ResponsiveContainer>:<div className="empty">Branch data is missing for the current campaign. Add branch details to candidates to populate this chart.</div>}</section>
    </div>
    <section className="panel"><div className="section-head"><div><div className="eyebrow">NEEDS ATTENTION</div><h2>What still needs work</h2></div><button className="secondary" onClick={load}>Refresh</button></div><div className="attention-grid"><button className={`attention-card ${unmarked?'attention-hot':''}`} onClick={()=>onNavigate({writtenAttendance:'UNMARKED'})}><span>Written unmarked</span><b>{unmarked}</b><small>Open list</small></button><button className={`attention-card ${markMissing?'attention-hot':''}`} onClick={()=>onNavigate({needsWrittenMarks:true})}><span>Marks missing</span><b>{markMissing}</b><small>Present but not scored</small></button><button className={`attention-card ${attention?.interviewsMissingRemarks?'attention-hot':''}`} onClick={()=>onNavigate({needsInterviewRemark:true})}><span>Interview remarks missing</span><b>{attention?.interviewsMissingRemarks||0}</b><small>Present interviews only</small></button><button className="attention-card"><span>Written absent</span><b>{data.stats.absent}</b><small>Informational</small></button></div></section>
    <section className="panel"><div className="section-head"><div><div className="eyebrow">DATA HEALTH</div><h2>Integrity checks</h2><p className="muted">These are read-only checks; no records are changed automatically.</p></div></div><div className="info-grid"><Info label="Total candidates" value={healthDetails?.total}/><Info label="Marks entered" value={healthDetails?.marksEntered}/><Info label="Qualified records" value={healthDetails?.qualified}/><Info label="Qualified without valid score" value={healthDetails?.qualifiedWithoutValidScore}/><Info label="Absent with written data" value={healthDetails?.absentWithWrittenData}/><Info label="Missing branch" value={branchMissing}/><Info label="Duplicate registrations" value={healthDetails?.duplicateRegistrations}/><Info label="Written finalization" value={healthDetails?.finalized?'Finalized':'In progress'}/></div></section>
    {whatIf&&<section className="panel"><div className="section-head"><div><div className="eyebrow">WHAT-IF CUTOFF</div><h2>Selection simulator</h2><p className="muted">Preview a top-N cutoff without changing the real result.</p></div></div><div className="phase-add"><label>Top candidates<input type="number" min="1" max="9999" value={topN} onChange={e=>setTopN(e.target.value)}/></label><div className="metrics"><Info label="Scored pool" value={whatIf.totalScored}/><Info label="Selected in preview" value={whatIf.selected}/><Info label="Cutoff percentile" value={whatIf.cutoffPercentile==null?'—':Number(whatIf.cutoffPercentile).toFixed(2)}/><Info label="Cutoff marks" value={whatIf.cutoffMarks==null?'—':`${whatIf.cutoffMarks}/20`}/></div></div></section>}
    <section className="panel"><div className="section-head"><div><div className="eyebrow">ACTIVE PHASES</div><h2>Recruitment pipeline</h2></div></div>{phaseCards.length?<div className="phase-grid">{phaseCards.map(p=><div className="note-grid" key={p.id}><div><b>{p.phase_order}. {p.name}</b><span>{p.records||0} result records · Present {p.present||0} · Absent {p.absent||0}</span></div></div>)}</div>:<div className="empty">No active interview phases.</div>}</section>
  </div>
}

function Candidates({token,user,onOpen,refreshKey,phases=[],filterIntent}){
  const [q,setQ]=useState(''),[status,setStatus]=useState('ALL'),[branch,setBranch]=useState(''),[writtenAttendance,setWrittenAttendance]=useState(''),[phaseId,setPhaseId]=useState(''),[needsWrittenMarks,setNeedsWrittenMarks]=useState(false),[needsInterviewRemark,setNeedsInterviewRemark]=useState(false),[includeDeleted,setIncludeDeleted]=useState(false),[page,setPage]=useState(1),[rows,setRows]=useState([]),[meta,setMeta]=useState({total:0,totalPages:1,branches:[]}),[selected,setSelected]=useState([]),[loading,setLoading]=useState(true),[error,setError]=useState(''),[showAdd,setShowAdd]=useState(false),[bulkBusy,setBulkBusy]=useState(false),[bulkMessage,setBulkMessage]=useState('');
  const canEdit=user.role==='ADMIN'||user.role==='TEST_CHECKER';
  const pageSize=50;
  function query(pageNo=page){const p=new URLSearchParams({q,page:pageNo,pageSize,includeDeleted});if(status!=='ALL')p.set('status',status);if(branch)p.set('branch',branch);if(writtenAttendance)p.set('writtenAttendance',writtenAttendance);if(phaseId)p.set('phaseId',phaseId);if(needsWrittenMarks)p.set('needsWrittenMarks','true');if(needsInterviewRemark)p.set('needsInterviewRemark','true');return p}
  async function load(pageNo=page){setLoading(true);setError('');try{const x=await api(`/candidates?${query(pageNo)}`,{token});setRows(x.data);setMeta(x);setPage(x.page)}catch(e){setError(e.message)}finally{setLoading(false)}}
  useEffect(()=>{setPage(1);setSelected([]);load(1)},[q,status,branch,writtenAttendance,phaseId,needsWrittenMarks,needsInterviewRemark,includeDeleted,refreshKey]);
  useEffect(()=>{if(!filterIntent)return;setQ(filterIntent.q||'');setStatus(filterIntent.status||'ALL');setBranch(filterIntent.branch||'');setWrittenAttendance(filterIntent.writtenAttendance||'');setPhaseId(filterIntent.phaseId||'');setNeedsWrittenMarks(Boolean(filterIntent.needsWrittenMarks));setNeedsInterviewRemark(Boolean(filterIntent.needsInterviewRemark));setIncludeDeleted(Boolean(filterIntent.includeDeleted));setPage(1);setSelected([])},[filterIntent]);
  function toggle(id){setSelected(s=>s.includes(id)?s.filter(x=>x!==id):[...s,id])}
  function togglePage(){const ids=rows.map(r=>r.id);const all=ids.length>0&&ids.every(id=>selected.includes(id));setSelected(s=>all?s.filter(id=>!ids.includes(id)):[...new Set([...s,...ids])])}
  async function selectAllMatching(){setBulkMessage('Loading all matching candidates…');const out=[];const totalPages=meta.totalPages||Math.ceil(meta.total/pageSize);for(let p=1;p<=totalPages;p++){const x=await api(`/candidates?${query(p)}`,{token});out.push(...x.data.map(r=>r.id));if(!x.data.length)break}setSelected(out);setBulkMessage(`${out.length} candidates selected`)}
  async function archiveSelected(){if(!selected.length)return;if(!confirm(`Archive ${selected.length} candidates? Their history will be preserved.`))return;setBulkBusy(true);setBulkMessage('');try{const x=await api('/candidates/bulk-archive',{method:'POST',token,body:{ids:selected}});setSelected([]);setBulkMessage(`${x.archived} archived`);await load(page)}catch(e){setBulkMessage(e.message)}finally{setBulkBusy(false)}}
  async function markUnmarkedAbsent(){try{const p=query(1);p.set('writtenAttendance','UNMARKED');p.set('needsWrittenMarks','false');p.set('needsInterviewRemark','false');const count=await api(`/candidates?${p}`,{token});const total=count.total||0;if(!total){setBulkMessage('No unmarked candidates match the current filters.');return}if(!confirm(`Mark all ${total} currently unmarked candidates matching these filters as ABSENT? Already-marked candidates will not be changed.`))return;setBulkBusy(true);setBulkMessage('Marking candidates absent…');const x=await api('/written-tests/bulk-mark-absent',{method:'POST',token,body:{q,status,branch,phaseId:Number(phaseId)||0}});setBulkMessage(`${x.marked} candidate(s) marked absent`);setSelected([]);await load(1)}catch(e){setBulkMessage(e.message)}finally{setBulkBusy(false)}}
  async function exportCsv(){const p=query(1);p.set('page','1');p.delete('pageSize');const data=await api(`/reports/candidates?${p}`,{token});const keys=['name','learner_id','registration_number','email','phone','branch','attendance','status'];const csv=[keys.join(','),...data.map(r=>keys.map(k=>`"${String(r[k]??'').replaceAll('"','""')}"`).join(','))].join('\n');const a=document.createElement('a');a.href=URL.createObjectURL(new Blob([csv],{type:'text/csv'}));a.download='recruitment-candidates.csv';a.click()}
  function clear(){setQ('');setStatus('ALL');setBranch('');setWrittenAttendance('');setPhaseId('');setNeedsWrittenMarks(false);setNeedsInterviewRemark(false);setIncludeDeleted(false);setPage(1)}
  const allShown=rows.length>0&&rows.every(r=>selected.includes(r.id));
  return <div>
    {showAdd&&<AddCandidate token={token} onClose={()=>setShowAdd(false)} onCreated={()=>{setShowAdd(false);load(1)}}/>}
    <div className="page-title"><div><div className="eyebrow">SEARCHABLE DATABASE</div><h1>Candidates</h1><p className="muted">Search, filter, bulk-update and archive candidates without deleting history.</p></div><div className="title-actions">{user.role==='ADMIN'&&<button onClick={()=>setShowAdd(true)}>+ Add candidate</button>}<button className="secondary" onClick={()=>load(page)}>Refresh</button></div></div>
    <section className="panel search-panel"><div className="search-row"><input className="search" value={q} onChange={e=>setQ(e.target.value)} placeholder="Search name, learner ID, reg no., phone, email…"/><button className="secondary" onClick={clear}>Clear</button></div><div className="filter-row"><select value={status} onChange={e=>setStatus(e.target.value)}><option value="ALL">All statuses</option>{STATUSES.filter(x=>x!=='ALL').map(s=><option key={s}>{s}</option>)}</select><select value={branch} onChange={e=>setBranch(e.target.value)}><option value="">All branches</option>{meta.branches?.map(b=><option key={b}>{b}</option>)}</select><select value={writtenAttendance} onChange={e=>setWrittenAttendance(e.target.value)}><option value="">Written attendance: all</option><option value="UNMARKED">Written: not marked</option><option value="PRESENT">Written: present</option><option value="ABSENT">Written: absent</option></select><select value={phaseId} onChange={e=>setPhaseId(e.target.value)}><option value="">All interview phases</option>{phases.map(p=><option key={p.id} value={p.id}>{p.name}</option>)}</select></div><div className="filter-row secondary-filters"><label className="check"><input type="checkbox" checked={needsWrittenMarks} onChange={e=>setNeedsWrittenMarks(e.target.checked)}/> Needs written marks</label><label className="check"><input type="checkbox" checked={needsInterviewRemark} onChange={e=>setNeedsInterviewRemark(e.target.checked)}/> Needs interview remark</label><label className="check"><input type="checkbox" checked={includeDeleted} onChange={e=>setIncludeDeleted(e.target.checked)}/> Show archived</label></div></section>
    <div className="quick-row"><button className={writtenAttendance==='UNMARKED'?'chip active':'chip'} onClick={()=>{setWrittenAttendance(writtenAttendance==='UNMARKED'?'':'UNMARKED');setNeedsWrittenMarks(false)}}>Needs written attendance</button><button className={needsWrittenMarks?'chip active':'chip'} onClick={()=>setNeedsWrittenMarks(!needsWrittenMarks)}>Written marks missing</button><button className={needsInterviewRemark?'chip active':'chip'} onClick={()=>setNeedsInterviewRemark(!needsInterviewRemark)}>Interview remarks missing</button><button className={status==='ABSENT FOR WRITTEN'?'chip active':'chip'} onClick={()=>setStatus(status==='ABSENT FOR WRITTEN'?'ALL':'ABSENT FOR WRITTEN')}>Written absent</button><button className={status==='WRITTEN CLEARED'?'chip active':'chip'} onClick={()=>setStatus(status==='WRITTEN CLEARED'?'ALL':'WRITTEN CLEARED')}>Written cleared</button><button className="chip" onClick={markUnmarkedAbsent} disabled={bulkBusy||!canEdit}>{bulkBusy?'Working…':'Mark unmarked as absent'}</button></div>
    {bulkMessage&&<div className="notice">{bulkMessage}</div>}{error&&<ErrorBox message={error} onRetry={()=>load(page)}/>} 
    {selected.length>0&&<div className="bulkbar"><div><b>{selected.length}</b> selected {selected.length<meta.total&&<button className="link-btn" onClick={selectAllMatching}>Select all {meta.total} matching</button>}</div>{user.role==='ADMIN'&&<button className="danger" disabled={bulkBusy} onClick={archiveSelected}>{bulkBusy?'Working…':'Archive selected'}</button>}</div>}
    <div className="table-wrap"><table><thead><tr><th className="checkbox-col"><input type="checkbox" checked={allShown} onChange={togglePage} aria-label="Select all shown"/></th><th>Candidate</th><th>Learner ID</th><th>Reg no.</th><th>Phone</th><th>Branch</th><th>Written</th><th>Status</th></tr></thead><tbody>{loading?<tr><td colSpan="8"><Loading label="Loading candidates…"/></td></tr>:rows.length?rows.map(r=><tr key={r.id} className={r.deleted_at?'archived':''} onClick={()=>onOpen(r.id)}><td className="checkbox-col" onClick={e=>e.stopPropagation()}><input type="checkbox" checked={selected.includes(r.id)} onChange={()=>toggle(r.id)}/></td><td><b>{r.name}</b><small>{r.email||'No personal email'}</small></td><td>{r.learner_id||'—'}</td><td>{r.registration_number||'—'}</td><td>{r.phone||'—'}</td><td>{r.branch||'—'}</td><td><span className={`status-pill ${String(r.attendance||'UNKNOWN').toLowerCase()}`}>{r.attendance==='UNKNOWN'?'Not marked':r.attendance}</span></td><td>{r.deleted_at?'Archived':r.status}</td></tr>):<tr><td colSpan="8"><div className="empty">No candidates match these filters.</div></td></tr>}</tbody></table><div className="table-foot pagination"><span>{meta.total} matching · page {meta.page||page} of {meta.totalPages||1}</span><div className="title-actions"><button className="secondary" disabled={(meta.page||page)<=1||loading} onClick={()=>load((meta.page||page)-1)}>Previous</button><button className="secondary" disabled={(meta.page||page)>=(meta.totalPages||1)||loading} onClick={()=>load((meta.page||page)+1)}>Next</button></div></div></div>
    <div className="footer-actions"><button className="secondary" onClick={exportCsv}>Export filtered list</button><span className="muted">Archive removes candidates from the normal working list without deleting their history.</span></div>
  </div>
}
function PhaseManager({token,phases,onChanged}){
  const [name,setName]=useState(''),[type,setType]=useState('TASKPHASE'),[error,setError]=useState(''),[busy,setBusy]=useState(false);
  async function add(){if(!name.trim())return;setError('');setBusy(true);try{await api('/interview-phases',{method:'POST',token,body:{name:name.trim(),phaseType:type}});setName('');onChanged()}catch(e){setError(e.message)}finally{setBusy(false)}}
  async function toggle(p){setError('');try{await api(`/interview-phases/${p.id}`,{method:'PUT',token,body:{active:!p.active}});onChanged()}catch(e){setError(e.message)}}
  async function remove(p){if(Number(p.records||0)>0){setError('This phase already has results. Archive/deactivate it instead of deleting it.');return}if(!confirm(`Permanently delete phase "${p.name}"? It has no results.`))return;setError('');try{await api(`/interview-phases/${p.id}`,{method:'DELETE',token});onChanged()}catch(e){setError(e.message)}}
  return <section className="panel"><div className="section-head"><div><h2>Interview phases</h2><p className="muted">Deactivate phases with history; permanently delete only empty phases.</p></div></div>{error&&<ErrorBox message={error}/>}<div className="phase-add"><input value={name} onChange={e=>setName(e.target.value)} placeholder="e.g. Taskphase 3"/><select value={type} onChange={e=>setType(e.target.value)}><option value="REC_INTERVIEW">Recruitment Interview</option><option value="TASKPHASE">Taskphase</option></select><button onClick={add} disabled={busy}>Add phase</button></div>{phases.map(p=><div className="phase-row" key={p.id}><div><b>{p.phase_order}. {p.name}</b><span>{p.phase_type} · {p.records||0} records</span></div><div className="title-actions"><span className={`status-pill ${p.active?'present':'absent'}`}>{p.active?'Active':'Archived'}</span><button className="secondary" onClick={()=>toggle(p)}>{p.active?'Archive':'Restore'}</button>{Number(p.records||0)===0&&<button className="danger-btn" onClick={()=>remove(p)}>Delete</button>}</div></div>)}</section>
}

function Admin({token,phases,onChanged}){
  const [year,setYear]=useState(new Date().getFullYear()),[name,setName]=useState('ThrustMIT Recruitment'),[message,setMessage]=useState('');
  const [users,setUsers]=useState([]),[userForm,setUserForm]=useState({name:'',email:'',password:'',role:'INTERVIEWER'}),[userError,setUserError]=useState(''),[userBusy,setUserBusy]=useState(false);
  async function create(){setMessage('');try{await api('/campaigns',{method:'POST',token,body:{name,recruitmentYear:Number(year),writtenMaxMarks:20,writtenQualifiedCount:150}});setMessage('Campaign created and activated.');onChanged()}catch(e){setMessage(e.message)}}
  async function loadUsers(){try{setUsers(await api('/users',{token}))}catch(e){setUserError(e.message)}}
  useEffect(()=>{loadUsers()},[]);
  async function addUser(e){e.preventDefault();setUserBusy(true);setUserError('');try{await api('/users',{method:'POST',token,body:userForm});setUserForm({name:'',email:'',password:'',role:'INTERVIEWER'});await loadUsers()}catch(e){setUserError(e.message)}finally{setUserBusy(false)}}
  async function toggleUser(u){try{await api(`/users/${u.id}`,{method:'PUT',token,body:{active:!u.active}});await loadUsers()}catch(e){setUserError(e.message)}}
  return <div><div className="page-title"><div><div className="eyebrow">ADMIN</div><h1>System setup</h1><p className="muted">Recruitment years, interview phases, users and operational controls.</p></div></div><section className="panel"><div className="section-head"><div><h2>Recruitment campaign</h2><p className="muted">Keep candidate data separated by recruitment year.</p></div></div><div className="phase-add"><input value={name} onChange={e=>setName(e.target.value)}/><input type="number" value={year} onChange={e=>setYear(e.target.value)}/><button onClick={create}>Add campaign</button></div>{message&&<div className="success">{message}</div>}</section><PhaseManager token={token} phases={phases} onChanged={onChanged}/><section className="panel"><div className="section-head"><div><h2>User management</h2><p className="muted">Create, deactivate and review team accounts without touching the database.</p></div></div>{userError&&<ErrorBox message={userError} onRetry={loadUsers}/>}<form className="form-grid" onSubmit={addUser}><label>Name<input value={userForm.name} onChange={e=>setUserForm({...userForm,name:e.target.value})} required/></label><label>Email<input type="email" value={userForm.email} onChange={e=>setUserForm({...userForm,email:e.target.value})} required/></label><label>Password<input type="password" value={userForm.password} onChange={e=>setUserForm({...userForm,password:e.target.value})} minLength={8} required/></label><label>Role<select value={userForm.role} onChange={e=>setUserForm({...userForm,role:e.target.value})}><option value="INTERVIEWER">Interviewer</option><option value="TEST_CHECKER">Test checker</option><option value="ADMIN">Admin</option></select></label><div className="wide"><button disabled={userBusy}>{userBusy?'Creating…':'Create user'}</button></div></form><div className="user-table">{users.map(u=><div className="user-row" key={u.id}><div><b>{u.name}</b><span>{u.email}</span></div><div><span className="status-pill">{u.role}</span><button className="secondary" onClick={()=>toggleUser(u)}>{u.active?'Deactivate':'Activate'}</button></div></div>)}</div></section><section className="panel"><div className="section-head"><div><h2>Operational notes</h2><p className="muted">V6 keeps the database as the source of truth. Code/schema updates are applied automatically at backend startup.</p></div></div><div className="note-grid"><div><b>Written attendance</b><span>Use “Mark unmarked as absent” only after checking the slot sheet.</span></div><div><b>Archive</b><span>Removes a person from the normal working list but preserves history and allows restore.</span></div><div><b>Written finalization</b><span>Finalize only when at least the configured number of scores is complete. Reopen if a correction is genuinely required.</span></div></div></section></div>
}
function App(){
  const token=localStorage.getItem('token');
  const [user,setUser]=useState(null),[page,setPage]=useState('dashboard'),[candidateId,setCandidateId]=useState(null),[phases,setPhases]=useState([]),[refresh,setRefresh]=useState(0),[candidateFilter,setCandidateFilter]=useState(null);
  useEffect(()=>{if(token)api('/auth/me',{token}).then(setUser).catch(()=>{localStorage.removeItem('token');location.reload()})},[token]);
  async function loadPhases(){if(token){try{setPhases(await api('/interview-phases',{token}))}catch{setPhases([])}}}
  useEffect(()=>{loadPhases()},[token,refresh]);
  if(!user)return <Login onLogin={setUser}/>;
  function logout(){localStorage.removeItem('token');location.reload()}
  const onChanged=()=>setRefresh(x=>x+1);
  function openCandidateFilter(filters){setCandidateFilter({...filters,_ts:Date.now()});setPage('candidates')}
  return <div className="app"><nav className="sidebar"><div className="brand"><span className="brand-mark">T</span><div><b>Recruitment</b><small>ThrustMIT</small></div></div><div className="nav-group"><button className={page==='dashboard'?'nav-active':''} onClick={()=>setPage('dashboard')}>Dashboard</button><button className={page==='candidates'?'nav-active':''} onClick={()=>setPage('candidates')}>Candidates</button>{user.role==='ADMIN'&&<button className={page==='admin'?'nav-active':''} onClick={()=>setPage('admin')}>Admin</button>}</div><div className="sidebar-bottom"><ThemeToggle/><div className="user-block"><b>{user.name}</b><span>{user.role.replace('_',' ')}</span></div><button className="signout" onClick={logout}>Sign out</button></div></nav><main className="content">{page==='dashboard'?<Dashboard token={token} user={user} refreshKey={refresh} onNavigate={openCandidateFilter}/>:page==='candidates'?<Candidates token={token} user={user} phases={phases} onOpen={setCandidateId} refreshKey={refresh} filterIntent={candidateFilter}/>:<Admin token={token} phases={phases} onChanged={onChanged}/>}</main>{candidateId&&<CandidateDrawer id={candidateId} token={token} user={user} phases={phases} onClose={()=>setCandidateId(null)} onChanged={onChanged}/>}</div>
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
