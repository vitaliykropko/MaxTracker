import {chromium} from 'playwright';
import {readFile,mkdir,cp,writeFile,rename} from 'node:fs/promises';
import {resolve} from 'node:path';
import assert from 'node:assert/strict';
import {spawn} from 'node:child_process';
const root=resolve('.');
const releaseExtension=resolve('extension');
const profiles=resolve('artifacts/e2e-'+Date.now());
await mkdir(profiles,{recursive:true});
const extension=resolve(profiles,'extension');
await cp(releaseExtension,extension,{recursive:true});
// Isolate even the worker's first connection, before the settings page opens.
// Only the initial URL differs; tests still configure the endpoint through UI.
const backgroundPath=resolve(extension,'background.js');
const backgroundCode=await readFile(backgroundPath,'utf8');
assert.equal(backgroundCode.split('ws://192.168.100.90:8766').length-1,1);
assert.equal(backgroundCode.split('http://127.0.0.1:5000').length-1,1);
await writeFile(backgroundPath,backgroundCode.replace('ws://192.168.100.90:8766','ws://127.0.0.1:18766').replace('http://127.0.0.1:5000','http://127.0.0.1:19768'));
const fixture=await readFile('tests/fixtures/max.html','utf8');
const model=await readFile('tests/fixtures/max-model.js','utf8');
const contexts=[];
const pageErrors=[];
let rejectedProfile=false;
const hub=spawn('python',['lan_hub.py','--host','127.0.0.1','--port','18766','--database',resolve(profiles,'relay.sqlite3')],{windowsHide:true,stdio:['ignore','ignore','pipe']});
hub.stderr.on('data',data=>{if(data.toString().includes('MAX profile ignored'))rejectedProfile=true;});
await new Promise((resolveReady,reject)=>{const timer=setTimeout(()=>reject(Error('Test relay did not start')),8000);hub.stderr.on('data',data=>{if(data.toString().includes('server listening')){clearTimeout(timer);resolveReady();}});hub.once('exit',code=>{clearTimeout(timer);reject(Error('Test relay exited '+code));});});
const delay=ms=>new Promise(r=>setTimeout(r,ms));
async function until(fn,label){for(let i=0;i<100;i++){if(await fn())return;await delay(100);}throw Error('Timeout: '+label);}
async function state(worker){return worker.evaluate(async()=> (await chrome.storage.local.get('maxtracker_v3')).maxtracker_v3);}
async function startPerson(name,{moduleFile='DPMqYNCb.js',exports=['bc','fi','_c'],waitForBindings=true}={}){
  const context=await chromium.launchPersistentContext(resolve(profiles,name),{headless:true,channel:'chromium',viewport:{width:1280,height:900},args:[`--disable-extensions-except=${extension}`,`--load-extension=${extension}`]});
  contexts.push(context);
  const pageFixture=fixture.replace('/DPMqYNCb.js',`/${moduleFile}`).replace('/10.Dhf2P_Qe.js','/10.FixtureBuild.js');
  const pageModel=model.replace('Base as bc,router as fi',`Base as ${exports[0]},router as ${exports[1]}`).replace('const _c=',`const ${exports[2]}=`);
  await context.route('https://web.max.ru/**',async route=>{
    const path=new URL(route.request().url()).pathname;
    if(path.endsWith(`/${moduleFile}`))await route.fulfill({contentType:'text/javascript',body:pageModel});
    else if(path.endsWith('/10.FixtureBuild.js'))await route.fulfill({contentType:'text/javascript',body:'export {};'});
    else await route.fulfill({contentType:'text/html',body:pageFixture});
  });
  const worker=context.serviceWorkers()[0]||await context.waitForEvent('serviceworker');
  await worker.evaluate(()=>{
    globalThis.__tt={online:false,calls:[],tasks:[],next:1};
    globalThis.fetch=async(input,options={})=>{
      const test=globalThis.__tt;const url=new URL(String(input));
      if(url.origin!=='http://127.0.0.1:19768')throw Error('Unexpected request in isolated test');
      if(url.pathname==='/api/health')return new Response(JSON.stringify({status:test.online?'ok':'offline'}),{status:test.online?200:503});
      if(!test.online)return new Response('',{status:503});
      test.calls.push({method:options.method||'GET',path:url.pathname});
      if(options.method==='POST'){const body=JSON.parse(options.body);const id=test.next++;test.tasks.push({...body,id});return Response.json({id});}
      if(options.method==='PUT'){
        const body=JSON.parse(options.body),id=url.pathname.split('/').at(-1),task=test.tasks.find(t=>String(t.id)===id&&t.date===body.date);
        if(!task)return Response.json({error:'Not found'},{status:404});
        if(test.holdPut)await new Promise(resolve=>{test.releasePut=resolve;});
        Object.assign(task,body);return Response.json({id:task.id});
      }
      if(options.method==='DELETE'){test.tasks=test.tasks.filter(t=>String(t.id)!==url.pathname.split('/').at(-1));return Response.json({ok:true});}
      return Response.json({tasks:test.tasks});
    };
  });
  const id=worker.url().split('/')[2];
  await until(async()=>!!(await state(worker))?.config,'initial state '+name);
  const needsName=/^(оператор|operator)?$/i.test((await state(worker)).config.operatorName);
  let options;
  if(needsName){
    await until(()=>context.pages().some(p=>p.url()===`chrome-extension://${id}/options.html`),'initial name setup '+name);
    options=context.pages().find(p=>p.url()===`chrome-extension://${id}/options.html`);
  }else{
    options=await context.newPage();await options.goto(`chrome-extension://${id}/options.html`);
  }
  await options.locator('#operator').waitFor({state:'visible'});
  if(needsName){
    assert.equal(await options.locator('#operator').inputValue(),'','initial setup asks for a personal name');
    await options.locator('#operator').fill('Оператор');
    await options.getByRole('button',{name:'Сохранить',exact:true}).click();
    await until(async()=>/имя/i.test(await options.locator('#error').textContent()),'generic name is rejected');
  }
  await options.locator('#operator').fill(name==='anna'?'Анна':'Борис');
  await options.locator('#hub').fill('ws://127.0.0.1:18766');
  await options.getByRole('button',{name:'Сохранить',exact:true}).click();
  await until(async()=> (await options.locator('#saved').textContent())==='Сохранено','name saved '+name);
  await until(async()=> (await options.locator('#connection').textContent())==='Подключено','LAN '+name);
  const page=await context.newPage();await page.goto('https://web.max.ru/-1?viewer='+name);
  page.on('pageerror',e=>pageErrors.push(e.message));
  await page.locator('.messageWrapper').first().waitFor();
  if(waitForBindings)await until(async()=>await page.locator('[data-maxtracker-locator]').count()===2,'native bindings '+name);
  return{context,worker,page,options};
}
async function localTasks(person){const s=await state(person.worker);return Object.values(s.displayMessages).filter(t=>t.ownerDeviceId===s.deviceId&&['running','paused'].includes(t.status));}
async function expand(person){
  const launcher=person.page.locator('#maxtracker-v3').locator('.launcher');await launcher.hover();
  await person.page.locator('#maxtracker-v3').locator('.panel-wrap').waitFor({state:'visible'});
}
async function expectOwner(person,name,status,index=0){
  const label=person.page.locator('.messageWrapper').nth(index).locator('.mta-owner-label');
  await until(async()=> (await label.textContent())===`${name} · ${status}`,'visible owner '+name+' '+status);
  const geometry=await label.evaluate(el=>{const r=el.getBoundingClientRect(),bubble=el.closest('.bubble').getBoundingClientRect(),time=el.parentElement.querySelector('.message-time').getBoundingClientRect();return{inside:r.left>=bubble.left&&r.right<=bubble.right&&r.top>=bubble.top&&r.bottom<=bubble.bottom,beforeTime:r.right<=time.left,visible:getComputedStyle(el).visibility!=='hidden'&&r.width>0};});
  assert.deepEqual(geometry,{inside:true,beforeTime:true,visible:true});
}
async function watchEdgeTransition(bubble) {
  await bubble.evaluate(element => {
    delete element.dataset.testEdgeTransition;
    element.addEventListener('transitionrun', event => {
      const edge = event.target;
      if (event.propertyName !== 'clip-path' || !edge.classList.contains('mta-message-edge')) return;
      const clip = edge.getAnimations().find(animation => animation.transitionProperty === 'clip-path');
      if (!clip) return;
      element.dataset.testEdgeTransition = JSON.stringify({
        insets: clip.effect.getKeyframes().map(frame => parseFloat(frame.clipPath.slice(6))),
        active: element.classList.contains('mta-bubble-status'),
        paused: edge.dataset.paused
      });
    });
  });
}
async function capture(person,name){
  if(await person.page.locator('#maxtracker-v3').locator('.launcher').isVisible()&&!(await person.page.locator('#maxtracker-v3').locator('.dialog').count()))await expand(person);
  const fit=await person.page.locator('#maxtracker-v3').evaluate(el=>{const panel=el.shadowRoot.querySelector('.panel');if(!panel.getClientRects().length)return true;const r=panel.getBoundingClientRect();return r.left>=0&&r.right<=innerWidth&&r.top>=0&&r.bottom<=innerHeight;});assert.equal(fit,true,'panel fits '+name);
  const position=await person.page.locator('#maxtracker-v3').evaluate(el=>{const r=el.getBoundingClientRect();return{right:innerWidth-r.right,bottom:innerHeight-r.bottom};});
  assert.equal(position.right,20,'widget is at the right edge '+name);assert.equal(position.bottom,20,'widget is at the bottom edge '+name);
  await person.page.screenshot({path:resolve(profiles,name+'.png'),scale:'css'});
}
try{
  const anna=await startPerson('anna',{moduleFile:'Bi8ePAXH.js',exports:['yc','fi','gc']});
  const boris=await startPerson('boris',{moduleFile:'FutureMaxFixture.js',exports:['chatV2','routeV2','viewerV2'],waitForBindings:false});
  const reply=person=>person.page.locator('.messageWrapper').first().getByRole('button',{name:'Ответить',exact:true});
  await reply(boris).click();
  await boris.page.locator('#maxtracker-v3').locator('.notice').filter({hasText:'требует профиля совместимости'}).waitFor({timeout:5000});
  assert.equal((await localTasks(boris)).length,0,'an unknown MAX build cannot start a guessed task');
  await capture(boris,'profile-required');
  const openDocument=await boris.page.evaluate(()=>performance.timeOrigin);
  const profile={schema:1,revision:'hot-test.1',models:[{module:'/_app/immutable/chunks/FutureMaxFixture.js',chat:'chatV2',router:'routeV2',viewer:'viewerV2'}]};
  async function publishProfile(value){
    const file=resolve(profiles,'max-compat.json');
    await writeFile(file+'.tmp',JSON.stringify(value));
    await rename(file+'.tmp',file);
  }
  await publishProfile(profile);
  await until(async()=>await boris.page.locator('[data-maxtracker-locator]').count()===2,'new profile activates in the open MAX tab');
  assert.equal(await boris.page.evaluate(()=>performance.timeOrigin),openDocument,'profile activation does not reload the page');
  assert.equal((await state(boris.worker)).maxCompatibility.profile.revision,'hot-test.1','profile is cached in the installed extension');
  assert.equal((await localTasks(boris)).length,0,'new compatibility does not replay the old click');
  await publishProfile({...profile,revision:'bad',models:[{...profile.models[0],module:'https://example.invalid/foreign.js'}]});
  await until(()=>rejectedProfile,'relay rejected an external profile module');
  assert.equal((await state(boris.worker)).maxCompatibility.profile.revision,'hot-test.1');
  assert.equal(await boris.page.locator('[data-maxtracker-locator]').count(),2,'invalid profile leaves the current adapter available');
  await publishProfile(profile);
  await anna.page.locator('.message-text').first().dblclick({position:{x:24,y:10}});
  assert.equal(await anna.page.evaluate(()=>getSelection().toString().trim()),'Одинаковое','a text double-click selects a word');
  await delay(1700);
  assert.equal(await anna.page.locator('#maxtracker-v3').locator('.notice').isVisible(),false,'selecting text does not show a reply error');
  assert.equal(await anna.page.locator('#reply-target').isVisible(),false,'selecting text does not open a reply draft');
  assert.equal((await localTasks(anna)).length,0,'selecting text does not start the timer');
  await anna.page.emulateMedia({ reducedMotion: 'no-preference' });
  const firstBubble = anna.page.locator('.messageWrapper .bubble').first();
  await watchEdgeTransition(firstBubble);
  await anna.page.evaluate(()=>{
    window.fixture.current.draft.replyTo=window.fixture.current.messages[1].id;
    window.fixture.replyDelay=180;
  });
  await reply(anna).click();
  await until(async()=> (await localTasks(anna))[0]?.status==='running','Anna start');
  assert.equal((await localTasks(anna))[0].messageId,'-111','delayed native reply cannot start the previous draft target');
  await until(async()=>!!await firstBubble.getAttribute('data-test-edge-transition'),'the edge entrance is animated');
  assert.deepEqual(JSON.parse(await firstBubble.getAttribute('data-test-edge-transition')), {insets:[100,0],active:true,paused:'false'});
  assert.match(await firstBubble.locator('.mta-message-edge').evaluate(edge=>getComputedStyle(edge,'::before').backgroundImage), /^linear-gradient\(to top,/);
  await anna.page.evaluate(()=>{window.fixture.replyDelay=0;});
  await until(async()=>await boris.page.locator('[data-mta-color="purple"]').count()===1,'peer start');
  assert.equal(await anna.page.locator('#maxtracker-v3').locator('.count').textContent(),'1');
  assert.equal(await anna.page.locator('#maxtracker-v3').locator('.panel-wrap').isVisible(),false,'starts as a compact counter');
  assert.equal(await anna.page.locator('.messageWrapper[data-mta-color],.mta-message-status,.mta-frame').count(),0,'message bubble has no status decoration');
  assert.equal(await anna.page.locator('.authorAvatar[data-mta-color],.mta-avatar-status').count(),0,'avatar has no decoration');
  assert.equal(await anna.page.locator('.bubble[data-mta-color="yellow"] > .mta-message-edge').count(),1,'only the text bubble has a left edge');
  assert.equal(await anna.page.locator('.bubble').first().getAttribute('title'),null,'owner status is not a tooltip');
  await expectOwner(boris,'Анна','в работе');
  assert.deepEqual(await anna.page.locator('.mta-message-edge').evaluate(e=>{const r=e.getBoundingClientRect(),b=e.parentElement.getBoundingClientRect(),s=getComputedStyle(e.parentElement);return{width:r.width,left:r.left-b.left,height:r.height===b.height,outline:s.outlineStyle,border:s.borderWidth};}),{width:5,left:0,height:true,outline:'none',border:'0px'});
  async function openChatInfo(person) {
    await person.page.getByRole('button',{name:'Инфо чата',exact:true}).click();
    const card=person.page.locator('.fixture-chat-info');
    assert.equal(await card.locator('.mta-chat-exclusion').count(),0,'the info card has no separate exclusion row');
    const more=card.getByRole('button',{name:'Ещё',exact:true});
    await more.click();
    const popupId=await more.getAttribute('aria-controls');
    const popup=person.page.locator(`#${popupId}`);
    const toggle=popup.getByRole('menuitemcheckbox',{name:'Исключить чат',exact:true});
    await toggle.waitFor();
    assert.deepEqual(await toggle.evaluate(button=>({before:button.previousElementSibling?.getAttribute('aria-label'),after:button.nextElementSibling?.getAttribute('aria-label'),style:button.className===`${button.previousElementSibling.className} mta-chat-exclusion`})),{before:'Найти',after:'Стереть переписку',style:true});
    return toggle;
  }
  const closeChatInfo=person=>person.page.getByRole('button',{name:'Закрыть инфо'}).click();
  // In MAX the title in the native header can differ from the model's chat title.
  await boris.page.evaluate(()=>{
    const title='Отображаемое имя группы';
    window.fixture.infoTitle=title;
    const profileButton=document.createElement('button');
    profileButton.setAttribute('aria-label',`Открыть профиль ${title}`);
    profileButton.textContent=title;
    document.getElementById('chat-title').after(profileButton);
  });
  let borisExclusion=await openChatInfo(boris);
  assert.equal(await borisExclusion.getAttribute('aria-checked'),'false');
  await borisExclusion.click();
  await until(async()=>await borisExclusion.getAttribute('aria-checked')==='true','chat rule is saved immediately');
  assert.deepEqual((await state(boris.worker)).excludedChats,['-1']);
  assert.equal(await boris.page.locator('.mta-message-edge').count(),0,'exclusion hides colleague highlights in this profile');
  assert.equal((await localTasks(anna))[0]?.status,'running','local exclusion leaves colleague timer running');
  const more=boris.page.locator('.fixture-chat-info').getByRole('button',{name:'Ещё',exact:true});
  await more.click();
  await borisExclusion.waitFor({state:'detached'});
  await more.click();
  const reopenedMenuToggle=boris.page.locator('.fixture-chat-menu').getByRole('menuitemcheckbox',{name:'Исключить чат',exact:true});
  await reopenedMenuToggle.waitFor();
  assert.equal(await reopenedMenuToggle.getAttribute('aria-checked'),'true','the next native menu instance restores the flag');
  await closeChatInfo(boris);
  await reply(boris).click();
  await boris.page.locator('#reply-target').waitFor();
  await boris.page.getByRole('button',{name:'Отправить',exact:true}).click();
  assert.ok(await boris.page.locator('#reply-target').isHidden(),'excluded chat keeps native replies available');
  assert.equal(await boris.page.locator('#maxtracker-v3').locator('.dialog').count(),0);
  assert.equal((await localTasks(boris)).length,0);
  assert.equal(Object.keys((await state(boris.worker)).records).length,0);
  await boris.page.reload();
  borisExclusion=await openChatInfo(boris);
  assert.equal(await borisExclusion.getAttribute('aria-checked'),'true','rule is restored after reload');
  await borisExclusion.click();
  await until(async()=>await borisExclusion.getAttribute('aria-checked')==='false','include chat again');
  await closeChatInfo(boris);
  await expectOwner(boris,'Анна','в работе');

  const sessionBeforeExclusion=(await localTasks(anna))[0].sessionId;
  let annaExclusion=await openChatInfo(anna);
  await annaExclusion.press('Space');
  await until(async()=>await annaExclusion.getAttribute('aria-checked')==='true','keyboard can exclude the chat');
  assert.equal((await localTasks(anna))[0]?.status,'paused','excluding an owned running task freezes it');
  assert.ok(await anna.page.locator('#maxtracker-v3').locator('.launcher').isHidden());
  await expectOwner(boris,'Анна','пауза');
  await closeChatInfo(anna);
  await anna.page.getByRole('button',{name:'Дополнительный чат',exact:true}).click();
  annaExclusion=await openChatInfo(anna);
  assert.equal(await annaExclusion.getAttribute('aria-checked'),'false','a different chat keeps its own rule');
  await closeChatInfo(anna);
  await anna.page.getByRole('button',{name:'Общий чат',exact:true}).click();
  annaExclusion=await openChatInfo(anna);
  assert.equal(await annaExclusion.getAttribute('aria-checked'),'true');
  await annaExclusion.click();
  await until(async()=>await annaExclusion.getAttribute('aria-checked')==='false','own chat included again');
  assert.equal((await localTasks(anna))[0]?.status,'paused','including a chat requires explicit resume');
  await closeChatInfo(anna);
  await reply(anna).click();
  await until(async()=> (await localTasks(anna))[0]?.status==='running','resume after including chat');
  assert.equal((await localTasks(anna))[0]?.sessionId,sessionBeforeExclusion,'the same timer resumes');
  await anna.page.locator('.messageWrapper').first().hover();
  await until(async()=>await anna.page.locator('.mta-message-action').count()===1,'own native cancel control');
  assert.equal(await boris.page.locator('.mta-message-action').count(),0,'no cancel control for colleague work');
  assert.equal(await anna.page.locator('.mta-message-reset').count(),0,'no tiny corner button');
  assert.deepEqual(await anna.page.locator('.mta-message-action button').evaluate(button=>{
    const native=button.closest('.buttons').querySelector('.row:not(.mta-message-action) button');
    const take=el=>{const s=getComputedStyle(el);return[s.width,s.height,s.borderRadius,s.background,s.color,el.className];};
    return {native:take(native),cancel:take(button)};
  }).then(({native,cancel})=>({same:JSON.stringify(native)===JSON.stringify(cancel),width:cancel[0]})),{same:true,width:'32px'});
  await anna.page.screenshot({path:resolve(profiles,'native-cancel.png'),scale:'css'});
  await anna.page.screenshot({path:resolve(profiles,'collapsed-counter.png'),scale:'css'});
  await capture(anna,'anna-running');await capture(boris,'boris-peer-running');
  const beforeRename=(await localTasks(anna))[0];
  await anna.options.locator('#operator').fill('Анна Иванова');await anna.options.getByRole('button',{name:'Сохранить',exact:true}).click();
  await expectOwner(boris,'Анна Иванова','в работе');
  const afterRename=(await localTasks(anna))[0];assert.equal(afterRename.sessionId,beforeRename.sessionId);assert.equal(afterRename.lastResumeTime,beforeRename.lastResumeTime,'name change does not restart timer');
  await anna.options.locator('#operator').fill('Анна');await anna.options.getByRole('button',{name:'Сохранить',exact:true}).click();await expectOwner(boris,'Анна','в работе');
  assert.equal(await anna.page.locator('#maxtracker-v3').locator('.connection,.status').count(),0,'no connection or redundant status text in the list');
  const ownTimer=anna.page.locator('#maxtracker-v3').locator('.time');
  assert.match(await ownTimer.textContent(),/^\d{2}:\d{2}$/,'per-task timer is visible');
  const firstTime=await ownTimer.textContent();
  await until(async()=>(await ownTimer.textContent())!==firstTime,'running timer advances');
  assert.equal(await boris.page.locator('#maxtracker-v3').locator('.launcher').isVisible(),false,'peer task does not enter own task list');
  await anna.page.mouse.move(500,700);
  await until(async()=>!(await anna.page.locator('#maxtracker-v3').locator('.panel-wrap').isVisible()),'hover list closes after pointer leaves');
  const launcher=anna.page.locator('#maxtracker-v3').locator('.launcher');
  await launcher.click();assert.equal(await launcher.getAttribute('aria-pressed'),'true','click pins the list');
  await anna.page.mouse.move(500,700);await delay(250);
  assert.equal(await anna.page.locator('#maxtracker-v3').locator('.panel-wrap').isVisible(),true,'pinned list stays open');
  await launcher.press('Escape');assert.equal(await launcher.getAttribute('aria-expanded'),'false','Escape closes the list');
  await launcher.press('Enter');assert.equal(await launcher.getAttribute('aria-expanded'),'true','keyboard opens the list');
  await anna.page.locator('#chat-title').click();assert.equal(await launcher.getAttribute('aria-expanded'),'false','outside click closes the list');
  await anna.page.locator('.authorAvatar').first().evaluate(el=>el.remove());
  assert.equal(await anna.page.locator('.mta-bubble-status').count(),1,'missing avatar does not remove the bubble edge');
  await anna.page.locator('.bubble').first().evaluate(el=>el.remove());
  await until(async()=>await anna.page.locator('.mta-bubble-status').count()===0,'missing bubble has no substitute decoration');
  assert.equal(await anna.page.locator('.messageWrapper[data-mta-color],.mta-frame').count(),0);
  await anna.page.evaluate(()=>window.fixture.render());
  await until(async()=>await anna.page.locator('.bubble[data-mta-color="yellow"]').count()===1,'bubble edge restored from exact binding');
  await anna.page.getByRole('button',{name:'Дополнительный чат',exact:true}).click();
  await until(async()=> (await localTasks(anna))[0]?.status==='paused','chat switch pause');
  await reply(anna).click();await until(async()=> (await localTasks(anna)).length===2,'paused card retained');
  assert.equal((await localTasks(anna)).find(t=>t.chatId==='-2')?.status,'running','fresh reply starts the new chat task');
  await expand(anna);await anna.page.locator('#maxtracker-v3').locator('.task').filter({hasText:'Общий тестовый чат'}).getByTitle('Открыть чат и перейти к сообщению').click();
  await until(async()=> (await anna.page.evaluate(()=>window.fixture.lastNavigation))?.messageId==='-111','message navigation finished');
  assert.deepEqual(await anna.page.evaluate(()=>window.fixture.lastNavigation),{chatId:'-1',messageId:'-111',highlight:false},'message navigation disables MAX flashing');
  await until(async()=> (await localTasks(anna)).every(t=>t.status==='paused'),'navigation card pauses the other active task');
  await until(async()=>await boris.page.locator('[data-mta-paused="true"]').count()===1,'peer pause');
  await until(async()=>await anna.page.locator('[data-mta-color="yellow"][data-mta-paused="true"]').count()===1,'restored own dashed frame');
  await capture(anna,'anna-two-paused');await capture(boris,'boris-peer-paused');
  await expectOwner(boris,'Анна','пауза');
  const pausedTimes=await anna.page.locator('#maxtracker-v3').locator('.time').allTextContents();
  await delay(1200);
  assert.deepEqual(await anna.page.locator('#maxtracker-v3').locator('.time').allTextContents(),pausedTimes,'paused timers stay frozen');
  await anna.page.locator('#maxtracker-v3').locator('.task').filter({hasText:'Общий тестовый чат'}).getByTitle('Открыть сообщение и продолжить').click();
  await until(async()=> (await localTasks(anna)).find(t=>t.chatId==='-1')?.status==='running','manual resume');
  const resumedTimer=anna.page.locator('#maxtracker-v3').locator('.task[data-status="running"] .time');
  const resumedTime=await resumedTimer.textContent();
  await until(async()=>(await resumedTimer.textContent())!==resumedTime,'resumed timer continues');
  await boris.page.getByRole('button',{name:'Ответить',exact:true}).first().click();
  await boris.page.locator('#maxtracker-v3').getByRole('button',{name:'Отказаться',exact:true}).waitFor();await capture(boris,'takeover-dialog');
  await boris.page.getByRole('button',{name:'Отправить',exact:true}).click();
  assert.equal((await localTasks(boris)).length,0,'sending is blocked until the takeover choice');
  assert.equal(await boris.page.locator('#maxtracker-v3').getByRole('button',{name:'Отказаться',exact:true}).isVisible(),true);
  await boris.page.locator('#close-reply').click();
  await until(async()=>await boris.page.locator('#maxtracker-v3').locator('.dialog').count()===0,'closing foreign quote dismisses takeover choice');
  assert.equal((await localTasks(anna)).find(t=>t.chatId==='-1')?.status,'running','foreign quote dismissal cannot cancel current owner');
  await reply(boris).click();await boris.page.locator('#maxtracker-v3').getByRole('button',{name:'Отказаться',exact:true}).waitFor();
  await boris.page.locator('#maxtracker-v3').getByRole('button',{name:'Отказаться',exact:true}).click();
  assert.equal((await localTasks(boris)).length,0);
  await anna.worker.evaluate(()=>{globalThis.__tt.online=true;});
  await boris.worker.evaluate(()=>{globalThis.__tt.online=true;});
  await reply(boris).click();await boris.page.locator('#maxtracker-v3').getByRole('button',{name:'Забрать себе',exact:true}).click();
  await until(async()=> (await localTasks(boris))[0]?.status==='running','takeover');
  await until(async()=> (await localTasks(anna)).every(t=>t.chatId!=='-1'),'old owner closed');
  await until(async()=>Object.values((await state(anna.worker)).records).length===1,'Anna work saved');
  const record=Object.values((await state(anna.worker)).records)[0];assert.equal(record.minutes,5);assert.equal(record.authorName,'Серверный автор');
  await boris.page.emulateMedia({ reducedMotion: 'no-preference' });
  const completionEdge = boris.page.locator('.messageWrapper .bubble').first().locator('.mta-message-edge');
  await until(async()=>await completionEdge.getAttribute('data-color')==='yellow','own active edge before completing');
  await completionEdge.locator('.mta-message-edge-previous').waitFor({state:'detached'});
  await completionEdge.evaluate(edge => {
    const observer = new MutationObserver(() => {
      const previous = edge.querySelector('.mta-message-edge-previous');
      if (!previous) return;
      observer.disconnect();
      const sample = () => {
        if (!previous.isConnected) return;
        const progress = parseFloat(getComputedStyle(edge).getPropertyValue('--mta-edge-reveal'));
        if (progress > 0 && progress < 118) {
          edge.dataset.testStatusWipe = JSON.stringify({
            from: previous.dataset.color,
            to: edge.dataset.color,
            mask: getComputedStyle(edge, '::before').maskImage,
            label: edge.parentElement.querySelector('.mta-owner-label').textContent
          });
        } else requestAnimationFrame(sample);
      };
      requestAnimationFrame(sample);
    });
    observer.observe(edge, {childList:true});
  });
  await boris.page.getByRole('button',{name:'Отправить',exact:true}).click();
  await until(async()=>await boris.page.locator('[data-mta-color="green"]').count()===1,'local complete');
  await until(async()=>await anna.page.locator('[data-mta-color="cyan"]').count()===1,'peer complete');
  await until(async()=>!!await completionEdge.getAttribute('data-test-status-wipe'),'completion animates through intermediate colors');
  const {mask: completionMask, ...completionStatus} = JSON.parse(await completionEdge.getAttribute('data-test-status-wipe'));
  assert.deepEqual(completionStatus, {from:'yellow',to:'green',label:'Борис · выполнено'});
  assert.match(completionMask, /radial-gradient\(circle(?: farthest-corner)? at (?:right center|100% 50%)/);
  await completionEdge.locator('.mta-message-edge-previous').waitFor({state:'detached'});
  await capture(boris,'boris-completed');await capture(anna,'anna-peer-completed');
  await expectOwner(anna,'Борис','выполнено');
  const personalTrigger = person => person.page.getByRole('button', { name: 'Моя статистика', exact: true });
  const personalPanel = person => person.page.locator('#maxtracker-v3').locator('.personal-panel');
  const stat = (person, key) => personalPanel(person).locator(`[data-stat="${key}"]`).textContent();
  const nativeLayout = await personalTrigger(boris).evaluate(button => {
    const native = button.nextElementSibling;
    const geometry = button.getBoundingClientRect();
    const adjacent = native.getBoundingClientRect();
    const shape = element => {
      const style = getComputedStyle(element);
      return [style.width, style.height, style.padding, style.background, style.color, style.borderRadius];
    };
    return {
      caption: native.querySelector('.title').textContent,
      above: geometry.bottom < adjacent.top && geometry.left === adjacent.left,
      nativeStyle: JSON.stringify(shape(button)) === JSON.stringify(shape(native))
    };
  });
  assert.deepEqual(nativeLayout, { caption: 'Настройки', above: true, nativeStyle: true });
  await personalTrigger(boris).hover();
  await personalPanel(boris).waitFor();
  assert.equal(await personalPanel(boris).evaluate(panel => getComputedStyle(panel).animationName), 'personal-panel-enter');
  const triggerBox = await personalTrigger(boris).boundingBox();
  const statsBox = await personalPanel(boris).boundingBox();
  assert.ok(statsBox.x >= triggerBox.x + triggerBox.width && statsBox.y >= 0 && statsBox.y + statsBox.height <= 900);
  await personalPanel(boris).hover();
  await delay(240);
  assert.ok(await personalPanel(boris).isVisible(), 'the tooltip stays open when the pointer crosses into it');
  await boris.page.mouse.move(1200, 100);
  await personalPanel(boris).waitFor({ state: 'hidden' });
  await personalTrigger(boris).hover();
  await personalPanel(boris).waitFor();
  assert.equal(await stat(boris, 'taken'), '1');
  assert.equal(await stat(boris, 'closed'), '1');
  assert.notEqual(await stat(boris, 'timer'), '—');
  assert.notEqual(await stat(boris, 'reply'), '—');
  await personalTrigger(boris).click();
  assert.equal(await personalTrigger(boris).getAttribute('aria-pressed'), 'true', 'personal hover card can be pinned');
  await personalPanel(boris).getByRole('button', { name: 'Этот месяц' }).click();
  assert.equal(await stat(boris, 'closed'), '1');
  await personalPanel(boris).getByRole('button', { name: 'Период', exact: true }).click();
  const lastDay = await personalPanel(boris).locator('[data-date-to]').getAttribute('max');
  await personalPanel(boris).locator('[data-date-from]').fill(lastDay);
  await personalPanel(boris).locator('[data-date-to]').fill(lastDay);
  await personalPanel(boris).getByRole('button', { name: 'Применить' }).click();
  assert.equal(await personalPanel(boris).locator('[data-period="custom"]').getAttribute('aria-pressed'), 'true');
  assert.equal(await stat(boris, 'closed'), '1');
  await personalTrigger(boris).press('Escape');
  assert.ok(!(await personalPanel(boris).isVisible()));
  await boris.page.locator('nav .settings').evaluate(settings => {
    const wrapper = settings.cloneNode(false);
    wrapper.append(settings.lastElementChild.cloneNode(true));
    settings.replaceWith(wrapper);
  });
  await personalTrigger(boris).waitFor();
  assert.equal(await personalTrigger(boris).count(), 1, 'the button returns after MAX recreates Settings');
  await anna.page.emulateMedia({ reducedMotion: 'reduce' });
  await personalTrigger(anna).hover();
  await personalPanel(anna).waitFor();
  assert.equal(await personalPanel(anna).evaluate(panel => getComputedStyle(panel).animationName), 'none');
  assert.equal(await stat(anna, 'taken'), '2');
  assert.equal(await stat(anna, 'closed'), '0', 'a colleague’s completion does not enter personal stats');
  await personalPanel(anna).locator('summary').click();
  await personalPanel(anna).getByRole('button', { name: /Общий тестовый чат, взято 1, закрыто 0/ }).click();
  assert.equal(await stat(anna, 'taken'), '1', 'chat selection filters personal totals');
  assert.equal(await stat(anna, 'reply'), '—', 'a transfer is not a personal reply');
  await personalTrigger(anna).press('Escape');
  assert.equal(await anna.page.getByTitle('Снять выполнено и удалить свою запись TimeTracker').count(),0);
  await until(async()=> (await boris.worker.evaluate(()=>globalThis.__tt.tasks.length))===1,'own TT write');
  const firstBorisRecord=Object.values((await state(boris.worker)).records)[0];
  const borisCase=firstBorisRecord.sessionId;
  const borisRemoteId=await boris.worker.evaluate(()=>globalThis.__tt.tasks[0].id);
  await reply(boris).click();
  await until(async()=> (await localTasks(boris))[0]?.sessionId===borisCase,'own completed dialog reopens the same case');
  await boris.page.evaluate(old=>window.postMessage({source:'__MAXTRACKER_V3__',version:3,type:'SENT_REPLY',chatId:old.chatId,messageId:old.messageId,sentMessageId:old.sentMessageId,replyText:'Повтор старого подтверждения'},location.origin),firstBorisRecord);
  await delay(250);assert.equal((await localTasks(boris))[0]?.status,'running','old send confirmation cannot finish reopened work');
  await until(async()=>await anna.page.locator('[data-mta-color="purple"]').count()===1,'peer sees reopened work');
  await boris.page.locator('#editor').fill('Дополнительный ответ Бориса');
  await boris.page.getByRole('button',{name:'Отправить',exact:true}).click();
  await until(async()=>await boris.worker.evaluate(()=>globalThis.__tt.tasks[0]?.task_name.includes('Дополнительный ответ Бориса')),'PUT updates the existing task');
  assert.equal(await boris.worker.evaluate(()=>globalThis.__tt.tasks.length),1);
  assert.equal(await boris.worker.evaluate(()=>globalThis.__tt.tasks[0].id),borisRemoteId);
  assert.equal((await state(boris.worker)).records[borisCase].minutes,5,'minimum is applied once to total case time');
  assert.match((await state(boris.worker)).records[borisCase].replyText,/Тестовый ответ.*Дополнительный ответ Бориса/);
  await boris.worker.evaluate(()=>{globalThis.__tt.online=false;});
  await reply(boris).click();await boris.page.locator('#editor').fill('Ответ без TimeTracker');
  await boris.page.getByRole('button',{name:'Отправить',exact:true}).click();
  await until(async()=> (await state(boris.worker)).records[borisCase].ttStatus==='update-pending','offline PUT stays queued');
  await boris.worker.evaluate(()=>{globalThis.__tt.online=true;globalThis.__tt.holdPut=true;});
  await reply(boris).click();
  await until(async()=>await boris.worker.evaluate(()=>typeof globalThis.__tt.releasePut==='function'),'older PUT is in flight');
  await boris.page.locator('#editor').fill('Ответ во время обновления');
  await boris.page.getByRole('button',{name:'Отправить',exact:true}).click();
  await until(async()=> (await state(boris.worker)).records[borisCase].replies.length===4,'newer reply retained while old PUT waits');
  await boris.worker.evaluate(()=>{globalThis.__tt.holdPut=false;globalThis.__tt.releasePut();});
  await until(async()=> (await state(boris.worker)).records[borisCase].ttStatus==='synced','latest revision delivered after older response');
  assert.equal(await boris.worker.evaluate(()=>globalThis.__tt.tasks.length),1);
  assert.match(await boris.worker.evaluate(()=>globalThis.__tt.tasks[0].task_name),/Тестовый ответ.*Дополнительный ответ Бориса.*Ответ без TimeTracker.*Ответ во время обновления/);
  await reply(boris).click();
  await boris.page.locator('#close-reply').click();
  await until(async()=>await boris.page.locator('.bubble[data-mta-color="green"]').count()===1,'cancel reopen restores the last completion');
  assert.equal((await state(boris.worker)).records[borisCase].replies.length,4);
  await boris.options.reload();await until(async()=>!(await boris.options.locator('#export').isDisabled()),'dialog TXT available');
  const borisDownload=boris.options.waitForEvent('download');await boris.options.getByRole('button',{name:'Выгрузить TXT',exact:true}).click();
  const borisFile=await borisDownload;const borisText=await readFile(await borisFile.path(),'utf8');
  assert.match(borisText,/Тестовый ответ[\s\S]*Дополнительный ответ Бориса[\s\S]*По таймеру: \d+:\d{2}:\d{2} \| Учтено: 5 мин/);
  assert.equal((borisText.match(/    Обращение:/g)||[]).length,1,'one structured TXT entry for the continued case');
  await boris.page.locator('.messageWrapper').first().hover();
  await boris.page.getByTitle('Снять выполнено и удалить свою запись TimeTracker').click();
  await until(async()=>await anna.page.locator('.mta-bubble-status').count()===0,'reset at peer');
  assert.equal(await anna.page.locator('.mta-owner-label').count(),0,'reset removes owner label');
  assert.equal(await anna.page.locator('.bubble').first().getAttribute('title'),null,'bubble title restored after reset');
  assert.equal(await anna.page.locator('.authorAvatar > button.header').first().getAttribute('title'),'Профиль автора','native profile title restored after reset');
  await until(async()=> (await boris.worker.evaluate(()=>globalThis.__tt.tasks.length))===0,'own TT delete');
  assert.equal(await anna.worker.evaluate(()=>globalThis.__tt.tasks.length),1,'Anna history is not deleted by Boris');
  await reply(boris).click();await until(async()=> (await localTasks(boris)).length===1,'new work after own reset');
  await boris.page.locator('.messageWrapper').first().hover();
  await boris.page.locator('.messageControls').first().getByRole('button',{name:'Переслать',exact:true}).press('Tab');
  assert.equal(await boris.page.locator('.mta-message-action button').evaluate(el=>el===document.activeElement),true,'native cancel is keyboard reachable');
  await boris.page.locator('.mta-message-action button').press('Enter');
  await until(async()=> (await localTasks(boris)).length===0,'cancel new period after reset');
  await until(async()=>await boris.page.locator('#reply-target').isHidden(),'native toolbar cancellation clears quote');
  assert.equal(await boris.page.evaluate(()=>window.fixture.nativeForwardClicks||0),0,'cancel never invokes native forwarding');
  await until(async()=>await anna.page.locator('.mta-bubble-status').count()===0,'cancel delivered');
  await reply(boris).click();await until(async()=> (await localTasks(boris)).length===1,'work before manual quote dismissal');
  const beforeQuoteRecords=Object.keys((await state(boris.worker)).records).length;
  const draftBeforeClose=await boris.page.locator('#editor').textContent();
  await boris.page.locator('#attachment-close').click();await delay(250);
  assert.equal((await localTasks(boris))[0]?.status,'running','unrelated attachment cross cannot cancel reply work');
  const quoteBubbles = [boris, anna].map(person => person.page.locator('.messageWrapper .bubble').first());
  await Promise.all(quoteBubbles.map(watchEdgeTransition));
  await Promise.all(quoteBubbles.map(bubble => bubble.evaluate(element => {
    new MutationObserver(records => {
      if (element.dataset.mtaPaused === 'true' || records.some(record => record.oldValue === 'true')) {
        element.dataset.testSawPause = 'true';
      }
    }).observe(element, { attributeFilter: ['data-mta-paused'], attributeOldValue: true });
  })));
  await boris.page.locator('#close-reply').click();
  await until(async()=> (await localTasks(boris)).length===0,'manual quote cross cancels matching task');
  await until(async()=>await anna.page.locator('.mta-bubble-status').count()===0,'quote cancellation delivered to peer');
  await until(async()=>!!await quoteBubbles[0].getAttribute('data-test-edge-transition'),'the edge exit is animated');
  assert.deepEqual(JSON.parse(await quoteBubbles[0].getAttribute('data-test-edge-transition')), {insets:[0,100],active:false,paused:'false'});
  assert.equal(await quoteBubbles[1].getAttribute('data-test-edge-transition'), null, 'reduced motion disables the exit transition');
  await Promise.all(quoteBubbles.map(bubble=>bubble.locator('.mta-message-edge').waitFor({state:'detached'})));
  for (const bubble of quoteBubbles) {
    assert.equal(await bubble.getAttribute('data-test-saw-pause'), null, 'cancellation never renders the paused status');
  }
  assert.equal(await boris.page.locator('#editor').textContent(),draftBeforeClose,'quote dismissal preserves drafted text');
  assert.equal(Object.keys((await state(boris.worker)).records).length,beforeQuoteRecords,'manual quote cancel creates no TimeTracker record');
  await reply(boris).click();await until(async()=> (await localTasks(boris)).length===1,'explicit reply restarts after quote cancellation');
  await boris.page.locator('#close-reply').press('Enter');
  await until(async()=> (await localTasks(boris)).length===0,'keyboard quote dismissal cancels too');
  await boris.worker.evaluate(()=>{globalThis.__tt.online=false;});
  await boris.page.locator('.messageWrapper').nth(1).getByRole('button',{name:'Ответить',exact:true}).click();
  await until(async()=> (await localTasks(boris)).length===1,'offline local start');
  await boris.page.getByRole('button',{name:'Отправить',exact:true}).click();
  await until(async()=>Object.values((await state(boris.worker)).records).some(r=>!r.deleted&&r.ttStatus==='pending'),'completion without TimeTracker');
  await reply(anna).click();await until(async()=> (await localTasks(anna)).some(t=>t.chatId==='-1'&&t.status==='running'),'new Anna period');
  await until(async()=>await boris.page.locator('[data-mta-color="purple"]').count()===1,'peer sees new period');
  const annaTrackerBeforeRestart=await anna.worker.evaluate(()=>globalThis.__tt);
  await anna.context.close();
  await reply(boris).click();await boris.page.locator('#maxtracker-v3').getByRole('button',{name:'Забрать себе',exact:true}).click();
  await until(async()=> (await localTasks(boris)).some(t=>t.chatId==='-1'),'takeover from offline owner');
  const annaAgain=await startPerson('anna');
  await annaAgain.worker.evaluate(snapshot=>{globalThis.__tt=snapshot;},annaTrackerBeforeRestart);
  await until(async()=>await annaAgain.page.locator('[data-mta-color="purple"]').count()===1,'offline old owner caught up');
  assert.equal((await localTasks(annaAgain)).some(t=>t.chatId==='-1'),false);
  await until(async()=>Object.values((await state(annaAgain.worker)).records).length===2,'offline transfer closes Anna period once');
  await capture(annaAgain,'anna-after-offline-transfer');
  await annaAgain.page.getByRole('button',{name:'Дополнительный чат',exact:true}).click();await reply(annaAgain).click();
  await until(async()=> (await localTasks(annaAgain)).some(t=>t.status==='running'),'task before reload');
  await annaAgain.page.reload();await until(async()=> (await localTasks(annaAgain)).every(t=>t.status==='paused'),'reload pauses');
  await capture(annaAgain,'anna-restored-paused');
  const otherTab=await annaAgain.context.newPage();await otherTab.goto('https://web.max.ru/-2?viewer=anna');await until(async()=>await otherTab.locator('[data-maxtracker-locator]').count()===2,'second tab bindings');
  await otherTab.locator('.messageWrapper').nth(1).getByRole('button',{name:'Ответить',exact:true}).click();await until(async()=> (await localTasks(annaAgain)).filter(t=>t.status==='running').length===1,'single running across tabs');
  await annaAgain.page.close();await delay(300);assert.equal((await localTasks(annaAgain)).filter(t=>t.status==='running').length,1,'closing inactive tab keeps other task');
  await expand({page:otherTab});await otherTab.locator('#maxtracker-v3').locator('.task[data-status="paused"]').getByTitle('Отменить задачу без записи выполненной работы').click();
  await delay(400);assert.equal((await localTasks(annaAgain)).filter(t=>t.status==='running').length,1,'cancelling paused work does not clear the other reply');
  await otherTab.locator('#maxtracker-v3').locator('.task[data-status="running"]').getByTitle('Отменить задачу без записи выполненной работы').click();
  await until(async()=> (await localTasks(annaAgain)).filter(t=>t.status==='running').length===0,'cancel');
  await otherTab.evaluate(()=>window.fixture.render());await delay(400);assert.equal((await localTasks(annaAgain)).filter(t=>t.status==='running').length,0,'DOM redraw does not restart cancellation');
  await otherTab.locator('.messageWrapper').first().getByRole('button',{name:'Ответить',exact:true}).click();
  await until(async()=> (await localTasks(annaAgain)).length===1,'new explicit period after cancelled inactive task');
  const replyBeforePause=await otherTab.evaluate(()=>String(window.fixture.current.draft.replyTo));
  const textBeforePause=await otherTab.locator('#editor').textContent();
  await expand({page:otherTab});await otherTab.getByTitle('Пауза',{exact:true}).click();await until(async()=> (await localTasks(annaAgain)).every(t=>t.status==='paused'),'explicit pause button');
  await until(async()=>await otherTab.locator('#reply-target').isHidden(),'pause clears the native reply quote');
  assert.equal(await otherTab.evaluate(()=>window.fixture.current.draft.replyTo),null);
  assert.equal(await otherTab.locator('#editor').textContent(),textBeforePause,'pause keeps drafted answer text');
  assert.equal((await localTasks(annaAgain)).length,1,'pause retains task');
  await otherTab.getByTitle('Открыть сообщение и продолжить').click();
  await until(async()=> (await localTasks(annaAgain)).some(t=>t.status==='running'),'resume after clearing native reply');
  assert.equal(await otherTab.evaluate(()=>String(window.fixture.current.draft.replyTo)),replyBeforePause,'resume restores the same server target');
  await otherTab.getByTitle('Пауза',{exact:true}).click();
  await until(async()=>await otherTab.locator('#reply-target').isHidden(),'second pause clears quote again');
  await otherTab.setViewportSize({width:760,height:700});await capture({page:otherTab},'compact-panel');
  await otherTab.setViewportSize({width:1280,height:900});
  await otherTab.getByRole('button',{name:'Общий чат',exact:true}).click();
  const previousColleagueRecord=Object.values((await state(boris.worker)).records).find(r=>r.messageId==='-112');
  assert.ok(previousColleagueRecord);
  await otherTab.locator('.messageWrapper').nth(1).getByRole('button',{name:'Ответить',exact:true}).click();
  await until(async()=> (await localTasks(annaAgain)).some(t=>t.messageId==='-112'&&t.status==='running'),'colleague completed dialog opens a new own case');
  assert.equal(await otherTab.locator('#maxtracker-v3').locator('.dialog').count(),0,'completed colleague task does not require active-work takeover');
  const ownNewCase=(await localTasks(annaAgain)).find(t=>t.messageId==='-112');
  assert.notEqual(ownNewCase.sessionId,previousColleagueRecord.sessionId);
  await otherTab.locator('#editor').fill('Новый ответ Анны');await otherTab.getByRole('button',{name:'Отправить',exact:true}).click();
  await until(async()=>!!(await state(annaAgain.worker)).records[ownNewCase.sessionId],'new operator has a separate work record');
  const previousStillSaved=(await state(boris.worker)).records[previousColleagueRecord.sessionId];
  assert.equal(previousStillSaved.replyText,previousColleagueRecord.replyText);
  assert.equal(previousStillSaved.deleted,previousColleagueRecord.deleted);
  await until(async()=>await boris.page.locator('.messageWrapper').nth(1).locator('[data-mta-color="cyan"]').count()===1,'colleague sees new final executor');
  await expectOwner(boris,'Анна','выполнено',1);
  assert.equal(await boris.page.locator('[data-maxtracker-locator]').nth(1).locator('.mta-message-action').count(),0,'new final owner alone has native reset');
  await annaAgain.options.reload();await annaAgain.options.locator('#operator').waitFor();
  await until(async()=>!(await annaAgain.options.locator('#export').isDisabled()),'TXT available');
  const download=annaAgain.options.waitForEvent('download');await annaAgain.options.getByRole('button',{name:'Выгрузить TXT',exact:true}).click();
  const file=await download;const text=await readFile(await file.path(),'utf8');assert.match(text,/ЧАТ: Общий тестовый чат/);assert.match(text,/Серверный автор/);assert.match(text,/Одинаковое обращение[\s\S]*Передано Борис/);assert.match(text,/По таймеру: \d+:\d{2}:\d{2} \| Учтено: 5 мин/);
  await writeFile(resolve(profiles,'export.txt'),text);
  await boris.page.screenshot({path:resolve(profiles,'boris-reset.png'),scale:'css'});
  await annaAgain.options.setViewportSize({width:520,height:800});await annaAgain.options.screenshot({path:resolve(profiles,'settings.png'),scale:'css'});
  assert.deepEqual(pageErrors,[]);
  console.log(JSON.stringify({ok:true,profiles,checks:['start','peer indication','chat pause','multiple cards','manual navigation/resume','decline','takeover','own work/author/minimum','completion','last-owner reset','own TT only','completion without TimeTracker','offline-owner takeover','replay after browser restart','reload','multiple tabs','cancel and DOM redraw','compact viewport','TXT']},null,2));
}catch(error){
  for(const context of contexts){
    try{
      const worker=context.serviceWorkers()[0];
      if(worker){const s=await state(worker);console.error(JSON.stringify({device:s.deviceId,committed:s.committed,pending:s.pending.map(e=>({type:e.type,chatId:e.chatId,messageId:e.messageId,expectedEventId:e.expectedEventId})),display:s.displayMessages}));}
      for(const page of context.pages().filter(p=>p.url().startsWith('https://web.max.ru/')))console.error(await page.evaluate(()=>({url:location.href,chat:String(window.fixture?.router.main.chatId),reply:String(window.fixture?.current.draft.replyTo),bindings:document.querySelectorAll('[data-maxtracker-locator]').length,notice:document.querySelector('#maxtracker-v3')?.shadowRoot.querySelector('.notice')?.textContent})));
    }catch{}
  }
  throw error;
}finally{for(const context of contexts)await context.close();hub.kill();}
