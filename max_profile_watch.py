"""Publish a MAX compatibility profile when web.max.ru ships a new build.

The relay already rereads max-compat.json and sends it to connected extensions.
This watcher only replaces that file when the current chat page has exactly one
module that still exposes server chat ids the same way as the checked build.
"""
from __future__ import annotations
import json
import os
import re
import time
import urllib.request
from pathlib import Path

try:
    from lan_hub import parse_max_profile
except ImportError:  # The installed relay keeps its historical file name.
    from lan_sync_hub import parse_max_profile

ORIGIN = 'https://web.max.ru'
APP_ENTRY = re.compile(r'/_app/immutable/entry/(app\.[A-Za-z0-9_-]{1,64}\.js)')
CHAT_ROUTE = re.compile(r'"/\[\[chatId\]\]/\[\[messageId\]\]/\[\[commentId\]\]":\[(\d+)\]')
NODE_IMPORT = re.compile(r'import\(`\.\./nodes/([A-Za-z0-9_.-]{1,80}\.js)`\)')
CHUNK_IMPORT = re.compile(r'from"\.\./chunks/([A-Za-z0-9_-]{1,64}\.js)"')
CLASS_START = re.compile(r'(?<![\w$])([\w$]+)=(?:new )?class\b')
CHAT_GETTER = re.compile(
    r'get\s+chat\s*\(\s*\)\s*\{\s*return\s+[\w$]+\.chats\.get\(this\.chatId\)\s*;?\s*\}')
ROUTER_START = re.compile(r'(?<![\w$])([\w$]+)=new class\{')
VIEWER_START = re.compile(
    r'(?<![\w$])([\w$]+)=class extends ([\w$]+)\{static get cache\(\)\{return [\w$]+\.viewer\}')
STATIC_GET = re.compile(r'static get\(\.\.\.')
CONTACT_ID = re.compile(r'get\s+contactId\s*\(')
OPEN_CHAT = re.compile(r'openChat\([\w$]+,[\w$]+,[\w$]+\)\{')


def http_get(url, timeout=15):
    request = urllib.request.Request(url, headers={'User-Agent': 'MaxTrackerProfileWatch/1'})
    with urllib.request.urlopen(request, timeout=timeout) as response:
        payload = response.read(6_000_001)
    if len(payload) > 6_000_000:
        raise ValueError(f'MAX response is too large: {url}')
    return payload.decode('utf-8', 'replace')


def _body(source, start, limit=12000):
    nxt = CLASS_START.search(source, start + 1, start + limit)
    return source[start:nxt.start() if nxt else min(len(source), start + limit)]


def _class_extends(source, name):
    match = re.search(
        rf'(?<![\w$]){re.escape(name)}=class(?: [\w$]+)?(?: extends ([\w$]+))?\{{', source)
    if not match:
        return None
    return match


def _has_static_get(source, name, depth=4):
    if depth < 0 or not name:
        return False
    match = _class_extends(source, name)
    if not match:
        return False
    if STATIC_GET.search(_body(source, match.end(), 800)):
        return True
    return _has_static_get(source, match.group(1), depth - 1)


def export_map(source):
    exports = list(re.finditer(r'export\{([^{}]*)\}', source))
    if not exports:
        return {}
    mapped = {}
    for part in exports[-1].group(1).split(','):
        part = part.strip()
        if not part:
            continue
        local, _, public = part.partition(' as ')
        mapped[local.strip()] = (public or local).strip()
    return mapped


def extract_model(source, module):
    """Return the profile model, None when this file is unrelated, or raise."""
    chats, routers, viewers = [], [], []
    for match in re.finditer(r'(?<![\w$])([\w$]+)=class\b', source):
        body = _body(source, match.start())
        if 'FLAG_HIDE_EDIT' not in body[:500]:
            continue
        if len(CHAT_GETTER.findall(body)) != 1:
            raise ValueError(f'{module} message class no longer exposes server chat ids')
        chats.append(match.group(1))
    for match in ROUTER_START.finditer(source):
        body = _body(source, match.start())
        if 'get main()' not in body or not OPEN_CHAT.search(body):
            continue
        if 'kind:`chat`,chatId:' not in body or 'highlight:' not in body:
            raise ValueError(f'{module} changed chat navigation')
        routers.append(match.group(1))
    for match in VIEWER_START.finditer(source):
        body = _body(source, match.start())
        if not _has_static_get(source, match.group(2)):
            raise ValueError(f'{module} viewer can no longer be read')
        if not CONTACT_ID.search(body):
            raise ValueError(f'{module} viewer lost contactId')
        viewers.append(match.group(1))
    if not chats and not routers and not viewers:
        return None
    if len(chats) != 1 or len(routers) != 1 or len(viewers) != 1:
        raise ValueError(
            f'ambiguous MAX model in {module}: chat={len(chats)} router={len(routers)} viewer={len(viewers)}')
    exports = export_map(source)
    try:
        names = [exports[local] for local in (chats[0], routers[0], viewers[0])]
    except KeyError as error:
        raise ValueError(f'{module} does not export {error.args[0]}') from error
    model = {'module': module, 'chat': names[0], 'router': names[1], 'viewer': names[2]}
    parse_max_profile({'schema': 1, 'revision': 'probe', 'models': [model]})
    return model


def chat_node(app_source):
    route = CHAT_ROUTE.search(app_source)
    nodes = NODE_IMPORT.findall(app_source)
    if not route or not nodes:
        raise ValueError('MAX chat route was not found')
    index = int(route.group(1))
    if index >= len(nodes):
        raise ValueError('MAX chat route points outside the page list')
    return nodes[index]


def discover_model(fetch):
    html = fetch(ORIGIN + '/')
    entry = APP_ENTRY.search(html)
    if not entry:
        raise ValueError('MAX app entry was not found')
    app_name = entry.group(1)
    app_source = fetch(f'{ORIGIN}/_app/immutable/entry/{app_name}')
    node_name = chat_node(app_source)
    node_source = fetch(f'{ORIGIN}/_app/immutable/nodes/{node_name}')
    found = []
    for chunk in dict.fromkeys(CHUNK_IMPORT.findall(node_source)):
        module = f'/_app/immutable/chunks/{chunk}'
        model = extract_model(fetch(f'{ORIGIN}{module}'), module)
        if model:
            found.append(model)
    if len(found) != 1:
        raise ValueError(f'expected one MAX model, found {len(found)}')
    return {'app': app_name, 'model': found[0]}


def load_profile(path):
    if not path.exists():
        return None
    return parse_max_profile(json.loads(path.read_text(encoding='utf-8-sig')))


def next_revision(current, day):
    match = re.fullmatch(rf'{re.escape(day)}\.(\d+)', current or '')
    number = int(match.group(1)) + 1 if match else 1
    revision = f'{day}.{number}'
    if not re.fullmatch(r'[A-Za-z0-9._-]{1,48}', revision):
        raise ValueError('profile revision is too long')
    return revision


def merge_profile(existing, model, day):
    models = list(existing['models']) if existing else []
    if any(item == model for item in models):
        return None
    models = [item for item in models if item['module'] != model['module']]
    models.insert(0, model)
    del models[8:]
    return parse_max_profile({
        'schema': 1,
        'revision': next_revision(existing.get('revision') if existing else '', day),
        'models': models,
    })


def dump_profile(profile):
    rows = []
    for model in profile['models']:
        fields = ', '.join(f'{json.dumps(key)}: {json.dumps(model[key])}'
                           for key in ('module', 'chat', 'router', 'viewer'))
        rows.append(f'    {{{fields}}}')
    return '\n'.join([
        '{',
        f'  "schema": {profile["schema"]},',
        f'  "revision": {json.dumps(profile["revision"])},',
        '  "models": [',
        ',\n'.join(rows),
        '  ]',
        '}',
        '',
    ])


def _write_json(path, text):
    temporary = path.with_name(path.name + '.tmp')
    temporary.write_text(text, encoding='utf-8')
    os.replace(temporary, path)


def update_profile(path, fetch=http_get, today=None):
    """Write a new profile when the published MAX build is not listed yet."""
    path = Path(path)
    discovered = discover_model(fetch)
    existing = load_profile(path)
    updated = merge_profile(existing, discovered['model'], today or time.strftime('%Y-%m-%d'))
    state = {'app': discovered['app'], 'module': discovered['model']['module']}
    if updated is None:
        _write_json(path.with_name('max-profile-watch.json'), json.dumps(state))
        return None
    _write_json(path, dump_profile(updated))
    _write_json(path.with_name('max-profile-watch.json'), json.dumps(state))
    return f"{updated['revision']} {discovered['model']['module']}"


def update_profile_if_build_changed(path, fetch=http_get, today=None):
    """Skip chunk downloads while the MAX app entry is the one already published."""
    path = Path(path)
    state_path = path.with_name('max-profile-watch.json')
    html = fetch(ORIGIN + '/')
    entry = APP_ENTRY.search(html)
    if not entry:
        raise ValueError('MAX app entry was not found')
    try:
        state = json.loads(state_path.read_text(encoding='utf-8')) if state_path.exists() else {}
        profile = load_profile(path)
    except (OSError, ValueError, json.JSONDecodeError):
        state, profile = {}, None
    if (state.get('app') == entry.group(1) and profile
            and any(item['module'] == state.get('module') for item in profile['models'])):
        return None
    remembered = {}

    def caching_fetch(url, timeout=15):
        if url == ORIGIN + '/':
            return html
        if url not in remembered:
            remembered[url] = fetch(url, timeout)
        return remembered[url]

    return update_profile(path, caching_fetch, today)
