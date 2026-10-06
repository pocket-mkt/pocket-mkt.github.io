import { comparisonText } from "./kpiComparisons.js";

export default function KpiDelta({ comparison, metric }) {
  const { label, detail, direction } = comparisonText(comparison, metric);
  return (
    <details className={`kd-delta ${direction}`} data-delta={metric}>
      <summary title={detail} aria-label={detail}>
        {label}
      </summary>
      <span className="kd-delta-detail">{detail}</span>
    </details>
  );
}
