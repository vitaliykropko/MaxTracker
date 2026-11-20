export const OPEN = new Set(['running', 'paused']);
export const messageKey = value => JSON.stringify([value.chatId, value.messageId]);
export const isChatExcluded = (state, chatId) => state?.excludedChats?.includes(chatId) ?? false;
export const elapsed = (task, now = Date.now()) => Math.max(0, Math.round(
  (task.accumulatedMs || 0) + (task.status === 'running' ? Math.max(0, now - task.lastResumeTime) : 0),
));
export const countedMinutes = ms => Math.max(5, Math.round(ms / 60000));

export function validEvent(e) {
  return !!e && typeof e === 'object' &&
    ['START', 'PAUSE', 'RESUME', 'COMPLETE', 'CANCEL', 'TAKEOVER', 'RESET', 'REOPEN', 'RENAME'].includes(e.type) &&
    ['chatId', 'messageId', 'eventId', 'deviceId', 'sessionId', 'operatorName'].every(k => typeof e[k] === 'string' && e[k].length > 0 && e[k].length <= 512) &&
    Number.isSafeInteger(e.eventAt) && e.eventAt > 0 &&
    typeof e.expectedEventId === 'string' &&
    (!['TAKEOVER','REOPEN'].includes(e.type) || (typeof e.fromSessionId === 'string' && typeof e.fromDeviceId === 'string'));
}

// Same reducer runs for local commands, incoming events and journal replay.
// The LAN server routes envelopes; the workflow decisions live here.
export function reduceEvent(messages, event) {
  if (!validEvent(event)) return { accepted: false, messages, reason: 'Некорректное событие' };
  const key = messageKey(event);
  const old = messages[key];
  if (old?.lastEventId === event.eventId) return { accepted: true, duplicate: true, messages };
  const status = old?.status || 'none';
  const own = old?.ownerDeviceId === event.deviceId && old.sessionId === event.sessionId;
  const expected = event.expectedEventId === (old?.lastEventId || '');
  let next;
  let closed;
  let reset;
  const base = { chatId: event.chatId, messageId: event.messageId, lastEventId: event.eventId, updatedAt: event.eventAt };
  const close = reason => {
    const { reopenedFrom, ...saved } = old;
    return { ...saved, accumulatedMs: elapsed(old, event.eventAt), status: 'completed', closedAt: event.eventAt, closeReason: reason, completionEventId:event.eventId };
  };
  switch (event.type) {
    case 'RENAME':
      if(!own||!expected||!['running','paused','completed'].includes(status))break;
      next={...old,...base,operatorName:event.operatorName};
      if(old.reopenedFrom?.ownerDeviceId===event.deviceId)next.reopenedFrom={...old.reopenedFrom,operatorName:event.operatorName};
      break;
    case 'START':
      if (status !== 'none' || !expected) break;
      next = { ...base, status: 'running', sessionId: event.sessionId, ownerDeviceId: event.deviceId, operatorName: event.operatorName, startedAt: event.eventAt, lastResumeTime: event.eventAt, accumulatedMs: 0 };
      break;
    case 'REOPEN':
      if(status!=='completed'||!expected||event.fromSessionId!==old.sessionId||event.fromDeviceId!==old.ownerDeviceId)break;
      if(old.ownerDeviceId===event.deviceId){
        if(event.sessionId!==old.sessionId)break;
        next={...old,...base,status:'running',lastResumeTime:event.eventAt,reopenedFrom:{...old}};
      }else{
        if(event.sessionId===old.sessionId)break;
        next={...base,status:'running',sessionId:event.sessionId,ownerDeviceId:event.deviceId,operatorName:event.operatorName,startedAt:event.eventAt,lastResumeTime:event.eventAt,accumulatedMs:0,completedMessageIds:old.completedMessageIds||(old.sentMessageId?[old.sentMessageId]:[]),reopenedFrom:{...old}};
      }
      break;
    case 'TAKEOVER':
      if (!OPEN.has(status) || old.ownerDeviceId === event.deviceId || old.sessionId !== event.fromSessionId || old.ownerDeviceId !== event.fromDeviceId) break;
      closed = { ...close('transferred'), transferredTo: event.operatorName, transferId: event.eventId };
      next = { ...base, status: 'running', sessionId: event.sessionId, ownerDeviceId: event.deviceId, operatorName: event.operatorName, startedAt: event.eventAt, lastResumeTime: event.eventAt, accumulatedMs: 0 };
      break;
    case 'PAUSE':
      if (!own || !expected || status !== 'running') break;
      next = { ...old, ...base, status: 'paused', accumulatedMs: elapsed(old, event.eventAt), lastResumeTime: null };
      break;
    case 'RESUME':
      if (!own || !expected || status !== 'paused') break;
      next = { ...old, ...base, status: 'running', lastResumeTime: event.eventAt };
      break;
    case 'COMPLETE':
      if (!own || !expected || !OPEN.has(status) || typeof event.sentMessageId !== 'string') break;
      if(old.sentMessageId===event.sentMessageId||old.completedMessageIds?.includes(event.sentMessageId))break;
      closed = { ...close('reply'), replyText: typeof event.replyText === 'string' ? event.replyText.slice(0,100000) : '', sentMessageId: event.sentMessageId,
        completedMessageIds:[...(old.completedMessageIds||(old.sentMessageId?[old.sentMessageId]:[])),event.sentMessageId] };
      next = { ...closed, ...base, lastResumeTime: null };
      break;
    case 'CANCEL':
      if (!own || !expected || !OPEN.has(status)) break;
      next = old.reopenedFrom ? {...old.reopenedFrom,...base} : { ...old, ...base, status: 'none', closeReason: 'cancelled', accumulatedMs: elapsed(old, event.eventAt), lastResumeTime: null };
      break;
    case 'RESET':
      if (!own || !expected || status !== 'completed') break;
      reset = { ...old };
      next = { ...old, ...base, status: 'none', closeReason: 'reset', lastResumeTime: null };
      break;
  }
  if (!next) return { accepted: false, messages, reason: 'Состояние или исполнитель уже изменились' };
  return { accepted: true, messages: { ...messages, [key]: next }, closed, reset };
}

export function projectMessages(committed, pending) {
  let messages = committed;
  const results = [];
  for (const event of pending) {
    const result = reduceEvent(messages, event);
    if (result.accepted) messages = result.messages;
    results.push({ event, ...result });
  }
  return { messages, results };
}

export function localWorkRecord(closed, metadata, deviceId) {
  if (!closed || closed.ownerDeviceId !== deviceId) return null;
  const ms = closed.accumulatedMs;
  return {
    ...metadata,
    chatId: closed.chatId, messageId: closed.messageId, sessionId: closed.sessionId,
    operatorName: closed.operatorName, ownerDeviceId: deviceId,
    minutes: countedMinutes(ms), startedAt: closed.startedAt, completedAt: closed.closedAt,
    elapsedMs:ms, completionEventId:closed.completionEventId||closed.lastEventId,
    closeReason: closed.closeReason,
    replyText: closed.closeReason === 'transferred' ? `Передано ${closed.transferredTo}` : closed.replyText || '',
    transferId: closed.transferId || null, sentMessageId: closed.sentMessageId || null,
    ttStatus: 'pending',
  };
}

// A repeated closure updates this operator's existing case, retaining delivery
// identity and all answers. The LAN echo has no private reply text and must not
// apply the same closure for a second time.
export function mergeWorkRecord(previous, record){
  if(!previous)return {...record,revision:1,firstCompletedAt:record.completedAt,firstElapsedMs:record.elapsedMs,replies:[{eventId:record.completionEventId,text:record.replyText,sentMessageId:record.sentMessageId,completedAt:record.completedAt}]};
  if(previous.completionEventId===record.completionEventId||previous.replies?.some(r=>r.eventId===record.completionEventId))return previous;
  const replies=previous.replies||[{eventId:previous.completionEventId||`legacy:${previous.sessionId}`,text:previous.replyText,sentMessageId:previous.sentMessageId,completedAt:previous.completedAt}];
  const nextReplies=[...replies,{eventId:record.completionEventId,text:record.replyText,sentMessageId:record.sentMessageId,completedAt:record.completedAt}];
  const knownRemote=previous.ttId!=null||previous.ttStatus==='synced'||previous.ttNeedsLookup;
  return {...previous,...record,
    revision:(previous.revision||0)+1,firstCompletedAt:previous.firstCompletedAt||previous.completedAt,
    replies:nextReplies,replyText:nextReplies.map(r=>r.text).filter(Boolean).join(' | '),
    minutes:Math.max(previous.minutes||0,countedMinutes(record.elapsedMs+(previous.attributionExtraMs||0))),
    ttId:previous.ttId??null,ttAnchor:previous.ttAnchor||((knownRemote&&previous.ttPayload)?{date:previous.ttPayload.date,start_time:previous.ttPayload.start_time}:null),
    ttPayload:previous.ttPayload,ttPayloadRevision:previous.ttPayloadRevision,
    ttNeedsLookup:!!previous.ttNeedsLookup||(previous.ttId==null&&(previous.ttStatus==='sending'||previous.ttStatus==='synced')),
    ttStatus:previous.ttId!=null?'update-pending':'pending',
  };
}

export {exportText} from './export-report.js';
