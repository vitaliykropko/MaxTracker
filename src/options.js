import { hasOperatorName, normalizeOperatorName } from './operator-name.js';
const byId=id=>document.getElementById(id);
let initialized=false;
async function request(message){const r=await chrome.runtime.sendMessage(message);if(!r?.ok)throw Error(r?.error||'Расширение недоступно');return r;}
function error(text){byId('error').textContent=text;byId('error').hidden=!text;}
async function refresh(){
  try{
    const {state}=await request({type:'GET_STATE'});
    byId('namePrompt').hidden=!state.needsName;
    if(!initialized){
      byId('operator').value=state.needsName?'':state.config.operatorName;
      byId('hub').value=state.config.lanUrl;byId('lanEnabled').checked=state.config.lanEnabled;initialized=true;
      if(state.needsName)byId('operator').focus();
    }
    byId('connection').textContent=state.lan.detail;byId('connection').className=`status${state.lan.connected?' online':''}`;
    const records=Object.values(state.records).filter(r=>!r.deleted&&r.ownerDeviceId===state.deviceId);
    byId('export').disabled=records.length===0;byId('recordCount').textContent=`Сохранено локально: ${records.length}`;
  }catch(e){error(e.message);}
}
byId('settings').addEventListener('submit',async event=>{
  event.preventDefault();error('');
  try{
    const operatorName=normalizeOperatorName(byId('operator').value);
    if(!hasOperatorName(operatorName))throw Error('Укажите своё имя, чтобы коллеги видели исполнителя');
    const url=new URL(byId('hub').value.trim());
    if(!['ws:','wss:'].includes(url.protocol))throw Error('Адрес должен начинаться с ws:// или wss://');
    const scheme=url.protocol==='wss:'?'https':'http';
    const enabled=byId('lanEnabled').checked;
    if(enabled){const granted=await chrome.permissions.request({origins:[`${scheme}://${url.hostname}/*`]});if(!granted)throw Error('Для подключения нужно разрешение на адрес хаба');}
    await request({type:'SAVE_CONFIG',config:{operatorName,lanUrl:url.href,lanEnabled:enabled}});
    byId('saved').textContent='Сохранено';setTimeout(()=>{byId('saved').textContent='';},2500);await refresh();
  }catch(e){error(e.message);}
});
byId('export').onclick=async()=>{
  try{
    const {text}=await request({type:'EXPORT'});const url=URL.createObjectURL(new Blob(['\uFEFF'+text],{type:'text/plain;charset=utf-8'}));
    const a=document.createElement('a');a.href=url;a.download=`maxtracker-${new Intl.DateTimeFormat('sv-SE',{timeZone:'Europe/Moscow'}).format(new Date())}.txt`;a.click();setTimeout(()=>URL.revokeObjectURL(url),5000);
  }catch(e){error(e.message);}
};
void refresh();setInterval(()=>void refresh(),3000);
