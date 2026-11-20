import { createServer } from 'node:http';
import { existsSync, mkdirSync, readFileSync, renameSync, rmSync, statSync, writeFileSync } from 'node:fs';
import { spawn } from 'node:child_process';
import { randomUUID } from 'node:crypto';
import { homedir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { groupEmployees, readJournal } from './journal.js';

const host = '127.0.0.1';
const port = Number(process.env.MAXTRACKER_ANALYTICS_PORT ?? 8770);
if (!Number.isInteger(port) || port < 1 || port > 65535) throw new Error('Некорректный порт панели');
const origin = 'http://' + host + ':' + port;
const here = fileURLToPath(new URL('.', import.meta.url));
const candidates = [
  join(homedir(), 'Desktop', 'УРВ', 'MaxTracker', 'lan_v3.sqlite3'),
  resolve(here, '../lan_v3.sqlite3')
];
const databasePath = process.env.MAXTRACKER_HUB_DB || candidates.find(existsSync) || candidates[0];
const settingsPath = process.env.MAXTRACKER_ANALYTICS_SETTINGS || join(
  process.env.LOCALAPPDATA || homedir(), 'MaxTracker', 'analytics', 'settings.json'
);

const assets = new Map([
  ['/', ['public/index.html', 'text/html; charset=utf-8']],
  ['/style.css', ['public/style.css', 'text/css; charset=utf-8']],
  ['/app.js', ['public/app.js', 'text/javascript; charset=utf-8']],
  ['/report.js', ['public/report.js', 'text/javascript; charset=utf-8']],
  ['/icon.png', ['../assets/icon48.png', 'image/png']]
]);

const headers = {
  'Cache-Control': 'no-store',
  'Content-Security-Policy': "default-src 'none'; script-src 'self'; style-src 'self'; connect-src 'self'; img-src 'self'; frame-ancestors 'none'; base-uri 'none'; form-action 'none'",
  'Cross-Origin-Resource-Policy': 'same-origin',
  'Referrer-Policy': 'no-referrer',
  'X-Content-Type-Options': 'nosniff'
};

function respond(response, status, content, type = 'application/json; charset=utf-8') {
  response.writeHead(status, { ...headers, 'Content-Type': type });
  response.end(type.startsWith('application/json') ? JSON.stringify(content) : content);
}

function readSettings() {
  try {
    const saved = JSON.parse(readFileSync(settingsPath, 'utf8'));
    return { people: saved.people ?? {}, chats: saved.chats ?? {} };
  } catch (error) {
    if (error.code === 'ENOENT') return { people: {}, chats: {} };
    throw error;
  }
}

function plainObject(value) {
  return value !== null && typeof value === 'object' && !Array.isArray(value);
}

function label(value) {
  if (typeof value !== 'string' || value.length > 100 || /[\u0000-\u001f\u007f]/.test(value)) {
    throw new TypeError('Проверьте названия. Допустимо до 100 символов.');
  }
  return value.trim();
}

async function updateSettings(request) {
  let bytes = 0;
  const parts = [];
  for await (const part of request) {
    bytes += part.length;
    if (bytes > 256 * 1024) throw new TypeError('Слишком большой объём настроек.');
    parts.push(part);
  }
  let draft;
  try {
    draft = JSON.parse(Buffer.concat(parts).toString('utf8'));
  } catch {
    throw new TypeError('Неверный формат настроек.');
  }
  if (!plainObject(draft) || !Array.isArray(draft.people) || !Array.isArray(draft.chats)) {
    throw new TypeError('Неверный формат настроек.');
  }
  const saved = readSettings();
  const changes = {
    people: Object.fromEntries(draft.people.map(person => [label(person?.id), {
      name: label(person?.name), department: label(person?.department)
    }])),
    chats: Object.fromEntries(draft.chats.map(chat => [label(chat?.id), label(chat?.name)]))
  };
  const normalized = {
    people: { ...saved.people, ...changes.people },
    chats: { ...saved.chats, ...changes.chats }
  };
  mkdirSync(dirname(settingsPath), { recursive: true });
  const temporary = settingsPath + '.' + randomUUID() + '.tmp';
  try {
    writeFileSync(temporary, JSON.stringify(normalized, null, 2) + '\n', { flag: 'wx', mode: 0o600 });
    renameSync(temporary, settingsPath);
  } finally {
    rmSync(temporary, { force: true });
  }
}

function snapshot() {
  if (!existsSync(databasePath) || !statSync(databasePath).isFile()) {
    return { missing: true, databasePath };
  }
  const report = readJournal(databasePath);
  const settings = readSettings();
  const { people, appeals } = groupEmployees(report, settings.people);
  const chats = [...new Set(report.appeals.map(appeal => appeal.chat))].map(id => ({
    id,
    name: Object.hasOwn(settings.chats, id) ? settings.chats[id] : ''
  }));
  return {
    fetchedAt: Date.now(),
    events: report.events,
    earliestEventAt: report.earliestEventAt,
    latestEventAt: report.latestEventAt,
    people,
    chats,
    appeals
  };
}

const server = createServer(async (request, response) => {
  if (request.headers.host !== host + ':' + port) {
    respond(response, 403, { error: 'Панель доступна по локальному адресу ' + origin });
    return;
  }
  const pathname = request.url?.split('?')[0];
  try {
    if (request.method === 'GET' && assets.has(pathname)) {
      const [path, type] = assets.get(pathname);
      respond(response, 200, readFileSync(resolve(here, path)), type);
    } else if (request.method === 'GET' && pathname === '/health') {
      respond(response, 200, { service: 'MaxTracker Analytics' });
    } else if (request.method === 'GET' && pathname === '/api/report') {
      const data = snapshot();
      respond(response, data.missing ? 503 : 200, data);
    } else if (request.method === 'PUT' && pathname === '/api/settings') {
      if (request.headers.origin !== origin || request.headers['content-type'] !== 'application/json') {
        respond(response, 403, { error: 'Сохранение доступно из локальной панели.' });
        return;
      }
      await updateSettings(request);
      respond(response, 200, { saved: true });
    } else {
      respond(response, 404, { error: 'Страница не найдена.' });
    }
  } catch (error) {
    const invalid = error instanceof TypeError && pathname === '/api/settings';
    if (!invalid) console.error(error.message);
    respond(response, invalid ? 400 : 500, {
      error: invalid ? error.message : 'Не удалось прочитать данные или сохранить настройки. Подробности в журнале панели.'
    });
  }
});

function openBrowser() {
  if (!process.argv.includes('--open') || process.platform !== 'win32') return;
  const browser = spawn('rundll32.exe', ['url.dll,FileProtocolHandler', origin], {
    detached: true, stdio: 'ignore', windowsHide: true
  });
  browser.on('error', error => console.error(error.message));
  browser.unref();
}

server.on('error', async error => {
  if (error.code === 'EADDRINUSE') {
    try {
      const result = await fetch(origin + '/health', { signal: AbortSignal.timeout(1500) });
      const info = await result.json();
      if (info.service === 'MaxTracker Analytics') {
        console.log('MaxTracker Analytics: ' + origin);
        openBrowser();
        return;
      }
    } catch {}
  }
  console.error(error.message);
  process.exitCode = 1;
});

server.listen(port, host, () => {
  console.log('MaxTracker Analytics: ' + origin);
  openBrowser();
});
