import test from 'node:test';
import assert from 'node:assert/strict';
import { attributeMinutes } from '../src/attribution.js';
test('preserved TimeTracker attribution keeps the five-minute floor and client activity',()=>{
  const end=1793610000000;
  assert.equal(attributeMinutes([], 'ИТ поддержка ОПТИМА', '', end, end-60000).minutes,5);
  const records=[{window_title:'Альфа-Авто: Автосалон',start_time:new Date(end-12*60000).toISOString(),end_time:new Date(end).toISOString()}];
  assert.equal(attributeMinutes(records,'ИТ поддержка ОПТИМА','',end,end-13*60000).minutes,12);
});
