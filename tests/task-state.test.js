import test from 'node:test';
import assert from 'node:assert/strict';
import { reduceEvent, messageKey, elapsed, localWorkRecord, mergeWorkRecord, exportText } from '../src/task-state.js';
const identity = { chatId: 'chat_with_separator', messageId: '117546298826250428' };
const e = (type, overrides = {}) => ({ ...identity, type, eventId: type, eventAt: 100000, expectedEventId: '', deviceId: 'anna', operatorName: 'Анна', sessionId: 'anna-session', ...overrides });
const apply = (state, event) => { const r=reduceEvent(state,event); assert.equal(r.accepted,true); return r; };

test('pause, resume and final reply preserve time and require the actual owner', () => {
  let s=apply({},e('START')).messages;
  s=apply(s,e('PAUSE',{expectedEventId:'START',eventAt:160000})).messages;
  assert.equal(elapsed(s[messageKey(identity)],500000),60000);
  s=apply(s,e('RESUME',{expectedEventId:'PAUSE',eventAt:300000})).messages;
  const bad=e('COMPLETE',{expectedEventId:'RESUME',deviceId:'boris',sentMessageId:'answer',eventAt:360000});
  assert.equal(reduceEvent(s,bad).accepted,false);
  const done=apply(s,{...bad,deviceId:'anna'});
  assert.equal(done.closed.accumulatedMs,120000);
  assert.equal(localWorkRecord(done.closed,{},'anna').minutes,5);
  assert.equal(localWorkRecord(done.closed,{},'boris'),null);
});

test('takeover closes only Anna’s work, starts Boris from zero and rejects late Anna events', () => {
  const s=apply({},e('START')).messages;
  const taken=apply(s,e('TAKEOVER',{eventId:'transfer',deviceId:'boris',operatorName:'Борис',sessionId:'boris-session',fromDeviceId:'anna',fromSessionId:'anna-session',expectedEventId:'START',eventAt:280000}));
  assert.equal(taken.closed.closeReason,'transferred');
  assert.equal(taken.closed.accumulatedMs,180000);
  assert.equal(taken.messages[messageKey(identity)].ownerDeviceId,'boris');
  assert.equal(elapsed(taken.messages[messageKey(identity)],280000),0);
  assert.equal(reduceEvent(taken.messages,e('PAUSE',{expectedEventId:'START',eventAt:300000})).accepted,false);
  assert.equal(localWorkRecord(taken.closed,{},'anna').replyText,'Передано Борис');
  assert.equal(localWorkRecord(taken.closed,{},'boris'),null);
  const competing=e('TAKEOVER',{deviceId:'peter',operatorName:'Петр',sessionId:'peter-session',fromDeviceId:'anna',fromSessionId:'anna-session'});
  assert.equal(reduceEvent(taken.messages,competing).accepted,false);
});

test('only the last executor resets completion and stale starts cannot resurrect a reset', () => {
  let s=apply({},e('START')).messages;
  s=apply(s,e('COMPLETE',{expectedEventId:'START',sentMessageId:'answer',eventAt:400000})).messages;
  assert.equal(reduceEvent(s,e('RESET',{deviceId:'other',expectedEventId:'COMPLETE'})).accepted,false);
  s=apply(s,e('RESET',{expectedEventId:'COMPLETE',eventAt:500000})).messages;
  assert.equal(s[messageKey(identity)].status,'none');
  assert.equal(reduceEvent(s,e('START')).accepted,false);
  assert.equal(reduceEvent(s,e('START',{eventId:'new-start',sessionId:'new-session',expectedEventId:'RESET',eventAt:600000})).accepted,true);
});

test('duplicate events have no second completion effect and cancelled work creates no record', () => {
  let r=apply({},e('START'));
  r=apply(r.messages,e('COMPLETE',{expectedEventId:'START',sentMessageId:'answer'}));
  const twice=reduceEvent(r.messages,e('COMPLETE',{expectedEventId:'START',sentMessageId:'answer'}));
  assert.equal(twice.duplicate,true);
  assert.equal(twice.closed,undefined);
  const cancel=apply(apply({},e('START')).messages,e('CANCEL',{expectedEventId:'START'}));
  assert.equal(cancel.closed,undefined);
});

test('TXT includes timer, accounted minutes, all answers and distinct operator periods', () => {
  const records={one:{chatTitle:'Чат',authorName:'Автор',requestText:'Вопрос',replyText:'Ответ | Уточнение',elapsedMs:61000,minutes:12,completedAt:1},two:{chatTitle:'Чат',authorName:'Автор',requestText:'Вопрос',replyText:'Передано Борису',elapsedMs:120000,minutes:5,completedAt:2},removed:{deleted:true}};
  const text=exportText(records);
  assert.match(text,/Обращений: 2 \| По таймеру: 00:03:01 \| Учтено: 17 мин/);
  assert.match(text,/Ответ \| Уточнение/);assert.match(text,/Передано Борису/);
  assert.match(text,/По таймеру: 00:01:01 \| Учтено: 12 мин/);
});

test('own dialog reopens the same case, excludes closed gaps and applies the minimum once',()=>{
  let result=apply({},e('START',{eventAt:100000}));
  let record;
  for(const [i,start,end] of [[1,100000,220000],[2,1000000,1120000],[3,2000000,2180000]]){
    if(i>1)result=apply(result.messages,e('REOPEN',{eventId:`open${i}`,expectedEventId:`done${i-1}`,eventAt:start,fromDeviceId:'anna',fromSessionId:'anna-session'}));
    result=apply(result.messages,e('COMPLETE',{eventId:`done${i}`,expectedEventId:i===1?'START':`open${i}`,eventAt:end,sentMessageId:`answer${i}`,replyText:`Ответ ${i}`}));
    record=mergeWorkRecord(record,localWorkRecord(result.closed,{},'anna'));
    assert.equal(record.minutes,i<3?5:7);
  }
  assert.equal(record.elapsedMs,420000);
  assert.equal(record.sessionId,'anna-session');
  assert.equal(record.replyText,'Ответ 1 | Ответ 2 | Ответ 3');
  assert.equal(record.replies.length,3);
  const echo={...localWorkRecord(result.closed,{},'anna'),replyText:''};
  assert.equal(mergeWorkRecord(record,echo),record,'private answers survive LAN echo');
  assert.equal(mergeWorkRecord(record,{...echo,completionEventId:'done1'}),record,'older echoes cannot replace the latest completion');
});

test('another operator opens a separate case; cancelling a reopen restores the last completed case',()=>{
  let result=apply({},e('START'));
  result=apply(result.messages,e('COMPLETE',{eventAt:220000,expectedEventId:'START',sentMessageId:'first',replyText:'Готово'}));
  const completed=result.messages[messageKey(identity)];
  const reopen=e('REOPEN',{eventId:'boris-reopen',eventAt:500000,expectedEventId:'COMPLETE',deviceId:'boris',operatorName:'Борис',sessionId:'boris-new',fromDeviceId:'anna',fromSessionId:'anna-session'});
  result=apply(result.messages,reopen);
  assert.equal(elapsed(result.messages[messageKey(identity)],500000),0);
  assert.equal(result.closed,undefined,'completed colleague work is not written again');
  assert.equal(reduceEvent(result.messages,{...reopen,eventId:'stale-reopen'}).accepted,false);
  const cancelled=apply(result.messages,{...reopen,type:'CANCEL',eventId:'cancel',expectedEventId:'boris-reopen',eventAt:560000});
  assert.equal(cancelled.messages[messageKey(identity)].status,'completed');
  assert.equal(cancelled.messages[messageKey(identity)].ownerDeviceId,'anna');
  assert.equal(cancelled.messages[messageKey(identity)].accumulatedMs,completed.accumulatedMs);
  result=apply(result.messages,{...reopen,type:'COMPLETE',eventId:'boris-done',expectedEventId:'boris-reopen',eventAt:560000,sentMessageId:'second',replyText:'Мой ответ'});
  assert.equal(localWorkRecord(result.closed,{},'anna'),null);
  assert.equal(localWorkRecord(result.closed,{},'boris').sessionId,'boris-new');
});

test('legacy TimeTracker identity and original activity attribution survive continued work',()=>{
  const old={sessionId:'case',completionEventId:'first',replyText:'Первый ответ',completedAt:1000,minutes:12,elapsedMs:120000,attributionExtraMs:600000,ttId:42,ttStatus:'synced',ttPayload:{date:'2026-11-01',start_time:'2026-11-01T09:00:00Z'}};
  const next=mergeWorkRecord(old,{sessionId:'case',completionEventId:'next',replyText:'Следующий ответ',completedAt:1000000,minutes:5,elapsedMs:300000});
  assert.equal(next.ttId,42);assert.equal(next.ttStatus,'update-pending');
  assert.equal(next.minutes,15,'new actual work is added to the originally attributed time');
  assert.equal(next.ttAnchor.date,'2026-11-01');assert.equal(next.firstCompletedAt,1000);
  assert.equal(next.replyText,'Первый ответ | Следующий ответ');
});

test('a delayed old reply acknowledgement cannot close a reopened dialog',()=>{
  let result=apply({},e('START'));
  result=apply(result.messages,e('COMPLETE',{eventAt:220000,expectedEventId:'START',sentMessageId:'old-answer'}));
  result=apply(result.messages,e('REOPEN',{eventId:'reopen',expectedEventId:'COMPLETE',eventAt:1000000,fromDeviceId:'anna',fromSessionId:'anna-session'}));
  assert.equal(reduceEvent(result.messages,e('COMPLETE',{eventId:'duplicate-confirmation',expectedEventId:'reopen',sentMessageId:'old-answer',eventAt:1010000})).accepted,false);
  assert.equal(result.messages[messageKey(identity)].status,'running');
});

test('operator rename changes visible identity without changing ownership or time',()=>{
  let result=apply({},e('START'));
  result=apply(result.messages,e('RENAME',{eventId:'named',expectedEventId:'START',operatorName:'Анна Иванова',eventAt:160000}));
  const task=result.messages[messageKey(identity)];
  assert.equal(task.operatorName,'Анна Иванова');assert.equal(task.status,'running');
  assert.equal(task.ownerDeviceId,'anna');assert.equal(task.sessionId,'anna-session');assert.equal(task.lastResumeTime,100000);
  assert.equal(result.closed,undefined);
  const moved=apply(result.messages,e('TAKEOVER',{eventId:'moved',expectedEventId:'named',deviceId:'boris',operatorName:'Борис',sessionId:'boris-session',fromDeviceId:'anna',fromSessionId:'anna-session',eventAt:200000}));
  assert.equal(reduceEvent(moved.messages,e('RENAME',{expectedEventId:'moved',operatorName:'Чужое имя'})).accepted,false);
  let reopened=apply(result.messages,e('COMPLETE',{expectedEventId:'named',sentMessageId:'answer',eventAt:210000}));
  reopened=apply(reopened.messages,e('REOPEN',{expectedEventId:'COMPLETE',fromDeviceId:'anna',fromSessionId:'anna-session',eventAt:250000}));
  reopened=apply(reopened.messages,e('RENAME',{expectedEventId:'REOPEN',operatorName:'Анна Петрова',eventAt:260000}));
  reopened=apply(reopened.messages,e('CANCEL',{expectedEventId:'RENAME',eventAt:270000}));
  assert.equal(reopened.messages[messageKey(identity)].operatorName,'Анна Петрова','cancelling a reopened case retains the new name');
  assert.equal(reopened.messages[messageKey(identity)].status,'completed');
});
