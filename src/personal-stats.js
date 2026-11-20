import { elapsed, isChatExcluded, messageKey, OPEN } from './task-state.js';

const calendar = new Intl.DateTimeFormat('en-CA', {
  timeZone: 'Europe/Moscow', year: 'numeric', month: '2-digit', day: '2-digit'
});

export const moscowDate = (now = Date.now()) => calendar.format(now);
const timestamp = value => Number.isSafeInteger(value) && value > 0 && value <= 8640000000000000;
const timer = value => Number.isFinite(value) && value >= 0;
const named = value => typeof value === 'string' ? value.trim() : '';

function emptySummary() {
  return {
    taken: 0, closed: 0, running: 0, paused: 0,
    timerTotal: 0, timerCount: 0, closeTotal: 0,
    replyTotal: 0, replyCount: 0, arrivalTotal: 0, arrivalCount: 0
  };
}

function summaryResult(value) {
  return {
    taken: value.taken,
    closed: value.closed,
    rate: value.taken ? value.closed / value.taken : null,
    running: value.running,
    paused: value.paused,
    timerMs: value.timerCount ? value.timerTotal : null,
    completionMs: value.closed ? value.closeTotal / value.closed : null,
    replyMs: value.arrivalCount
      ? value.arrivalTotal / value.arrivalCount
      : value.replyCount ? value.replyTotal / value.replyCount : null,
    replyCount: value.replyCount,
    arrivalCount: value.arrivalCount
  };
}

function ownAppeals(state, now, frozen) {
  const appeals = new Map();
  if (!state?.deviceId) return appeals;
  const messages = state.messages || {};
  const remember = value => {
    const key = messageKey(value);
    if (!appeals.has(key)) appeals.set(key, {
      chatId: value.chatId, title: '', startedAt: Infinity, requestTime: null,
      firstReply: null, lastReply: null, sessions: new Map(), current: messages[key]
    });
    const appeal = appeals.get(key);
    const metadata = state.metadata?.[key];
    appeal.title ||= named(metadata?.chatTitle) || named(value.chatTitle);
    if (timestamp(value.startedAt) && value.startedAt <= now) {
      appeal.startedAt = Math.min(appeal.startedAt, value.startedAt);
    }
    for (const candidate of [metadata?.requestTime, value.requestTime]) {
      if (timestamp(candidate) && candidate <= appeal.startedAt) {
        appeal.requestTime = Math.min(appeal.requestTime ?? candidate, candidate);
      }
    }
    return appeal;
  };
  const addReply = (appeal, time) => {
    if (!timestamp(time) || time > now) return;
    appeal.firstReply = Math.min(appeal.firstReply ?? time, time);
    appeal.lastReply = Math.max(appeal.lastReply ?? time, time);
  };

  for (const record of Object.values(state.records || {})) {
    if (record.deleted || record.ownerDeviceId !== state.deviceId) continue;
    const appeal = remember(record);
    if (timer(record.elapsedMs)) appeal.sessions.set(record.sessionId, record.elapsedMs);
    const replies = (record.replies || []).filter(reply => reply.sentMessageId && reply.eventId !== record.transferId);
    for (const reply of replies) addReply(appeal, reply.completedAt);
    if (record.closeReason === 'reply') addReply(appeal, record.completedAt);
  }

  for (const task of Object.values(messages)) {
    if (task.ownerDeviceId !== state.deviceId || (!OPEN.has(task.status) && task.status !== 'completed')) continue;
    const appeal = remember(task);
    if (timer(task.accumulatedMs)) {
      const worked = !frozen && task.status === 'running' && timestamp(task.lastResumeTime)
        ? elapsed(task, now) : task.accumulatedMs;
      appeal.sessions.set(task.sessionId, worked);
    }
    if (task.status === 'completed') addReply(appeal, task.closedAt);
  }
  return appeals;
}

export function personalStats(state, range, now = Date.now(), frozen = false) {
  const total = emptySummary();
  const chats = new Map();
  const appeals = ownAppeals(state, now, frozen);
  const chatTitles = new Map();
  for (const appeal of appeals.values()) {
    if (appeal.title && !chatTitles.has(appeal.chatId)) chatTitles.set(appeal.chatId, appeal.title);
  }

  for (const appeal of appeals.values()) {
    const { current, startedAt, requestTime, firstReply, lastReply } = appeal;
    if (current?.status === 'none' && current.closeReason === 'reset') continue;
    const isOwn = current?.ownerDeviceId === state.deviceId;
    const live = isOwn && !isChatExcluded(state, appeal.chatId);
    const running = live && current.status === 'running' && !frozen;
    const paused = live && (current.status === 'paused' || (current.status === 'running' && frozen));
    const day = timestamp(startedAt) ? moscowDate(startedAt) : '';
    const inPeriod = !!day && day >= range.from && day <= range.to;
    if (!inPeriod && !running && !paused) continue;
    let chat = chats.get(appeal.chatId);
    if (!chat) {
      chat = emptySummary();
      chats.set(appeal.chatId, chat);
    }
    const closedAt = current ? isOwn && current.status === 'completed' ? current.closedAt : null : lastReply;
    const worked = [...appeal.sessions.values()];

    for (const result of [total, chat]) {
      result.running += Number(running);
      result.paused += Number(paused);
      if (!inPeriod) continue;
      result.taken++;
      if (timestamp(closedAt) && closedAt >= startedAt && closedAt <= now) {
        result.closed++;
        result.closeTotal += closedAt - startedAt;
      }
      if (timestamp(firstReply) && firstReply >= startedAt) {
        result.replyTotal += firstReply - startedAt;
        result.replyCount++;
        if (timestamp(requestTime) && requestTime <= startedAt) {
          result.arrivalTotal += firstReply - requestTime;
          result.arrivalCount++;
        }
      }
      for (const duration of worked) result.timerTotal += duration;
      if (worked.length) result.timerCount++;
    }
  }

  return {
    total: summaryResult(total),
    chats: [...chats].map(([id, summary]) => ({ id, title: chatTitles.get(id) || 'Чат без названия', ...summaryResult(summary) }))
      .sort((first, second) => second.taken - first.taken || first.title.localeCompare(second.title, 'ru'))
  };
}
