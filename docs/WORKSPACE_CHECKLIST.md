# 회의 후속 체크리스트

`#checklist`는 내부 첫 화면이다. 기존 `#portfolio` 및 프로젝트 일정·KPI 데이터는 변경하지 않는다.

## 동작

- 마감일 / 할 일 / 프로젝트명 / 완료 체크. 미완료가 먼저 나오고 그 안에서 마감일 순으로 표시한다. 최초 10개, 더보기는 완료 여부·마감일·ID 커서로 10개씩 이어진다. 기존 날짜 값은 재작성하지 않는다.
- 미완료·기한 지남·오늘 마감 수치는 선택 프로젝트의 전체 권한 범위에서 집계한다. 한국 날짜 기준이며 기한 경과로 자동 완료하지 않는다.
- 프로젝트 버튼은 동일 레코드의 프로젝트 FK를 필터링한다. 수정에서 프로젝트를 바꿔도 복제하지 않는다.
- 완료 시각은 DB가 기록한다. 완료 후 7일 미만은 할 일, 7일 이상은 완료에 조회된다. 체크 해제 시 할 일로 복귀한다. 제목 수정은 완료 시각을 바꾸지 않는다.
- 등록 계정과 완료 체크 계정을 분리해 기록한다. 체크한 사람이 실제 수행자라고 간주하지 않는다. 이후 제목을 수정한 사람으로 완료 체크 계정이 바뀌지 않는다. 과거 신원은 감사 기록이 있을 때만 복원하며 미확인 기록을 추정하지 않는다.
- 체크 직후 `완료 취소`로 되돌릴 수 있다. 되돌리기도 같은 버전 검증을 거쳐 다른 사람의 최신 변경을 덮어쓰지 않는다. 저장 실패·재시도 동안 입력을 잠그고 동일 요청을 유지한다.
- 하단 자유보드는 프로젝트별 텍스트 문서다. 웹 주소는 즉시 링크로 표시하고 HTML은 실행하지 않는다. 비밀번호는 아이디 관리대장으로 안내한다.
- 할 일 삭제는 해당 항목만 soft archive한다. 보드 수정과 모두 버전 비교 후 저장한다.

## 저장·접근 경계

`workspace_checklist`, `project_checklist_boards`, 비공개 `checklist_audit`를 추가한다. 기존 테이블·데이터는 재작성하지 않는다. 브라우저에는 DB 비밀키를 추가하지 않는다.

공개 SECURITY INVOKER RPC는 비공개 함수에 위임한다. 함수는 활성 내부 프로필, 활성 프로젝트, 기존 tasks 페이지 권한을 확인한다. NS는 배정 프로젝트 EDIT만 수정하고 고객/익명/정지 계정은 차단된다. 테이블 직접 접근은 ACL 및 RLS에서 차단된다. 일반 자유보드는 내부 공동 메모이며 암호 금고가 아니다.

낙관적 row_version, 사용자·요청 본문에 결합된 mutation UUID, 트랜잭션 잠금, private before/after 감사 기록을 사용한다. 불명확한 실패 재시도는 같은 요청을 재사용한다. 다른 사람의 변경은 덮어쓰지 않고 초안을 남긴다. 내용은 localStorage/sessionStorage에 저장하지 않는다.

## 검증

`npm test`, `npm run test:supabase`, `CHECKLIST_ONLY=1 npm run test:review-ui`, `npm run build` 및 기존 전체 브라우저 회귀검사. 테스트 데이터는 로컬 격리 DB/브라우저에서만 사용한다. 운영 검증 시 임시 레코드는 트랜잭션 종료 전에 롤백한다.

2026-10-08: 단위·계약 검사 405개, 로컬 DB 전체 권한 검사 및 1440/1024/390px 전체 브라우저 회귀검사를 통과했다. 운영 DB 마이그레이션 후 실제 NS 역할의 등록/읽기/재시도 및 포켓 완료 체크 → NS 제목 수정 → 완료 취소에서 계정·시각 보존을 검증했다. 고객 접근 차단도 확인했으며 검증 데이터는 트랜잭션 롤백했다(체크리스트·감사 기록 0건). 최초 배포의 프로젝트별 보드 저장·권한 검증도 유지한다.

보안 advisor에 이번 기능으로 새 경고는 추가되지 않았다. 기존 공개 definer 함수와 유출 비밀번호 보호 설정 경고는 범위 밖으로 유지했다. 신규 FK/감사 인덱스의 미사용 안내는 아직 운영 데이터가 없는 단계의 INFO이며 삭제하지 않는다. 참고: [공개 definer 함수](https://supabase.com/docs/guides/database/database-linter?lint=0029_authenticated_security_definer_function_executable), [비밀번호 보호](https://supabase.com/docs/guides/auth/password-security#password-strength-and-leaked-password-protection), [미사용 인덱스](https://supabase.com/docs/guides/database/database-linter?lint=0005_unused_index).
