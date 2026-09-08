import { useEffect, useMemo, useRef, useState } from "react";
import { AlertCircle, ArrowRight, FileUp, LoaderCircle, X } from "lucide-react";
import { QuoteSummary, won } from "./QuoteSummary.jsx";
import {
  addIsoDays,
  buildQuoteImportPayload,
  buildQuoteItems,
  QUOTE_MAPPING_FIELDS,
  quoteColumnLabel,
  readQuoteFile,
} from "./quoteImport.js";

function localIsoToday() {
  const now = new Date();
  const pad = (value) => String(value).padStart(2, "0");
  return `${now.getFullYear()}-${pad(now.getMonth() + 1)}-${pad(now.getDate())}`;
}

export default function QuoteImportModal({ currentProject, onClose, onCreateProject, onAppendProject }) {
  const inputRef = useRef(null);
  const [state, setState] = useState({ stage: "select", detail: "", error: null });
  const [parsed, setParsed] = useState(null);
  const [mapping, setMapping] = useState({});
  const [items, setItems] = useState([]);
  const [selectedIndexes, setSelectedIndexes] = useState([]);
  const [showMapping, setShowMapping] = useState(false);
  const [splitQuantities, setSplitQuantities] = useState(true);
  const [deriveDesign, setDeriveDesign] = useState(true);
  const [fields, setFields] = useState({ clientName: "", projectName: "", start: "", end: "" });

  useEffect(() => {
    const closeOnEscape = (event) => { if (event.key === "Escape" && state.stage !== "saving") onClose(); };
    globalThis.addEventListener?.("keydown", closeOnEscape);
    return () => globalThis.removeEventListener?.("keydown", closeOnEscape);
  }, [onClose, state.stage]);

  const setField = (name, value) => setFields((current) => ({ ...current, [name]: value }));
  const processFile = async (file) => {
    if (!file) return;
    setState({ stage: "reading", detail: file.name, error: null });
    try {
      const result = await readQuoteFile(file, ({ stage, detail }) => setState({ stage, detail, error: null }));
      const today = localIsoToday();
      const nextItems = result.items;
      setParsed(result);
      setMapping(result.analysis.map);
      setItems(nextItems);
      setSelectedIndexes(nextItems.map((_, index) => index));
      setShowMapping(!result.analysis.autoMapped);
      setFields({
        clientName: result.analysis.metadata.client || "",
        projectName: result.analysis.metadata.project || result.fileName.replace(/\.[^.]+$/, ""),
        start: result.analysis.metadata.start || today,
        end: result.analysis.metadata.end || addIsoDays(today, 29),
      });
      setState({ stage: "review", detail: "", error: null });
    } catch (error) {
      setState({ stage: "error", detail: "", error });
    }
  };

  const updateMapping = (field, value) => {
    const next = { ...mapping };
    if (value === "") delete next[field]; else next[field] = Number(value);
    setMapping(next);
    if (parsed) {
      const nextItems = buildQuoteItems(parsed.analysis, next);
      setItems(nextItems);
      setSelectedIndexes(nextItems.map((_, index) => index));
    }
  };

  const toggleItem = (index) => setSelectedIndexes((current) => current.includes(index) ? current.filter((item) => item !== index) : [...current, index]);
  const preview = useMemo(() => {
    if (!parsed || !items.length) return { payload: null, error: null };
    try {
      return { payload: buildQuoteImportPayload({ analysis: parsed.analysis, items, selectedIndexes, clientName: fields.clientName, projectName: fields.projectName, start: fields.start, end: fields.end, splitQuantities, deriveDesign, fileName: parsed.fileName }), error: null };
    } catch (error) { return { payload: null, error }; }
  }, [deriveDesign, fields, items, parsed, selectedIndexes, splitQuantities]);
  const previewPayload = preview.payload;

  const submit = async (mode) => {
    if (!parsed) return;
    try {
      const payload = buildQuoteImportPayload({ analysis: parsed.analysis, items, selectedIndexes, clientName: fields.clientName, projectName: fields.projectName, start: fields.start, end: fields.end, splitQuantities, deriveDesign, fileName: parsed.fileName });
      if (mode === "new" && (!payload.fields.client_name || !payload.fields.project_name)) throw new Error("새 프로젝트의 회사명과 프로젝트명을 입력해 주세요.");
      setState({ stage: "saving", detail: `${payload.tasks.length}개 업무 저장`, error: null });
      if (mode === "new") await onCreateProject(payload);
      else await onAppendProject(payload);
      onClose();
    } catch (error) {
      setState({ stage: parsed ? "review" : "error", detail: "", error });
    }
  };

  const busy = ["reading", "library", "parsing", "matching", "saving"].includes(state.stage);
  const quoteFileType = parsed?.fileName.split(".").pop()?.toUpperCase() || "파일";
  return <div className="modal-backdrop quote-import-backdrop" role="presentation" onMouseDown={(event) => { if (event.target === event.currentTarget && !busy) onClose(); }}>
    <section className="create-modal quote-import-modal" role="dialog" aria-modal="true" aria-labelledby="quote-import-title">
      <header><div>{parsed && state.stage === "review" ? <><h2 id="quote-import-title">견적서에서 캠페인 만들기</h2><span>{parsed.fileName} · {parsed.sheetName ? `시트 ${parsed.sheetName} · ` : ""}{quoteFileType} · 항목 {items.length}건</span></> : <><p className="editorial-kicker">견적서 → 프로젝트·업무</p><h2 id="quote-import-title">견적서 불러오기</h2><span>PDF·엑셀·CSV의 항목, 수량, 금액을 읽어 프로젝트 일정으로 만듭니다.</span></>}</div><button className="icon-button" type="button" onClick={onClose} disabled={busy} aria-label="닫기"><X size={18} /></button></header>
      <input ref={inputRef} className="quote-file-input" type="file" accept=".pdf,.xlsx,.xls,.xlsm,.csv,.tsv,application/pdf" onClick={(event) => { event.currentTarget.value = ""; }} onChange={(event) => processFile(event.target.files?.[0])} />
      {state.stage === "select" && <div className="quote-dropzone" onDragOver={(event) => event.preventDefault()} onDrop={(event) => { event.preventDefault(); processFile(event.dataTransfer.files?.[0]); }}>
        <span className="quote-dropzone-icon"><FileUp size={26} /></span><strong>견적서 파일을 놓으세요</strong><p>또는 파일을 직접 선택할 수 있습니다. 최대 20MB</p><button className="primary-button" type="button" onClick={() => inputRef.current?.click()}>파일 선택</button>
      </div>}
      {busy && <div className="quote-import-progress" role="status"><LoaderCircle size={25} className="spin" /><strong>{state.stage === "saving" ? "프로젝트를 저장하고 있습니다" : "견적서를 읽고 있습니다"}</strong><span>{state.detail}</span></div>}
      {state.stage === "error" && <div className="quote-import-error"><AlertCircle size={24} /><strong>견적서를 읽지 못했습니다</strong><span>{state.error?.message || "파일 형식을 확인해 주세요."}</span><button className="secondary-button" type="button" onClick={() => { setState({ stage: "select", detail: "", error: null }); if (inputRef.current) inputRef.current.value = ""; }}>다른 파일 선택</button></div>}
      {state.stage === "review" && parsed && <>
        <div className="quote-import-body">
          {state.error && <div className="form-error"><AlertCircle size={15} /><span>{state.error.message}</span></div>}
          <div className="quote-mapping-head"><span>{parsed.analysis.autoMapped ? "✓ 표 머리글을 찾아 열을 자동으로 맞췄습니다." : "열을 자동 추정했습니다. 항목 열을 확인하세요."}</span><button type="button" onClick={() => setShowMapping((current) => !current)}>{showMapping ? "열 지정 접기" : "열 지정 고치기"}</button></div>
          {showMapping && <div className="quote-mapping-grid">{QUOTE_MAPPING_FIELDS.map((field) => <label key={field.key}><span>{field.label}</span><select value={mapping[field.key] ?? ""} onChange={(event) => updateMapping(field.key, event.target.value)}><option value="">없음</option>{parsed.analysis.columns.map((column) => <option key={column.index} value={column.index}>{quoteColumnLabel(column)}</option>)}</select></label>)}</div>}
          <div className="quote-project-meta">
            <label><span>CLIENT</span><input value={fields.clientName} onChange={(event) => setField("clientName", event.target.value)} placeholder="고객사명" /></label>
            <label><span>PROJECT</span><input value={fields.projectName} onChange={(event) => setField("projectName", event.target.value)} placeholder="캠페인명" /></label>
            <div><span>담당</span><strong>{parsed.analysis.metadata.manager || "-"}</strong></div>
            <div><span>발행일</span><strong>{parsed.analysis.metadata.issuedAt || "-"}</strong></div>
          </div>
          <div className="quote-period-row">
            <span>캠페인 기간</span>
            <input type="date" value={fields.start} max={fields.end || undefined} onChange={(event) => setField("start", event.target.value)} aria-label="캠페인 시작일" />
            <ArrowRight size={14} />
            <input type="date" value={fields.end} min={fields.start || undefined} onChange={(event) => setField("end", event.target.value)} aria-label="캠페인 종료일" />
            <small>{parsed.analysis.metadata.start ? "견적서에서 읽은 기간입니다." : "견적서에 기간이 없어 오늘부터 한 달로 잡았습니다."} 고치면 생성될 일정이 이 기간에 맞춰 분산됩니다.</small>
          </div>
          <QuoteSummary quote={{ issued_at: parsed.analysis.metadata.issuedAt, project: parsed.analysis.metadata.project, totals: parsed.analysis.totals }} />
          <div className="quote-item-table-wrap"><table className="quote-item-table"><thead><tr><th aria-label="선택" /><th>매체</th><th>항목</th><th>수량</th><th>금액</th></tr></thead><tbody>{items.map((item, index) => <tr key={`${item.name}-${index}`} className={selectedIndexes.includes(index) ? "" : "is-off"}><td><input type="checkbox" checked={selectedIndexes.includes(index)} onChange={() => toggleItem(index)} /></td><td><span className="quote-media-chip">{item.media}</span></td><td><strong>{item.name}</strong>{item.detail && <small>{item.detail}</small>}</td><td>{item.quantity}{item.unit}</td><td>{won(item.amount)}</td></tr>)}</tbody></table></div>
        </div>
        <footer className="quote-import-footer">
          <div className="quote-import-options"><label><input type="checkbox" checked={splitQuantities} onChange={(event) => setSplitQuantities(event.target.checked)} /><span>수량만큼 행 나누기 <small>(10건 → 1/10 … 10/10)</small></span></label><label><input type="checkbox" checked={deriveDesign} onChange={(event) => setDeriveDesign(event.target.checked)} /><span>디자인·썸네일 업무 자동 추가 <small>(담당 포켓)</small></span></label></div>
          <span className={`quote-task-count${preview.error ? " is-error" : ""}`} title={preview.error?.message || undefined}>{preview.error ? preview.error.message : <>업무 <strong>{previewPayload?.tasks.length ?? 0}</strong>행 생성</>}</span>
          <button className="secondary-button" type="button" onClick={onClose}>취소</button>
          <button className="secondary-button" type="button" disabled={!previewPayload || !currentProject?.id} onClick={() => submit("append")}>현재 프로젝트에 추가</button>
          <button className="primary-button" type="button" disabled={!previewPayload || !fields.clientName.trim() || !fields.projectName.trim()} onClick={() => submit("new")}>새 프로젝트로 만들기</button>
        </footer>
      </>}
    </section>
  </div>;
}
