import test from 'node:test';
import assert from 'node:assert/strict';
import {exportText} from '../src/export-report.js';

const base={chatId:'support',chatTitle:'Поддержка',authorName:'Анна',requestText:'Вопрос',replyText:'Ответ',minutes:5,elapsedMs:61000,completedAt:Date.parse('2026-11-03T08:00:00Z')};
test('TXT groups completed cases by Moscow month and chat, with correct totals and full reply history',()=>{
  const text=exportText({
    nov:{...base,sessionId:'continued',completedAt:Date.parse('2026-10-31T21:05:00Z'),requestText:'Новый вопрос\nВторая строка',replies:[{text:'Первый ответ',completedAt:Date.parse('2026-10-30T08:00:00Z')},{text:'Уточнение\nС новой строки',completedAt:Date.parse('2026-10-31T21:05:00Z')}],elapsedMs:370000,minutes:6},
    other:{...base,chatId:'orders',chatTitle:'Заказы',elapsedMs:2000},
    oct:{...base,completedAt:Date.parse('2026-10-31T20:59:00Z')},
    deleted:{...base,deleted:true,requestText:'УДАЛЁННОЕ'},
  });
  assert.match(text,/ИТОГО: Обращений: 3 \| По таймеру: 00:07:13 \| Учтено: 16 мин/);
  assert.ok(text.indexOf('НОЯБРЬ 2026')<text.indexOf('ОКТЯБРЬ 2026'));
  const november=text.slice(text.indexOf('НОЯБРЬ 2026'),text.indexOf('ОКТЯБРЬ 2026'));
  assert.match(november,/Обращений: 2 \| По таймеру: 00:06:12 \| Учтено: 11 мин/);
  assert.match(november,/ЧАТ: Заказы/);assert.match(november,/ЧАТ: Поддержка/);
  assert.match(november,/01\.11\.2026, 00:05/);
  assert.match(november,/Новый вопрос\r\n      Вторая строка/);
  assert.match(november,/Первый ответ/);assert.match(november,/Уточнение\r\n         С новой строки/);
  assert.equal(text.split('Новый вопрос').length-1,1,'continued case appears once');
  assert.doesNotMatch(text,/УДАЛЁННОЕ/);
});
test('legacy records do not invent a timer from the five-minute minimum and same-named chats stay separate',()=>{
  const text=exportText({
    missing:{...base,chatId:'one',elapsedMs:undefined},
    known:{...base,chatId:'two',elapsedMs:1000},
    undated:{...base,completedAt:NaN,elapsedMs:0},
  });
  assert.match(text,/По таймеру: 00:00:01 \(нет данных: 1\)/);
  assert.match(text,/По таймеру: нет данных \| Учтено: 5 мин/);
  assert.match(text,/По таймеру: 00:00:00 \| Учтено: 5 мин/);
  assert.match(text,/ЧАТ: Поддержка \[one\]/);assert.match(text,/ЧАТ: Поддержка \[two\]/);
  assert.match(text,/БЕЗ ДАТЫ/);
  assert.doesNotThrow(()=>exportText({broken:{...base,completedAt:1e99}}));
});
test('TXT duration keeps hours instead of wrapping them, and an empty report is readable',()=>{
  assert.match(exportText({long:{...base,elapsedMs:90061000,minutes:1501}}),/25:01:01/);
  assert.match(exportText({gone:{...base,deleted:true}}),/Нет завершённых обращений/);
});
