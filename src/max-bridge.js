import { decodeMaxFrame, serverId } from './max-codec.js';
import { maxChatIdFromPath } from './max-chat-route.js';
import { parseMaxProfile } from './max-profile.js';
import bundledProfile from '../max-compat.json';

const BRIDGE = '__MAXTRACKER_V3__';
let model;
let hubProfile = null;
let selectedProfile;
let connecting;
let nextConnectionAt = 0;
let lastSignature = '';
let currentChat = null;
let replyBeingDismissed = null;
let bindingCounter = 0;
let lastStatus = '';
const rows = new WeakMap();
const counts = { frames: 0, decoded: 0, errors: 0, ids: 0 };
const emit = (type, data = {}) => window.postMessage({ source: BRIDGE, version: 3, type, ...data }, location.origin);
const status = (ok, detail) => {
  const key = `${ok}:${detail}`;
  if (key !== lastStatus) { lastStatus = key; emit('DIAGNOSTIC', { ok, detail }); }
};

function chatInfo(chat, chatId) {
  return {
    chatId,
    chatTitle: chat.title || chat.$.title || (chatId === '0' ? 'Избранное' : ''),
    canTrack: chatId !== '0' && ['CHAT', 'CHANNEL'].includes(chat.$.type),
  };
}

function messageInfo(chat, message) {
  if (!message?.$ || !serverId(message.$.id)) return null;
  const chatId = serverId(chat.$.id);
  const messageId = serverId(message.$.id);
  if (!chatId || !messageId || serverId(message.id) !== messageId) return null;
  const authorId = serverId(message.$.sender) || '';
  let authorName = '';
  try { authorName = message.sender?.fullName || ''; } catch { /* contact is not cached yet */ }
  return {
    ...chatInfo(chat, chatId), messageId, authorId, authorName,
    requestText: message.text?.plain || '', requestTime: Number(message.time) || 0,
    hasAttachment: !!message.$.attaches?.length,
    isOut: message.isOut === true,
  };
}

function modelFromExports(loaded, spec) {
  const getter = Object.getOwnPropertyDescriptor(loaded[spec.chat]?.prototype || {}, 'chat')?.get;
  const router = loaded[spec.router];
  const viewer = loaded[spec.viewer];
  if (!getter || typeof router?.openChat !== 'function' || !('main' in router) || typeof viewer?.get !== 'function') return null;
  // The accepted getter is a read of the page's chat map. Its minified map
  // variable may change without changing how server chat IDs are resolved.
  const getterSource = Function.prototype.toString.call(getter);
  if (!/^get\s+chat\s*\(\s*\)\s*\{\s*return\s+[\w$]+\.chats\.get\(this\.chatId\)\s*;?\s*\}$/.test(getterSource)) return null;
  const main = router.main;
  if (main?.kind === 'chat') {
    const chat = getter.call({chatId: main.chatId});
    const id = serverId(main.chatId);
    if (!id || serverId(chat?.id) !== id || serverId(chat?.$?.id) !== id ||
        !Array.isArray(chat.messages) || !Array.isArray(chat.pendingQueue?.messages) || !chat.draft) return null;
  }
  return {router, viewer, getChat: getter, spec: JSON.stringify(spec)};
}

function connectModel() {
  if (connecting) return connecting;
  if (Date.now() < nextConnectionAt) return;
  const profile = hubProfile;
  nextConnectionAt = Date.now() + 1000;
  connecting = (async () => {
    const resources = new Set(performance.getEntriesByType('resource').map(entry => entry.name));
    const candidates = [...(profile?.models || []), ...bundledProfile.models];
    for (const spec of candidates) {
      const url = new URL(spec.module, location.origin).href;
      if (!resources.has(url)) continue;
      if (model?.spec === JSON.stringify(spec)) {
        selectedProfile = profile;
        return;
      }
      try {
        // Only reuse modules already loaded by MAX on this origin. The hub
        // supplies identifiers, never an extension script or an external URL.
        const loaded = await import(/* @vite-ignore */ url);
        if (profile !== hubProfile) return;
        const candidate = modelFromExports(loaded, spec);
        if (!candidate) continue;
        model = candidate;
        selectedProfile = profile;
        lastSignature = '';
        status(true, 'Серверная модель MAX подключена');
        return;
      } catch { /* Try another compatible module already on the page. */ }
    }
    // A bad or inapplicable profile must not detach a working adapter.
    if (model) selectedProfile = profile;
  })().finally(() => {
    connecting = null;
    if (profile !== hubProfile) nextConnectionAt = 0;
  });
  return connecting;
}

function view() {
  if (!model || selectedProfile !== hubProfile) void connectModel();
  currentChat = null;
  if (!model) return;
  const main = model.router.main;
  if (main?.kind !== 'chat') {
    currentChat = null;
    if (lastSignature !== 'no-chat') { lastSignature = 'no-chat'; emit('VIEW', { chatId: null, reply: null, bindings: [] }); }
    return;
  }
  try {
    const chat = model.getChat.call({ chatId: main.chatId });
    const chatId = serverId(chat.$.id);
    if (!chatId || serverId(chat.id) !== chatId || serverId(main.chatId) !== chatId) return;
    const openedChat = chatInfo(chat, chatId);
    const roots = [...document.querySelectorAll('.history[data-scale]')].filter(root => root.getClientRects().length > 0);
    if (chat.isOpened !== true || roots.length !== 1) {
      currentChat = null;
      const signature = JSON.stringify(['transition', chatId, openedChat]);
      if (lastSignature !== signature) {
        lastSignature = signature;
        for (const row of document.querySelectorAll('[data-maxtracker-locator]')) row.removeAttribute('data-maxtracker-locator');
        emit('VIEW', { chatId, openedChat, reply: null, bindings: [] });
      }
      return;
    }
    currentChat = chat;
    const items = [...chat.messages, ...chat.pendingQueue.messages];
    const bindings = [];
    for (const row of roots[0].querySelectorAll('[data-index]')) {
      if (row.closest('.history[data-scale]') !== roots[0]) continue;
      const wrapper = row.querySelector('.messageWrapper');
      if (!wrapper || row.closest('[data-maxtracker-ui]')) continue;
      const index = Number(row.getAttribute('data-index'));
      if (!Number.isInteger(index) || index < 0) continue;
      const info = messageInfo(chat, items[index]);
      if (!info) { row.removeAttribute('data-maxtracker-locator'); continue; }
      // data-index addresses the current renderer item. It is never a task ID.
      let binding = rows.get(row);
      if (!binding || binding.chatId !== info.chatId || binding.messageId !== info.messageId) {
        binding = { chatId: info.chatId, messageId: info.messageId, locator: `mta-${++bindingCounter}` };
        rows.set(row, binding);
        row.setAttribute('data-maxtracker-locator', binding.locator);
      }
      if (row.getAttribute('data-maxtracker-locator') !== binding.locator) row.setAttribute('data-maxtracker-locator', binding.locator);
      bindings.push({ ...info, locator: binding.locator });
    }
    const replyId = serverId(chat.draft?.replyTo);
    const replyModel = replyId ? chat.messages.find(m => serverId(m.id) === replyId) : null;
    const reply = replyModel ? messageInfo(chat, replyModel) : null;
    const dismissedReply = replyBeingDismissed?.chatId === chatId && replyBeingDismissed.messageId !== replyId
      ? replyBeingDismissed : null;
    if (dismissedReply) replyBeingDismissed = null;
    const signature = JSON.stringify([openedChat, replyId, bindings]);
    if (signature !== lastSignature || dismissedReply) {
      lastSignature = signature;
      emit('VIEW', { chatId, openedChat, reply, replyId, bindings, dismissedReply });
    }
  } catch {
    status(false, 'Не удалось точно связать сообщения с моделью MAX');
  }
}

async function rawBytes(data) {
  if (data instanceof ArrayBuffer) return new Uint8Array(data);
  if (ArrayBuffer.isView(data)) return new Uint8Array(data.buffer, data.byteOffset, data.byteLength);
  if (data instanceof Blob) return new Uint8Array(await data.arrayBuffer());
  return null;
}

function capture(data, requestContexts, incoming) {
  return rawBytes(data).then(bytes => {
    if (!bytes) return;
    const f = decodeMaxFrame(bytes);
    const p = f.payload;
    if (!incoming) {
      if (f.opcode === 49) requestContexts.set(f.sequence, serverId(p?.chatId));
      return;
    }
    counts.frames++;
    counts.decoded++;
    const chatId = serverId(p?.chatId) || (f.opcode === 49 ? requestContexts.get(f.sequence) : null);
    if (chatId && (p?.messages || p?.message)) {
      const messages = Array.isArray(p.messages) ? p.messages : [p.message];
      const identities = messages.filter(m => serverId(m?.id)).map(m => ({ chatId, messageId: serverId(m.id) }));
      counts.ids += identities.length;
      emit('SERVER_IDS', { identities });
    }
    if (f.opcode === 64 && chatId && p?.message?.link?.type === 'REPLY') {
      let viewerId;
      try { viewerId = serverId(model?.viewer.get().contactId); } catch { return; }
      const message = p.message;
      if (!viewerId || serverId(message.sender) !== viewerId) return;
      const target = serverId(message.link.message?.id);
      const sentId = serverId(message.id);
      if (target && sentId) emit('SENT_REPLY', {
        chatId, messageId: target, sentMessageId: sentId,
        replyText: typeof message.text === 'string' ? message.text : message.text?.plain || '',
      });
    }
  });
}

const NativeWebSocket = window.WebSocket;
window.WebSocket = new Proxy(NativeWebSocket, {
  construct(target, args, newTarget) {
    const socket = Reflect.construct(target, args, newTarget);
    let host;
    try { host = new URL(String(args[0]), location.href).hostname; } catch { return socket; }
    if (host !== 'api.oneme.ru') return socket;
    const contexts = new Map();
    let incoming = Promise.resolve();
    socket.addEventListener('message', event => {
      incoming = incoming.then(() => capture(event.data, contexts, true)).catch(() => { counts.errors++; });
    });
    const send = socket.send;
    socket.send = function(data) {
      // Observe only native request metadata to correlate history responses.
      // The original arguments are forwarded unchanged, immediately.
      void capture(data, contexts, false).catch(() => {});
      return Reflect.apply(send, this, arguments);
    };
    return socket;
  },
});

const delay = ms => new Promise(resolve => setTimeout(resolve, ms));
document.addEventListener('click',event=>{
  // Only a real user's dismissal cancels work. CLEAR_REPLY uses button.click()
  // for pause/decline and must keep its existing meaning.
  if(!event.isTrusted)return;
  const element=event.target instanceof Element?event.target:null;
  const button=element?.closest('button');
  if(!button?.closest('[data-testid="composer"]'))return;
  const isClose=button.classList.contains('close')||/закрыть|отменить ответ/i.test(`${button.getAttribute('aria-label')||''} ${button.title||''}`)||button.querySelector('use[href*="cross"],use[href*="close"],use[href*="cancel"]');
  if(!isClose)return;
  view();
  const target={chatId:serverId(currentChat?.$.id),messageId:serverId(currentChat?.draft?.replyTo)};
  if(!target.chatId||!target.messageId)return;
  replyBeingDismissed = target;
  setTimeout(()=>{
    if (replyBeingDismissed !== target) return;
    view();
    // An attachment's cross or a prevented click leaves replyTo unchanged.
    if (replyBeingDismissed === target) replyBeingDismissed = null;
  },0);
},true);
async function clearReply(expected) {
  if (expected) {
    view();
    if (serverId(currentChat?.id) !== expected.chatId || serverId(currentChat?.draft?.replyTo) !== expected.messageId) return;
  }
  const composer = document.querySelector('[data-testid="composer"]');
  if (!composer) return;
  const button = [...composer.querySelectorAll('button')].find(b =>
    /закрыть|отменить ответ/i.test(`${b.getAttribute('aria-label') || ''} ${b.title || ''}`) || b.querySelector('use[href*="close"], use[href*="cancel"], use[href*="cross"]'));
  if (button) button.click();
  else {
    const editor = composer.querySelector('[role="textbox"]');
    editor?.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', code: 'Escape', bubbles: true, cancelable: true }));
  }
  // Publish the cleared native draft before acknowledging the action. Waiting
  // for the 150 ms polling tick can hide a quick, subsequent Reply selection.
  await delay(0);
  view();
}

async function openTarget(data) {
  if (!model || !data.target?.chatId || !data.target?.messageId) throw Error('Модель MAX еще не готова');
  const target = data.target;
  const chatId = BigInt(target.chatId);
  const messageId = BigInt(target.messageId);
  // Native MAX navigation loads and positions the exact message anchor.
  await model.router.openChat(chatId, { id: messageId, time: target.requestTime }, { highlight: false });
  for (let i = 0; i < 60; i++) {
    view();
    const row = [...document.querySelectorAll('.history [data-index]')].find(el => {
      const binding = rows.get(el);
      return binding?.chatId === target.chatId && binding.messageId === target.messageId && el.getAttribute('data-maxtracker-locator') === binding.locator;
    });
    if (row) {
      row.scrollIntoView({ block: 'center' });
      if (data.resume) {
        row.querySelector('.block')?.dispatchEvent(new MouseEvent('dblclick', { bubbles: true, cancelable: true }));
        await delay(100);
        if (serverId(currentChat?.draft?.replyTo) !== target.messageId) throw Error('Выберите «Ответить» на выделенном сообщении');
      }
      return;
    }
    await delay(100);
  }
  throw Error('Сообщение пока не загружено или чат недоступен');
}

async function resolveReply(expected) {
  const deadline = performance.now() + 1400;
  let routeId = expected?.chatId || null;
  do {
    if (!model || selectedProfile !== hubProfile) await connectModel();
    view();
    const main = model?.router.main;
    const currentRoute = main?.kind === 'chat' ? serverId(main.chatId) : null;
    if (routeId && currentRoute && currentRoute !== routeId) return null;
    routeId ||= currentRoute;
    const replyId = serverId(currentChat?.draft?.replyTo);
    if (replyId && (!expected || replyId === expected.messageId)) {
      const message = currentChat.messages.find(item => serverId(item.id) === replyId);
      const reply = message && messageInfo(currentChat, message);
      if (reply && reply.chatId === routeId) return reply;
    }
    await delay(50);
  } while (performance.now() < deadline);
  if (!model) throw Error('Эта сборка MAX требует профиля совместимости. Проверьте подключение к хабу.');
  return null;
}

window.addEventListener('message', async event => {
  if (event.source !== window || event.origin !== location.origin || event.data?.source !== BRIDGE || event.data.version !== 3) return;
  const data = event.data;
  if (data.type === 'MAX_PROFILE') {
    const profile = data.profile === null ? null : parseMaxProfile(data.profile);
    if (data.profile !== null && !profile) return;
    if (JSON.stringify(profile) === JSON.stringify(hubProfile)) return;
    hubProfile = profile;
    nextConnectionAt = 0;
    void connectModel();
    return;
  }
  if (data.type === 'READY') { lastSignature = ''; view(); emit('DIAGNOSTIC_STATS', { counts: { ...counts } }); }
  if (data.type !== 'ACTION' || typeof data.requestId !== 'string') return;
  try {
    if (data.action === 'CLEAR_REPLY') await clearReply(data.target);
    else if (data.action === 'OPEN_TARGET') await openTarget(data);
    else if (data.action === 'CHECK_OPEN_CHAT') {
      const main = model?.router.main;
      const modelChatId = main?.kind === 'chat' ? serverId(main.chatId) : null;
      const pathChatId = maxChatIdFromPath(location.pathname);
      if ((!modelChatId && !pathChatId) || (modelChatId && modelChatId !== data.chatId) || (pathChatId && pathChatId !== data.chatId)) {
        throw Error('Чат сменился. Откройте его карточку ещё раз.');
      }
    }
    else if (data.action === 'RESOLVE_REPLY') {
      const reply = await resolveReply(data.expected);
      emit('ACTION_RESULT', { requestId:data.requestId, ok:true, reply });
      return;
    }
    else throw Error('Неизвестное действие');
    emit('ACTION_RESULT', { requestId: data.requestId, ok: true });
  } catch (error) {
    emit('ACTION_RESULT', { requestId: data.requestId, ok: false, error: error.message });
  }
});

setInterval(view, 150);
setTimeout(() => { if (!model) status(false, 'Откройте чат. Если версия MAX изменилась, потребуется обновить адаптер.'); }, 15000);
view();
