# 급여 관리 계약

`state.payroll` 배열. `server/payroll.cjs`는 `applyPayroll(data,type,payload,ctx)`를 내보낸다. owner/manager만 변경. designer와 reception은 자신의 확정/지급 명세서만 조회·출력하도록 서버 필터링한다. 다른 직원 명세서와 작성 중인 명세서는 반환하지 않는다. 급여 API의 idempotency와 상태 버전은 공통 actions 처리기가 제공한다.

- `payroll.save`: `{id?,staffId,month:'YYYY-MM',payDate,basePay,commissionRate,allowances:[{name,amount}],deductions:[{name,amount}],workDays?,workHours?,overtimeHours?,basis,notes}`. 동일 직원·월 1건. 수정은 draft만.
- `payroll.finalize`: `{id}`. 현재 거래로 다시 계산하고 매장·직원·급여 계산을 스냅샷 저장. future month 불가.
- `payroll.reopen`: `{id,reason}`. finalized에서만 draft 복귀. 기존 확정 스냅샷을 changes에 보존. paid는 변경 금지.
- `payroll.paid`: `{id,paidDate}`. finalized에서 paid 전환. 실제 지급일 미래 불가. 은행 이체를 실행하지 않음.

저장 필드는 입력과 `id,status,createdAt,createdBy,updatedAt,staffSnapshot:{id,name,role},storeSnapshot:{name,phone,address},revenue:{from,to,gross,refunded,net,sales:[{transactionId,date,amount}],refunds:[{refundId,transactionId,date,amount}],method},commission,allowanceTotal,deductionTotal,earningsTotal,netPay,changes[]`이다. 확정 시 finalizedAt/finalizedBy, 지급 시 paidDate/paidAt 추가.

매출 인센티브는 **귀속월 결제일의 시술 할인 후 매출 − 귀속월 환불일의 시술 환불액**에 입력된 비율을 곱한다. 상품 매출은 제외. 다른 달 결제의 이번 달 환불은 이번 달 공제. 순매출 음수면 인센티브 0원. 원 단위 반올림. 확정 후 결제·환불·직원 수정에도 계산은 고정. 지급 후 차액은 후속 월 추가 지급·공제로 기입한다.

공제·수당과 계산 근거를 수동 입력하는 급여명세서 기능이다. 근태 연동, 은행 이체, 세금·4대보험 자동 산정 기능이 아니며 출력에 명시한다. 실급여 음수 금지. 총 근로시간은 연장근로시간을 포함한다.
