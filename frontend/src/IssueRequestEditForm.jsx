import { useState } from 'react';
import { ISSUE_REQUEST_TYPES, issueEditInitial, issueEditFields } from './issueRequestEdit.js';
import './issueRequestEdit.css';

export default function IssueRequestEditForm({issue, owners=[], saving, onSave, onCancel}) {
  const [draft,setDraft]=useState(()=>issueEditInitial(issue));
  const [error,setError]=useState('');
  const set=(key,value)=>setDraft(old=>({...old,[key]:value}));
  const ownerOptions=[...new Set([issue.owner,...owners,'포켓컴퍼니','NS',issue.clientName].filter(Boolean))];
  const kinds=[...new Set([issue.kind,...ISSUE_REQUEST_TYPES].filter(Boolean))];
  const submit=async event=>{
    event.preventDefault();if(saving)return;
    setError('');
    try {
      const fields=issueEditFields(issue,draft);
      if(!Object.keys(fields).length){onCancel();return;}
      if(await onSave(fields,issue))onCancel();
    }catch(error){setError(error.message || '수정 내용을 확인해 주세요.');}
  };
  const cancel=()=>{
    if(saving)return;
    if(JSON.stringify(draft)!==JSON.stringify(issueEditInitial(issue))&&!window.confirm('작성 중인 수정 내용을 버릴까요?'))return;
    onCancel();
  };
  return <form className="issue-request-edit-form" aria-label="확인요청 수정" onSubmit={submit}>
    <h4>확인요청 수정</h4>
    <fieldset disabled={saving}>
      <div className="issue-request-edit-grid">
        <label>확인할 사람<select required value={draft.owner} onChange={e=>set('owner',e.target.value)}><option value="">선택</option>{ownerOptions.map(value=><option key={value}>{value}</option>)}</select></label>
        <label>유형<select required value={draft.kind} onChange={e=>set('kind',e.target.value)}><option value="">선택</option>{kinds.map(value=><option key={value}>{value}</option>)}</select></label>
      </div>
      <label>남긴 사람<input required maxLength={100} value={draft.requester} onChange={e=>set('requester',e.target.value)}/></label>
      <label>제목<input required autoFocus maxLength={500} value={draft.title} onChange={e=>set('title',e.target.value)}/></label>
      <label>확인 내용<textarea required rows={5} maxLength={20000} value={draft.body} onChange={e=>set('body',e.target.value)}/></label>
      <div className="issue-request-edit-grid">
        <label>컨펌 마감일<input type="date" value={draft.deadline} onChange={e=>set('deadline',e.target.value)}/></label>
        <label>콘텐츠·자료 링크<input type="url" maxLength={2048} placeholder="https://…" value={draft.link} onChange={e=>set('link',e.target.value)}/></label>
      </div>
    </fieldset>
    <small>작성일·완료 상태·기존 답변은 유지되며, 수정한 로그인 계정과 시각은 세부로그에 남습니다.</small>
    {error&&<p role="alert">{error}</p>}
    <div className="issue-request-edit-actions"><button type="button" disabled={saving} onClick={cancel}>취소</button><button type="submit" disabled={saving}>{saving?'저장 중…':'수정 저장'}</button></div>
  </form>;
}
