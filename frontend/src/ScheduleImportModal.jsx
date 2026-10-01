import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { AlertCircle, CalendarDays, FileUp, LoaderCircle, X } from 'lucide-react';
import { tasksViewModel } from './api/viewModel.js';
import { useDialogSurface } from './useDialogSurface.js';
import { taskMonthKey } from './taskMonth.js';
import { createScheduleImportPlan, IMPORT_STATUS_OPTIONS, matchScheduleProject, prepareScheduleRows, readScheduleFile } from './scheduleImport.js';
import './scheduleImport.css';

export default function ScheduleImportModal({ currentProject, projects, source, onImport, onClose }) {
  const [projectId,setProjectId]=useState(String(projects.find(item=>String(item.id)===String(currentProject?.id))?.id||projects[0]?.id||''));
  const [parsed,setParsed]=useState(null),[campaignIndex,setCampaignIndex]=useState(0),[month,setMonth]=useState(taskMonthKey(new Date()));
  const [existing,setExisting]=useState({loading:true,items:[],error:null}),[loadRevision,setLoadRevision]=useState(0);
  const [rows,setRows]=useState([]),[selected,setSelected]=useState(new Set()),[preparing,setPreparing]=useState(false);
  const [busy,setBusy]=useState(''),[error,setError]=useState(''),[visibility,setVisibility]=useState('PROJECT_TEAM'),[page,setPage]=useState(0);
  const [progress,setProgress]=useState({done:0,total:0});
  const modalRef=useRef(null),fileRef=useRef(null),generation=useRef(0),saveLock=useRef(false),planRef=useRef(null),closeRef=useRef(null);
  const campaign=parsed?.campaigns[campaignIndex];
  const target=projects.find(project=>String(project.id)===projectId);
  closeRef.current=()=>{
    if(busy)return;
    if(planRef.current?.attempted && !window.confirm(`${planRef.current.offset}건의 저장 응답을 확인했습니다. 추가된 업무는 유지됩니다. 창을 닫고 나중에 같은 파일을 다시 불러오시겠습니까?`))return;
    generation.current++;onClose();
  };
  const close=useCallback(()=>closeRef.current?.(),[]);
  useDialogSurface(true,modalRef,close);
  useEffect(()=>()=>{generation.current++;},[]);
  useEffect(()=>{
    const controller=new AbortController();setExisting({loading:true,items:[],error:null});
    if(!projectId){setExisting({loading:false,items:[],error:Error('등록할 프로젝트를 선택해 주세요.')});return;}
    source.tasks({projectId,signal:controller.signal}).then(result=>{
      if(!controller.signal.aborted)setExisting({loading:false,items:tasksViewModel(result).items,error:null});
    }).catch(error=>{if(!controller.signal.aborted)setExisting({loading:false,items:[],error});});
    return ()=>controller.abort();
  },[source,projectId,loadRevision]);
  useEffect(()=>{
    if(!campaign || existing.loading || existing.error || planRef.current?.attempted)return;
    let alive=true;setPreparing(true);setError('');
    prepareScheduleRows(campaign,month,existing.items).then(next=>{
      if(!alive)return;setRows(next);setSelected(new Set(next.filter(row=>!row.duplicate).map(row=>row.index)));setPage(0);
    }).catch(error=>{if(alive){setRows([]);setSelected(new Set());setError(error.message);}}).finally(()=>{if(alive)setPreparing(false);});
    return ()=>{alive=false;};
  },[campaign,month,existing.items,existing.loading,existing.error]);
  const locked=Boolean(busy||planRef.current?.attempted);
  const selectedRows=useMemo(()=>rows.filter(row=>selected.has(row.index)&&!row.duplicate),[rows,selected]);
  const available=rows.filter(row=>!row.duplicate),duplicates=rows.length-available.length;
  const visibleRows=rows.slice(page*50,(page+1)*50);
  const processFile=async file=>{
    if(!file || locked)return;
    const id=++generation.current;setBusy('reading');setError('');setRows([]);setParsed(null);planRef.current=null;
    try {
      const result=await readScheduleFile(file);if(id!==generation.current)return;
      setParsed(result);setCampaignIndex(0);setMonth(result.campaigns[0].month);
      setProjectId(matchScheduleProject(result.campaigns[0],projects,projectId));
      setProgress({done:0,total:0});
    }catch(error){if(id===generation.current)setError(error.message);}
    finally{if(id===generation.current)setBusy('');}
  };
  const chooseCampaign=value=>{
    const index=Number(value),next=parsed.campaigns[index];setCampaignIndex(index);setMonth(next.month);
    setProjectId(matchScheduleProject(next,projects,projectId));
  };
  const editRow=(index,field,value)=>setRows(current=>current.map(row=>row.index===index?{...row,fields:{...row.fields,[field]:value}}:row));
  const submit=async event=>{
    event.preventDefault();if(saveLock.current||existing.loading||existing.error||preparing||!target)return;
    try{
      if(!planRef.current)planRef.current=createScheduleImportPlan({projectId,month,rows:selectedRows,visibility,lastOrder:Math.max(0,...existing.items.map(task=>Number(task.sortOrder)||0))});
      saveLock.current=true;setBusy('saving');setError('');
      await onImport(planRef.current,(done,total)=>setProgress({done,total}));
      planRef.current=null;onClose();
    }catch(error){if(!planRef.current?.attempted)planRef.current=null;setError(error.message||'업무를 저장하지 못했습니다. 다시 시도해 주세요.');}
    finally{saveLock.current=false;setBusy('');}
  };
  return <div className="modal-backdrop schedule-import-backdrop" onMouseDown={event=>{if(event.target===event.currentTarget)close();}}>
    <form ref={modalRef} className="schedule-import-modal" role="dialog" aria-modal="true" aria-labelledby="schedule-import-title" onSubmit={submit}>
      <header><div><span>HTML 일정 → 업무 일정·간트</span><h2 id="schedule-import-title">일정 불러오기</h2><p>파일의 업무명·매체·담당·날짜를 확인하고 선택한 프로젝트에 추가합니다.</p></div><button type="button" className="icon-button" data-dialog-close disabled={Boolean(busy)} onClick={close} aria-label="일정 불러오기 닫기"><X size={18}/></button></header>
      <div className="schedule-import-body">
        <div className={`schedule-import-file${parsed?' has-file':''}`} onDragOver={event=>event.preventDefault()} onDrop={event=>{event.preventDefault();void processFile(event.dataTransfer.files?.[0]);}}>
          <FileUp size={25}/><div><strong>{parsed?.fileName||'일정 HTML 파일을 놓으세요'}</strong><small>{parsed?`${parsed.total}개 업무를 읽었습니다`:'포켓 일정 보드에서 저장한 HTML · 최대 10MB'}</small></div><button type="button" className="secondary-button" disabled={locked} onClick={()=>fileRef.current?.click()}>{parsed?'다른 파일':'파일 선택'}</button>
          <input ref={fileRef} hidden type="file" accept=".html,.htm,text/html" aria-label="일정 HTML 파일" disabled={locked} onClick={event=>{event.currentTarget.value='';}} onChange={event=>void processFile(event.target.files?.[0])}/>
        </div>
        {(busy==='reading'||preparing)&&<p className="schedule-import-loading" role="status"><LoaderCircle size={16} className="spin"/>일정을 확인하고 있습니다.</p>}
        {error&&<p className="schedule-import-error" role="alert"><AlertCircle size={16}/>{error}</p>}
        <div className="schedule-import-settings">
          <label>등록할 프로젝트<select aria-label="등록할 프로젝트" value={projectId} disabled={locked} onChange={event=>setProjectId(event.target.value)}>{projects.map(project=><option key={project.id} value={project.id}>{project.clientName||project.name} · {project.name}</option>)}</select></label>
          {parsed?.campaigns.length>1&&<label>파일 내 캠페인<select value={campaignIndex} disabled={locked} onChange={event=>chooseCampaign(event.target.value)}>{parsed.campaigns.map((item,index)=><option key={index} value={index}>{item.name} · {item.rows.length}건</option>)}</select></label>}
          <label>진행 월<input type="month" aria-label="일정 진행 월" min="2000-01" max="2100-12" value={month} disabled={locked||!parsed} required onChange={event=>setMonth(event.target.value)}/></label>
          <label>고객 공개 범위<select aria-label="가져올 업무 공개 범위" value={visibility} disabled={locked} onChange={event=>setVisibility(event.target.value)}><option value="PROJECT_TEAM">고객 숨김 · 내부 관리</option><option value="CLIENT">고객 공개</option></select></label>
        </div>
        {existing.loading&&<p className="schedule-import-loading" role="status">기존 업무와 중복 여부를 확인하고 있습니다.</p>}
        {existing.error&&<div className="schedule-import-error" role="alert"><span>기존 업무를 확인하지 못했습니다. {existing.error.message}</span><button type="button" className="secondary-button" onClick={()=>setLoadRevision(value=>value+1)}>다시 시도</button></div>}
        {campaign&&<><div className="schedule-import-summary"><span><CalendarDays size={14}/>{campaign.name} · {campaign.start} ~ {campaign.end}</span><strong>{selectedRows.length}건 선택</strong>{duplicates>0&&<span>중복 {duplicates}건 제외</span>}</div>
          <p className="schedule-import-note">기존 업무는 유지하고 새 업무를 추가합니다. 빈 날짜는 채우지 않으며 일정 미정도 유지합니다. 하위 업무는 상위 업무명을 비고에 남겨 각각 등록합니다.</p>
          {rows.some(row=>row.dateAdjusted)&&<p className="schedule-import-note">시작·종료 표시가 칠해진 날짜와 다른 {rows.filter(row=>row.dateAdjusted).length}건은 실제 칠해진 날짜를 기준으로 맞춥니다.</p>}
          <div className="schedule-import-table-wrap"><table><thead><tr><th><input type="checkbox" aria-label="가져올 업무 전체 선택" disabled={locked||preparing||!available.length} checked={available.length>0&&selectedRows.length===available.length} onChange={event=>setSelected(new Set(event.target.checked?available.map(row=>row.index):[]))}/></th><th>매체</th><th>업무 · 세부내용</th><th>담당</th><th>업무 분야</th><th>상태</th><th>일정</th></tr></thead><tbody>{visibleRows.map(row=><tr key={row.index} className={row.duplicate?'is-duplicate':''}>
            <td><input type="checkbox" aria-label={`${row.fields.title} 가져오기`} disabled={locked||preparing||Boolean(row.duplicate)} checked={selected.has(row.index)&&!row.duplicate} onChange={event=>setSelected(current=>{const next=new Set(current);event.target.checked?next.add(row.index):next.delete(row.index);return next;})}/></td>
            <td>{row.media||'미지정'}</td><td><strong>{row.fields.title}</strong><small>{row.fields.description}</small>{row.parentTitle&&<small>상위 업무 · {row.parentTitle}</small>}{row.duplicate&&<em>{row.duplicate}</em>}</td>
            <td><select aria-label={`${row.fields.title} 담당`} disabled={locked||Boolean(row.duplicate)} value={row.fields.responsible_org_code} onChange={event=>editRow(row.index,'responsible_org_code',event.target.value)}><option value="POCKET">포켓</option><option value="NS">NS</option><option value="CLIENT">고객사</option></select></td>
            <td><select aria-label={`${row.fields.title} 업무 분야`} disabled={locked||Boolean(row.duplicate)} value={row.fields.workstream_code} onChange={event=>editRow(row.index,'workstream_code',event.target.value)}><option value="MARKETING">마케팅</option><option value="DESIGN">디자인</option><option value="VIDEO">영상</option></select></td>
            <td><select aria-label={`${row.fields.title} 상태`} disabled={locked||Boolean(row.duplicate)} value={row.fields.status_code} onChange={event=>editRow(row.index,'status_code',event.target.value)}>{IMPORT_STATUS_OPTIONS.map(([value,label])=><option key={value} value={value}>{label}</option>)}</select></td>
            <td>{row.dates.length?<><span>{row.dates[0]} ~ {row.dates.at(-1)}</span><small>{row.dates.length}일 선택</small></>:'일정 미정'}</td>
          </tr>)}</tbody></table></div>
          {rows.length>50&&<div className="schedule-import-pages"><button type="button" className="secondary-button" disabled={!page} onClick={()=>setPage(value=>value-1)}>이전</button><span>{page+1} / {Math.ceil(rows.length/50)}</span><button type="button" className="secondary-button" disabled={(page+1)*50>=rows.length} onClick={()=>setPage(value=>value+1)}>다음</button></div>}
        </>}
      </div>
      <footer><div>{busy==='saving'?<strong role="status">{progress.done} / {progress.total}건 저장 확인</strong>:planRef.current?.attempted?<strong>{planRef.current.offset}건 저장 확인 · 나머지 재시도 가능</strong>:<span>{target?.clientName||target?.name||'프로젝트 선택'} · {month} · {selectedRows.length}건 추가</span>}<small>{visibility==='CLIENT'?'선택한 업무를 고객에게 공개합니다.':'등록 후 업무별로 고객 공개 여부를 바꿀 수 있습니다.'}</small></div><button type="button" className="secondary-button" disabled={Boolean(busy)} onClick={close}>취소</button><button type="submit" className="primary-button" disabled={Boolean(busy)||preparing||existing.loading||Boolean(existing.error)||!target||!selectedRows.length||!month}>{busy==='saving'?<><LoaderCircle size={15} className="spin"/>저장 중</>:planRef.current?.attempted?'남은 업무 다시 저장':`${selectedRows.length}개 일정 추가`}</button></footer>
    </form>
  </div>;
}
