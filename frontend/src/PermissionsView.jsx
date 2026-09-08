import { useState } from "react";
import "./permissionsView.css";
import { X, AlertCircle, LoaderCircle, Plus, ShieldCheck, Pencil, FolderOpen } from "lucide-react";
import { ACCESS_PAGE_OPTIONS, PROJECT_NAVIGATION_GROUP, normalizeAllowedPages, accountSubmission, removeAccessSubmission } from "./accessPermissions.js";

function FormSelect({ label, value, onChange, options }) {
  return <label className="create-field"><span>{label}</span><select value={value} onChange={(event) => onChange(event.target.value)}>{options.map(([code, text]) => <option key={code} value={code}>{text}</option>)}</select></label>;
}


function ViewHeader({ eyebrow, title, description, children }) {
  return <div className="view-header"><div><p className="editorial-kicker">{eyebrow}</p><h2>{title}</h2><p>{description}</p></div>{children && <div className="view-actions">{children}</div>}</div>;
}


function EmptyState({ title, description }) {
  return <div className="empty-state"><FolderOpen size={22} strokeWidth={1.7} /><strong>{title}</strong><span>{description}</span></div>;
}


function AccessAccountModal({ account, projects, onClose, onSave, canDisableAccount }) {
  const firstAccess = account?.accesses?.[0] || null;
  const [fields, setFields] = useState(() => ({
    account: account?.account || "",
    displayName: account?.displayName || "",
    accessCode: "",
    projectId: firstAccess?.projectId || projects[0]?.id || "",
    membershipId: firstAccess?.id || "",
    allowedPages: normalizeAllowedPages(firstAccess?.allowedPages?.length ? firstAccess.allowedPages : ACCESS_PAGE_OPTIONS.map((page) => page.id)),
    enabled: account?.enabled !== false,
  }));
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState(null);
  const pageGroups = [
    {
      id: "main",
      label: "기본 메뉴",
      description: "프로젝트 공통 정보와 성과·기록 화면",
      pages: ACCESS_PAGE_OPTIONS.filter((page) => !PROJECT_NAVIGATION_GROUP.pageIds.includes(page.id)),
    },
    {
      id: PROJECT_NAVIGATION_GROUP.id,
      label: PROJECT_NAVIGATION_GROUP.label,
      description: "왼쪽 프로젝트 메뉴에 표시할 하위 화면",
      pages: ACCESS_PAGE_OPTIONS.filter((page) => PROJECT_NAVIGATION_GROUP.pageIds.includes(page.id)),
    },
  ];
  const setField = (key, value) => setFields((current) => ({ ...current, [key]: value }));
  const togglePage = (page) => setFields((current) => ({
    ...current,
    allowedPages: current.allowedPages.includes(page)
      ? current.allowedPages.filter((item) => item !== page)
      : normalizeAllowedPages([...current.allowedPages, page]),
  }));
  const submit = async (event) => {
    event.preventDefault();
    setError(null);
    if (!account && !fields.accessCode) return setError(new Error("신규 계정의 임시 비밀번호를 입력해 주세요."));
    if (!fields.allowedPages.length) return setError(new Error("접근 가능한 페이지를 하나 이상 선택해 주세요."));
    setSaving(true);
    try {
      await onSave(accountSubmission(fields));
      onClose();
    } catch (saveError) {
      setError(saveError);
    } finally {
      setSaving(false);
    }
  };
  const disable = async () => {
    setSaving(true);
    setError(null);
    try {
      await onSave({ ...accountSubmission(fields), operation: "DISABLE", enabled: false });
      onClose();
    } catch (saveError) {
      setError(saveError);
    } finally {
      setSaving(false);
    }
  };
  const removeAccess = async (access) => {
    if (!window.confirm(`${access.projectName} 접근 권한을 제거할까요? 계정의 다른 프로젝트 권한은 유지됩니다.`)) return;
    setSaving(true);
    setError(null);
    try {
      await onSave(removeAccessSubmission(fields, access));
      onClose();
    } catch (saveError) {
      setError(saveError);
    } finally {
      setSaving(false);
    }
  };
  return <div className="modal-backdrop" role="presentation" onMouseDown={(event) => { if (event.target === event.currentTarget && !saving) onClose(); }}><section className="create-modal access-account-modal" role="dialog" aria-modal="true" aria-labelledby="access-account-title"><header><div><p className="editorial-kicker">Supabase 계정·권한 원장</p><h2 id="access-account-title">{account ? "고객사 계정 관리" : "고객사 계정 생성"}</h2></div><button className="icon-button" type="button" onClick={onClose} disabled={saving} aria-label="닫기"><X size={18} /></button></header><form onSubmit={submit}>
    <div className="access-form-grid"><label className="create-field"><span>로그인 아이디</span><input value={fields.account} onChange={(event) => setField("account", event.target.value)} placeholder="예: client-account" disabled={Boolean(account)} required /></label><label className="create-field"><span>표시 이름</span><input value={fields.displayName} onChange={(event) => setField("displayName", event.target.value)} placeholder="예: 고객사 담당자" required /></label><label className="create-field"><span>{account ? "새 비밀번호 · 변경할 때만" : "임시 비밀번호"}</span><input type="password" autoComplete="new-password" value={fields.accessCode} onChange={(event) => setField("accessCode", event.target.value)} placeholder="8자 이상" required={!account} /></label><FormSelect label="계정 상태" value={fields.enabled ? "ACTIVE" : "DISABLED"} onChange={(value) => setField("enabled", value === "ACTIVE")} options={[["ACTIVE", "사용 중"], ["DISABLED", "사용 중지"]]} /><FormSelect label="접근 프로젝트" value={fields.projectId} onChange={(value) => setField("projectId", value)} options={projects.map((project) => [project.id, project.name])} /></div>
    <fieldset className="access-page-fieldset"><legend>접근 가능한 페이지</legend><p>체크한 메뉴만 고객사 화면에 표시됩니다. 프로젝트의 업무·진행상황·데일리 회의록은 각각 따로 지정할 수 있습니다.</p><div className="access-page-groups">{pageGroups.map((group) => <section className="access-page-group" key={group.id}><header><strong>{group.label}</strong><small>{group.description}</small></header><div className="access-page-options">{group.pages.map((page) => <label key={page.id}><input type="checkbox" checked={fields.allowedPages.includes(page.id)} onChange={() => togglePage(page.id)} /><span><strong>{page.label}</strong><small>{page.description}</small></span></label>)}</div></section>)}</div></fieldset>
    {account?.accesses?.length > 0 && <section className="access-current-projects"><strong>현재 프로젝트 권한</strong><div>{account.accesses.map((access) => <article key={access.id}><span><b>{access.projectName}</b><small>{access.allowedPages.length}개 페이지</small></span><button type="button" className="danger-button" disabled={saving} onClick={() => removeAccess(access)}>이 프로젝트 권한 제거</button></article>)}</div></section>}
    {error && <div className="form-error"><AlertCircle size={14} />{error.message}</div>}
    <footer>{account && canDisableAccount && <button type="button" className="danger-button" onClick={disable} disabled={saving || !fields.projectId}>계정 비활성화</button>}<span /><button className="secondary-button" type="button" onClick={onClose} disabled={saving}>취소</button><button className="primary-button" type="submit" disabled={saving || !fields.account.trim() || !fields.displayName.trim() || !fields.projectId || !fields.allowedPages.length}>{saving ? <><LoaderCircle size={15} className="spin" /> 저장 중</> : "권한 저장"}</button></footer>
  </form></section></div>;
}

export default function PermissionsView({ access, onSave, role }) {
  const [editing, setEditing] = useState(undefined);
  const accounts = access.accounts || [];
  const pageLabel = Object.fromEntries(ACCESS_PAGE_OPTIONS.map((page) => [page.id, page.label]));
  const activeCount = accounts.filter((account) => account.enabled).length;
  return <div className="view-stack"><ViewHeader eyebrow="고객 계정 관리" title="권한 관리" description="고객사 계정을 만들고 프로젝트별로 볼 수 있는 페이지를 지정합니다."><button className="primary-button" type="button" onClick={() => setEditing(null)}><Plus size={15} /> 고객사 계정 생성</button></ViewHeader><section className="access-summary"><article><span>고객 계정</span><strong>{accounts.length}</strong></article><article><span>활성 계정</span><strong>{activeCount}</strong></article><article><span>배정 프로젝트</span><strong>{access.projects?.length || 0}</strong></article></section><section className="panel access-panel"><div className="panel-heading"><div><h3>계정별 접근 범위</h3><p>비밀번호 원문은 저장하거나 다시 표시하지 않습니다.</p></div></div>{accounts.length ? <div className="access-account-list">{accounts.map((account) => {
    const primaryAccess = account.accesses?.[0];
    return <button type="button" key={account.id} className="access-account-row" onClick={() => setEditing(account)}><span className={`access-account-state ${account.enabled ? "is-active" : ""}`}><ShieldCheck size={16} /></span><span className="access-account-identity"><strong>{account.displayName}</strong><small>{account.account}</small></span><span className="access-account-project"><small>프로젝트</small><strong>{primaryAccess?.projectName || "미배정"}</strong></span><span className="access-page-badges">{(primaryAccess?.allowedPages || []).map((page) => <i key={page}>{pageLabel[page] || page}</i>)}</span><span className={`status ${account.enabled ? "status-success" : "status-muted"}`}>{account.enabled ? "사용 중" : "중지"}</span><Pencil size={15} /></button>;
  })}</div> : <EmptyState title="등록된 고객사 계정이 없습니다" description="고객사 계정 생성 버튼에서 첫 계정을 추가하세요." />}</section>{editing !== undefined && <AccessAccountModal account={editing} projects={access.projects || []} onClose={() => setEditing(undefined)} onSave={onSave} canDisableAccount={role === "pocket"} />}</div>;
}
