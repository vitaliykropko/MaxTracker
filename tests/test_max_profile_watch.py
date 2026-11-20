import json
import threading
import time
import unittest
from pathlib import Path

from hub_supervisor import Supervisor
from max_profile_watch import (
    chat_node, extract_model, merge_profile, update_profile_if_build_changed,
)


MODEL = (
    'var TD=class e extends yD{static cache;static get(...e){return this.cache.get()}};'
    'var ED=class extends TD{get id(){throw Error(`singleton model has no id`)}};'
    'var GA=class extends ED{static get cache(){return G.viewer}get contactId(){return 1}};'
    'var dA=class e extends yD{chatId;static FLAG_HIDE_EDIT=1;get chat(){return G.chats.get(this.chatId)}};'
    'var dK=new class{get main(){return {kind:`empty`}}'
    'openChat(e,t,n){let r={};r.main={kind:`chat`,chatId:e};r.anchor={highlight:n?.highlight??!0};return r}};'
    'export{dA as xc,dK as pi,GA as vc};'
)
APP = (
    'f={"/[[chatId]]/[[messageId]]/[[commentId]]":[1]};'
    'u=[()=>import(`../nodes/0.OTHER.js`),()=>import(`../nodes/10.CHAT.js`)]'
)
NODE = 'import{a as b}from"../chunks/plain.js";import{c as d}from"../chunks/model.js";'
PAGES = {
    'https://web.max.ru/': '<link href="/_app/immutable/entry/app.NEWBUILD.js">',
    'https://web.max.ru/_app/immutable/entry/app.NEWBUILD.js': APP,
    'https://web.max.ru/_app/immutable/nodes/10.CHAT.js': NODE,
    'https://web.max.ru/_app/immutable/chunks/plain.js': 'export{a as b};',
    'https://web.max.ru/_app/immutable/chunks/model.js': MODEL,
}
EXPECTED = {
    'module': '/_app/immutable/chunks/model.js',
    'chat': 'xc', 'router': 'pi', 'viewer': 'vc',
}


class ProfileWatchTests(unittest.TestCase):
    def test_current_build_is_prepended_and_a_repeat_check_reads_only_the_page(self):
        with self.subTest('model'):
            self.assertEqual(extract_model(MODEL, EXPECTED['module']), EXPECTED)
        seen = []

        def fetch(url, timeout=15):
            seen.append(url)
            return PAGES[url]

        import tempfile
        with tempfile.TemporaryDirectory() as temp:
            path = Path(temp) / 'max-compat.json'
            previous = {'schema': 1, 'revision': '2026-11-06.2', 'models': [
                {'module': '/_app/immutable/chunks/old.js', 'chat': 'yc', 'router': 'fi', 'viewer': 'gc'}]}
            path.write_text(json.dumps(previous), encoding='utf-8')
            published = update_profile_if_build_changed(path, fetch, today='2026-11-13')
            self.assertEqual(published, '2026-11-13.1 /_app/immutable/chunks/model.js')
            saved = json.loads(path.read_text(encoding='utf-8'))
            self.assertEqual(saved['models'][0], EXPECTED)
            self.assertEqual(saved['models'][1]['module'], '/_app/immutable/chunks/old.js')
            seen.clear()
            self.assertIsNone(update_profile_if_build_changed(path, fetch, today='2026-11-13'))
            self.assertEqual(seen, ['https://web.max.ru/'])

    def test_ambiguous_build_does_not_replace_the_profile(self):
        broken = MODEL.replace('var dK=new class{', 'var dK=new class{', 1) + MODEL
        pages = dict(PAGES)
        pages['https://web.max.ru/_app/immutable/chunks/model.js'] = broken
        import tempfile
        with tempfile.TemporaryDirectory() as temp:
            path = Path(temp) / 'max-compat.json'
            path.write_text('{"schema":1,"revision":"keep","models":[{"module":"/_app/immutable/chunks/old.js","chat":"yc","router":"fi","viewer":"gc"}]}', encoding='utf-8')
            before = path.read_bytes()
            with self.assertRaises(ValueError):
                update_profile_if_build_changed(path, lambda url, timeout=15: pages[url], today='2026-11-13')
            self.assertEqual(path.read_bytes(), before)

    def test_oldest_model_is_dropped_after_eight(self):
        existing = {'schema': 1, 'revision': '2026-11-13.1', 'models': [
            {'module': f'/_app/immutable/chunks/{index}.js', 'chat': 'a', 'router': 'b', 'viewer': 'c'}
            for index in range(8)]}
        updated = merge_profile(existing, EXPECTED, '2026-11-13')
        self.assertEqual(updated['revision'], '2026-11-13.2')
        self.assertEqual(len(updated['models']), 8)
        self.assertEqual(updated['models'][0], EXPECTED)
        self.assertNotIn('/_app/immutable/chunks/7.js', [item['module'] for item in updated['models']])

    def test_saved_chat_page_points_at_the_checked_module(self):
        app = Path(__file__).parents[1] / 'artifacts' / 'max-build-20261113' / 'app.B3xUOzsa.js'
        chunk = Path(__file__).parents[1] / 'artifacts' / 'max-build-20261113' / 'chunks' / 'uj-hx3bp.js'
        if not app.exists() or not chunk.exists():
            self.skipTest('saved MAX build is not in artifacts')
        self.assertEqual(chat_node(app.read_text(encoding='utf-8')), '10.Be8jU25f.js')
        self.assertEqual(extract_model(chunk.read_text(encoding='utf-8'), '/_app/immutable/chunks/uj-hx3bp.js'), {
            'module': '/_app/immutable/chunks/uj-hx3bp.js', 'chat': 'xc', 'router': 'pi', 'viewer': 'vc'})


class SupervisorWatchTests(unittest.TestCase):
    def test_profile_check_runs_beside_the_health_loop(self):
        done = threading.Event()
        calls = []

        def watch(path):
            calls.append(path.name)
            done.set()
            return '2026-11-13.1 /_app/immutable/chunks/model.js'

        supervisor = Supervisor(
            Path(__file__).parents[1] / 'lan_hub.py', '127.0.0.1', 9, 'relay.sqlite3',
            profile_interval=1000, profile_delay=0, profile_watch=watch)
        supervisor.retry_at = time.monotonic() + 100
        supervisor.step()
        self.assertTrue(done.wait(2))
        supervisor.step()
        self.assertEqual(calls, ['max-compat.json'])


if __name__ == '__main__':
    unittest.main()
