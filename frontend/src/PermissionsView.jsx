import { useCallback, useRef, useState } from 'react';
import './permissionsView.css';
import { X, AlertCircle, LoaderCircle, Plus, ShieldCheck, Pencil, FolderOpen, Search } from 'lucide-react';
import { ACCESS_PAGE_OPTIONS, normalizeAllowedPages, accountSubmission, removeAccessSubmission, accessProjectLabel, projectAccessDraft } from './accessPermissions.js';
import { useDialogSurface } from './useDialogSurface.js';

function AccessAccountModal({ account, projects, onClose, onSave, canDisableAccount }) {
  const initial = useRef({account:account?.account || '', displayName:account?.displayName || '', accessCode:'', enabled:account?.enabled !== false,
    ...projectAccessDraft(account, account?.accesses?.[0]?.projectId || '')});
  const [fields,setFields] = useState(initial.current);
  const [saving,setSaving] = useState(false), [error,setError] = useState(null);
  const lock=useRef(false), latest=useRef(fields), surface=useRef(null);latest.current=fields;
  const close=useCallback(()=>{
    if(lock.current)return;
    if(JSON.stringify(latest.current)!==JSON.stringify(initial.current) && !window.confirm('작성 중인 계정·권한 변경을 버리고 닫을까요?'))return;
    onClose();
  },[onClose]);
  useDialogSurface(true,surface,close);
  const selectedProject=projects.find(project=>String(project.id)===fields.projectId);
  const currentAccess=account?.accesses?.find(access=>String(access.projectId)===fields.projectId);
  const setField=(key,value)=>setFields(current=>({...current,[key]:value}));
  const selectProject=projectId=>{
    if(lock.current || projectId===fields.projectId)return;
    const saved=projectAccessDraft(account,fields.projectId);
    if(JSON.stringify(fields.allowedPages)!==JSON.stringify(saved.allowedPages) && !window.confirm('현재 프로젝트의 저장하지 않은 권한 변경을 버리고 전환할까요?'))return;
    setError(null);setFields(current=>({...current,...projectAccessDraft(account,projectId)}));
  };
  const togglePage=page=>setFields(current=>({...current,allowedPages:current.allowedPages.includes(page)?current.allowedPages.filter(item=>item!==page):normalizeAllowedPages([...current.allowedPages,page])}));
  const groups=[
    {id:'sharing',label:'클라이언트 공유',description:'고객에게 보여 줄 메뉴를 각각 선택합니다. 월별 보고서는 별도 권한입니다.',pages:ACCESS_PAGE_OPTIONS.filter(page=>['plan','progress','reports'].includes(page.id))},
    {id:'additional',label:'추가 조회 메뉴',description:'필요한 경우에만 허용하세요. 고객에게 공개된 데이터만 읽을 수 있습니다.',pages:ACCESS_PAGE_OPTIONS.filter(page=>['overview','tasks','daily'].includes(page.id))},
    {id:'legacy',label:'기존 추가 권한',description:'기존 KPI 접근 권한을 확인·해제합니다. 신규 계정에는 부여하지 않습니다.',pages:ACCESS_PAGE_OPTIONS.filter(page=>page.legacyPermission && currentAccess?.allowedPages.includes(page.id))},
  ].filter(group=>group.pages.length);
  const save=async submission=>{
    if(lock.current)return;
    lock.current=true;setSaving(true);setError(null);
    try {await onSave(submission);onClose();}
    catch(caught){setError(caught);}
    finally {lock.current=false;setSaving(false);}
  };
  const submit=event=>{
    event.preventDefault();if(lock.current)return;
    if(!/^[a-z0-9._-]{2,40}$/i.test(fields.account.trim()))return setError(new Error('로그인 아이디는 영문·숫자·점·밑줄·하이픈으로 2~40자 입력해 주세요.'));
    if(!selectedProject)return setError(new Error('접근 프로젝트를 선택해 주세요.'));
    if((!account || fields.accessCode) && fields.accessCode.length<8)return setError(new Error('비밀번호는 8자 이상 입력해 주세요.'));
    if(!fields.allowedPages.length)return setError(new Error('접근 가능한 페이지를 하나 이상 선택해 주세요.'));
    void save(accountSubmission(fields));
  };
  const disable=()=>{
    if(!window.confirm('이 계정의 모든 프로젝트 접근을 중지할까요?'))return;
    void save({...accountSubmission(fields),operation:'DISABLE',enabled:false});
  };
  const remove=access=>{
    if(!window.confirm(`${accessProjectLabel(access)} 접근 권한을 제거할까요? 다른 프로젝트 권한은 유지됩니다.`))return;
    void save(removeAccessSubmission(fields,access));
  };
  return <div className="modal-backdrop" role="presentation" onMouseDown={event=>{if(event.target===event.currentTarget)close();}}>
    <section ref={surface} className="create-modal access-account-modal" role="dialog" aria-modal="true" aria-labelledby="access-account-title" tabIndex={-1}>
      <header><div><p className="editorial-kicker">고객 계정 · 프로젝트별 읽기 권한</p><h2 id="access-account-title">{account?'고객사 계정 관리':'고객사 계정 생성'}</h2></div><button data-dialog-close className="icon-button" type="button" onClick={close} disabled={saving} aria-label="닫기"><X size={18}/></button></header>
      <form onSubmit={submit}>
        <div className="access-modal-body"><fieldset className="access-edit-fields" disabled={saving}>
          <div className="access-form-grid">
            <label className="create-field"><span>로그인 아이디</span><input value={fields.account} onChange={e=>setField('account',e.target.value)} placeholder="영문·숫자 2~40자" maxLength={40} autoComplete="off" disabled={Boolean(account)} required/></label>
            <label className="create-field"><span>표시 이름</span><input value={fields.displayName} onChange={e=>setField('displayName',e.target.value)} placeholder="고객사 담당자 이름" maxLength={100} required/></label>
            <label className="create-field"><span>{account?'새 비밀번호 · 변경할 때만':'임시 비밀번호'}</span><input type="password" autoComplete="new-password" value={fields.accessCode} onChange={e=>setField('accessCode',e.target.value)} placeholder="8자 이상" minLength={8} required={!account}/></label>
            <label className="create-field"><span>계정 상태 · 모든 프로젝트 공통</span><select value={fields.enabled?'ACTIVE':'DISABLED'} disabled={!canDisableAccount && Boolean(account)} onChange={e=>setField('enabled',e.target.value==='ACTIVE')}><option value="ACTIVE">사용 중</option>{(canDisableAccount || !fields.enabled) && <option value="DISABLED">사용 중지</option>}</select></label>
            <label className="create-field"><span>접근 프로젝트 · 고객사 / 프로젝트명</span><select aria-label="접근 프로젝트" value={fields.projectId} onChange={e=>selectProject(e.target.value)} required><option value="">프로젝트를 선택하세요</option>{projects.map(project=><option key={project.id} value={project.id}>{accessProjectLabel(project)}</option>)}</select></label>
          </div>
          {!projects.length && <p role="alert" className="form-error">관리 가능한 프로젝트가 없습니다. 프로젝트 배정 권한을 확인해 주세요.</p>}
          <fieldset className="access-page-fieldset" disabled={!selectedProject}>
            <legend>접근 가능한 페이지</legend>
            <p className="access-selected-project">{selectedProject?<><strong>{accessProjectLabel(selectedProject)}</strong><span>{currentAccess?'이 프로젝트의 기존 권한을 수정합니다.':'저장하면 이 프로젝트 접근 권한을 추가합니다.'}</span></>:'위에서 프로젝트를 선택하세요.'}</p>
            <div className="access-page-groups">{groups.map(group=><section className="access-page-group" key={group.id}><header><strong>{group.label}</strong><small>{group.description}</small></header><div className="access-page-options">{group.pages.map(page=><label key={page.id}><input type="checkbox" aria-label={page.label} checked={fields.allowedPages.includes(page.id)} onChange={()=>togglePage(page.id)}/><span><strong>{page.label}</strong><small>{page.description}</small></span></label>)}</div></section>)}</div>
            <p className="access-readonly-note">고객 계정은 읽기 전용입니다. 내부 진행상황·블로그·아이디 관리대장·세부 로그·권한관리는 노출되지 않습니다.</p>
          </fieldset>
          {!!account?.accesses?.length && <section className="access-current-projects"><strong>배정된 프로젝트 · 눌러서 권한 전환</strong><div>{account.accesses.map(access=><article key={access.id} className={String(access.projectId)===fields.projectId?'is-selected':''}><button className="access-project-switch" type="button" onClick={()=>selectProject(String(access.projectId))}><b>{accessProjectLabel(access)}</b><small>{access.allowedPages.length}개 권한</small></button><button type="button" className="danger-button" onClick={()=>remove(access)}>권한 제거</button></article>)}</div></section>}
        </fieldset></div>
        <footer>{error && <div role="alert" className="form-error"><AlertCircle size={14}/>{error.message}</div>}<div className="access-footer-actions">{account && canDisableAccount && <button type="button" className="danger-button" onClick={disable} disabled={saving || !fields.projectId}>계정 비활성화</button>}<span/><button className="secondary-button" type="button" onClick={close} disabled={saving}>취소</button><button className="primary-button" type="submit" disabled={saving || !fields.account.trim() || !fields.displayName.trim() || !selectedProject || !fields.allowedPages.length}>{saving?<><LoaderCircle size={15} className="spin"/>저장 중</>:'권한 저장'}</button></div></footer>
      </form>
    </section>
  </div>;
}

export default function PermissionsView({access,onSave,role}) {
  const [editing,setEditing]=useState(undefined),[query,setQuery]=useState('');
  const accounts=access.accounts || [], projects=access.projects || [];
  const labels=Object.fromEntries(ACCESS_PAGE_OPTIONS.map(page=>[page.id,page.label]));
  const needle=query.trim().toLocaleLowerCase();
  const filtered=accounts.filter(account=>[account.account,account.displayName,...(account.accesses || []).map(accessProjectLabel)].join(' ').toLocaleLowerCase().includes(needle));
  return <div className="view-stack"><div className="view-header"><div><p className="editorial-kicker">고객 계정 관리</p><h2>권한 관리</h2><p>고객사별 계정과 프로젝트별 공유 메뉴를 관리합니다.</p></div><div className="view-actions"><button className="primary-button" type="button" onClick={()=>setEditing(null)}><Plus size={15}/>고객사 계정 생성</button></div></div>
    <section className="access-summary"><article><span>고객 계정</span><strong>{accounts.length}</strong></article><article><span>활성 계정</span><strong>{accounts.filter(a=>a.enabled).length}</strong></article><article><span>관리 가능한 프로젝트</span><strong>{projects.length}</strong></article></section>
    <section className="panel access-panel"><div className="panel-heading"><div><h3>계정별 접근 범위</h3><p>계정을 누르면 각 프로젝트의 권한을 확인·수정할 수 있습니다.</p></div><label className="access-search"><Search size={15}/><input aria-label="계정·고객사·프로젝트 검색" placeholder="계정·고객사·프로젝트 검색" value={query} onChange={e=>setQuery(e.target.value)}/></label></div>
      {filtered.length?<div className="access-account-list">{filtered.map(account=>{const grants=account.accesses || [], pages=normalizeAllowedPages(grants.flatMap(a=>a.allowedPages));return <button type="button" key={account.id} className="access-account-row" onClick={()=>setEditing(account)}><span className={`access-account-state ${account.enabled?'is-active':''}`}><ShieldCheck size={16}/></span><span className="access-account-identity"><strong>{account.displayName}</strong><small>{account.account}</small></span><span className="access-account-project"><small>배정 프로젝트 {grants.length}개</small>{grants.length?grants.map(grant=><strong key={grant.id} title={accessProjectLabel(grant)}>{accessProjectLabel(grant)}</strong>):<strong>미배정</strong>}</span><span className="access-page-badges" title="배정된 프로젝트 전체 권한 요약">{pages.map(page=><i key={page}>{labels[page]}</i>)}</span><span className={`status ${account.enabled?'status-success':'status-muted'}`}>{account.enabled?'사용 중':'중지'}</span><Pencil size={15}/></button>;})}</div>:<div className="empty-state"><FolderOpen size={22}/><strong>{query?'검색 결과가 없습니다':'등록된 고객사 계정이 없습니다'}</strong><span>{query?'계정·고객사·프로젝트명을 확인하세요.':'고객사 계정 생성에서 프로젝트와 공유 메뉴를 선택하세요.'}</span></div>}
    </section>{editing!==undefined && <AccessAccountModal account={editing} projects={projects} onClose={()=>setEditing(undefined)} onSave={onSave} canDisableAccount={role==='pocket'}/>}</div>;
}
