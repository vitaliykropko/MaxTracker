const WRITES = new Set(['pending','sending','update-pending','updating']);
const DELETES = new Set(['delete-pending','delete-after-send']);
export const needsTimeTrackerSync = record => WRITES.has(record.ttStatus)||DELETES.has(record.ttStatus);
const revision = record => record?.revision||0;

export function timeTrackerPayload(record){
  const firstEnd=new Date(record.firstCompletedAt||record.completedAt);
  const start=record.ttAnchor?.start_time?new Date(record.ttAnchor.start_time):new Date(firstEnd.getTime()-record.minutes*60000);
  const end=new Date(start.getTime()+record.minutes*60000);
  const pad=n=>String(n).padStart(2,'0');
  const date=record.ttAnchor?.date||`${firstEnd.getFullYear()}-${pad(firstEnd.getMonth()+1)}-${pad(firstEnd.getDate())}`;
  const short=text=>String(text||'').replace(/\s+/g,' ').slice(0,70);
  const answers=String(record.replyText||'').replace(/\s+/g,' ').trim();
  return{date,task_name:`${short(record.authorName||record.authorId||'Клиент')}: ${short(record.requestText||'Вложение')} | ${record.operatorName}: ${answers}`,
    start_time:start.toISOString(),end_time:end.toISOString(),minutes:record.minutes,include_idle:false,
    onec_description:'Выполненные работы',onec_synced:false,chat_name:record.chatTitle||''};
}

// All durable changes go through commit. Network requests use snapshots: an old
// response can acknowledge only its own revision, never a newer completed reply.
export async function syncTimeTracker({getRecords,commit,request,prepare,onChanged=()=>{}}){
  if(!(await request('/api/health')).ok)return false;
  let followUp=false;
  async function resolveId(snapshot,deleting=false){
    if(snapshot.ttId!=null)return snapshot.ttId;
    const payload=snapshot.ttPayload;
    if(!payload){
      await commit(records=>{records[snapshot.sessionId].ttError='Не сохранены данные для однозначного поиска записи TimeTracker';});
      return undefined;
    }
    const response=await request(`/api/tasks?date=${encodeURIComponent(payload.date)}`);
    if(!response.ok)throw Error(`TimeTracker: HTTP ${response.status}`);
    const result=await response.json();
    const matches=(result.tasks||[]).filter(t=>t.task_name===payload.task_name&&t.start_time===payload.start_time&&t.end_time===payload.end_time);
    if(matches.length>1){
      await commit(records=>{records[snapshot.sessionId].ttError='Не удалось однозначно найти собственную запись TimeTracker';});
      return undefined;
    }
    const id=matches[0]?.id??null;
    await commit(records=>{
      const latest=records[snapshot.sessionId];
      if(id!=null){latest.ttId=id;latest.ttAnchor||={date:payload.date,start_time:payload.start_time};}
      latest.ttNeedsLookup=false;
      if(deleting&&id==null)latest.ttStatus='deleted';
    });
    return id;
  }
  async function deleteRecord(snapshot){
    const id=await resolveId(snapshot,true);
    if(id==null)return;
    const latest=getRecords()[snapshot.sessionId];
    const date=latest.ttAnchor?.date||latest.ttPayload?.date;
    if(!date)return;
    const response=await request(`/api/tasks/${encodeURIComponent(id)}?date=${encodeURIComponent(date)}`,{method:'DELETE'});
    if(response.ok||response.status===404){
      await commit(records=>{records[snapshot.sessionId].ttStatus='deleted';delete records[snapshot.sessionId].ttError;});
      onChanged();
    }
  }
  for(const sessionId of Object.keys(getRecords())){
    let snapshot=structuredClone(getRecords()[sessionId]);
    if(DELETES.has(snapshot.ttStatus)){await deleteRecord(snapshot);continue;}
    if(snapshot.deleted||!WRITES.has(snapshot.ttStatus))continue;
    if(snapshot.ttId==null&&(snapshot.ttNeedsLookup||snapshot.ttStatus==='sending')){
      if(await resolveId(snapshot)===undefined)continue;
      snapshot=structuredClone(getRecords()[sessionId]);
      if(snapshot.deleted){if(DELETES.has(snapshot.ttStatus))await deleteRecord(snapshot);continue;}
    }
    const prepared=snapshot.ttPayload&&snapshot.ttPayloadRevision===revision(snapshot)
      ? {payload:snapshot.ttPayload,minutes:snapshot.minutes,extraMs:snapshot.attributionExtraMs||0}
      : await prepare(snapshot);
    const outgoing=await commit(records=>{
      const latest=records[sessionId];
      if(latest.deleted||revision(latest)!==revision(snapshot))return null;
      latest.minutes=Math.max(latest.minutes,prepared.minutes);
      latest.attributionExtraMs=prepared.extraMs??latest.attributionExtraMs??0;
      latest.ttPayload=prepared.payload;latest.ttPayloadRevision=revision(latest);
      latest.ttStatus=latest.ttId!=null?'updating':'sending';
      if(latest.ttId==null)latest.ttNeedsLookup=true;
      return structuredClone(latest);
    });
    if(!outgoing){followUp=true;continue;}
    const updating=outgoing.ttId!=null;
    const response=await request(updating?`/api/tasks/${encodeURIComponent(outgoing.ttId)}`:'/api/tasks',{
      method:updating?'PUT':'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(outgoing.ttPayload),
    });
    if(!response.ok){
      await commit(records=>{
        const latest=records[sessionId];latest.ttError=`TimeTracker: HTTP ${response.status}`;
        if(!latest.deleted&&revision(latest)===revision(outgoing))latest.ttStatus=updating?'update-pending':'sending';
      });
      break;
    }
    const body=await response.json().catch(()=>null);
    await commit(records=>{
      const latest=records[sessionId];
      latest.ttId=outgoing.ttId??body?.id??body?.task?.id??null;
      latest.ttAnchor||={date:outgoing.ttPayload.date,start_time:outgoing.ttPayload.start_time};
      latest.ttNeedsLookup=latest.ttId==null;
      delete latest.ttError;
      if(latest.deleted)latest.ttStatus='delete-pending';
      else if(revision(latest)===revision(outgoing))latest.ttStatus='synced';
      else{latest.ttStatus=latest.ttId!=null?'update-pending':'pending';followUp=true;}
    });
    onChanged();
    snapshot=getRecords()[sessionId];
    if(DELETES.has(snapshot.ttStatus))await deleteRecord(snapshot);
  }
  return followUp;
}
