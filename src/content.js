import { OPEN, isChatExcluded, messageKey, elapsed } from './task-state.js';
import { maxChatIdFromPath } from './max-chat-route.js';
import { cachedMaxProfile } from './max-profile.js';
import { mountPersonalStats } from './personal-stats-widget.js';
import widgetStyles from './widget.css';
const icons = {
  flag: '<path d="M5 21V4m0 1c5-5 9 5 14 0v10c-5 5-9-5-14 0" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"/>',
  settings: '<path d="m10 3-.6 2.2-1.8 1L5.4 6 3.5 9.3 5 11v2l-1.5 1.7L5.4 18l2.2-.2 1.8 1L10 21h4l.6-2.2 1.8-1 2.2.2 1.9-3.3L19 13v-2l1.5-1.7L18.6 6l-2.2.2-1.8-1L14 3Z"/><circle cx="12" cy="12" r="3"/>',
  pause: '<path d="M9 6v12M15 6v12" stroke-width="2.8"/>',
  play: '<path d="m9 6 9 6-9 6Z" fill="currentColor" stroke="none"/>',
  close: '<path d="m7 7 10 10M17 7 7 17"/>',
  transfer: '<path d="M4 8h15m-4-4 4 4-4 4M20 16H5m4-4-4 4 4 4"/>'
};
function icon(name) { return `<svg viewBox="0 0 24 24" aria-hidden="true">${icons[name]}</svg>`; }
const BRIDGE = '__MAXTRACKER_V3__';
const STORAGE = 'maxtracker_v3';
const pendingActions = new Map();
let state;
let bindings = [];
let currentChatId = null;
let openedChat = null;
let reply = null;
let previousReplyKey = null;
let lastGesture = 0;
let gestureTarget = null;
let gestureVersion = 0;
let confirmedGesture = 0;
let lastStartedGesture = 0;
let replyChoicePending = false;
let dialogOpen = false;
let openingTarget = false;
let startup = true;
let sentMaxProfile;
let panelSignature = '';
let reconnectTimer;
let port;
let noticeTimer;
let closeTimer;
let pinned = false;
let hovering = false;
const bubbleUi = new WeakMap();
const decoratedBubbles = new Set();
const edgeMotion = matchMedia('(prefers-reduced-motion: no-preference)');
const chatInfoCards = new WeakMap();
const savingChatExclusions = new Set();
let switchChatId;
const pausing = new Set();
const host = document.createElement('div');
host.id = 'maxtracker-v3';
host.setAttribute('data-maxtracker-ui','');
host.dataset.maxtrackerVersion = chrome.runtime.getManifest().version;
const shadow = host.attachShadow({ mode: 'open' });
shadow.innerHTML = `<style>${widgetStyles}</style><div class="overlays"><div class="dialogs"></div><div class="notice" hidden role="status"></div></div><div class="dock" hidden><div class="panel-wrap" id="mta-task-list" hidden><section class="panel" aria-label="Мои обращения"><header class="bar"><strong>Обращения</strong><button class="gear" title="Настройки" aria-label="Настройки MaxTracker">${icon('settings')}</button></header><div class="tasks"></div></section></div><button class="launcher" aria-label="Мои обращения" aria-haspopup="true" aria-expanded="false" aria-controls="mta-task-list"><span class="count"></span></button></div>`;
function mount() { if (!host.isConnected && document.documentElement) document.documentElement.append(host); }
mount();
new MutationObserver(mount).observe(document, { childList: true });
const tasksEl = shadow.querySelector('.tasks');
const dock = shadow.querySelector('.dock');
const popover = shadow.querySelector('.panel-wrap');
const launcher = shadow.querySelector('.launcher');
const personal = mountPersonalStats(shadow, {
  canOpen: () => !dialogOpen,
  onOpen: () => { pinned = false; setExpanded(false); }
});
const chatExclusion = node('button', null, 'mta-chat-exclusion');
chatExclusion.type = 'button';
chatExclusion.setAttribute('role', 'menuitemcheckbox');
chatExclusion.setAttribute('data-maxtracker-ui', '');
chatExclusion.innerHTML = `${icon('flag')}<span>Исключить чат</span><span class="mta-chat-exclusion-track" aria-hidden="true"></span>`;
const [exclusionIcon, exclusionTitle] = chatExclusion.children;
chatExclusion.onclick = async () => {
  const chatId = switchChatId;
  if (!chatId || savingChatExclusions.has(chatId)) return;
  const excluded = !isChatExcluded(state, chatId);
  savingChatExclusions.add(chatId);
  chatExclusion.disabled = true;
  try {
    await action('CHECK_OPEN_CHAT', { chatId });
    await send({ type: 'SET_CHAT_EXCLUDED', chatId, excluded });
  } catch (error) {
    notice(error.message);
  } finally {
    savingChatExclusions.delete(chatId);
    renderChatExclusion();
  }
};
const normalizedTitle = title => title.normalize().trim().replace(/\s+/g, ' ');
function chatIdForInfoMenu(title, card, menu) {
  const pathChatId = maxChatIdFromPath(location.pathname);
  if (pathChatId && openedChat?.chatId && openedChat.chatId !== pathChatId) return null;
  if (openedChat?.canTrack && typeof openedChat.chatTitle === 'string' && normalizedTitle(openedChat.chatTitle) === title) {
    return openedChat.chatId;
  }
  if (!pathChatId) return null;

  // The native header and the group controls identify the card when the model title is absent or different.
  const hasGroupControls = [...menu.querySelectorAll('[role="menuitem"]')].some(item =>
    /^(?:выйти из чата|покинуть чат|выйти из канала|покинуть канал|отписаться|leave chat|leave group|leave channel|unsubscribe)$/i.test((item.getAttribute('aria-label') ?? item.textContent).trim())
  ) || [...card.closest('.layout-inner').querySelectorAll('[role="tab"]')].some(tab =>
    /^(?:участники|подписчики|members|subscribers)$/i.test(tab.textContent.trim())
  );
  if (!hasGroupControls) return null;
  const profileButtons = [...document.querySelectorAll('button[aria-label^="Открыть профиль "], button[aria-label^="Open profile "]')]
    .filter(button => button.getClientRects().length);
  const headerTitle = profileButtons.length === 1 && profileButtons[0].getAttribute('aria-label').replace(/^(?:Открыть профиль|Open profile)\s+/i, '');
  return headerTitle && normalizedTitle(headerTitle) === title ? pathChatId : null;
}
function renderChatExclusion() {
  const matches = [];
  for (const trigger of document.querySelectorAll('.layout-inner .actions button[aria-expanded="true"]:has(use[href="#icon_dots_horizontal"])')) {
    const card = trigger.closest('.layout-inner > .wrapper');
    const title = card?.querySelector(':scope > header .titleWrapper h2 .name');
    const popupId = trigger.getAttribute('aria-controls');
    const menu = popupId && document.getElementById(popupId)?.querySelector('[role="menu"]');
    if (!title || !menu) continue;
    let text = title.textContent;
    if (title.querySelector('img[alt]')) {
      const copy = title.cloneNode(true);
      for (const image of copy.querySelectorAll('img[alt]')) image.replaceWith(image.alt);
      text = copy.textContent;
    }
    const titleText = normalizedTitle(text);
    if (!titleText) continue;
    const chatId = chatIdForInfoMenu(titleText, card, menu);
    const known = chatInfoCards.get(title);
    if (!chatId || (known?.title === titleText && known.chatId !== chatId)) continue;
    const items = [...menu.querySelectorAll('button[role="menuitem"]:not([aria-haspopup]):not(.actionsMenuItem--danger)')];
    const native = items.find(item => /^(?:найти|поиск|find|search)$/i.test(item.getAttribute('aria-label') ?? item.textContent.trim())) ?? items[0];
    if (native?.getClientRects().length) matches.push({ title, titleText, chatId, native });
  }
  if (matches.length !== 1) {
    switchChatId = undefined;
    chatExclusion.remove();
    return;
  }
  const { title, titleText, chatId, native } = matches[0];
  switchChatId = chatId;
  chatInfoCards.set(title, { title: titleText, chatId });
  chatExclusion.setAttribute('aria-checked', String(isChatExcluded(state, switchChatId)));
  chatExclusion.disabled = startup || savingChatExclusions.has(switchChatId);
  if (native.nextElementSibling !== chatExclusion) {
    chatExclusion.className = `${native.className} mta-chat-exclusion`;
    exclusionTitle.className = native.querySelector(':scope > .title')?.className ?? '';
    const nativeIcon = native.querySelector(':scope > svg');
    for (const dimension of ['width', 'height']) exclusionIcon.setAttribute(dimension, nativeIcon?.getAttribute(dimension) ?? '20');
    native.after(chatExclusion);
  }
}
function setExpanded(open) {
  clearTimeout(closeTimer);
  open = !!open && !dock.hidden && !dialogOpen;
  if (open) personal.close();
  popover.hidden = !open;
  launcher.setAttribute('aria-expanded', String(open));
  launcher.setAttribute('aria-pressed', String(open && pinned));
  if(open)updateTimers();
}
function closeIfUnused() {
  clearTimeout(closeTimer);
  closeTimer = setTimeout(() => { if (!pinned && !hovering && !dock.matches(':focus-within')) setExpanded(false); }, 180);
}
dock.addEventListener('pointerenter', event => { if (event.pointerType !== 'touch') { hovering = true; setExpanded(true); } });
dock.addEventListener('pointerleave', () => { hovering = false; closeIfUnused(); });
dock.addEventListener('focusin', () => setExpanded(true));
dock.addEventListener('focusout', closeIfUnused);
launcher.onclick = () => { pinned = !pinned; setExpanded(pinned); };
document.addEventListener('pointerdown', event => { if (!event.composedPath().includes(host)) { pinned = false; setExpanded(false); } }, true);
document.addEventListener('keydown', event => {
  if (event.key === 'Escape' && !popover.hidden) {
    event.preventDefault();event.stopImmediatePropagation();
    pinned = false; launcher.focus({preventScroll:true}); setExpanded(false);
  }
}, true);
function node(tag, text, className) { const el=document.createElement(tag); if(text!=null)el.textContent=text;if(className)el.className=className;return el; }
function formatTime(ms) { const seconds=Math.floor(ms/1000);return `${Math.floor(seconds/3600)>0?`${Math.floor(seconds/3600)}:`:''}${String(Math.floor(seconds/60)%60).padStart(2,'0')}:${String(seconds%60).padStart(2,'0')}`; }
function notice(text) { const box=shadow.querySelector('.notice');box.textContent=text;box.hidden=false;clearTimeout(noticeTimer);noticeTimer=setTimeout(()=>{box.hidden=true;},6500); }
async function send(message) {
  const result = await chrome.runtime.sendMessage(message);
  if (!result?.ok) throw Error(result?.error || 'Фоновый процесс недоступен');
  if (result.state) { state=result.state;startup=false;render(); }
  return result;
}
function action(action, data={}) {
  const requestId=crypto.randomUUID();
  return new Promise((resolve,reject)=>{
    const timer=setTimeout(()=>{pendingActions.delete(requestId);reject(Error('MAX не подтвердил переход к сообщению'));},10000);
    pendingActions.set(requestId,{resolve,reject,timer});
    window.postMessage({source:BRIDGE,version:3,type:'ACTION',requestId,action,...data},location.origin);
  });
}
function command(actionName,target,extra={}) { return send({type:'CMD',action:actionName,target,...extra}); }
function meta(task) { return state?.metadata?.[messageKey(task)] || bindings.find(b=>messageKey(b)===messageKey(task)) || task; }
async function pauseTask(task){
  const key=messageKey(task);if(pausing.has(key))return;
  pausing.add(key);render();
  try{
    await command('PAUSE',task);
    // The bridge clears only this exact native reply, even if the user changed chats.
    await action('CLEAR_REPLY',{target:task});
  }catch(error){notice(error.message);}
  finally{pausing.delete(key);render();}
}
async function cancelTask(task){
  const matches=reply&&messageKey(reply)===messageKey(task);
  await command('CANCEL',task,{suppressReply:!!matches});
  if(reply&&messageKey(reply)===messageKey(task))await action('CLEAR_REPLY',{target:task});
}

async function openTask(task,resume) {
  if(isChatExcluded(state,task.chatId))return;
  openingTarget=true;
  try {
    const active=Object.values(state.messages).find(t=>t.ownerDeviceId===state.deviceId&&t.status==='running'&&messageKey(t)!==messageKey(task));
    if(active)await command('PAUSE',active);
    const target={...task,...meta(task)};
    await action('OPEN_TARGET',{target,resume});
    if(resume)await command('RESUME',target);
  } catch(error) { notice(error.message); }
  finally { openingTarget=false; }
}
function render() {
  if(!state)return;
  if((gestureTarget||replyChoicePending)&&isChatExcluded(state,gestureTarget?.chatId??currentChatId))forgetReplyGesture();
  const choice=shadow.querySelector('.dialogs .dialog');
  if(choice&&isChatExcluded(state,choice.dataset.chatId)){choice.remove();dialogOpen=false;}
  const maxProfile = state.maxProfile ?? null;
  const serializedProfile = JSON.stringify(maxProfile);
  if (serializedProfile !== sentMaxProfile) {
    sentMaxProfile = serializedProfile;
    window.postMessage({source:BRIDGE,version:3,type:'MAX_PROFILE',profile:maxProfile},location.origin);
  }
  const mine=Object.values(state.messages||{}).filter(t=>t.ownerDeviceId===state.deviceId&&OPEN.has(t.status)&&!isChatExcluded(state,t.chatId))
    .sort((a,b)=>Number(b.status==='running')-Number(a.status==='running')||b.updatedAt-a.updatedAt);
  const signature=JSON.stringify([startup,[...pausing],mine.map(t=>[t.lastEventId,meta(t).requestText,meta(t).chatTitle])]);
  dock.hidden=mine.length===0;
  if(dock.hidden){pinned=false;setExpanded(false);}
  shadow.querySelector('.count').textContent=String(mine.length);
  const running=mine.filter(t=>t.status==='running'&&!startup).length;
  launcher.title=`Обращений: ${mine.length} · в работе: ${running} · на паузе: ${mine.length-running}`;
  launcher.setAttribute('aria-label',launcher.title);
  if(signature!==panelSignature){
    panelSignature=signature;tasksEl.replaceChildren();
    for(const task of mine){
      const metadata=meta(task);const row=node('div',null,'task');
      row.dataset.status=startup?'paused':task.status;
      const label=node('button',null,'label');label.type='button';label.title='Открыть чат и перейти к сообщению';
      const heading=node('div',null,'task-heading');
      const timer=node('span',null,'time');timer.dataset.session=task.sessionId;
      heading.append(node('div',metadata.chatTitle||'Чат','title'),timer);
      label.append(heading,node('div',metadata.requestText||'Вложение без текста','preview'));
      label.onclick=()=>void openTask(task,false);
      const toggle=node('button',null,'icon toggle');toggle.innerHTML=icon(task.status==='running'&&!startup?'pause':'play');toggle.type='button';toggle.title=task.status==='running'?'Пауза':'Открыть сообщение и продолжить';toggle.setAttribute('aria-label',toggle.title);
      toggle.disabled=startup||pausing.has(messageKey(task));
      toggle.onclick=()=>task.status==='running'?void pauseTask(task):void openTask(task,true);
      const cancel=node('button',null,'icon cancel');cancel.innerHTML=icon('close');cancel.type='button';cancel.title='Отменить задачу без записи выполненной работы';cancel.setAttribute('aria-label',cancel.title);
      cancel.disabled=startup;
      cancel.onclick=()=>void cancelTask(task).catch(e=>notice(e.message));
      const controls=node('div',null,'controls');controls.append(toggle,cancel);
      row.append(label,controls);tasksEl.append(row);
    }
  }
  personal.update(state, startup);
  updateTimers();renderFrames();
}
function updateTimers(){
  if(!state||popover.hidden)return;
  const sessions=new Map(Object.values(state.messages||{}).map(task=>[task.sessionId,task]));
  for(const timer of tasksEl.querySelectorAll('[data-session]')){
    const task=sessions.get(timer.dataset.session);if(!task)continue;
    const text=formatTime(elapsed(startup?{...task,status:'paused'}:task));
    if(timer.textContent!==text){timer.textContent=text;timer.setAttribute('aria-label',`Время работы: ${text}`);}
  }
}
function finishEdgeStatusTransition(edge){
  const previous=edge.querySelector(':scope > .mta-message-edge-previous');
  if(!previous)return false;
  previous.remove();
  edge.getAnimations().find(animation=>animation.id==='mta-edge-status')?.cancel();
  return true;
}
function setEdgeStatus(edge,color,paused){
  const {color:previousColor,paused:previousPaused}=edge.dataset;
  if(previousColor===color&&previousPaused===paused)return;
  edge.dataset.color=color;
  edge.dataset.paused=paused;
  // If another update arrives mid-wipe, show the latest state immediately.
  if(finishEdgeStatusTransition(edge)||!previousColor||!edgeMotion.matches||edge.hasAttribute('data-leaving'))return;
  const previous=node('span',null,'mta-message-edge-previous');
  previous.dataset.color=previousColor;
  previous.dataset.paused=previousPaused;
  edge.append(previous);
  const transition=edge.animate([
    {'--mta-edge-reveal':'0%'},
    {'--mta-edge-reveal':'118%'}
  ],{id:'mta-edge-status',duration:280,easing:'cubic-bezier(.22, .65, .32, 1)',fill:'both'});
  void transition.finished.then(()=>{previous.remove();transition.cancel();},()=>previous.remove());
}
function renderFrames(){
  personal.mount();
  renderChatExclusion();
  if(!state)return;
  const seen=new Set();
  for(const binding of bindings){
    const row=document.querySelector(`[data-maxtracker-locator="${binding.locator}"]`);
    const bubble=row?.querySelector('.messageWrapper .bubble');
    if(!bubble)continue;seen.add(bubble);
    if(isChatExcluded(state,binding.chatId)){clearBubble(bubble);continue;}
    const task=state.messages[messageKey(binding)];
    if(!task||task.status==='none'){clearBubble(bubble,binding.locator);continue;}
    decoratedBubbles.add(bubble);
    const own=task.ownerDeviceId===state.deviceId;
    bubble.classList.add('mta-bubble-status');bubble.dataset.mtaColor=task.status==='completed'?(own?'green':'cyan'):(own?'yellow':'purple');
    bubble.dataset.mtaPaused=String(task.status!=='completed'&&(startup||task.status==='paused'));
    let edge=bubble.querySelector(':scope > .mta-message-edge');
    if(edge?.dataset.locator!==binding.locator){
      edge?.remove();
      edge=node('span',null,'mta-message-edge');
      edge.dataset.locator=binding.locator;
      edge.setAttribute('aria-hidden','true');
      edge.setAttribute('data-maxtracker-ui','');
      bubble.append(edge);
    }
    setEdgeStatus(edge,bubble.dataset.mtaColor,bubble.dataset.mtaPaused);
    edge.removeAttribute('data-leaving');
    const anchor=bubble.closest('.message')||bubble;
    renderOwnerLabel(bubble,row,task,anchor);
    renderMessageActions(row,task,own);
  }
  for(const bubble of new Set([...decoratedBubbles,...document.querySelectorAll('.mta-bubble-status')]))if(!seen.has(bubble))clearBubble(bubble);
  // Remove decorations left by earlier UI builds.
  for(const avatar of document.querySelectorAll('.mta-avatar-status')){
    avatar.classList.remove('mta-avatar-status');delete avatar.dataset.mtaColor;delete avatar.dataset.mtaPaused;avatar.querySelector(':scope > .mta-avatar-reset')?.remove();
  }
  for(const wrapper of document.querySelectorAll('.mta-frame')){
    wrapper.classList.remove('mta-frame');delete wrapper.dataset.mtaColor;delete wrapper.dataset.mtaPaused;wrapper.querySelector(':scope > .mta-message-status')?.remove();
  }
}
function renderMessageActions(row,task,own){
  const eligible=own&&!startup&&['running','paused','completed'].includes(task.status);
  for(const stale of row.querySelectorAll('.mta-message-action'))if(!eligible||!stale.closest('.messageControls .buttons'))stale.remove();
  if(!eligible)return;
  for(const buttons of row.querySelectorAll('.messageControls .wrapper .buttons')){
    let actionRow=buttons.querySelector(':scope > .mta-message-action');
    if(!actionRow){
      const nativeRow=[...buttons.querySelectorAll(':scope > .row')].find(el=>!el.classList.contains('mta-message-action')&&el.querySelector('button'));
      const nativeButton=nativeRow?.querySelector('button');if(!nativeButton)continue;
      // Reuse MAX's real row/button classes and theme, as in MaxTracker-Auto.
      // Clone only the containers; native event handlers and popovers stay native.
      actionRow=nativeRow.cloneNode(false);actionRow.removeAttribute('id');actionRow.classList.add('mta-message-action');actionRow.setAttribute('data-maxtracker-ui','');
      const button=nativeButton.cloneNode(false);button.type='button';
      for(const name of ['id','aria-haspopup','aria-controls','aria-expanded','aria-describedby'])button.removeAttribute(name);
      button.innerHTML='<svg aria-hidden="true" width="16" height="16" viewBox="0 0 24 24" fill="none"><path d="m6 6 12 12M18 6 6 18" stroke="currentColor" stroke-width="2.5" stroke-linecap="round"/></svg>';
      button.onclick=async event=>{
        event.preventDefault();event.stopPropagation();
        const binding=bindings.find(b=>b.locator===row.dataset.maxtrackerLocator);
        if(!binding||messageKey(binding)!==actionRow.dataset.mtaTarget)return;
        const current=state?.messages[messageKey(binding)];
        if(!current||current.ownerDeviceId!==state.deviceId||!['running','paused','completed'].includes(current.status))return;
        button.disabled=true;
        try{if(current.status==='completed')await command('RESET',current);else await cancelTask(current);}
        catch(error){notice(error.message);}
        finally{if(button.isConnected)button.disabled=false;}
      };
      actionRow.append(button);buttons.append(actionRow);
    }
    actionRow.dataset.mtaTarget=messageKey(task);
    const button=actionRow.querySelector('button');
    const title=task.status==='completed'?'Снять выполнено и удалить свою запись TimeTracker':'Отменить работу';
    if(button.title!==title){button.title=title;button.setAttribute('aria-label',title);}
  }
}
function renderOwnerLabel(bubble,row,task,anchor){
  let ui=bubbleUi.get(bubble);
  if(!ui){ui={anchor,row};bubbleUi.set(bubble,ui);}else ui.row=row;
  const nativeMeta=[...bubble.querySelectorAll('.meta--text,.meta--bubbled-inside')].find(meta=>meta.closest('.bubble')===bubble&&meta.parentElement?.classList.contains('meta'));
  let target=nativeMeta;
  if(!target){
    target=bubble.querySelector(':scope > .mta-owner-fallback');
    if(!target){target=node('div',null,'mta-owner-fallback');target.setAttribute('data-maxtracker-ui','');bubble.append(target);}
  }
  let label=ui.label;
  if(!label){
    label=node('span',null,'mta-owner-label');label.setAttribute('data-maxtracker-ui','');
    label.append(node('span',null,'mta-owner-name'),node('span',null,'mta-owner-state'));ui.label=label;
  }
  const placementChanged=label.parentElement!==target;
  if(placementChanged){
    ui.meta?.classList.remove('mta-owner-host');
    target.prepend(label);ui.meta=target;
    if(nativeMeta)target.classList.add('mta-owner-host');
    for(const fallback of bubble.querySelectorAll(':scope > .mta-owner-fallback'))if(fallback!==target)fallback.remove();
  }
  const name=task.operatorName||'Участник';
  const status=task.status==='completed'?'выполнено':task.status==='paused'||startup?'пауза':'в работе';
  if(label.querySelector('.mta-owner-name').textContent!==name)label.querySelector('.mta-owner-name').textContent=name;
  if(label.querySelector('.mta-owner-state').textContent!==` · ${status}`)label.querySelector('.mta-owner-state').textContent=` · ${status}`;
  label.setAttribute('aria-label',`${name} · ${status}`);
  if(placementChanged){
    ui.resizeObserver?.disconnect();
    ui.resizeObserver=new ResizeObserver(()=>sizeOwnerLabel(bubble,row));
    const wrapper=row.querySelector('.messageWrapper');if(wrapper)ui.resizeObserver.observe(wrapper);
    ui.resizeObserver.observe(target);sizeOwnerLabel(bubble,row);
  }
}
function sizeOwnerLabel(bubble,row){
  const ui=bubbleUi.get(bubble);if(!ui?.label?.isConnected)return;
  const wrapper=row.querySelector('.messageWrapper');if(!wrapper)return;
  const avatar=wrapper.querySelector(':scope > .authorAvatar');
  const avatarWidth=avatar?avatar.getBoundingClientRect().width+(parseFloat(getComputedStyle(avatar).marginRight)||0):0;
  const others=[...ui.meta.children].filter(el=>el!==ui.label);
  const timeWidth=others.reduce((sum,el)=>sum+el.getBoundingClientRect().width,0);
  const gap=parseFloat(getComputedStyle(ui.meta).columnGap)||4;
  const max=Math.max(0,Math.min(180,Math.floor(wrapper.clientWidth-avatarWidth-timeWidth-32-gap*others.length)));
  if(ui.label.style.maxWidth!==`${max}px`)ui.label.style.maxWidth=`${max}px`;
}
function clearBubble(bubble,locator){
  bubble.classList.remove('mta-bubble-status');delete bubble.dataset.mtaColor;delete bubble.dataset.mtaPaused;
  const saved=bubbleUi.get(bubble);
  if(saved){
    saved.resizeObserver?.disconnect();saved.meta?.classList.remove('mta-owner-host');saved.label?.remove();
    bubbleUi.delete(bubble);
  }
  for(const label of bubble.querySelectorAll('.mta-owner-label'))label.remove();
  bubble.querySelector(':scope > .mta-owner-fallback')?.remove();
  for(const action of saved?.row?.querySelectorAll('.mta-message-action')||[])action.remove();
  const anchor=saved?.anchor||bubble.closest('.message')||bubble;
  anchor.querySelector(':scope > .mta-message-reset')?.remove();anchor.classList.remove('mta-message-anchor');

  const edge=bubble.querySelector(':scope > .mta-message-edge');
  // Keep only the visual edge during its exit, and only on the same message.
  if(edge&&locator&&edge.dataset.locator===locator&&bubble.isConnected){
    if(edge.hasAttribute('data-leaving'))return;
    finishEdgeStatusTransition(edge);
    edge.setAttribute('data-leaving','');
    const transition=edge.getAnimations().find(animation=>animation.transitionProperty==='clip-path');
    if(transition){
      const removeLeavingEdge=()=>{
        if(edge.parentElement===bubble&&edge.hasAttribute('data-leaving')){
          edge.remove();
          decoratedBubbles.delete(bubble);
        }
      };
      void transition.finished.then(removeLeavingEdge,removeLeavingEdge);
      return;
    }
  }
  edge?.remove();
  decoratedBubbles.delete(bubble);
}

async function offerTakeover(target,task){
  if(dialogOpen||isChatExcluded(state,target.chatId))return;dialogOpen=true;
  personal.close();
  pinned=false;setExpanded(false);
  const box=node('section',null,'dialog');box.setAttribute('role','dialog');box.setAttribute('aria-modal','true');
  box.dataset.taskKey=messageKey(target);
  box.dataset.chatId=target.chatId;
  const symbol=node('div',null,'dialog-icon');symbol.innerHTML=icon('transfer');box.append(symbol);
  box.append(node('strong',`Уже в работе у ${task.operatorName}`),node('p','Забрать обращение себе? У коллеги завершится его работа, у вас начнется новый таймер.'));
  const buttons=node('div',null,'buttons');const decline=node('button','Отказаться');const take=node('button','Забрать себе','primary');
  decline.onclick=async()=>{try{await action('CLEAR_REPLY',{target});}catch(e){notice(e.message);}box.remove();dialogOpen=false;void maybeStart();};
  take.onclick=async()=>{take.disabled=true;try{
    const confirmed=await action('RESOLVE_REPLY',{expected:{chatId:target.chatId,messageId:target.messageId}});
    if(!confirmed.reply||messageKey(confirmed.reply)!==messageKey(target))throw Error('Цель ответа изменилась. Повторите выбор «Ответить».');
    await command('TAKEOVER',target,{fromSessionId:task.sessionId});box.remove();dialogOpen=false;
  }catch(e){notice(e.message);take.disabled=false;}};
  buttons.append(decline,take);box.append(buttons);shadow.querySelector('.dialogs').append(box);take.focus();
}
async function maybeStart(){
  if(!reply||openingTarget||dialogOpen||confirmedGesture!==gestureVersion||Date.now()-lastGesture>3000||lastStartedGesture===gestureVersion)return;
  if(isChatExcluded(state,reply.chatId))return;
  if(gestureTarget&&messageKey(gestureTarget)!==messageKey(reply))return;
  lastStartedGesture=gestureVersion;
  const version=gestureVersion;
  try{
    const result=await command('REPLY_SELECTED',reply);
    if(result.needsTakeover)await offerTakeover(reply,result.task);
  }catch(e){notice(e.message);}
  finally{if(gestureVersion===version)replyChoicePending=false;}
}
function forgetReplyGesture(){
  ++gestureVersion;replyChoicePending=false;lastGesture=0;gestureTarget=null;
}
function gesture(event){
  if(openingTarget||isChatExcluded(state,currentChatId))return;
  if(event.composedPath().includes(host))return;
  const target=event.target instanceof Element?event.target:null;if(!target)return;
  if(target.closest('[data-maxtracker-ui]'))return;
  if(target.closest('.authorAvatar'))return;
  const control=target.closest('button,[role="menuitem"]');
  const isReply=control&&(/^(ответить|reply)$/i.test(control.textContent.trim())||/ответить|reply/i.test(`${control.getAttribute('aria-label')||''} ${control.title||''}`)||control.querySelector('use[href*="reply"]'));
  if(!isReply)return;
  const row=target.closest('[data-maxtracker-locator]');
  gestureTarget=row?bindings.find(b=>b.locator===row.dataset.maxtrackerLocator):null;
  const expected = gestureTarget ? {chatId:gestureTarget.chatId,messageId:gestureTarget.messageId} : undefined;
  lastGesture=Date.now();const version=++gestureVersion;replyChoicePending=true;
  // Resolve after MAX has processed this native action. A cached VIEW from the
  // previous chat must never consume the click or restart the previous task.
  setTimeout(async()=>{
    try{
      if(gestureVersion!==version)return;
      const result=await action('RESOLVE_REPLY',{expected});
      if(gestureVersion!==version)return;
      if(!result.reply){replyChoicePending=false;notice('Не удалось подтвердить серверную цель ответа. Повторите выбор «Ответить».');return;}
      if(isChatExcluded(state,result.reply.chatId)){forgetReplyGesture();return;}
      confirmedGesture=version;gestureTarget=result.reply;reply=result.reply;
      await maybeStart();
    }catch(e){if(gestureVersion===version){replyChoicePending=false;notice(e.message);}}
  },0);
}
document.addEventListener('click',gesture,true);
function needsChoice(){
  const target=reply||(Date.now()-lastGesture<3000?gestureTarget:null);
  if(isChatExcluded(state,currentChatId)||isChatExcluded(state,target?.chatId))return false;
  const task=target&&state?.messages?.[messageKey(target)];
  return replyChoicePending||dialogOpen||task&&OPEN.has(task.status)&&task.ownerDeviceId!==state.deviceId;
}
function preventUnchosenReply(event){
  if(!needsChoice())return;
  const target=event.target instanceof Element?event.target:null;
  if(!target?.closest('[data-testid="composer"]'))return;
  const button=target.closest('button');
  // HTML buttons without type report type="submit" even outside a form.
  // A quote's close button must remain usable while takeover is undecided.
  const isSend=button&&(button.getAttribute('type')==='submit'||/отправить|send/i.test(`${button.getAttribute('aria-label')||''} ${button.title||''} ${button.textContent||''}`)||button.querySelector('use[href*="send"]'));
  if(event.type==='submit'||event.type==='keydown'&&event.key==='Enter'&&!event.shiftKey||event.type==='click'&&isSend){
    event.preventDefault();event.stopImmediatePropagation();notice(replyChoicePending?'Подтверждаю серверную цель ответа…':'Сначала выберите: забрать обращение или отказаться.');
  }
}
document.addEventListener('keydown',preventUnchosenReply,true);
document.addEventListener('submit',preventUnchosenReply,true);
document.addEventListener('click',preventUnchosenReply,true);
window.addEventListener('message',event=>{
  if(event.source!==window||event.origin!==location.origin||event.data?.source!==BRIDGE||event.data.version!==3)return;
  const data=event.data;
  if(data.type==='VIEW'){
    const changedChat=currentChatId!==null&&currentChatId!==data.chatId;
    const nextReply=data.reply?messageKey(data.reply):null;
    const dismissed=data.dismissedReply;
    let dismissedKey=null;
    if(typeof dismissed?.chatId==='string'&&typeof dismissed.messageId==='string'){
      dismissedKey=messageKey(dismissed);
      if(!gestureTarget||messageKey(gestureTarget)===dismissedKey)forgetReplyGesture();
      const choice=shadow.querySelector('.dialogs .dialog');
      if(choice?.dataset.taskKey===dismissedKey){choice.remove();dialogOpen=false;}
      void send({type:'DISMISS_REPLY',target:dismissed}).catch(e=>notice(e.message));
    }
    if(previousReplyKey&&previousReplyKey!==nextReply&&previousReplyKey!==dismissedKey){void send({type:'REPLY_CLEARED',key:previousReplyKey}).catch(()=>{});if(!openingTarget)void send({type:'PAUSE_CONTEXT',key:previousReplyKey}).catch(()=>{});}
    if(changedChat&&!openingTarget)void send({type:'PAUSE_CONTEXT',chatId:currentChatId}).catch(()=>{});
    currentChatId=data.chatId;openedChat=data.openedChat;bindings=Array.isArray(data.bindings)?data.bindings:[];reply=data.reply;previousReplyKey=nextReply;
    if(data.replyId&&!reply&&Date.now()-lastGesture<3000)notice('Не удалось точно получить серверную цель ответа');
    render();void maybeStart();
  }
  if(data.type==='SENT_REPLY'&&!isChatExcluded(state,data.chatId))void command('COMPLETE',{chatId:data.chatId,messageId:data.messageId},{sentMessageId:data.sentMessageId,replyText:data.replyText}).catch(e=>notice(e.message));
  if(data.type==='ACTION_RESULT'){
    const pending=pendingActions.get(data.requestId);if(pending){clearTimeout(pending.timer);pendingActions.delete(data.requestId);data.ok?pending.resolve(data):pending.reject(Error(data.error));}
  }
  if(data.type==='DIAGNOSTIC'&&!data.ok&&Date.now()-lastGesture<3000)notice(data.detail);
});

function connect(){
  try{
    port=chrome.runtime.connect({name:'mta-max'});
    port.onMessage.addListener(message=>{if(message.type==='STATE'){state=message.state;startup=false;render();}if(message.type==='NOTICE')notice(message.text);});
    port.onDisconnect.addListener(()=>{clearTimeout(reconnectTimer);reconnectTimer=setTimeout(connect,1500);});
  }catch{reconnectTimer=setTimeout(connect,1500);}
}
shadow.querySelector('.gear').onclick=()=>void send({type:'OPEN_OPTIONS'}).catch(e=>notice(e.message));
chrome.storage.local.get(STORAGE).then(saved=>{
  if(!startup)return;
  const doc=saved[STORAGE];if(!doc)return;
  state={...doc,maxProfile:cachedMaxProfile(doc),messages:projectCached(doc),lan:{connected:false,detail:'Восстановлено локально'}};render();
});
function projectCached(doc){
  // GET_STATE provides the canonical projection; the saved display snapshot is
  // used immediately and is always shown paused until the worker is ready.
  return doc.displayMessages||doc.committed||{};
}
chrome.storage.onChanged.addListener((changes,area)=>{if(area==='local'&&changes[STORAGE]?.newValue&&!state)void send({type:'GET_STATE'}).catch(()=>{});});
connect();
setInterval(()=>{try{port?.postMessage({type:'ALIVE'});}catch{}},5000);
setInterval(() => { updateTimers(); personal.tick(); }, 1000);
let framesQueued=false;
new MutationObserver(mutations=>{
  if(framesQueued||!mutations.some(m=>{
    if(m.type==='attributes')return m.target.matches('.layout-inner .actions button:has(use[href="#icon_dots_horizontal"])');
    return !(m.target instanceof Element?m.target:m.target.parentElement)?.closest('[data-maxtracker-ui],.mta-message-status');
  }))return;
  framesQueued=true;requestAnimationFrame(()=>{framesQueued=false;renderFrames();});
}).observe(document,{childList:true,subtree:true,attributeFilter:['aria-controls','aria-expanded']});
window.addEventListener('pagehide',()=>{void chrome.runtime.sendMessage({type:'PAUSE_CONTEXT'}).catch(()=>{});});
window.postMessage({source:BRIDGE,version:3,type:'READY'},location.origin);
