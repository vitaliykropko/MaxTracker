const params=new URLSearchParams(location.search);
const viewer=params.get('viewer')==='boris'?2n:1n;
const names=new Map([[1n,'Анна'],[2n,'Борис'],[100n,'Серверный автор']]);
function makeChat(id,title){
  const chat={id,$:{id,type:'CHAT',title},title,draft:{replyTo:null},pendingQueue:{messages:[]}};
  chat.messages=[11n,12n].map((n,i)=>({id:id*100n-n,$:{id:id*100n-n,sender:100n,attaches:[]},senderId:100n,sender:{fullName:names.get(100n)},text:{plain:'Одинаковое обращение'},time:Date.now()-60000-i,isOut:false}));
  return chat;
}
const chats=new Map([[-1n,makeChat(-1n,'Общий тестовый чат')]]);
if(viewer===1n)chats.set(-2n,makeChat(-2n,'Дополнительный чат Анны'));
const G={chats};
class Base{get chat(){return G.chats.get(this.chatId)}}
const initial=BigInt(location.pathname.split('/')[1]||'-1');
const router={main:{kind:'chat',chatId:chats.has(initial)?initial:-1n},openChat(id,anchor,options){
  if(!chats.has(id))throw Error('Чат недоступен');
  window.fixture.lastNavigation={chatId:String(id),messageId:anchor?String(anchor.id):null,highlight:options?.highlight};
  this.main={kind:'chat',chatId:id};history.replaceState(null,'',`/${id}?viewer=${viewer===2n?'boris':'anna'}`);render();
}};
function render(){
  document.querySelector('.fixture-chat-info')?.remove();
  document.querySelector('.fixture-chat-menu')?.remove();
  for(const observer of window.fixtureMetaObservers||[])observer.disconnect();window.fixtureMetaObservers=[];
  const chat=chats.get(router.main.chatId);
  for(const item of chats.values())item.isOpened=item===chat;
  document.getElementById('chat-title').textContent=chat.title;
  const container=document.querySelector('.history');container.replaceChildren();
  chat.messages.forEach((message,index)=>{
    const row=document.createElement('div');row.className='item';row.dataset.index=index;
    const block=document.createElement('div');block.className='block';
    const bubble=document.createElement('div');bubble.className='messageWrapper';
    const avatar=document.createElement('div');avatar.className='authorAvatar';
    const profile=document.createElement('button');profile.className='header';profile.title='Профиль автора';profile.setAttribute('aria-label','Профиль автора');
    const image=document.createElement('div');image.className='avatar';image.textContent='С';profile.append(image);avatar.append(profile);
    const body=document.createElement('div');body.className='message';
    const content=document.createElement('div');content.className='bubble';
    const bubbleContent=document.createElement('div');bubbleContent.className='bubbleContent';
    const author=document.createElement('small');author.textContent='Автор из DOM не используется';
    const text=document.createElement('p');text.className='message-text';text.textContent=message.text.plain;
    const meta=document.createElement('span');meta.className='meta fixture-meta';
    const metaContent=document.createElement('div');metaContent.className='meta meta--text';
    const stamp=document.createElement('span');stamp.className='text message-time';stamp.textContent=new Date(message.time).toLocaleTimeString('ru-RU',{hour:'2-digit',minute:'2-digit'});
    metaContent.append(stamp);meta.append(metaContent);
    const reply=document.createElement('button');reply.textContent='Ответить';
    const select=()=>{
      const apply=()=>{chat.draft.replyTo=message.id;renderComposer();};
      if(window.fixture.replyDelay)setTimeout(apply,window.fixture.replyDelay);else apply();
    };
    reply.onclick=select;
    block.ondblclick=event=>{if(!text.contains(event.target))select();};
    bubbleContent.append(author,text,reply,meta);content.append(bubbleContent);body.append(content);bubble.append(avatar,body);block.append(bubble);
    const controls=document.createElement('div');controls.className='messageControls fixture-controls';
    controls.innerHTML='<div class="wrapper svelte-k89anl"><div class="buttons svelte-k89anl"><div class="row svelte-k89anl"><button class="button fixture-action svelte-k89anl" aria-label="Переслать" type="button"><svg aria-hidden="true" width="16" height="16" viewBox="0 0 24 24" fill="currentColor"><path d="m14 4 8 8-8 8v-5c-6 0-9 2-12 5 1-9 5-12 12-12Z"/></svg></button></div></div></div>';
    controls.querySelector('button').onclick=()=>{window.fixture.nativeForwardClicks=(window.fixture.nativeForwardClicks||0)+1;};
    block.append(controls);row.append(block);container.append(row);
    const observer=new ResizeObserver(()=>body.style.setProperty('--metaWidth',`${meta.clientWidth}px`));observer.observe(meta);window.fixtureMetaObservers.push(observer);
  });renderComposer();
}
function renderComposer(){
  const chat=chats.get(router.main.chatId);
  const target=document.getElementById('reply-target');target.hidden=chat.draft.replyTo===null;
}
window.fixture={chats,router,render,get current(){return chats.get(router.main.chatId)}};
const chatInfoButton=document.createElement('button');chatInfoButton.textContent='Инфо чата';
document.getElementById('chat-title').after(chatInfoButton);
let menuCounter=0;
chatInfoButton.onclick=()=>{
  document.querySelector('.fixture-chat-info')?.remove();
  document.querySelector('.fixture-chat-menu')?.remove();
  const card=document.createElement('section');
  card.className='layout absolute fixture-chat-info';
  card.style.cssText='position:fixed;top:16px;right:20px;width:280px;padding:16px;background:white;border-radius:18px;z-index:10';
  card.innerHTML='<button type="button" aria-label="Закрыть инфо">×</button><div class="layout-inner"><div class="wrapper"><header><div class="titleWrapper"><h2><span class="name"></span></h2></div></header><div class="actions"><div class="group"><button type="button">Звонок</button> <button type="button" aria-haspopup="dialog" aria-controls="" aria-expanded="false"><svg aria-hidden="true" width="24" height="24"><use href="#icon_dots_horizontal"></use></svg><span>Ещё</span></button></div></div></div></div>';
  card.querySelector('.name').textContent=window.fixture.infoTitle??window.fixture.current.title;
  const more=card.querySelector('[aria-haspopup="dialog"]');
  let popup;
  const closeMenu=()=>{
    popup?.remove();
    popup=undefined;
    more.setAttribute('aria-controls','');
    more.setAttribute('aria-expanded','false');
  };
  more.onclick=()=>{
    if(popup){closeMenu();return;}
    popup=document.createElement('div');
    popup.id=`fixture-chat-menu-${++menuCounter}`;
    popup.className='popover fixture-chat-menu';
    popup.setAttribute('role','dialog');
    popup.style.cssText='position:fixed;right:20px;width:216px;padding:6px;background:white;border-radius:14px;z-index:11;box-shadow:0 6px 18px #0002';
    popup.style.top=`${more.getBoundingClientRect().bottom+8}px`;
    popup.innerHTML='<div class="actionsMenu" role="menu"><div class="cropped"><div class="scrollable"><div class="content"></div></div></div></div>';
    const items=popup.querySelector('.content');
    for(const [title,tone] of [['Добавить в папку','primary'],['Найти','primary'],['Стереть переписку','primary'],['Выйти из чата','danger']]){
      const button=document.createElement('button');
      button.type='button';
      button.className=`actionsMenuItem actionsMenuItem--${tone} actionsMenuItem--withBefore`;
      button.setAttribute('role','menuitem');
      button.setAttribute('aria-label',title);
      button.innerHTML='<svg aria-hidden="true" width="20" height="20" viewBox="0 0 20 20"><circle cx="9" cy="9" r="5" fill="none" stroke="currentColor"/><path d="m13 13 3 3" stroke="currentColor"/></svg><span class="title"></span>';
      button.querySelector('.title').textContent=title;
      if(title==='Добавить в папку')button.setAttribute('aria-haspopup','dialog');
      items.append(button);
    }
    document.body.append(popup);
    more.setAttribute('aria-controls',popup.id);
    more.setAttribute('aria-expanded','true');
  };
  card.querySelector('button').onclick=()=>{closeMenu();card.remove();};
  document.body.append(card);
};
document.getElementById('common').onclick=()=>router.openChat(-1n);
document.getElementById('extra').hidden=viewer!==1n;
document.getElementById('extra').onclick=()=>router.openChat(-2n);
document.getElementById('close-reply').onclick=()=>{window.fixture.current.draft.replyTo=null;renderComposer();};
document.getElementById('attachment-close').onclick=event=>{event.currentTarget.hidden=true;};
document.getElementById('send').onclick=()=>{
  const chat=window.fixture.current;
  if(chat.draft.replyTo===null)return;
  window.postMessage({source:'__MAXTRACKER_V3__',version:3,type:'SENT_REPLY',chatId:String(chat.id),messageId:String(chat.draft.replyTo),sentMessageId:String(Date.now()),replyText:document.getElementById('editor').textContent},location.origin);
  chat.draft.replyTo=null;renderComposer();
};
render();
export{Base as bc,router as fi};
export const _c={get(){return{contactId:viewer}}};
