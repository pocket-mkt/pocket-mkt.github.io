# 상세점검 실행 기록

작성: 2026-09-08 19:03 KST

대상: `CODE_REVIEW_2026-09-08.md`의 미완료 항목. 이미 배포된 세션/캐시 수정은 보존했다. **운영 DB 인증이 막혀 있어 전체 완료가 아니다.** 데이터 삭제·인덱스 삭제·계정 비밀번호 변경·유료 플랜 전환은 하지 않았다.

## 실행 항목

| 보고서 과제 | 실행 결과 | 남은 조건 |
|---|---|---|
| 로그인/bootstrap/조회/저장 관측 | 탭 메모리 최근 300건. 성공 p50/p95, 실패 코드/건수, 조회 응답의 디코딩 크기 추정치. 내부 계정에서 `window.pocketHubDiagnostics()`로 확인 | 운영 사용자 표본 축적 필요. 압축 전송 바이트나 DB 실행시간으로 오인하지 말 것 |
| API 지연/렌더링 구분 | 실제 React 표/간트의 100/500/1000행 마운트+페인트 벤치마크 추가 | 운영 DB 저장 p95는 미측정. 테스트 업무로 운영 원장을 임의로 변경하지 않음 |
| 다른 사용자 수정 반영 | 보이는 탭의 60초 검사, focus/online 재검증, 최소 30초 간격, 실패 backoff, 숨김/오프라인/동시 요청 억제 | 편집·드래그·모달·저장 중에는 초안 보존을 위해 연기 |
| 동일 사용자 권한 변경 캐시 | 이전 bootstrap으로 먼저 그리는 경로 제거. 서버 확인 후 리소스 캐시 초기화. 역할/프로젝트/허용 페이지/쓰기 등급 비교. 401/403 때 기존 내용 제거 | 운영 권한 계정별 실로그인 smoke는 인증 복구 후 수행 |
| 세션 경합 | 늦은 이전 조회/저장 응답이 새 계정 상태나 로그아웃을 덮지 못하도록 dataSource 세대 검사 | 실제 서버 요청 취소와 저장 취소는 다름. 이미 확정된 저장을 자동 되돌리지 않음 |
| Sheets 잔여 경로 목록화 | 아래 기능별 표 작성. 숨김 콘텐츠/성과추적 조회를 명시적 중지. Supabase 전용 고객의 불필요한 bridge warmup 제거 | overview/세부로그/프로젝트 수정/파일 및 이전 계정 로그인 호환은 아직 남음 |
| Sheets 완전 제거 | 선행 경로 조사와 안전한 사용 중지까지 수행 | DB/계정 연결 복구 후 필요 데이터·권한·이력 이전 검증. 로그인 fallback을 먼저 끊지 않음 |
| App 책임 분리 | 업무 표/간트, 권한관리, 공용 UI/status, 리소스 조회/캐시, batch state transform 분리. 업무·권한은 lazy chunk | 남은 legacy 화면과 전역 조정자는 후속 분리 여지 있음. 모든 App 책임 분리가 끝났다는 뜻 아님 |
| 공통 CSS 정리 | 권한관리 스타일을 화면 전용 lazy CSS로 분리, 모바일 우선순위 유지 | 전역 역사적 override 전체 제거는 미완료. 모든 페이지의 시각적 동등성을 검증하지 않은 삭제는 하지 않음 |
| 배치 patch | 행마다 전체 배열을 반복 조회하던 방식 → Map + 단일 패스. 실패 시 원래 행 위치 복원 | 실제 동시 외부 수정은 서버 row_version 검사 유지 |
| 대량 행 렌더링 | 200행 초과만 가상 스크롤, 다중행 높이 측정, 포커스 행 유지. 일반 프로젝트 DOM 유지 | 네이티브 행 드래그 중에는 호환성을 위해 전체 DOM 사용. 이 구간의 대량 렌더링 비용은 남음 |
| CI 행동 회귀검사 | Ubuntu/Windows Chrome 지원, 1440/390px 브라우저 검사 배포 전 실행, 스크린샷 7일 보관 | 실기기 Safari/Android 검증 아님 |
| 운영 SECURITY DEFINER 9건 | 기존 로컬 RLS/RPC 회귀검사 실행. 일괄 INVOKER 전환 금지 | Supabase OAuth refresh 오류로 최신 운영 정의/권한 조회 불가. 이전 Advisor 목록만으로 안전 판정하지 않음 |
| 미사용 인덱스 28건 | 삭제하지 않음 | 운영 통계 초기화 시점·실제 쿼리 EXPLAIN·관찰 기간 확인 후 판단 |
| 유출 비밀번호 차단 | 공식 문서에서 Pro 이상 조건 확인 | 비용 승인이 없는 상태에서 플랜/인증 정책 변경하지 않음 |

## 렌더링 실측

격리 headless Chrome 1440px, synthetic fixture. 마운트 대기와 2 animation frame을 포함한 단일 실행값이며 p50/p95가 아니다. 이 값은 네트워크/DB 저장 속도와 무관하다.

| 업무 수 | 표 이전 → 이후 | 간트 이전 → 이후 |
|---|---:|---:|
| 100 | 826ms → 990ms | 177ms → 216ms |
| 500 | 2,131ms → 144ms | 797ms → 94ms |
| 1,000 | 4,423ms → 141ms | 1,429ms → 103ms |

100행은 기존 전체 렌더링을 유지하고 첫 실행/JIT 편차가 있다. 모든 규모가 빨라졌다고 해석하지 않는다. 1,000행 DOM 노드는 표 100,130→3,232, 간트 81,309→2,739. 재현: PowerShell에서 `$env:BENCHMARK_UI='1'; npm run test:review-ui`.

최초 메인 JS: 이전 배포 501.68KB → 429.46KB(gzip 118.77KB). 업무를 열면 TaskWorkspace 66.22KB(gzip 20.55KB)가 추가 로드된다. 공통 CSS 213.84→204.64KB, 권한 화면 CSS 4.57KB 별도. 총 사용량과 최초 비용을 혼동하지 않는다.

## Sheets 의존 인벤토리

| 경로 | 현재 원천/처리 | 제거 전 조건 |
|---|---|---|
| 로그인 | 직접 Supabase Auth 우선, 실제 이전 계정 fallback bridge 유지 | 기존 계정 인증 이전 검증 |
| 고객 progress-only 로그인 | Supabase, background Sheets warmup 안 함 | 완료 |
| bootstrap/업무/진행상황/회의/통합관리/성과/권한/계정대장/실행계획 | Supabase RPC | 기존 DB 보안 회귀 유지 |
| 콘텐츠/성과추적 | 메뉴 숨김 + hybrid 조회 명시적 중지 | 과거 서버 API가 삭제된 것은 아님 |
| overview | legacy overview + native task rollup | native 요약 projection 및 고객 필드 검증 |
| 세부로그 | `activity` 비TASK 경로는 Sheets | Supabase activity_events의 안전한 목록 RPC/이력 정합성 |
| workspace/files 호환 API | Sheets | 실제 호출 필요성/데이터 확인 후 retire 또는 이전 |
| PROJECT/FILE 등 잔여 mutate | Sheets | native mutation/프로젝트 권한/감사 이력 검증 |
| 권한 legacy mirror | Supabase 확정 후 best-effort | 잔여 legacy 페이지 제거 후 mirror 제거 |

## 검증 및 제한

- 단위/계약 278개 통과. 최종 지연 로딩 변경 뒤 PC/모바일/대량 목록 브라우저 회귀 재통과.
- 로컬 Supabase: 마이그레이션 27개, 24개 테이블 RLS, 고객 필드/프로젝트 경계, 행 버전 충돌, 중복 저장, quote rollback, Vault 대역 테스트 통과. 운영 Vault 암호화/복원 테스트를 대체하지 않음.
- 브라우저: overview 늦은 응답, 계정대장 열람 경합, 견적 검토, 권한 모달, 이슈 작성, 고객 진행상황, 500행 스크롤/Shift/포커스, 간트 조작 1회당 1회 mutation 통과.
- 변경 중 새로 발견: 숫자 ID 범위 선택의 문자열 중복 및 React 지연 updater의 anchor 참조 경합도 수정.
- 운영 Supabase MCP `get_advisors`, `list_projects` 모두 OAuth token refresh 오류. 재인증 요청을 사용자에게 전달함. 재연결 전 DB 변경/최신 안전 판정은 중단.
- 공식 안내: [비밀번호 보호의 Pro 조건](https://supabase.com/docs/guides/auth/password-security), [운영 로그 조회](https://supabase.com/docs/guides/observability/logs).

## 다음 실행 조건

Supabase 플러그인 재인증 후 최신 함수 정의/권한, 인덱스 및 pg_stat_statements/통계 초기화 시점 확인 → 필요한 legacy 경로를 native RPC로 구현·로컬 회귀 → 역할별 운영 읽기 검증 → 최소한의 운영 migration → Auth bridge 제거 가능 여부 판정. 사용자 계정 비밀번호를 임의로 재설정해서 우회하지 않는다.
