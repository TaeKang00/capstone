'use strict';
const { test } = require('node:test');
const assert = require('node:assert/strict');
const { readFileSync } = require('node:fs');
const path = require('node:path');
const source = readFileSync(path.resolve(__dirname, '../src/pages/operations-utils.js'), 'utf8');
const utils = import(`data:text/javascript;base64,${Buffer.from(source).toString('base64')}`);
function fixture() {
  return {
    store: { open: 600, close: 1080, slotMinutes: 30, closedWeekdays: [] },
    staff: [{ id: 'designer', role: 'designer', status: 'active', workingDays: [0, 1, 2, 3, 4, 5, 6], startMinutes: 630, endMinutes: 1050, breakStart: 720, breakEnd: 780 }],
    appointments: [{ id: 'busy', date: '2026-10-05', staffId: 'designer', start: 840, duration: 60, status: 'booked' }],
  };
}
const selection = { date: '2026-10-05', staffId: 'designer', duration: 60 };
test('예약 가능 시간은 시술 전체 길이·근무·휴게·중복 예약을 반영한다', async () => {
  const { availableAppointmentTimes } = await utils;
  assert.deepEqual(availableAppointmentTimes(fixture(), selection), [630, 660, 780, 900, 930, 960, 990]);
});
test('예약 수정은 자기 시간을 다시 선택할 수 있고 취소된 예약은 시간을 점유하지 않는다', async () => {
  const { availableAppointmentTimes } = await utils;
  const data = fixture();
  const editing = availableAppointmentTimes(data, { ...selection, excludeId: 'busy' });
  assert.ok(editing.includes(840));
  data.appointments[0].status = 'cancelled';
  assert.deepEqual(availableAppointmentTimes(data, selection), editing);
});
test('휴무일·비활성·접수 직원이나 유효하지 않은 시간에는 가능한 시간을 안내하지 않는다', async () => {
  const { availableAppointmentTimes } = await utils;
  const closed = fixture(); closed.store.closedWeekdays = [1];
  assert.deepEqual(availableAppointmentTimes(closed, selection), []);
  for (const change of [{ status: 'inactive' }, { role: 'reception' }, { workingDays: [0] }]) {
    const data = fixture(); Object.assign(data.staff[0], change);
    assert.deepEqual(availableAppointmentTimes(data, selection), []);
  }
  for (const change of [{ duration: '' }, { duration: -30 }, { duration: 5.5 }, { date: '' }, { staffId: 'missing' }]) {
    assert.deepEqual(availableAppointmentTimes(fixture(), { ...selection, ...change }), []);
  }
});
test('지난 시간과 승인된 휴가 시간은 가능한 시간으로 안내하지 않는다', async () => {
  const { availableAppointmentTimes } = await utils;
  assert.deepEqual(availableAppointmentTimes(fixture(), { ...selection, notBefore: 900 }), [900, 930, 960, 990]);
  const halfDay = fixture();
  halfDay.staffRequests = [{ kind: 'leave', status: 'approved', staffId: 'designer', from: '2026-10-05', to: '2026-10-05', start: 780, end: 1050 }];
  assert.deepEqual(availableAppointmentTimes(halfDay, selection), [630, 660]);
  const fullDay = fixture();
  fullDay.staffRequests = [{ kind: 'leave', status: 'approved', staffId: 'designer', from: '2026-10-04', to: '2026-10-06', start: null, end: null }];
  assert.deepEqual(availableAppointmentTimes(fullDay, selection), []);
  fullDay.staffRequests[0].status = 'requested';
  assert.deepEqual(availableAppointmentTimes(fullDay, selection), [630, 660, 780, 900, 930, 960, 990]);
});
