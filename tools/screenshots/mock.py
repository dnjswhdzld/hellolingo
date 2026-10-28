"""Scripted stand-in for the Anthropic Messages API, so the guide screenshots replay the same session every time.

    python3 -I mock.py <scene.json> <cards.json> <log> <port> [--record]

The mod's card call gets the real haiku answer recorded in cards.json for that exact prompt.
With --record, a prompt with no recording is sent to real haiku through `claude -p`, built the way
the mod builds it (same system prompt, low effort, no tools), and the answer is saved.
Claude's main loop gets the scene's scripted turn, one step per assistant message. Tools run for real.
"""
import itertools, json, os, re, shutil, subprocess, sys, threading, time
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer

SCENE = json.load(open(sys.argv[1]))
CARDS_PATH = sys.argv[2]
LOG = open(sys.argv[3], 'a')
RECORD = '--record' in sys.argv
CARD_DELAY = SCENE.get('card_delay', 1.5)
CLAUDE = shutil.which('claude') or os.path.expanduser('~/.local/bin/claude')
COACH = 'You are an English coach for a Korean'
ids = itertools.count(1)
lock = threading.Lock()


def log(line):
    with lock:
        LOG.write(line + '\n')
        LOG.flush()


def text_of(content):
    if isinstance(content, str):
        return content
    return ''.join(b.get('text', '') for b in content if b.get('type') == 'text')


def ask_haiku(system, prompt):
    env = {k: v for k, v in os.environ.items() if k not in ('ANTHROPIC_BASE_URL', 'ANTHROPIC_API_KEY')}
    out = subprocess.run([CLAUDE, '-p', '--model', 'haiku', '--effort', 'low', '--tools', '', '--system-prompt', system,
                          '--setting-sources', 'project', '--no-session-persistence', '--output-format', 'json'],
                         input=prompt, capture_output=True, text=True, env=env, cwd='/', timeout=120)
    result = json.loads(out.stdout)['result']
    return json.loads(result[result.find('{'):result.rfind('}') + 1])


def card_reply(body, system):
    prompt = text_of(body['messages'][-1]['content'])
    m = re.search(r'PROMPT:\n<<<\n(.*)\n>>>', prompt, re.S)
    key = m.group(1) if m else ''
    with lock:
        cards = json.load(open(CARDS_PATH))
    card = cards.get(key)
    if card is None and RECORD:
        card = ask_haiku(system, prompt)
        with lock:
            cards = json.load(open(CARDS_PATH))
            cards[key] = card
            json.dump(cards, open(CARDS_PATH, 'w'), ensure_ascii=False, indent=2)
        log(f'card {key[:60]!r} -> recorded')
    else:
        log(f'card {key[:60]!r} -> {"hit" if card else "MISS"}')
        time.sleep(CARD_DELAY)
    return [{'type': 'text', 'text': json.dumps(card or {}, ensure_ascii=False)}]


def is_tool_result(m):
    return isinstance(m['content'], list) and any(b.get('type') == 'tool_result' for b in m['content'])


def main_reply(body):
    msgs = body['messages']
    last = max(i for i, m in enumerate(msgs) if m['role'] == 'user' and text_of(m['content']).strip() and not is_tool_result(m))
    said = text_of(msgs[last]['content'])
    step = sum(1 for m in msgs[last:] if m['role'] == 'assistant')
    turn = next((t for t in SCENE['turns'] if t['user'] in said), None)
    if turn is None or step >= len(turn['steps']):
        log(f'main {said[-50:]!r} step {step} -> MISS')
        return [{'type': 'text', 'text': '(각본에 없는 요청)'}]
    log(f'main {said[-50:]!r} step {step} -> hit')
    s = turn['steps'][step]
    time.sleep(s.get('delay', 1.0))
    if 'tool' in s:
        return ([{'type': 'text', 'text': s['say']}] if s.get('say') else []) + \
               [{'type': 'tool_use', 'id': f'toolu_{next(ids):04d}', 'name': s['tool'], 'input': s['input']}]
    return [{'type': 'text', 'text': s['text']}]


def reply_for(body):
    system = body.get('system', '')
    system = system if isinstance(system, str) else ''.join(b.get('text', '') for b in system)
    if COACH in system:
        # Claude Code puts its own header before the mod's system prompt; record with the mod's part only.
        return card_reply(body, system[system.index(COACH):])
    if body.get('tools'):
        return main_reply(body)
    log(f'aux model={body.get("model")} sys={system[:60]!r}')
    return [{'type': 'text', 'text': '{}' if 'json' in system.lower() else 'ok'}]


class Handler(BaseHTTPRequestHandler):
    def log_message(self, *args):
        pass

    def send_json(self, obj):
        data = json.dumps(obj, ensure_ascii=False).encode()
        self.send_response(200)
        self.send_header('content-type', 'application/json')
        self.send_header('content-length', str(len(data)))
        self.end_headers()
        self.wfile.write(data)

    def do_GET(self):
        self.send_json({})

    def do_POST(self):
        body = json.loads(self.rfile.read(int(self.headers['content-length'])) or b'{}')
        if not self.path.split('?')[0].endswith('/v1/messages'):
            return self.send_json({'input_tokens': 1200})
        blocks = reply_for(body)
        stop = 'tool_use' if any(b['type'] == 'tool_use' for b in blocks) else 'end_turn'
        msg = {'id': f'msg_{next(ids):04d}', 'type': 'message', 'role': 'assistant', 'model': body.get('model'),
               'stop_reason': None, 'stop_sequence': None, 'usage': {'input_tokens': 1200, 'output_tokens': 1}}
        if not body.get('stream'):
            return self.send_json({**msg, 'content': blocks, 'stop_reason': stop})
        self.send_response(200)
        self.send_header('content-type', 'text/event-stream')
        self.end_headers()

        def event(kind, data):
            self.wfile.write(f'event: {kind}\ndata: {json.dumps({"type": kind, **data}, ensure_ascii=False)}\n\n'.encode())
            self.wfile.flush()

        event('message_start', {'message': {**msg, 'content': []}})
        for i, b in enumerate(blocks):
            if b['type'] == 'text':
                event('content_block_start', {'index': i, 'content_block': {'type': 'text', 'text': ''}})
                for chunk in re.findall(r'.{1,12}', b['text'], re.S):
                    event('content_block_delta', {'index': i, 'delta': {'type': 'text_delta', 'text': chunk}})
                    time.sleep(0.02)
            else:
                event('content_block_start', {'index': i, 'content_block': {**b, 'input': {}}})
                event('content_block_delta', {'index': i, 'delta': {'type': 'input_json_delta',
                                                                     'partial_json': json.dumps(b['input'], ensure_ascii=False)}})
            event('content_block_stop', {'index': i})
        event('message_delta', {'delta': {'stop_reason': stop, 'stop_sequence': None}, 'usage': {'output_tokens': 40}})
        event('message_stop', {})


ThreadingHTTPServer(('127.0.0.1', int(sys.argv[4])), Handler).serve_forever()
