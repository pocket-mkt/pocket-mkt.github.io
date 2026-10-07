import { lazy, Suspense } from "react";
const Daily = lazy(() => import("./KpiDailyView.jsx"));
const Monthly = lazy(() => import("./KpiFunnelView.jsx"));

export default function KpiPerformanceView({
  internal,
  onJumpTasks,
  ...props
}) {
  return (
    <Suspense fallback={<p role="status">KPI 화면을 준비하는 중…</p>}>
      {!internal ? (
        <Monthly {...props} />
      ) : (
        <Daily {...props} onJumpTasks={onJumpTasks} />
      )}
    </Suspense>
  );
}
