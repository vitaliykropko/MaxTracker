import assert from 'node:assert/strict';
import test from 'node:test';
import { groupEmployees, replayJournal } from '../analytics/journal.js';
import { moscowDay, projectScope, summarize } from '../analytics/public/report.js';

const start = Date.parse('2026-11-17T20:58:00Z');
const minute = 60000;
const time = offset => start + offset * minute;

function entry(type, id, expectedEventId, offset, deviceId = 'anna', sessionId = 'first', extra = {}) {
  const event = {
    type, eventId: id, expectedEventId, eventAt: time(offset), deviceId, sessionId,
    operatorName: deviceId, chatId: 'chat', messageId: 'message', ...extra
  };
  return { sender: deviceId, payload: JSON.stringify(event) };
}

test('analytics keeps one appeal through a transfer and attributes confirmed work to each device', () => {
  const { appeals } = replayJournal([
    entry('START', 'start', '', 0, 'anna', 'first', { requestTime: time(-2) }),
    entry('PAUSE', 'pause', 'start', 4),
    entry('RESUME', 'resume', 'pause', 14),
    entry('TAKEOVER', 'handover', 'resume', 15, 'boris', 'second', { fromDeviceId: 'anna', fromSessionId: 'first' }),
    entry('COMPLETE', 'reply', 'handover', 18, 'boris', 'second', { sentMessageId: 'answer' })
  ]);
  const whole = projectScope(appeals, new Set(['anna', 'boris']));
  assert.equal(whole[0].takenDay, moscowDay(time(0)));
  assert.notEqual(whole[0].takenDay, moscowDay(time(18)));
  assert.deepEqual(summarize(whole, true), { taken: 1, closed: 1, rate: 1, reply: 20, completion: 18, timer: 8 });
  const anna = summarize(projectScope(appeals, new Set(['anna'])), false);
  const boris = summarize(projectScope(appeals, new Set(['boris'])), false);
  assert.deepEqual(anna, { taken: 1, closed: 0, rate: 0, reply: null, completion: null, timer: 5 });
  assert.deepEqual(boris, { taken: 1, closed: 1, rate: 1, reply: 3, completion: 3, timer: 3 });
});

test('cancelling a reopen from a second device restores the original completed appeal', () => {
  const { appeals } = replayJournal([
    entry('START', 'start', '', 0),
    entry('COMPLETE', 'reply', 'start', 4, 'anna', 'first', { sentMessageId: 'answer' }),
    entry('REOPEN', 'reopen', 'reply', 6, 'boris', 'second', { fromDeviceId: 'anna', fromSessionId: 'first' }),
    entry('CANCEL', 'cancel', 'reopen', 8, 'boris', 'second')
  ]);
  assert.equal(appeals[0].closed.owner, 'anna');
  assert.equal(appeals[0].open, null);
  assert.deepEqual(appeals[0].work, [{ owner: 'anna', takenAt: time(0), workedMs: 4 * minute }]);
  assert.equal(summarize(projectScope(appeals, new Set(['anna'])), true).reply, null);
});

test('analytics omits cancelled work and preserves the next valid start', () => {
  const { appeals, rejected } = replayJournal([
    entry('START', 'start', '', 0),
    entry('CANCEL', 'cancel', 'start', 3),
    entry('START', 'new', 'cancel', 15, 'anna', 'next'),
    entry('PAUSE', 'pause', 'new', 20, 'anna', 'next'),
    entry('RENAME', 'rename', 'pause', 22, 'anna', 'next'),
    entry('COMPLETE', 'stale', 'pause', 23, 'anna', 'next', { sentMessageId: 'stale-answer' })
  ]);
  assert.equal(rejected, 1);
  assert.equal(appeals[0].closed, null);
  assert.equal(appeals[0].open.pausedAt, time(20));
  assert.deepEqual(appeals[0].work, [{ owner: 'anna', takenAt: time(15), workedMs: 5 * minute }]);
});

test('analytics combines devices with the same current operator name without duplicating appeals or time', () => {
  const journal = replayJournal([
    entry('START', 'start', '', 0, 'old-device', 'first', { operatorName: '  Salay ' }),
    entry('TAKEOVER', 'handover', 'start', 4, 'new-device', 'next', {
      operatorName: 'SALAY', fromDeviceId: 'old-device', fromSessionId: 'first'
    }),
    entry('COMPLETE', 'reply', 'handover', 7, 'new-device', 'next', { operatorName: 'Salay', sentMessageId: 'answer' })
  ]);
  const initial = groupEmployees(journal);
  const [employee] = initial.people;
  const grouped = groupEmployees(journal, { [employee.id]: { name: 'Александр', department: '' } });
  assert.equal(grouped.people.length, 1);
  assert.equal(grouped.people[0].name, 'Александр');
  assert.equal(grouped.appeals[0].closed.owner, employee.id);
  assert.deepEqual(grouped.appeals[0].work, [{ owner: employee.id, takenAt: time(0), workedMs: 7 * minute }]);
  assert.equal(summarize(projectScope(grouped.appeals, new Set([employee.id])), false).closed, 1);
});
