import asyncio
import json
from pathlib import Path
import socket
import tempfile
import time
import unittest
from websockets.asyncio.client import connect
from hub_supervisor import Supervisor, acquire_lock, probe


class SupervisorTests(unittest.TestCase):
    def test_duplicate_supervisor_cannot_take_same_lock(self):
        with tempfile.TemporaryDirectory() as temp:
            path = Path(temp)/'monitor.lock'
            first = acquire_lock(path)
            self.assertIsNotNone(first)
            try:
                self.assertIsNone(acquire_lock(path))
            finally:
                first.close()
            second = acquire_lock(path)
            self.assertIsNotNone(second)
            second.close()

    def test_crashed_relay_is_restarted_with_the_same_history_and_unread_delivery(self):
        with tempfile.TemporaryDirectory() as temp:
            with socket.socket() as free:
                free.bind(('127.0.0.1', 0)); port = free.getsockname()[1]
            database = Path(temp)/'relay.sqlite3'
            supervisor = Supervisor(Path(__file__).parents[1]/'lan_hub.py', '127.0.0.1', port, database, retry_min=.1, retry_max=.2)
            def wait_healthy():
                deadline = time.monotonic()+10
                while time.monotonic()<deadline:
                    supervisor.step()
                    if probe('127.0.0.1',port,.2)=='healthy':
                        return
                    time.sleep(.1)
                self.fail('Supervised relay did not recover')
            async def produce():
                async with connect(f'ws://127.0.0.1:{port}',proxy=None) as ws:
                    await ws.send(json.dumps({'type':'HELLO','protocol':3,'deviceId':'test-device','operatorName':'Test','cursor':0}))
                    self.assertEqual(json.loads(await ws.recv())['type'],'WELCOME')
                    event={'eventId':'durable','deviceId':'test-device','type':'START','chatId':'chat','messageId':'1','sessionId':'work','operatorName':'Test','expectedEventId':'','eventAt':1000}
                    await ws.send(json.dumps({'type':'EVENT','event':event}))
                    self.assertEqual(json.loads(await ws.recv())['type'],'ACCEPTED')
                    self.assertEqual(json.loads(await ws.recv())['entries'][0]['sequence'],1)
            async def receive():
                async with connect(f'ws://127.0.0.1:{port}',proxy=None) as ws:
                    await ws.send(json.dumps({'type':'HELLO','protocol':3,'deviceId':'test-device','operatorName':'Test','cursor':0}))
                    await ws.recv()
                    self.assertEqual(json.loads(await ws.recv())['entries'][0]['event']['eventId'],'durable')
            try:
                wait_healthy()
                asyncio.run(produce())
                pid = supervisor.child.pid
                supervisor.child.kill(); supervisor.child.wait(timeout=5)
                wait_healthy()
                self.assertNotEqual(supervisor.child.pid,pid)
                asyncio.run(receive())
                self.assertEqual(probe('127.0.0.1',port),'healthy')
            finally:
                supervisor.stop_child()


if __name__ == '__main__':
    unittest.main()
