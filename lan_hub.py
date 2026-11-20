"""Durable delivery channel for MaxTracker 3. No MAX or TimeTracker API client.

Workflow decisions, permissions and task reduction belong to the extensions.
This relay stores envelopes, gives them delivery sequence numbers and retains
each peer's acknowledgement cursor across disconnects and restarts.
"""
from __future__ import annotations
import argparse
import asyncio
import json
import logging
from logging.handlers import RotatingFileHandler
import re
import sqlite3
import sys
import time
from http import HTTPStatus
from pathlib import Path
from websockets.asyncio.server import serve

LOG = logging.getLogger('MaxTrackerRelay')
WIRE_FIELDS = {
    'type', 'chatId', 'messageId', 'eventId', 'eventAt', 'deviceId',
    'operatorName', 'sessionId', 'expectedEventId', 'fromSessionId',
    'fromDeviceId', 'sentMessageId',
}


def parse_max_profile(data):
    if not isinstance(data, dict) or type(data.get('schema')) is not int or data['schema'] != 1:
        raise ValueError('unsupported profile schema')
    revision, entries = data.get('revision'), data.get('models')
    if not isinstance(revision, str) or not re.fullmatch(r'[A-Za-z0-9._-]{1,48}', revision):
        raise ValueError('invalid profile revision')
    if not isinstance(entries, list) or not 1 <= len(entries) <= 8:
        raise ValueError('invalid model list')
    models = []
    for entry in entries:
        if not isinstance(entry, dict):
            raise ValueError('invalid model')
        module = entry.get('module')
        if not isinstance(module, str) or not re.fullmatch(r'/_app/immutable/chunks/[A-Za-z0-9_-]{1,64}\.js', module):
            raise ValueError('invalid MAX module path')
        model = {'module': module}
        for role in ('chat', 'router', 'viewer'):
            name = entry.get(role)
            if (not isinstance(name, str) or not re.fullmatch(r'[A-Za-z_$][A-Za-z0-9_$]{0,31}', name)
                    or name in ('__proto__', 'prototype', 'constructor')):
                raise ValueError('invalid MAX export name')
            model[role] = name
        models.append(model)
    return {'schema': 1, 'revision': revision, 'models': models}


class RelayStore:
    def __init__(self, path):
        self.db = sqlite3.connect(path)
        self.db.execute('PRAGMA journal_mode=WAL')
        self.db.execute('PRAGMA synchronous=FULL')
        self.db.executescript('''
          CREATE TABLE IF NOT EXISTS events (
            sequence INTEGER PRIMARY KEY AUTOINCREMENT,
            event_id TEXT NOT NULL UNIQUE,
            sender TEXT NOT NULL,
            payload TEXT NOT NULL
          );
          CREATE TABLE IF NOT EXISTS peers (
            device_id TEXT PRIMARY KEY,
            operator_name TEXT NOT NULL,
            cursor INTEGER NOT NULL DEFAULT 0,
            last_seen REAL NOT NULL
          );
        ''')
        self.db.commit()

    def hello(self, device, name, cursor):
        if not isinstance(cursor, int) or cursor < 0 or cursor > self.last_sequence():
            raise ValueError('Недопустимый курсор истории; проверьте сохранность базы хаба')
        self.db.execute('''INSERT INTO peers VALUES (?, ?, ?, ?)
            ON CONFLICT(device_id) DO UPDATE SET operator_name=excluded.operator_name,
            cursor=MIN(peers.cursor,excluded.cursor),last_seen=excluded.last_seen''',
            (device, name, cursor, time.time()))
        self.db.commit()

    def last_sequence(self):
        return self.db.execute('SELECT COALESCE(MAX(sequence),0) FROM events').fetchone()[0]

    def append(self, device, event):
        if not isinstance(event, dict) or event.get('deviceId') != device:
            raise ValueError('Отправитель конверта не совпадает с подключением')
        if not isinstance(event.get('eventId'), str) or not 1 <= len(event['eventId']) <= 512:
            raise ValueError('Не указан ID доставки')
        clean = {key: value for key, value in event.items() if key in WIRE_FIELDS}
        payload = json.dumps(clean, ensure_ascii=False, separators=(',', ':'))
        if len(payload.encode('utf-8')) > 16384:
            raise ValueError('Слишком большой конверт')
        with self.db:
            previous = self.db.execute('SELECT sequence,sender,payload FROM events WHERE event_id=?', (clean['eventId'],)).fetchone()
            if previous:
                if previous[1] != device or previous[2] != payload:
                    raise ValueError('ID доставки уже занят другим конвертом')
                return previous[0]
            return self.db.execute('INSERT INTO events(event_id,sender,payload) VALUES (?,?,?)', (clean['eventId'],device,payload)).lastrowid

    def pending(self, device, limit=200):
        row = self.db.execute('SELECT cursor FROM peers WHERE device_id=?',(device,)).fetchone()
        if row is None:
            return []
        return [{'sequence': seq, 'event': json.loads(payload)} for seq,payload in
                self.db.execute('SELECT sequence,payload FROM events WHERE sequence>? ORDER BY sequence LIMIT ?', (row[0],limit))]

    def received(self, device, sequence):
        if not isinstance(sequence,int) or not 0 <= sequence <= self.last_sequence():
            raise ValueError('Недопустимое подтверждение')
        with self.db:
            self.db.execute('UPDATE peers SET cursor=MAX(cursor,?),last_seen=? WHERE device_id=?',(sequence,time.time(),device))

    def close(self):
        self.db.close()


class Relay:
    def __init__(self, store, profile_path=None):
        self.store = store
        self.clients = {}
        self.send_locks = {}
        self.profile_path = profile_path
        self.profile_stamp = None
        self.profile = None
        self.profile_clients = {}
        self.refresh_profile()

    def refresh_profile(self):
        if self.profile_path is None:
            return
        try:
            stat = self.profile_path.stat()
            stamp = (stat.st_mtime_ns, stat.st_size)
            if stamp == self.profile_stamp:
                return
            self.profile_stamp = stamp
            with self.profile_path.open('rb') as file:
                raw = file.read(16385)
            if len(raw) > 16384:
                raise ValueError('profile is too large')
            profile = parse_max_profile(json.loads(raw.decode('utf-8-sig')))
        except FileNotFoundError:
            self.profile_stamp = None
            return
        except (OSError, ValueError) as error:
            LOG.warning('MAX profile ignored: %s', error)
            return
        self.profile = profile
        LOG.info('MAX profile loaded: %s', profile['revision'])

    async def send_profile(self, ws):
        profile = self.profile
        if profile is None or ws not in self.profile_clients or self.profile_clients[ws] == profile:
            return
        try:
            await asyncio.wait_for(self.send(ws, {'type': 'MAX_PROFILE', 'profile': profile}), timeout=3)
        except Exception:
            return  # Try again next cycle if the peer is still connected.
        if ws in self.profile_clients:
            self.profile_clients[ws] = profile

    def process_http_request(self, connection, request):
        if 'websocket' in request.headers.get('Upgrade','').lower():
            return None
        if request.path not in ('/','/status','/api/status','/health'):
            return None
        connected=set(self.clients.values())
        names=[name for device,name in self.store.db.execute('SELECT device_id,operator_name FROM peers') if device in connected]
        last=self.store.last_sequence()
        data={'status':'ok','service':'MaxTracker LAN Sync Hub','version':'3.0.1','protocol':3,
              'connectedClients':len(self.clients),'onlineUsers':sorted(set(names)),
              'knownDevices':self.store.db.execute('SELECT COUNT(*) FROM peers').fetchone()[0],
              'lastSequence':last,
              'pendingDeliveries':self.store.db.execute('SELECT COALESCE(SUM(?-cursor),0) FROM peers',(last,)).fetchone()[0],
              'maxProfile':self.profile['revision'] if self.profile else None,
              'profileClients':len(self.profile_clients),
              'serverTime':int(time.time()*1000)}
        response=connection.respond(HTTPStatus.OK,json.dumps(data,ensure_ascii=False,indent=2))
        response.headers['Content-Type']='application/json; charset=utf-8'
        response.headers['Cache-Control']='no-store'
        return response

    async def send(self, ws, data):
        async with self.send_locks[ws]:
            await ws.send(json.dumps(data, ensure_ascii=False, separators=(',', ':')))

    async def send_pending(self, ws):
        device = self.clients.get(ws)
        if not device:
            return
        entries = self.store.pending(device)
        if entries:
            await self.send(ws, {'type':'BATCH','entries':entries})

    async def deliver_all(self):
        async def deliver(ws):
            try:
                await asyncio.wait_for(self.send_pending(ws), timeout=3)
            except Exception:
                pass  # Durable cursor retains every undelivered envelope.
        await asyncio.gather(*(deliver(ws) for ws in list(self.clients)))

    async def periodic_delivery(self):
        while True:
            await asyncio.sleep(5)
            self.refresh_profile()
            await asyncio.gather(*(self.send_profile(ws) for ws in list(self.profile_clients)))
            await self.deliver_all()

    async def handler(self, ws):
        self.send_locks[ws] = asyncio.Lock()
        try:
            async for raw in ws:
                try:
                    data = json.loads(raw)
                    kind = data.get('type')
                    if kind == 'HELLO':
                        if data.get('protocol') != 3:
                            raise ValueError('Для этого хаба нужно расширение MaxTracker 3')
                        device = data.get('deviceId')
                        name = data.get('operatorName')
                        if not isinstance(device,str) or not 1 <= len(device) <= 512 or not isinstance(name,str) or not 1 <= len(name) <= 100:
                            raise ValueError('Не заданы устройство и имя пользователя')
                        self.store.hello(device,name,data.get('cursor',0))
                        self.clients[ws] = device
                        capabilities = data.get('capabilities')
                        if isinstance(capabilities, list) and 'max-profile-v1' in capabilities:
                            self.profile_clients[ws] = None
                        peers = [r[0] for r in self.store.db.execute('SELECT operator_name FROM peers ORDER BY operator_name')]
                        await self.send(ws, {'type':'WELCOME','protocol':3,'peers':peers})
                        await self.send_profile(ws)
                        await self.send_pending(ws)
                    elif kind == 'PING':
                        await self.send(ws, {'type':'PONG'})
                    elif ws not in self.clients:
                        raise ValueError('Сначала требуется HELLO')
                    elif kind == 'EVENT':
                        sequence = self.store.append(self.clients[ws],data.get('event'))
                        await self.send(ws, {'type':'ACCEPTED','eventId':data['event']['eventId'],'sequence':sequence})
                        await self.deliver_all()
                    elif kind == 'RECEIVED':
                        self.store.received(self.clients[ws],data.get('sequence'))
                        await self.send_pending(ws)
                    else:
                        raise ValueError('Неизвестный тип конверта')
                except (ValueError,TypeError,KeyError) as error:
                    await self.send(ws, {'type':'ERROR','error':str(error)})
        except Exception:
            pass
        finally:
            self.clients.pop(ws,None)
            self.profile_clients.pop(ws,None)
            self.send_locks.pop(ws,None)


async def run(args):
    path = Path(args.database).resolve()
    path.parent.mkdir(parents=True,exist_ok=True)
    store = RelayStore(str(path))
    relay = Relay(store, path.with_name('max-compat.json'))
    try:
        async with serve(relay.handler,args.host,args.port,max_size=32768,ping_interval=20,ping_timeout=30,process_request=relay.process_http_request):
            LOG.info('MaxTracker LAN 3: ws://%s:%s; database=%s',args.host,args.port,path)
            await relay.periodic_delivery()
    finally:
        store.close()


if __name__ == '__main__':
    parser=argparse.ArgumentParser(description='MaxTracker durable LAN delivery channel')
    parser.add_argument('--host',default='192.168.100.90')
    parser.add_argument('--port',type=int,default=8766)
    parser.add_argument('--database',default=str(Path(__file__).with_name('lan_v3.sqlite3')))
    args=parser.parse_args()
    handlers=[RotatingFileHandler(Path(__file__).with_name('lan_v3.log'),maxBytes=1048576,backupCount=3,encoding='utf-8')]
    if sys.stderr is not None:
        handlers.append(logging.StreamHandler())
    logging.basicConfig(level=logging.INFO,format='%(asctime)s %(message)s',handlers=handlers)
    try:
        asyncio.run(run(args))
    except KeyboardInterrupt:
        pass
    except Exception:
        LOG.exception('LAN relay stopped unexpectedly')
        raise SystemExit(1)
