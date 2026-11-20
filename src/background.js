import { OPEN, isChatExcluded, messageKey, projectMessages, reduceEvent, localWorkRecord, mergeWorkRecord, exportText } from './task-state.js';
import { attributeMinutes } from './attribution.js';
import { needsTimeTrackerSync, syncTimeTracker, timeTrackerPayload as ttPayload } from './timetracker-sync.js';
import { hasOperatorName, normalizeOperatorName } from './operator-name.js';
import { cachedMaxProfile, parseMaxProfile } from './max-profile.js';

const STORAGE = 'maxtracker_v3';
let doc;
let durableDoc;
let serial = Promise.resolve();
let socket;
let retryTimer;
let pingTimer;
let retryMs = 1500;
let mismatch = false;
let ttBusy = false;
const ports = new Set();
let lan = { connected: false, detail: 'Подключение…' };
const loading = (async () => {
  const stored = (await chrome.storage.local.get(STORAGE))[STORAGE];
  doc = stored?.version === 3 ? stored : {
    version: 3, deviceId: crypto.randomUUID(),
    config: { operatorName: 'Оператор', lanUrl: 'ws://192.168.100.90:8766', lanEnabled: true },
    committed: {}, pending: [], cursor: 0, metadata: {}, records: {}, suppressed: {}, lastAlive: Date.now(),
  };
  for(const record of Object.values(doc.records)){
    if(!record.completionEventId){
      const task=(doc.displayMessages||doc.committed)[messageKey(record)];
      const pending=doc.pending.find(e=>e.type==='COMPLETE'&&e.sessionId===record.sessionId||e.type==='TAKEOVER'&&e.fromSessionId===record.sessionId);
      record.completionEventId=pending?.eventId||(task?.sessionId===record.sessionId&&task.status==='completed'?task.lastEventId:undefined);
      if(record.elapsedMs==null&&task?.sessionId===record.sessionId)record.elapsedMs=task.accumulatedMs;
    }
    record.firstCompletedAt||=record.completedAt;
    record.firstElapsedMs??=record.elapsedMs;
    if(record.attributionExtraMs==null&&record.elapsedMs!=null&&record.minutes>5)record.attributionExtraMs=Math.max(0,record.minutes*60000-record.elapsedMs);
    record.revision||=0;
    if(record.ttPayload&&record.ttPayloadRevision==null)record.ttPayloadRevision=record.revision;
    if(record.ttPayload&&record.ttStatus==='synced')record.ttAnchor||={date:record.ttPayload.date,start_time:record.ttPayload.start_time};
  }
  durableDoc = structuredClone(doc);
  const boot = await chrome.storage.session.get('maxtracker_boot');
  if (!boot.maxtracker_boot) {
    // Session storage survives worker suspension, but not a full browser exit.
    // Freeze before tabs/loading events can add the browser's closed time.
    pauseOthers(null, doc.lastAlive || Date.now());
    await chrome.storage.session.set({ maxtracker_boot: true });
  }
  await save();
})();
function exclusive(fn) {
  const result = serial.then(async () => { await loading; return fn(); });
  serial = result.catch(() => {});
  return result;
}
function projection() { return projectMessages(doc.committed, doc.pending); }
function snapshot() {
  return { version: 3, deviceId: doc.deviceId, config: doc.config, needsName:!hasOperatorName(doc.config.operatorName), messages: projection().messages, metadata: doc.metadata, records: doc.records, lan, suppressed: doc.suppressed, excludedChats: doc.excludedChats ?? [], maxProfile: cachedMaxProfile(doc) };
}
async function save() {
  // One durable document contains the transition, local work and delivery queues.
  doc.displayMessages = projectMessages(doc.committed, doc.pending).messages;
  try {
    await chrome.storage.local.set({ [STORAGE]: doc });
    durableDoc = structuredClone(doc);
  } catch {
    doc = structuredClone(durableDoc);
    throw Error('Не удалось сохранить задачу в памяти браузера. Проверьте свободное место.');
  }
}
function broadcast() {
  const state = snapshot();
  for (const port of ports) { try { port.postMessage({ type: 'STATE', state }); } catch { ports.delete(port); } }
  return state;
}
function addEffects(result) {
  if (!result.accepted || result.duplicate) return;
  const record = localWorkRecord(result.closed, doc.metadata[messageKey(result.closed || {})] || {}, doc.deviceId);
  if(record)doc.records[record.sessionId]=mergeWorkRecord(doc.records[record.sessionId],record);
  if (result.reset?.ownerDeviceId === doc.deviceId) {
    const record = doc.records[result.reset.sessionId];
    if (record) {
      record.deleted = true;
      record.ttStatus = record.ttId!=null||record.ttNeedsLookup||['synced','updating','update-pending'].includes(record.ttStatus) ? 'delete-pending' : record.ttStatus === 'sending' ? 'delete-after-send' : 'cancelled';
    }
  }
}
function createEvent(type, target, extra = {}) {
  const old = projection().messages[messageKey(target)];
  return {
    type, chatId: target.chatId, messageId: target.messageId,
    eventId: crypto.randomUUID(), eventAt: Date.now(), deviceId: doc.deviceId,
    operatorName: doc.config.operatorName,
    sessionId: ['START','TAKEOVER'].includes(type)||type==='REOPEN'&&old?.ownerDeviceId!==doc.deviceId ? crypto.randomUUID() : old?.sessionId || '',
    expectedEventId: old?.lastEventId || '', ...extra,
  };
}
function appendEvent(event) {
  const result = reduceEvent(projection().messages, event);
  if (!result.accepted) throw Error(result.reason);
  doc.pending.push(event);
  addEffects(result);
  return result;
}
function pauseOthers(exceptKey, time = Date.now()) {
  for (const task of Object.values(projection().messages)) {
    if (task.ownerDeviceId === doc.deviceId && task.status === 'running' && messageKey(task) !== exceptKey) {
      appendEvent(createEvent('PAUSE', task, { eventAt: Math.max(task.lastResumeTime, time) }));
    }
  }
}
async function command(message, sender) {
  const target = message.target;
  const action = message.action;
  if (!target || typeof target.chatId !== 'string' || typeof target.messageId !== 'string') throw Error('Не получены серверные ID сообщения');
  if (isChatExcluded(doc, target.chatId)) return { state: snapshot() };
  const key = messageKey(target);
  let old = projection().messages[key];
  if (action === 'REPLY_SELECTED') {
    if (!target.canTrack || target.isOut) return { state: broadcast() };
    if (old && OPEN.has(old.status) && old.ownerDeviceId !== doc.deviceId) return { needsTakeover: true, task: old, state: broadcast() };
    if (doc.suppressed[key]&&old?.status!=='completed') return { state: broadcast(), suppressed: true };
    if (old?.status === 'running') return { state: broadcast() };
    pauseOthers(key);
    doc.metadata[key] = { ...target, ownerTabId: sender.tab?.id, ownerDocumentId: sender.documentId || '' };
    if(old?.status==='completed'){
      appendEvent(createEvent('REOPEN',target,{fromSessionId:old.sessionId,fromDeviceId:old.ownerDeviceId}));
      delete doc.suppressed[key];
    }else appendEvent(createEvent(old?.status === 'paused' ? 'RESUME' : 'START', target));
  } else if (action === 'TAKEOVER') {
    if (!old || !OPEN.has(old.status) || old.ownerDeviceId === doc.deviceId) throw Error('Исполнитель уже изменился');
    if (message.fromSessionId !== old.sessionId) throw Error('Задача уже передана другому сотруднику');
    pauseOthers(key);
    doc.metadata[key] = { ...target, ownerTabId: sender.tab?.id, ownerDocumentId: sender.documentId || '' };
    appendEvent(createEvent('TAKEOVER', target, { fromSessionId: old.sessionId, fromDeviceId: old.ownerDeviceId }));
    delete doc.suppressed[key];
  } else if (action === 'PAUSE' || action === 'RESUME' || action === 'CANCEL' || action === 'RESET') {
    if (!old || old.ownerDeviceId !== doc.deviceId) throw Error('Управление доступно только исполнителю');
    if (action === 'RESUME') {
      pauseOthers(key);
      doc.metadata[key] = { ...doc.metadata[key], ownerTabId: sender.tab?.id, ownerDocumentId: sender.documentId || '' };
    }
    appendEvent(createEvent(action, target));
    if (action === 'CANCEL' && message.suppressReply !== false) doc.suppressed[key] = true;
    else if (action === 'CANCEL' || action === 'RESET') delete doc.suppressed[key];
  } else if (action === 'COMPLETE') {
    if (!old || old.ownerDeviceId !== doc.deviceId || !OPEN.has(old.status)) return { state: broadcast() };
    if(old.sentMessageId===message.sentMessageId||old.completedMessageIds?.includes(message.sentMessageId))return{state:broadcast()};
    appendEvent(createEvent('COMPLETE', target, { sentMessageId: message.sentMessageId, replyText: message.replyText || '' }));
    doc.suppressed[key] = true;
  } else throw Error('Неизвестная команда');
  await save();
  const state = broadcast();
  flushLan();
  void flushTimeTracker();
  return { state };
}

function flushLan() {
  if (socket?.readyState !== WebSocket.OPEN || !lan.connected) return;
  for (const event of doc.pending) {
    const { replyText, ...wireEvent } = event;
    try { socket.send(JSON.stringify({ type: 'EVENT', event: wireEvent })); } catch { return; }
  }
}
function connectLan() {
  clearTimeout(retryTimer);
  clearInterval(pingTimer);
  if (!doc.config.lanEnabled) { lan = { connected: false, detail: 'Автономный режим' }; broadcast(); return; }
  if (socket?.readyState === WebSocket.OPEN || socket?.readyState === WebSocket.CONNECTING) return;
  mismatch = false;
  lan = { connected: false, detail: 'Подключение…' };
  broadcast();
  const hubUrl = doc.config.lanUrl;
  let ws;
  try { ws = new WebSocket(hubUrl); } catch {
    lan = { connected: false, detail: 'Подключение недоступно. Изменения сохранены.' };
    broadcast();retryTimer=setTimeout(connectLan,Math.min(30000,retryMs*=2));return;
  }
  socket = ws;
  let lastReceived = Date.now();
  ws.onopen = () => {
    if (socket !== ws) return;
    retryMs = 1500;
    ws.send(JSON.stringify({ type: 'HELLO', protocol: 3, deviceId: doc.deviceId, operatorName: doc.config.operatorName, cursor: doc.cursor, capabilities: ['max-profile-v1'] }));
    pingTimer = setInterval(() => {
      if (Date.now()-lastReceived>45000) { ws.close();return; }
      if (ws.readyState === WebSocket.OPEN) { try { ws.send(JSON.stringify({ type: 'PING' })); } catch { ws.close(); } }
    }, 20000);
  };
  ws.onmessage = event => {
    if (socket !== ws) return;
    lastReceived = Date.now();
    let data;
    try { data = JSON.parse(event.data); } catch { return; }
    if (data.type === 'SYNC_STATE') {
      mismatch = true;
      lan = { connected: false, detail: 'Текущий хаб использует старый протокол. Нужен LAN Hub 3.' };
      broadcast(); ws.close(); return;
    }
    if (data.type === 'WELCOME' && data.protocol === 3) {
      lan = { connected: true, detail: 'Подключено', peers: data.peers || [] };
      broadcast(); flushLan(); return;
    }
    if (data.type === 'MAX_PROFILE' && lan.connected) {
      const profile = parseMaxProfile(data.profile);
      if (profile) void exclusive(async () => {
        if (socket !== ws || doc.config.lanUrl !== hubUrl || JSON.stringify(cachedMaxProfile(doc)) === JSON.stringify(profile)) return;
        doc.maxCompatibility = {hubUrl, profile};
        await save();
        broadcast();
      }).catch(error => notify(error.message));
      return;
    }
    if (data.type === 'ERROR') { lan = { connected: false, detail: data.error || 'Хаб отклонил подключение' };broadcast(); }
    if (data.type === 'BATCH' && Array.isArray(data.entries)) void exclusive(async () => {
      for (const entry of data.entries) {
        if (!Number.isSafeInteger(entry.sequence) || entry.sequence <= doc.cursor) continue;
        if (entry.sequence !== doc.cursor + 1) { ws.close(); return; }
        const result = reduceEvent(doc.committed, entry.event);
        if (result.accepted) { doc.committed = result.messages; addEffects(result); }
        const wasPending = doc.pending.some(e => e.eventId === entry.event?.eventId);
        doc.pending = doc.pending.filter(e => e.eventId !== entry.event?.eventId);
        if (wasPending && !result.accepted) notify('Состояние обращения изменилось у коллеги. Локальная команда не применена.');
        doc.cursor = entry.sequence;
      }
      await save(); broadcast();
      if (ws.readyState === WebSocket.OPEN) ws.send(JSON.stringify({ type: 'RECEIVED', sequence: doc.cursor }));
      void flushTimeTracker();
    }).catch(error => notify(error.message));
  };
  ws.onerror = () => {};
  ws.onclose = () => {
    if (socket !== ws) return;
    clearInterval(pingTimer);
    if (!mismatch) {
      lan = { connected: false, detail: 'Нет связи. Изменения сохранены локально.' };
      broadcast();
      retryTimer = setTimeout(connectLan, retryMs);
      retryMs = Math.min(30000, retryMs * 2);
    }
  };
}
function notify(text) { for (const port of ports) { try { port.postMessage({ type: 'NOTICE', text }); } catch {} } }

async function ttFetch(path, options = {}) {
  return fetch(`http://127.0.0.1:5000${path}`, { ...options, signal: AbortSignal.timeout(3000) });
}
async function refreshTimeTrackerTabs() {
  try {
    const tabs=await chrome.tabs.query({url:['http://127.0.0.1/*','http://localhost/*']});
    for(const tab of tabs){
      if(tab.id==null||!tab.url)continue;
      const url=new URL(tab.url);
      if(url.port==='5000')void chrome.tabs.reload(tab.id).catch(()=>{});
    }
  } catch { /* Refreshing an optional UI does not affect the saved work. */ }
}
async function flushTimeTracker() {
  await loading;
  if (ttBusy || !Object.values(doc.records).some(needsTimeTrackerSync)) return;
  ttBusy = true;
  let followUp=false;
  try {
    followUp=await syncTimeTracker({
      getRecords:()=>doc.records,
      commit:fn=>exclusive(async()=>{const result=fn(doc.records);await save();broadcast();return result;}),
      request:ttFetch,onChanged:()=>void refreshTimeTrackerTabs(),
      prepare:async record=>{
        let minutes=record.minutes;
        let extraMs=record.attributionExtraMs||0;
        if(!record.ttPayload&&!record.ttAnchor){
          try {
            const dataResponse = await ttFetch(`/api/data?date=${encodeURIComponent(ttPayload(record).date)}`);
            if (dataResponse.ok) {
              const data = await dataResponse.json();
              if (Array.isArray(data.records)) {
                const attributed = attributeMinutes(data.records, record.chatTitle || '', `${record.requestText || ''} ${record.replyText || ''}`, record.firstCompletedAt||record.completedAt, record.startedAt);
                extraMs=Math.max(0,Math.min(attributed.activeMs||0,120*60000)-(record.firstElapsedMs??record.elapsedMs??0));
                minutes=Math.max(minutes,Math.round(((record.elapsedMs||0)+extraMs)/60000),attributed.minutes,5);
              }
            }
          } catch { /* Keep the durable minimum and timer-based duration. */ }
        }
        return {minutes,extraMs,payload:ttPayload({...record,minutes})};
      },
    });
  } catch { /* TimeTracker is optional; retain the local record and queue. */ }
  finally { ttBusy = false;if(followUp)void flushTimeTracker(); }
}

chrome.runtime.onConnect.addListener(port => {
  if (port.name !== 'mta-max' || !port.sender?.url?.startsWith('https://web.max.ru/')) return;
  ports.add(port);
  void exclusive(async () => { port.postMessage({ type: 'STATE', state: snapshot() }); });
  port.onMessage.addListener(message => {
    if (message.type === 'ALIVE') void exclusive(async () => { doc.lastAlive = Date.now(); await save(); });
  });
  port.onDisconnect.addListener(() => {
    ports.delete(port);
    void exclusive(async () => {
      for (const task of Object.values(projection().messages)) {
        const meta = doc.metadata[messageKey(task)];
        if (task.ownerDeviceId === doc.deviceId && task.status === 'running' && meta?.ownerTabId === port.sender.tab?.id && (!meta.ownerDocumentId || meta.ownerDocumentId === port.sender.documentId)) {
          appendEvent(createEvent('PAUSE', task));
        }
      }
      await save(); broadcast(); flushLan();
    });
  });
});

chrome.runtime.onMessage.addListener((message, sender, respond) => {
  void exclusive(async () => {
    if (message.type === 'GET_STATE') return { state: snapshot() };
    if (message.type === 'CMD') {
      if (!sender.url?.startsWith('https://web.max.ru/')) throw Error('Команда доступна только из MAX');
      return command(message, sender);
    }
    if (message.type === 'SET_CHAT_EXCLUDED') {
      if (!sender.url?.startsWith('https://web.max.ru/')) throw Error('Команда доступна только из MAX');
      const { chatId, excluded } = message;
      if (typeof chatId !== 'string' || !/^-?[1-9]\d{0,19}$/.test(chatId) || typeof excluded !== 'boolean') throw Error('Не удалось определить чат');
      if (isChatExcluded(doc, chatId) === excluded) return { state: snapshot() };
      const saved = doc.excludedChats ?? [];
      doc.excludedChats = excluded ? [...saved, chatId] : saved.filter(id => id !== chatId);
      if (excluded) {
        for (const task of Object.values(projection().messages)) {
          if (task.chatId === chatId && task.ownerDeviceId === doc.deviceId && task.status === 'running') {
            appendEvent(createEvent('PAUSE', task));
          }
        }
      }
      await save();
      const state = broadcast();
      flushLan();
      return { state };
    }
    if (message.type === 'DISMISS_REPLY') {
      if(!sender.url?.startsWith('https://web.max.ru/'))throw Error('Команда доступна только из MAX');
      const target=message.target;
      if(typeof target?.chatId!=='string'||typeof target?.messageId!=='string')return{ok:true};
      const key=messageKey(target),task=projection().messages[key],meta=doc.metadata[key];
      // Check the canonical state rather than a possibly delayed content snapshot.
      // A stale quote in another tab cannot cancel work in the controlling tab.
      if(!isChatExcluded(doc,target.chatId)&&task?.ownerDeviceId===doc.deviceId&&OPEN.has(task.status)&&meta?.ownerTabId===sender.tab?.id&&(!meta.ownerDocumentId||meta.ownerDocumentId===sender.documentId)){
        return command({action:'CANCEL',target,suppressReply:false},sender);
      }
      if(doc.suppressed[key]){
        delete doc.suppressed[key];
        await save();
      }
      return{ok:true};
    }
    if (message.type === 'REPLY_CLEARED') {
      if (typeof message.key === 'string') delete doc.suppressed[message.key];
      await save(); return { ok: true };
    }
    if (message.type === 'PAUSE_CONTEXT') {
      for (const task of Object.values(projection().messages)) {
        const meta = doc.metadata[messageKey(task)];
        if (task.ownerDeviceId === doc.deviceId && task.status === 'running' && meta?.ownerTabId === sender.tab?.id &&
            (!meta.ownerDocumentId || meta.ownerDocumentId === sender.documentId) &&
            (!message.key || message.key === messageKey(task)) && (!message.chatId || message.chatId === task.chatId)) appendEvent(createEvent('PAUSE', task));
      }
      await save(); broadcast(); flushLan(); return { ok: true };
    }
    if (message.type === 'SAVE_CONFIG') {
      const config = message.config;
      const operatorName=normalizeOperatorName(config.operatorName);
      if(!hasOperatorName(operatorName))throw Error('Укажите своё имя, чтобы коллеги видели исполнителя');
      const url = new URL(config.lanUrl);
      if (!['ws:','wss:'].includes(url.protocol) || !url.hostname) throw Error('Укажите адрес ws:// или wss://');
      const previousName=doc.config.operatorName;
      doc.config = { operatorName, lanUrl: url.href, lanEnabled: !!config.lanEnabled };
      if(previousName!==operatorName){
        for(const task of Object.values(projection().messages)){
          if(task.ownerDeviceId===doc.deviceId&&task.status!=='none')appendEvent(createEvent('RENAME',task));
        }
      }
      await save(); mismatch = false;
      const old = socket; socket = null; old?.close(); connectLan();
      return { state: broadcast() };
    }
    if (message.type === 'EXPORT') return { text: exportText(doc.records) };
    if (message.type === 'OPEN_OPTIONS') { await chrome.runtime.openOptionsPage(); return { ok: true }; }
    throw Error('Неизвестный запрос');
  }).then(result => respond({ ok: true, ...result })).catch(error => respond({ ok: false, error: error.message }));
  return true;
});

chrome.tabs.onUpdated.addListener((tabId, change) => {
  if (change.status !== 'loading') return;
  void exclusive(async () => {
    for (const task of Object.values(projection().messages)) {
      if (task.ownerDeviceId === doc.deviceId && task.status === 'running' && doc.metadata[messageKey(task)]?.ownerTabId === tabId) appendEvent(createEvent('PAUSE',task));
    }
    await save();broadcast();flushLan();
  });
});
chrome.windows.onRemoved.addListener(() => {
  void chrome.windows.getAll().then(windows => {
    if (windows.length === 0) void exclusive(async () => { pauseOthers(null);await save();broadcast();flushLan(); });
  });
});
chrome.action.onClicked.addListener(() => void chrome.runtime.openOptionsPage());
const promptForName=()=>void loading.then(()=>{
  if(!hasOperatorName(doc.config.operatorName))return chrome.runtime.openOptionsPage();
}).catch(()=>{});
chrome.runtime.onInstalled.addListener(promptForName);
chrome.runtime.onStartup.addListener(promptForName);
chrome.alarms.create('mta-retry', { periodInMinutes: 1 });
chrome.alarms.onAlarm.addListener(() => { void loading.then(() => { if (!mismatch && socket?.readyState !== WebSocket.OPEN) connectLan(); else flushLan(); void flushTimeTracker(); }); });
void loading.then(() => { connectLan(); void flushTimeTracker(); });
