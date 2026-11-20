export const dayMs = 86400000;
const minuteMs = 60000;
const moscowCalendar = new Intl.DateTimeFormat('en', {
  year: 'numeric', month: 'numeric', day: 'numeric', timeZone: 'Europe/Moscow'
});
const calendarDays = new Map();

export function moscowDay(timestamp) {
  if (!calendarDays.has(timestamp)) {
    const parts = Object.fromEntries(moscowCalendar.formatToParts(timestamp).map(({ type, value }) => [type, Number(value)]));
    calendarDays.set(timestamp, Date.UTC(parts.year, parts.month - 1, parts.day) / dayMs);
  }
  return calendarDays.get(timestamp);
}

export function projectScope(appeals, owners) {
  const scoped = [];
  for (const appeal of appeals) {
    const work = appeal.work.filter(item => owners.has(item.owner));
    if (!work.length) continue;
    const taken = Math.min(...work.map(item => item.takenAt));
    const reply = appeal.firstReply && owners.has(appeal.firstReply.owner) ? appeal.firstReply.at : null;
    scoped.push({
      id: appeal.messageId,
      chat: appeal.chat,
      taken,
      takenDay: moscowDay(taken),
      received: appeal.receivedAt,
      reply,
      closed: appeal.closed && owners.has(appeal.closed.owner) ? appeal.closed.at : null,
      open: appeal.open && owners.has(appeal.open.owner) ? appeal.open : null,
      timer: work.reduce((total, item) => total + item.workedMs, 0) / minuteMs
    });
  }
  return scoped;
}

function mean(values) {
  return values.length ? values.reduce((total, value) => total + value, 0) / values.length / minuteMs : null;
}

export function summarize(cases, useReceivedTime) {
  const closed = cases.filter(item => item.closed !== null && item.closed >= item.taken);
  const replies = [];
  for (const item of cases) {
    const start = useReceivedTime ? item.received : item.taken;
    if (start !== null && item.reply !== null && item.reply >= start) replies.push(item.reply - start);
  }
  return {
    taken: cases.length,
    closed: closed.length,
    rate: cases.length ? closed.length / cases.length : null,
    reply: mean(replies),
    completion: mean(closed.map(item => item.closed - item.taken)),
    timer: cases.length ? cases.reduce((sum, item) => sum + item.timer, 0) : null
  };
}
