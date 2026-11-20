import asyncio
import json
import tempfile
import unittest
from pathlib import Path
from websockets.asyncio.client import connect
from websockets.asyncio.server import serve
from lan_hub import RelayStore, Relay


class DeliveryTests(unittest.IsolatedAsyncioTestCase):
    async def asyncSetUp(self):
        self.temp = tempfile.TemporaryDirectory()
        self.path = str(Path(self.temp.name)/'relay.sqlite3')
        self.store = RelayStore(self.path)
        self.relay = Relay(self.store)
        self.server = await serve(self.relay.handler,'127.0.0.1',0)
        self.url = f'ws://127.0.0.1:{self.server.sockets[0].getsockname()[1]}'

    async def asyncTearDown(self):
        self.server.close();await self.server.wait_closed()
        self.store.close();self.temp.cleanup()

    async def hello(self,device,cursor=0):
        ws=await connect(self.url)
        await ws.send(json.dumps({'type':'HELLO','protocol':3,'deviceId':device,'operatorName':device,'cursor':cursor}))
        self.assertEqual(json.loads(await ws.recv())['type'],'WELCOME')
        return ws

    async def test_offline_peer_receives_after_restart_and_duplicate_is_single_envelope(self):
        anna=await self.hello('anna')
        boris=await self.hello('boris');await boris.close()
        event={'eventId':'one','deviceId':'anna','type':'START','chatId':'chat_1','messageId':'123456789012345678','sessionId':'session','operatorName':'anna','expectedEventId':'','eventAt':1000,'replyText':'must not travel'}
        await anna.send(json.dumps({'type':'EVENT','event':event}))
        accepted=json.loads(await anna.recv());batch=json.loads(await anna.recv())
        self.assertEqual(accepted['sequence'],1)
        self.assertNotIn('replyText',batch['entries'][0]['event'])
        await anna.send(json.dumps({'type':'RECEIVED','sequence':1}))
        await anna.send(json.dumps({'type':'EVENT','event':event}))
        self.assertEqual(json.loads(await anna.recv())['sequence'],1)
        self.assertEqual(self.store.last_sequence(),1)
        await anna.close()
        self.server.close();await self.server.wait_closed();self.store.close()
        self.store=RelayStore(self.path);self.relay=Relay(self.store)
        self.server=await serve(self.relay.handler,'127.0.0.1',0)
        self.url=f'ws://127.0.0.1:{self.server.sockets[0].getsockname()[1]}'
        boris=await self.hello('boris')
        batch=json.loads(await boris.recv())
        self.assertEqual(batch['entries'][0]['event']['messageId'],'123456789012345678')
        await boris.send(json.dumps({'type':'RECEIVED','sequence':1}))
        await asyncio.sleep(0.02)
        self.assertEqual(self.store.pending('boris'),[])
        await boris.close()

    async def test_sender_cannot_forge_the_envelope_device(self):
        ws=await self.hello('anna')
        await ws.send(json.dumps({'type':'EVENT','event':{'eventId':'forged','deviceId':'boris'}}))
        self.assertEqual(json.loads(await ws.recv())['type'],'ERROR')
        self.assertEqual(self.store.last_sequence(),0)
        await ws.close()


if __name__=='__main__':
    unittest.main()
