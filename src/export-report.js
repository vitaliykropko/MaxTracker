const TIME_ZONE = 'Europe/Moscow';
const monthFormat = new Intl.DateTimeFormat('ru-RU', {timeZone:TIME_ZONE,year:'numeric',month:'long'});
const dateFormat = new Intl.DateTimeFormat('ru-RU', {timeZone:TIME_ZONE,year:'numeric',month:'2-digit',day:'2-digit',hour:'2-digit',minute:'2-digit'});
const monthKeyFormat = new Intl.DateTimeFormat('en-CA', {timeZone:TIME_ZONE,year:'numeric',month:'2-digit'});
const clean = value => String(value ?? '').replace(/\s+/g,' ').trim();
const timestamp = value => Number.isFinite(Number(value)) && Number(value)>0 && Number(value)<=8640000000000000 ? Number(value) : null;
const timerMs = record => record.elapsedMs != null && Number.isFinite(Number(record.elapsedMs)) && Number(record.elapsedMs)>=0 ? Number(record.elapsedMs) : null;
const minutes = record => Math.max(5, Math.round(Number.isFinite(Number(record.minutes)) && Number(record.minutes)>0 ? Number(record.minutes) : (timerMs(record)||0)/60000));
const duration = ms => {
  const seconds=Math.floor(ms/1000);
  return [Math.floor(seconds/3600),Math.floor(seconds/60)%60,seconds%60].map(n=>String(n).padStart(2,'0')).join(':');
};
const date = value => timestamp(value) == null ? 'дата не сохранена' : dateFormat.format(Number(value));
function summary(records){
  const known=records.filter(record=>timerMs(record)!=null);
  const missing=records.length-known.length;
  const timer=known.length ? duration(known.reduce((sum,record)=>sum+timerMs(record),0)) : 'нет данных';
  return `Обращений: ${records.length} | По таймеру: ${timer}${missing&&known.length?` (нет данных: ${missing})`:''} | Учтено: ${records.reduce((sum,record)=>sum+minutes(record),0)} мин`;
}
function block(label,value,fallback){
  const lines=String(value||fallback).replace(/\r\n?/g,'\n').trim().split('\n');
  return [`    ${label}:`,...lines.map(line=>`      ${line}`)];
}

export function exportText(records){
  const rows=Object.values(records).filter(record=>!record.deleted);
  if(!rows.length)return 'ОТЧЁТ ПО ОБРАЩЕНИЯМ\r\n\r\nНет завершённых обращений.';
  const months=new Map();
  for(const record of rows){
    const time=timestamp(record.completedAt);
    const parts=time==null?null:monthKeyFormat.formatToParts(time);
    const key=parts?`${parts.find(p=>p.type==='year').value}-${parts.find(p=>p.type==='month').value}`:'unknown';
    if(!months.has(key))months.set(key,{title:time==null?'Без даты':monthFormat.format(time).replace(/ г\.$/,''),records:[]});
    months.get(key).records.push(record);
  }
  const lines=['ОТЧЁТ ПО ОБРАЩЕНИЯМ','Месяц — по последнему завершению кейса. Даты и время — МСК.',
    'По таймеру — время работы без пауз; учтено — с минимумом 5 минут на кейс.',
    '',`ИТОГО: ${summary(rows)}`];
  const keys=[...months.keys()].sort((a,b)=>a==='unknown'?1:b==='unknown'?-1:b.localeCompare(a));
  for(const key of keys){
    const month=months.get(key);
    lines.push('','='.repeat(64),month.title.toLocaleUpperCase('ru-RU'),summary(month.records),'='.repeat(64));
    const chats=new Map();
    for(const record of month.records){
      const chatKey=record.chatId!=null?`id:${record.chatId}`:`title:${clean(record.chatTitle)}`;
      if(!chats.has(chatKey))chats.set(chatKey,{title:clean(record.chatTitle)||'Чат без названия',id:record.chatId,records:[]});
      chats.get(chatKey).records.push(record);
    }
    const sortedChats=[...chats.values()].sort((a,b)=>a.title.localeCompare(b.title,'ru')||String(a.id||'').localeCompare(String(b.id||'')));
    for(const chat of sortedChats){
      const sameName=sortedChats.filter(other=>other.title===chat.title).length>1;
      lines.push('',`ЧАТ: ${chat.title}${sameName&&chat.id!=null?` [${chat.id}]`:''}`,summary(chat.records),'-'.repeat(64));
      chat.records.sort((a,b)=>(timestamp(a.completedAt)||Infinity)-(timestamp(b.completedAt)||Infinity)||String(a.sessionId||'').localeCompare(String(b.sessionId||'')));
      chat.records.forEach((record,index)=>{
        lines.push('',`  ${index+1}. ${date(record.completedAt)} | ${clean(record.authorName||record.authorId)||'Автор не указан'}`);
        lines.push(...block('Обращение',record.requestText,'Вложение без текста'));
        const replies=record.replies?.length?record.replies:[{text:record.replyText,completedAt:record.completedAt}];
        lines.push('    Ответы:');
        replies.forEach((reply,i)=>{
          lines.push(`      ${i+1}) ${date(reply.completedAt)}`,...String(reply.text||'Ответ без текста').replace(/\r\n?/g,'\n').trim().split('\n').map(line=>`         ${line}`));
        });
        const ms=timerMs(record);
        lines.push(`    По таймеру: ${ms==null?'нет данных':duration(ms)} | Учтено: ${minutes(record)} мин`);
      });
    }
  }
  return lines.join('\r\n');
}
