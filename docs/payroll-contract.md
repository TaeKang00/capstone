# 급여 관리 계약

`state.payroll` 배열. `server/payroll.cjs`는 `applyPayroll(data,type,payload,ctx)`를 내보낸다. 급여 변경 API는 **원장 비밀번호 재인증으로 발급받은 owner scope**가 있어야 호출할 수 있다. 원장의 일반 업무 로그인만으로는 변경할 수 없으며 매니저도 다른 직원 급여 관리 권한이 없다. 급여 API의 idempotency와 상태 버전은 공통 actions 처리기가 제공한다.

- 공용 화면·일반 업무의 `GET /api/state`와 일반 업무 저장 응답은 `payroll`·`payrolls`를 빈 배열로 제공한다. 로그인한 역할이 원장이어도 동일하다.
- `GET /api/admin/state`는 세션에 결합된 유효한 `X-Private-Token`의 owner scope를 확인한 뒤 전체 급여를 제공한다. `payroll.*` 변경에도 같은 검사가 적용된다.
- `GET /api/personal/state`는 현재 작업자 본인이 비밀번호로 재인증한 personal scope를 확인한다. 그 직원의 `staffId`에 해당하는 finalized/paid 명세서만 제공하며 다른 직원 자료와 draft는 반환하지 않는다. 개인 조회 응답에는 전체 매장 거래·고객·로그인 계정을 포함하지 않는다.
- 재인증 권한은 미사용 3분 또는 발급 후 최대 10분에 만료된다. 클라이언트는 보호 영역 종료·화면 숨김 시 즉시 자료를 비우고 잠근다. API는 매 요청마다 현재 세션·계정·역할·만료를 검사한다. 인증 토큰은 브라우저 저장소에 보관하지 않는다.

- `payroll.save`: `{id?,staffId,month:'YYYY-MM',payDate,basePay,commissionRate,allowances:[{name,amount}],deductions:[{name,amount}],workDays?,workHours?,overtimeHours?,basis,notes}`. 동일 직원·월 1건. 수정은 draft만.
- `payroll.finalize`: `{id}`. 현재 거래로 다시 계산하고 매장·직원·급여 계산을 스냅샷 저장. future month 불가.
- `payroll.reopen`: `{id,reason}`. finalized에서만 draft 복귀. 기존 확정 스냅샷을 changes에 보존. paid는 변경 금지.
- `payroll.paid`: `{id,paidDate}`. finalized에서 paid 전환. 실제 지급일 미래 불가. 은행 이체를 실행하지 않음.

저장 필드는 입력과 `id,status,createdAt,createdBy,updatedAt,staffSnapshot:{id,name,role},storeSnapshot:{name,phone,address},revenue:{from,to,gross,refunded,net,sales:[{transactionId,date,amount}],refunds:[{refundId,transactionId,date,amount}],method},commission,allowanceTotal,deductionTotal,earningsTotal,netPay,changes[]`이다. 확정 시 finalizedAt/finalizedBy, 지급 시 paidDate/paidAt 추가.

매출 인센티브는 **귀속월 결제일의 시술 할인 후 매출 − 귀속월 환불일의 시술 환불액**에 입력된 비율을 곱한다. 상품 매출은 제외. 다른 달 결제의 이번 달 환불은 이번 달 공제. 순매출 음수면 인센티브 0원. 원 단위 반올림. 확정 후 결제·환불·직원 수정에도 계산은 고정. 지급 후 차액은 후속 월 추가 지급·공제로 기입한다.

공제·수당과 계산 근거를 수동 입력하는 급여명세서 기능이다. 근태 연동, 은행 이체, 세금·4대보험 자동 산정 기능이 아니며 출력에 명시한다. 실급여 음수 금지. 총 근로시간은 연장근로시간을 포함한다.
