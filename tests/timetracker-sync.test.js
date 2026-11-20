import test from 'node:test';
import assert from 'node:assert/strict';
import {syncTimeTracker,timeTrackerPayload} from '../src/timetracker-sync.js';

const payload=(text='Первый ответ',minutes=5)=>({date:'2026-11-02',task_name:text,minutes,start_time:'2026-11-02T09:00:00Z',end_time:'2026-11-02T09:05:00Z'});
function fixture(record){
  const records={case:record},calls=[],remote=[];
  let online=true,holdWrite,releaseWrite;
  const request=async(path,options={})=>{
    const method=options.method||'GET';calls.push({path,method,body:options.body&&JSON.parse(options.body)});
    if(!online)return new Response('',{status:503});
    if(path==='/api/health')return Response.json({ok:true});
    if(method==='GET')return Response.json({tasks:remote});
    if(holdWrite&&['POST','PUT'].includes(method))await new Promise(r=>{releaseWrite=r;});
    if(method==='DELETE'){const at=remote.findIndex(t=>String(t.id)===path.split('/').at(-1).split('?')[0]);if(at>=0)remote.splice(at,1);return Response.json({ok:true});}
    const body=JSON.parse(options.body);
    if(method==='POST'){remote.push({...body,id:10});return Response.json({id:10});}
    const task=remote.find(t=>String(t.id)===path.split('/').at(-1));
    if(!task)return new Response('',{status:404});
    Object.assign(task,body);return Response.json({id:task.id});
  };
  const run=()=>syncTimeTracker({getRecords:()=>records,commit:async fn=>fn(records),request,prepare:async r=>({minutes:r.minutes,payload:payload(r.replyText,r.minutes)})});
  return{records,calls,remote,run,setOnline:value=>{online=value;},hold:()=>{holdWrite=true;},release:()=>{holdWrite=false;releaseWrite();},waiting:()=>!!releaseWrite};
}
const pending=()=>({sessionId:'case',revision:1,minutes:5,replyText:'Первый ответ',ttStatus:'pending'});

test('repeated completion updates the same remote id and retains queued changes while offline',async()=>{
  const f=fixture(pending());await f.run();
  assert.equal(f.remote.length,1);
  Object.assign(f.records.case,{revision:2,minutes:9,replyText:'Первый ответ | Новый ответ',ttStatus:'update-pending'});
  f.setOnline(false);await f.run();assert.equal(f.records.case.ttStatus,'update-pending');
  f.setOnline(true);await f.run();
  assert.equal(f.remote.length,1);assert.equal(f.remote[0].id,10);assert.equal(f.remote[0].minutes,9);
  assert.match(f.remote[0].task_name,/Первый ответ \| Новый ответ/);
  assert.equal(f.calls.filter(c=>c.method==='POST').length,1);
  assert.equal(f.calls.filter(c=>c.method==='PUT').length,1);
});

test('an older PUT response cannot mark a newer answer synced',async()=>{
  const f=fixture(pending());await f.run();
  Object.assign(f.records.case,{revision:2,replyText:'Два ответа',ttStatus:'update-pending'});
  f.hold();const writing=f.run();
  while(!f.waiting())await new Promise(r=>setTimeout(r,1));
  f.records.case={...f.records.case,revision:3,replyText:'Три ответа',ttStatus:'update-pending'};
  f.release();assert.equal(await writing,true);
  assert.equal(f.records.case.ttStatus,'update-pending');
  await f.run();assert.equal(f.remote[0].task_name,'Три ответа');
  assert.equal(f.records.case.ttStatus,'synced');assert.equal(f.remote.length,1);
});

test('lost POST response is reconciled against the exact old payload instead of creating another task',async()=>{
  const p=payload(),r={...pending(),ttStatus:'sending',ttPayload:p,ttPayloadRevision:1,ttNeedsLookup:true};
  const f=fixture(r);f.remote.push({...p,id:42});await f.run();
  assert.equal(f.records.case.ttId,42);assert.equal(f.remote.length,1);
  assert.equal(f.calls.some(c=>c.method==='POST'),false);
});

test('reset during an in-flight update deletes only this case after its response',async()=>{
  const f=fixture(pending());await f.run();f.remote.push({...payload('Коллега'),id:88});
  Object.assign(f.records.case,{revision:2,replyText:'Новый ответ',ttStatus:'update-pending'});
  f.hold();const writing=f.run();while(!f.waiting())await new Promise(r=>setTimeout(r,1));
  f.records.case.deleted=true;f.records.case.ttStatus='delete-pending';
  f.release();await writing;
  assert.deepEqual(f.remote.map(t=>t.id),[88]);assert.equal(f.records.case.ttStatus,'deleted');
});

test('continued case stays on its original date and retains complete answer text',()=>{
  const answers='Первый ответ '.repeat(20)+' | Дополнение на следующий день';
  const result=timeTrackerPayload({firstCompletedAt:Date.parse('2026-11-01T09:05:00Z'),completedAt:Date.parse('2026-11-02T12:00:00Z'),minutes:9,replyText:answers,operatorName:'Анна',ttAnchor:{date:'2026-11-01',start_time:'2026-11-01T09:00:00.000Z'}});
  assert.equal(result.date,'2026-11-01');assert.equal(result.start_time,'2026-11-01T09:00:00.000Z');
  assert.equal(result.end_time,'2026-11-01T09:09:00.000Z');
  assert.match(result.task_name,/Дополнение на следующий день$/);
});

test('ambiguous old records are left untouched',async()=>{
  const p=payload();const f=fixture({...pending(),ttStatus:'sending',ttPayload:p,ttNeedsLookup:true});
  f.remote.push({...p,id:1},{...p,id:2});await f.run();
  assert.equal(f.calls.some(c=>c.method==='PUT'||c.method==='POST'||c.method==='DELETE'),false);
  assert.match(f.records.case.ttError,/однозначно/);
});
