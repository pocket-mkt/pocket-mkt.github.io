import { AlertCircle, Plus, X } from "lucide-react";
import { useMemo, useState } from "react";
import { useEffect } from "react";
import { acquireBodyScrollLock } from "./bodyScrollLock.js";
import { briefRequestFields, seoulDate } from "./progressBrief.js";
import "./issueRequestCreateModal.css";

const REQUEST_TYPES = ["콘텐츠 검토", "자료 요청", "내용 확인", "일정 확인", "추가 요청"];

export default function IssueRequestCreateModal({ projects = [], initialProjectId, owners = [], actorName = "", onCreate, onClose }) {
  useEffect(() => acquireBodyScrollLock(), []);
  const initialProject = String(initialProjectId || projects[0]?.id || "");
  const ownerOptions = useMemo(() => [...new Set(owners.filter(Boolean))], [owners]);
  const [projectId, setProjectId] = useState(initialProject);
  const [fields, setFields] = useState({ title: "", body: "", owner: ownerOptions[0] || "", kind: REQUEST_TYPES[0], requester: actorName || "", link: "", deadline: "" });
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");
  const setField = (name, value) => setFields((current) => ({ ...current, [name]: value }));
  const submit = async (event) => {
    event.preventDefault();
    if (projects.length > 1 && !projectId) return setError("프로젝트를 선택해 주세요.");
    setSaving(true); setError("");
    try {
      await onCreate(briefRequestFields(fields), projectId || initialProjectId);
      onClose();
    } catch (saveError) {
      setError(saveError?.message || "확인 요청을 저장하지 못했습니다.");
    } finally { setSaving(false); }
  };
  return <div className="issue-create-backdrop" role="presentation" onMouseDown={onClose}>
    <form className="issue-create-modal" role="dialog" aria-modal="true" aria-labelledby="issue-create-title" onSubmit={submit} onMouseDown={(event) => event.stopPropagation()}>
      <header><div className="issue-create-heading"><span><AlertCircle size={18} /></span><div><small>확인 요청</small><h2 id="issue-create-title">안건 추가</h2></div></div><button type="button" aria-label="닫기" disabled={saving} onClick={onClose}><X size={19} /></button></header>
      <div className="issue-create-body">
        {projects.length > 1 && <label className="issue-create-wide"><span>프로젝트 <em>필수</em></span><select required autoFocus value={projectId} onChange={(event) => setProjectId(event.target.value)}><option value="">프로젝트 선택</option>{projects.map((project) => <option key={project.id} value={project.id}>{project.clientName} · {project.name}</option>)}</select></label>}
        <div className="issue-create-grid"><label><span>확인할 사람 <em>필수</em></span><select required value={fields.owner} onChange={(event) => setField("owner", event.target.value)}>{ownerOptions.map((owner) => <option key={owner} value={owner}>{owner}</option>)}</select></label><label><span>유형 <em>필수</em></span><select required value={fields.kind} onChange={(event) => setField("kind", event.target.value)}>{REQUEST_TYPES.map((kind) => <option key={kind}>{kind}</option>)}</select></label></div>
        <label className="issue-create-wide"><span>남긴 사람 <em>필수</em></span><input required maxLength={100} value={fields.requester} onChange={(event) => setField("requester", event.target.value)} placeholder="요청을 남긴 사람 이름" /></label>
        <label className="issue-create-wide"><span>제목 <em>필수</em></span><input required autoFocus={projects.length <= 1} maxLength={500} value={fields.title} onChange={(event) => setField("title", event.target.value)} placeholder="확인이 필요한 업무나 콘텐츠" /></label>
        <label className="issue-create-wide"><span>확인 내용 <em>필수</em></span><textarea required maxLength={20000} rows={5} value={fields.body} onChange={(event) => setField("body", event.target.value)} placeholder="무엇을 확인하거나 결정해야 하는지 적어 주세요." /></label>
        <div className="issue-create-grid"><label><span>컨펌 마감일</span><input type="date" min={seoulDate()} value={fields.deadline} onChange={(event) => setField("deadline", event.target.value)} /></label><label><span>콘텐츠·자료 링크</span><input type="url" maxLength={2048} value={fields.link} onChange={(event) => setField("link", event.target.value)} placeholder="https://…" /></label></div>
        {error && <p className="issue-create-error" role="alert">{error}</p>}
      </div>
      <footer><small>등록 후 프로젝트 업무와 통합 관리에서 함께 확인됩니다.</small><button type="button" disabled={saving} onClick={onClose}>취소</button><button className="issue-create-primary" type="submit" disabled={saving}><Plus size={14} />{saving ? "저장 중…" : "확인 요청 등록"}</button></footer>
    </form>
  </div>;
}
