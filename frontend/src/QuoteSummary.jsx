export function won(value) {
  return value === null || value === undefined ? "–" : `${Math.round(Number(value)).toLocaleString("ko-KR")}원`;
}

export function QuoteSummary({ quote }) {
  const totals = quote?.totals || {};
  if (!quote || (!quote.issued_at && !quote.project && !Object.keys(totals).length)) return null;
  return <div className="quote-summary" aria-label="적용된 견적 정보">
    <span className="quote-summary-label">견적</span>
    {quote.issued_at && <span><small>발행</small><strong>{quote.issued_at}</strong></span>}
    {quote.project && <span className="quote-summary-project"><small>프로젝트</small><strong>{quote.project}</strong></span>}
    {totals.base !== undefined && <span><small>기준단가</small><strong>{won(totals.base)}</strong></span>}
    {totals.discount !== undefined && <span className="is-discount"><small>할인</small><strong>-{won(totals.discount)}</strong></span>}
    {totals.supply !== undefined && <span><small>공급가액</small><strong>{won(totals.supply)}</strong></span>}
    {totals.vat !== undefined && <span><small>부가세</small><strong>{won(totals.vat)}</strong></span>}
    {totals.total !== undefined && <span className="is-total"><small>총 결제금액</small><strong>{won(totals.total)}</strong></span>}
  </div>;
}
