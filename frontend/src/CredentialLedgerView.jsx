import { useEffect, useMemo, useState } from "react";
import {
  AlertCircle,
  Copy,
  ExternalLink,
  Eye,
  EyeOff,
  KeyRound,
  LoaderCircle,
  Pencil,
  Plus,
  ShieldCheck,
  Trash2,
  X,
} from "lucide-react";
import { acquireBodyScrollLock } from "./bodyScrollLock.js";
import "./credentialLedger.css";

function safeSiteUrl(value) {
  try {
    const parsed = new URL(String(value || ""));
    return ["http:", "https:"].includes(parsed.protocol) ? parsed.href : "";
  } catch {
    return "";
  }
}

function formatUpdatedAt(value) {
  const parsed = new Date(value || "");
  if (Number.isNaN(parsed.getTime())) return "시각 미확인";
  return new Intl.DateTimeFormat("ko-KR", {
    year: "numeric",
    month: "numeric",
    day: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  }).format(parsed);
}

async function copyText(value) {
  if (!globalThis.navigator?.clipboard?.writeText) throw new Error("이 브라우저에서는 복사를 지원하지 않습니다.");
  await globalThis.navigator.clipboard.writeText(String(value || ""));
}

function CredentialModal({ credential, onClose, onSave }) {
  const [fields, setFields] = useState(() => ({
    siteName: credential?.siteName || "",
    siteUrl: credential?.siteUrl || "",
    accountIdentifier: credential?.accountIdentifier || "",
    password: "",
    notes: credential?.notes || "",
  }));
  const [showPassword, setShowPassword] = useState(false);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState(null);

  useEffect(() => acquireBodyScrollLock(), []);

  const setField = (key, value) => setFields((current) => ({ ...current, [key]: value }));
  const submit = async (event) => {
    event.preventDefault();
    const siteName = fields.siteName.trim();
    const siteUrl = fields.siteUrl.trim();
    const accountIdentifier = fields.accountIdentifier.trim();
    if (!siteName || !accountIdentifier || (!credential && !fields.password)) {
      setError(new Error("필수 입력값을 확인해 주세요."));
      return;
    }
    if (siteUrl && !safeSiteUrl(siteUrl)) {
      setError(new Error("사이트 주소는 http:// 또는 https://로 시작해야 합니다."));
      return;
    }
    const submission = {
      site_name: siteName,
      site_url: siteUrl,
      account_identifier: accountIdentifier,
      notes: fields.notes.trim(),
    };
    if (fields.password) submission.password = fields.password;
    setSaving(true);
    setError(null);
    try {
      await onSave(credential, submission);
      onClose();
    } catch (nextError) {
      setError(nextError);
    } finally {
      setSaving(false);
    }
  };

  return <div className="modal-backdrop credential-modal-backdrop" role="presentation" onMouseDown={(event) => { if (event.target === event.currentTarget && !saving) onClose(); }}>
    <section className="create-modal credential-modal" role="dialog" aria-modal="true" aria-labelledby="credential-modal-title">
      <header><div><p className="editorial-kicker">프로젝트 보안 원장</p><h2 id="credential-modal-title">{credential ? "계정 정보 수정" : "사이트 계정 등록"}</h2><span>현재 프로젝트에서만 조회할 수 있습니다.</span></div><button className="icon-button" type="button" onClick={onClose} disabled={saving} aria-label="닫기"><X size={18} /></button></header>
      <form onSubmit={submit}>
        <div className="credential-form-grid">
          <label className="credential-field"><span>사이트 이름 <em>필수</em></span><input autoFocus type="text" value={fields.siteName} onChange={(event) => setField("siteName", event.target.value)} placeholder="예: 네이버 검색광고" maxLength={160} /></label>
          <label className="credential-field"><span>사이트 주소</span><input type="url" inputMode="url" value={fields.siteUrl} onChange={(event) => setField("siteUrl", event.target.value)} placeholder="https://" maxLength={1000} /></label>
          <label className="credential-field"><span>아이디·이메일 <em>필수</em></span><input type="text" autoComplete="off" value={fields.accountIdentifier} onChange={(event) => setField("accountIdentifier", event.target.value)} placeholder="로그인 아이디" maxLength={320} /></label>
          <label className="credential-field"><span>비밀번호 {!credential && <em>필수</em>}{credential && <small>비우면 기존 값 유지</small>}</span><div className="credential-password-input"><input type={showPassword ? "text" : "password"} autoComplete="new-password" value={fields.password} onChange={(event) => setField("password", event.target.value)} placeholder={credential ? "변경할 때만 입력" : "비밀번호 입력"} maxLength={2048} /><button type="button" onClick={() => setShowPassword((current) => !current)} aria-label={showPassword ? "비밀번호 숨기기" : "비밀번호 보기"}>{showPassword ? <EyeOff size={17} /> : <Eye size={17} />}</button></div></label>
          <label className="credential-field is-wide"><span>메모</span><textarea value={fields.notes} onChange={(event) => setField("notes", event.target.value)} placeholder="2차 인증, 담당자, 복구 메일 등 필요한 정보" maxLength={2000} rows={4} /></label>
        </div>
        {error && <div className="credential-form-error" role="alert"><AlertCircle size={15} />{error.message || "저장하지 못했습니다."}</div>}
        <footer><p><ShieldCheck size={14} /> 비밀번호는 Supabase Vault에 암호화해 저장합니다.</p><div><button className="secondary-button" type="button" onClick={onClose} disabled={saving}>취소</button><button className="primary-button" type="submit" disabled={saving}>{saving ? <><LoaderCircle size={15} className="spin" /> 저장 중</> : credential ? "변경 저장" : "계정 등록"}</button></div></footer>
      </form>
    </section>
  </div>;
}

export function CredentialLedgerView({ project, credentials = [], query = "", canWrite, onSave, onArchive, onReveal }) {
  const [editing, setEditing] = useState(undefined);
  const [revealed, setRevealed] = useState({});
  const [busyId, setBusyId] = useState(null);
  const [notice, setNotice] = useState("");
  const [error, setError] = useState(null);
  const filtered = useMemo(() => {
    const term = String(query || "").trim().toLocaleLowerCase("ko");
    if (!term) return credentials;
    return credentials.filter((item) => [item.siteName, item.siteUrl, item.accountIdentifier, item.notes].some((value) => String(value || "").toLocaleLowerCase("ko").includes(term)));
  }, [credentials, query]);

  useEffect(() => {
    setRevealed({});
    setBusyId(null);
    setNotice("");
    setError(null);
  }, [project.id]);

  useEffect(() => () => setRevealed({}), []);
  useEffect(() => {
    if (!notice) return undefined;
    const timer = window.setTimeout(() => setNotice(""), 2500);
    return () => window.clearTimeout(timer);
  }, [notice]);

  const reveal = async (credential) => {
    if (revealed[credential.id] !== undefined) {
      setRevealed((current) => { const next = { ...current }; delete next[credential.id]; return next; });
      return;
    }
    setBusyId(credential.id);
    setError(null);
    try {
      const password = await onReveal(credential);
      setRevealed((current) => ({ ...current, [credential.id]: password }));
    } catch (nextError) {
      setError(nextError);
    } finally {
      setBusyId(null);
    }
  };

  const copy = async (value, label) => {
    try {
      await copyText(value);
      setNotice(`${label}를 복사했습니다.`);
      setError(null);
    } catch (nextError) {
      setError(nextError);
    }
  };

  const archive = async (credential) => {
    if (!window.confirm(`‘${credential.siteName}’ 계정 정보를 삭제하시겠습니까?\n저장된 비밀번호도 함께 삭제되며 복구할 수 없습니다.`)) return;
    setBusyId(credential.id);
    setError(null);
    try {
      await onArchive(credential);
      setRevealed((current) => { const next = { ...current }; delete next[credential.id]; return next; });
    } catch (nextError) {
      setError(nextError);
    } finally {
      setBusyId(null);
    }
  };

  return <div className="view-stack credential-ledger-view">
    <div className="view-header"><div><p className="editorial-kicker">{project.clientName || project.label || "프로젝트"}</p><h2>아이디 관리대장</h2><p>사이트별 로그인 정보를 프로젝트 단위로 관리합니다.</p></div>{canWrite && <div className="view-actions"><button className="primary-button" type="button" onClick={() => setEditing(null)}><Plus size={16} /> 계정 등록</button></div>}</div>
    <section className="credential-security-note"><span><ShieldCheck size={18} /></span><div><strong>기본 숨김 · 열람 이력 기록</strong><p>비밀번호는 목록 응답과 브라우저 캐시에 포함하지 않으며, 보기 버튼을 누른 한 건만 일시적으로 불러옵니다.</p></div></section>
    {(notice || error) && <div className={`credential-feedback ${error ? "is-error" : "is-success"}`} role={error ? "alert" : "status"}>{error ? <AlertCircle size={15} /> : <ShieldCheck size={15} />}{error?.message || notice}</div>}
    <section className="panel credential-ledger-panel">
      <header><div><h3>저장된 계정</h3><span>{filtered.length}개{query ? ` · 검색 전체 ${credentials.length}개` : ""}</span></div><small>비밀번호 열람은 감사 로그에 남습니다.</small></header>
      {filtered.length ? <div className="credential-table-wrap"><table className="credential-table"><thead><tr><th>사이트</th><th>아이디·이메일</th><th>비밀번호</th><th>메모</th><th>최근 수정</th><th aria-label="관리" /></tr></thead><tbody>{filtered.map((credential) => {
        const url = safeSiteUrl(credential.siteUrl);
        const password = revealed[credential.id];
        const busy = busyId === credential.id;
        return <tr key={credential.id}>
          <td data-label="사이트"><div className="credential-site"><span><KeyRound size={16} /></span><div><strong>{credential.siteName}</strong>{url ? <a href={url} target="_blank" rel="noreferrer">사이트 열기 <ExternalLink size={12} /></a> : <small>주소 미등록</small>}</div></div></td>
          <td data-label="아이디·이메일"><div className="credential-copy-value"><code>{credential.accountIdentifier}</code><button type="button" onClick={() => copy(credential.accountIdentifier, "아이디")} aria-label={`${credential.siteName} 아이디 복사`}><Copy size={14} /></button></div></td>
          <td data-label="비밀번호"><div className="credential-password-value"><code className={password === undefined ? "is-masked" : ""}>{password === undefined ? "••••••••••••" : password}</code><button type="button" onClick={() => reveal(credential)} disabled={busy} aria-label={password === undefined ? `${credential.siteName} 비밀번호 보기` : `${credential.siteName} 비밀번호 숨기기`}>{busy ? <LoaderCircle size={15} className="spin" /> : password === undefined ? <Eye size={15} /> : <EyeOff size={15} />}</button>{password !== undefined && <button type="button" onClick={() => copy(password, "비밀번호")} aria-label={`${credential.siteName} 비밀번호 복사`}><Copy size={14} /></button>}</div></td>
          <td data-label="메모"><p className="credential-notes">{credential.notes || "-"}</p></td>
          <td data-label="최근 수정"><div className="credential-updated"><strong>{credential.updatedByName}</strong><time>{formatUpdatedAt(credential.updatedAt)}</time></div></td>
          <td className="credential-row-actions">{canWrite && <><button type="button" onClick={() => setEditing(credential)} disabled={busy} aria-label={`${credential.siteName} 수정`}><Pencil size={15} /></button><button className="is-danger" type="button" onClick={() => archive(credential)} disabled={busy} aria-label={`${credential.siteName} 삭제`}><Trash2 size={15} /></button></>}</td>
        </tr>;
      })}</tbody></table></div> : <div className="credential-empty"><KeyRound size={23} /><strong>{query ? "검색 결과가 없습니다" : "등록된 사이트 계정이 없습니다"}</strong><span>{canWrite ? "계정 등록 버튼으로 첫 로그인 정보를 추가하세요." : "프로젝트 운영자가 계정을 등록하면 표시됩니다."}</span></div>}
    </section>
    {editing !== undefined && <CredentialModal credential={editing} onClose={() => setEditing(undefined)} onSave={onSave} />}
  </div>;
}
