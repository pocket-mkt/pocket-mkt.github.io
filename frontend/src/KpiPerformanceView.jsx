import { lazy, Suspense, useState } from "react";
const Daily = lazy(() => import("./KpiDailyView.jsx"));
const Monthly = lazy(() => import("./KpiFunnelView.jsx"));

export default function KpiPerformanceView({
  internal,
  onJumpTasks,
  ...props
}) {
  const [monthly, setMonthly] = useState(false);
  return (
    <Suspense fallback={<p role="status">KPI 화면을 준비하는 중…</p>}>
      {!internal || monthly ? (
        <>
          {internal && (
            <button
              className="secondary-button"
              onClick={() => {
                if (
                  window.dispatchEvent(
                    new Event("pocket:before-navigate", { cancelable: true }),
                  )
                )
                  setMonthly(false);
              }}
            >
              ← 일별 실적·브리핑
            </button>
          )}
          <Monthly
            {...props}
            initialMonth={typeof monthly === "string" ? monthly : undefined}
          />
        </>
      ) : (
        <Daily
          {...props}
          onLegacy={(month) => setMonthly(month)}
          onJumpTasks={onJumpTasks}
        />
      )}
    </Suspense>
  );
}
