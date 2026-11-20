import { DatabaseSync } from 'node:sqlite';
import { createHash } from 'node:crypto';
import { messageKey, reduceEvent } from '../src/task-state.js';

function addParticipant(appeal, state) {
  if (!appeal.sessions.has(state.sessionId)) {
    appeal.sessions.set(state.sessionId, {
      owner: state.ownerDeviceId,
      takenAt: state.startedAt,
      workedMs: 0
    });
  }
}

export function replayJournal(rows) {
  const history = new Map();
  const people = new Map();
  let rejected = 0;
  let earliestEventAt = null;
  let latestEventAt = null;

  for (const row of rows) {
    let event;
    try {
      event = JSON.parse(row.payload);
    } catch {
      rejected++;
      continue;
    }
    if (!event || event.deviceId !== row.sender) {
      rejected++;
      continue;
    }

    const key = messageKey(event);
    const entry = history.get(key) ?? { state: null, appeal: null, pausedAt: null };
    const previous = entry.state;
    const result = reduceEvent(previous ? { [key]: previous } : {}, event);
    if (!result.accepted) {
      rejected++;
      continue;
    }
    if (result.duplicate) continue;
    entry.state = result.messages[key];
    history.set(key, entry);
    people.set(event.deviceId, event.operatorName);
    earliestEventAt = Math.min(earliestEventAt ?? event.eventAt, event.eventAt);
    latestEventAt = Math.max(latestEventAt ?? event.eventAt, event.eventAt);

    if (event.type === 'START') {
      entry.appeal = {
        messageId: event.messageId,
        chat: event.chatId,
        receivedAt: null,
        firstReply: null,
        sessions: new Map()
      };
    }
    if (entry.state.status === 'none') {
      entry.appeal = null;
      entry.pausedAt = null;
      continue;
    }
    const appeal = entry.appeal;
    if (!appeal) continue;

    if (Number.isSafeInteger(event.requestTime) && event.requestTime > 0 && event.requestTime <= event.eventAt) {
      appeal.receivedAt ??= event.requestTime;
    }
    if (event.type === 'CANCEL' && previous.sessionId !== entry.state.sessionId) {
      appeal.sessions.delete(previous.sessionId);
    }
    addParticipant(appeal, entry.state);
    if (result.closed) {
      const work = appeal.sessions.get(result.closed.sessionId);
      work.workedMs = result.closed.accumulatedMs;
      if (event.type === 'COMPLETE' && !appeal.firstReply) {
        appeal.firstReply = { at: event.eventAt, owner: event.deviceId };
      }
    }
    if (event.type === 'PAUSE') entry.pausedAt = event.eventAt;
    else if (entry.state.status !== 'paused') entry.pausedAt = null;
  }

  const appeals = [];
  for (const { state, appeal, pausedAt } of history.values()) {
    if (!appeal) continue;
    const work = new Map();
    for (const [sessionId, session] of appeal.sessions) {
      const confirmed = sessionId === state.sessionId ? state.accumulatedMs : session.workedMs;
      const person = work.get(session.owner) ?? { owner: session.owner, takenAt: session.takenAt, workedMs: 0 };
      person.takenAt = Math.min(person.takenAt, session.takenAt);
      person.workedMs += confirmed ?? 0;
      work.set(session.owner, person);
    }
    appeals.push({
      messageId: appeal.messageId,
      chat: appeal.chat,
      receivedAt: appeal.receivedAt,
      firstReply: appeal.firstReply,
      closed: state.status === 'completed' ? { at: state.closedAt, owner: state.ownerDeviceId } : null,
      open: state.status === 'completed' ? null : { owner: state.ownerDeviceId, pausedAt },
      work: [...work.values()]
    });
  }
  return { appeals, people, rejected, earliestEventAt, latestEventAt };
}

export function readJournal(path) {
  const database = new DatabaseSync(path, { readOnly: true });
  try {
    database.exec('PRAGMA query_only=ON; PRAGMA busy_timeout=2500; BEGIN;');
    const rows = database.prepare('SELECT sender, payload FROM events ORDER BY sequence').all();
    const peers = database.prepare('SELECT device_id, operator_name FROM peers').all();
    database.exec('COMMIT');
    const report = replayJournal(rows);
    for (const peer of peers) report.people.set(peer.device_id, peer.operator_name);
    return { ...report, events: rows.length };
  } finally {
    database.close();
  }
}

export function groupEmployees(report, settings = {}) {
  const identities = new Map();
  const devices = new Map();
  for (const [device, original] of report.people) {
    const name = original.normalize('NFC').trim().replace(/\s+/g, ' ');
    const key = name.toLocaleLowerCase('ru');
    const id = 'person:' + createHash('sha256').update(key || device).digest('hex').slice(0, 24);
    const group = identities.get(id) ?? { id, original: name, legacy: null };
    if (Object.hasOwn(settings, device)) {
      const custom = settings[device];
      if (!group.legacy || custom.name || custom.department) group.legacy = custom;
    }
    identities.set(id, group);
    devices.set(device, id);
  }
  const people = [...identities.values()].map(({ id, original, legacy }) => {
    const custom = Object.hasOwn(settings, id) ? settings[id] : legacy ?? {};
    return { id, original, name: custom.name || original, department: custom.department || '', custom };
  });
  const remap = value => value && { ...value, owner: devices.get(value.owner) };
  const appeals = report.appeals.map(appeal => {
    const work = new Map();
    for (const item of appeal.work) {
      const owner = devices.get(item.owner);
      const combined = work.get(owner) ?? { owner, takenAt: item.takenAt, workedMs: 0 };
      combined.takenAt = Math.min(combined.takenAt, item.takenAt);
      combined.workedMs += item.workedMs;
      work.set(owner, combined);
    }
    return {
      ...appeal,
      firstReply: remap(appeal.firstReply),
      closed: remap(appeal.closed),
      open: remap(appeal.open),
      work: [...work.values()]
    };
  });
  return { people, appeals };
}
