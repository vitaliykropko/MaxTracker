"""Keep the existing LAN relay alive without changing its address or database."""
from __future__ import annotations
import argparse
import http.client
import json
import logging
from logging.handlers import RotatingFileHandler
from pathlib import Path
import socket
import subprocess
import sys
import threading
import time

LOG = logging.getLogger('MaxTrackerSupervisor')


def acquire_lock(path):
    """One supervisor per relay directory; the OS releases the lock on exit."""
    handle = open(path, 'a+b')
    try:
        # Reading an already locked byte itself fails on Windows. Inspect size
        # without reading it, so a second launcher can exit cleanly.
        if Path(path).stat().st_size == 0:
            handle.write(b'0'); handle.flush()
        handle.seek(0)
        if sys.platform == 'win32':
            import msvcrt
            msvcrt.locking(handle.fileno(), msvcrt.LK_NBLCK, 1)
        else:
            import fcntl
            fcntl.flock(handle, fcntl.LOCK_EX | fcntl.LOCK_NB)
    except OSError:
        handle.close()
        return None
    return handle


def probe(host, port, timeout=2):
    # http.client never uses the system or environment proxy. This is LAN only.
    connection = http.client.HTTPConnection(host, port, timeout=timeout)
    try:
        connection.request('GET', '/health')
        response = connection.getresponse()
        data = json.loads(response.read(65536))
        if response.status == 200 and data.get('protocol') == 3 and data.get('service') == 'MaxTracker LAN Sync Hub':
            return 'healthy'
    except (OSError, ValueError, http.client.HTTPException):
        pass
    finally:
        connection.close()
    try:
        with socket.create_connection((host, port), timeout=timeout):
            return 'busy'
    except OSError:
        return 'offline'


class Supervisor:
    def __init__(self, script, host, port, database, *, retry_min=2, retry_max=30, unhealthy_limit=60,
                 profile_interval=600, profile_delay=120, profile_watch=None):
        self.script = Path(script).resolve()
        self.host, self.port = host, port
        self.database = str(Path(database).resolve())
        self.child = None
        self.retry_min, self.retry_max = retry_min, retry_max
        self.retry_delay = retry_min
        self.retry_at = 0
        self.unhealthy_since = None
        self.unhealthy_limit = unhealthy_limit
        self.last_state = None
        self.profile_interval = profile_interval
        self.profile_watch = profile_watch
        self.profile_thread = None
        self.next_profile_check = time.monotonic() + (profile_delay if profile_interval else 0)

    def step(self):
        now = time.monotonic()
        if self.child is not None and self.child.poll() is not None:
            LOG.warning('Relay exited: code=%s; next attempt in %.1fs', self.child.returncode, self.retry_delay)
            self.child = None
            self.retry_at = now + self.retry_delay
            self.retry_delay = min(self.retry_max, self.retry_delay * 2)
            self.unhealthy_since = None
        state = probe(self.host, self.port)
        if state != self.last_state:
            LOG.info('LAN relay: %s at %s:%s', state, self.host, self.port)
            self.last_state = state
        if state == 'healthy':
            self.retry_delay = self.retry_min
            self.unhealthy_since = None
        elif self.child is not None:
            self.unhealthy_since = self.unhealthy_since or now
            if now - self.unhealthy_since >= self.unhealthy_limit:
                # Only terminate the child we launched, never an unknown listener.
                LOG.warning('Owned relay stopped answering health checks; restarting')
                self.stop_child()
                self.retry_at = time.monotonic() + self.retry_delay
        elif state != 'busy' and now >= self.retry_at:
            try:
                self.child = subprocess.Popen(
                    [sys.executable, str(self.script), '--host', self.host, '--port', str(self.port), '--database', self.database],
                    cwd=str(self.script.parent), stdin=subprocess.DEVNULL,
                    stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL,
                    creationflags=getattr(subprocess, 'CREATE_NO_WINDOW', 0),
                )
                LOG.info('Started relay PID %s; database=%s', self.child.pid, self.database)
                self.unhealthy_since = time.monotonic()
            except OSError:
                LOG.exception('Could not start relay')
                self.retry_at = time.monotonic() + self.retry_delay
                self.retry_delay = min(self.retry_max, self.retry_delay * 2)
        self.maybe_watch_profile()

    def maybe_watch_profile(self):
        # Checking the public MAX build must not delay a relay restart.
        if not self.profile_interval or time.monotonic() < self.next_profile_check:
            return
        if self.profile_thread is not None and self.profile_thread.is_alive():
            return
        self.next_profile_check = time.monotonic() + self.profile_interval
        watch = self.profile_watch or _watch_installed_profile
        database = self.database

        def run():
            try:
                published = watch(Path(database).with_name('max-compat.json'))
            except Exception:
                LOG.exception('MAX profile watch failed')
                return
            if published:
                LOG.info('MAX profile published: %s', published)
            else:
                LOG.info('MAX profile current')

        self.profile_thread = threading.Thread(target=run, name='max-profile-watch', daemon=True)
        self.profile_thread.start()

    def stop_child(self):
        if self.child is None:
            return
        if self.child.poll() is None:
            self.child.terminate()
            try:
                self.child.wait(timeout=5)
            except subprocess.TimeoutExpired:
                self.child.kill(); self.child.wait(timeout=5)
        self.child = None
        self.unhealthy_since = None


def _watch_installed_profile(path):
    from max_profile_watch import update_profile_if_build_changed
    return update_profile_if_build_changed(path)


def main():
    parser = argparse.ArgumentParser(description='MaxTracker LAN relay supervisor')
    parser.add_argument('--script', default=str(Path(__file__).with_name('lan_sync_hub.py')))
    parser.add_argument('--host', default='192.168.100.90')
    parser.add_argument('--port', type=int, default=8766)
    parser.add_argument('--database')
    args = parser.parse_args()
    script = Path(args.script).resolve()
    if not script.is_file():
        raise SystemExit(f'Relay script not found: {script}')
    lock = acquire_lock(script.parent/'lan_supervisor.lock')
    if lock is None:
        return
    handler = RotatingFileHandler(script.parent/'lan_supervisor.log', maxBytes=1048576, backupCount=3, encoding='utf-8')
    logging.basicConfig(level=logging.INFO, format='%(asctime)s %(message)s', handlers=[handler])
    supervisor = Supervisor(script, args.host, args.port, args.database or script.parent/'lan_v3.sqlite3')
    LOG.info('Supervisor started; relay=%s', script)
    try:
        while True:
            try:
                supervisor.step()
            except Exception:
                LOG.exception('Supervisor iteration failed; retrying')
            time.sleep(3)
    except KeyboardInterrupt:
        supervisor.stop_child()
    finally:
        lock.close()


if __name__ == '__main__':
    main()
