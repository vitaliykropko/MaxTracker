import assert from 'node:assert/strict';
import test from 'node:test';
import { moscowDate, personalStats } from '../src/personal-stats.js';
import { messageKey } from '../src/task-state.js';

const minute = 60000;
const dayStart = Date.parse('2026-11-19T21:00:00Z');
const at = minutes => dayStart + minutes * minute;
const today = { from: '2026-11-20', to: '2026-11-20' };
const state = () => ({ deviceId: 'mine', records: {}, metadata: {}, messages: {} });

function item(chatId, messageId, fields) {
  return { chatId, messageId, sessionId: messageId, ownerDeviceId: 'mine', ...fields };
}

test('personal stats use Moscow dates, ignore colleagues, and break down measured times by exact chat ID', () => {
  const local = state();
  const complete = item('one', 'now', {
    startedAt: at(3), completedAt: at(13), requestTime: at(-9), elapsedMs: 4 * minute,
    closeReason: 'reply', sentMessageId: 'answer'
  });
  const yesterday = item('two','earlier',{
    startedAt: at(-1), status: 'paused', accumulatedMs: 0
  });
  const colleague = item('one','foreign',{
    ownerDeviceId: 'peer', startedAt: at(6), completedAt: at(8), elapsedMs: 2 * minute, closeReason: 'reply'
  });
  local.records = { complete, colleague, deleted: item('three', 'removed', { startedAt: at(9), deleted: true }) };
  local.messages = {
    [messageKey(complete)]: { ...complete, status: 'completed', closedAt: at(13), accumulatedMs: 4 * minute },
    [messageKey(yesterday)]: yesterday,
    [messageKey(colleague)]: { ...colleague, status: 'running', lastResumeTime: at(6) }
  };
  local.metadata = {
    [messageKey(complete)]: { chatTitle: 'Поддержка' },
    [messageKey(yesterday)]: { chatTitle: 'Отчёты' }
  };
  const report = personalStats(local, today, at(30));
  assert.equal(moscowDate(at(-1)), '2026-11-19');
  assert.deepEqual(report.total, {
    taken: 1, closed: 1, rate: 1, running: 0, paused: 1, timerMs: 4 * minute,
    completionMs: 10 * minute, replyMs: 22 * minute, replyCount: 1, arrivalCount: 1
  });
  assert.deepEqual(report.chats.map(chat => [chat.id, chat.title, chat.taken, chat.paused]), [
    ['one', 'Поддержка', 1, 0], ['two', 'Отчёты', 0, 1]
  ]);
  assert.equal(personalStats(local, { from: '2026-11-01', to: today.to }, at(30)).total.taken, 2);
  assert.equal(personalStats(local, { from: '2026-11-19', to: '2026-11-19' }, at(30)).total.taken, 1);
});

test('reopened work replaces the prior timer snapshot, while transfer time cannot act as a reply', () => {
  const local = state();
  const answered = item('one', 'reopened', {
    startedAt: at(2), completedAt: at(5), elapsedMs: 3 * minute, closeReason: 'reply',
    replies: [{ completedAt: at(5), sentMessageId: 'reply', eventId: 'complete' }]
  });
  const transferred = item('two', 'transferred', {
    startedAt: at(3), completedAt: at(8), elapsedMs: 2 * minute, closeReason: 'transferred',
    transferId: 'transfer', replies: [{ completedAt: at(8), sentMessageId: null, eventId: 'transfer' }]
  });
  local.records = { answered, transferred };
  local.messages = {
    [messageKey(answered)]: { ...answered, status: 'running', accumulatedMs: 3 * minute, lastResumeTime: at(10) },
    [messageKey(transferred)]: { ...transferred, status: 'running', ownerDeviceId: 'peer', lastResumeTime: at(8) }
  };
  const report = personalStats(local, today, at(14));
  assert.equal(report.total.taken, 2);
  assert.equal(report.total.closed, 0);
  assert.equal(report.total.rate, 0);
  assert.equal(report.total.timerMs, 9 * minute);
  assert.equal(report.total.replyMs, 3 * minute);
  assert.equal(report.total.arrivalCount, 0);
  assert.equal(report.total.running, 1);
  const saved = personalStats(local, today, at(14), true).total;
  assert.equal(saved.timerMs, 5 * minute);
  assert.equal(saved.running, 0);
  assert.equal(saved.paused, 1);
});
