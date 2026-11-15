"""Shoot one guide scene: real Claude Code with this repo's mod, against the scripted API, each screen saved as a PNG.

    python3 -I tools/screenshots/shoot.py <scene name> [--record | --render]

Claude Code starts in a fresh home folder, so screens show ~/hellolingo/<project> and nothing from this computer.
--record sends prompts that have no recorded card to real haiku first (needs `claude` logged in). Without it,
the run fails when a card or a scripted step is missing, or when a screen shows anything from this computer.
"""
import hashlib, json, os, pathlib, re, shlex, shutil, socket, subprocess, sys, tempfile, time, urllib.request

ROOT = pathlib.Path(__file__).resolve().parent
sys.path.insert(0, str(ROOT))
from render import render  # noqa: E402

REPO = ROOT.parent.parent
IMAGES = REPO / 'docs' / 'guide' / 'images'
CARDS = ROOT / 'cards.json'
PORT = 18431
SESSION = 'hl-shoot'
KEY = 'hellolingo-demo-key-not-a-secret'
CLAUDE = shutil.which('claude') or os.path.expanduser('~/.local/bin/claude')
STORE = 'hellolingo_inline-' + hashlib.sha256(b'hellolingo@inline').hexdigest()[:12] + '.json'
DAY_MS = 24 * 60 * 60 * 1000
ALLOW = ['Read', 'Edit', 'Write', 'Glob', 'Grep', 'Bash(npm test:*)', 'Bash(npm run:*)', 'Bash(git:*)',
         'Bash(python3:*)', 'Bash(node:*)', 'Bash(ls:*)']


def tmux(*args, **kw):
    return subprocess.run(['tmux', *args], check=True, capture_output=True, text=True, **kw).stdout


def screen(ansi=False):
    return without_host_notice(tmux('capture-pane', '-p', *(['-e'] if ansi else []), '-t', SESSION))


def without_host_notice(text):
    """호스팅된 컨테이너(클라우드 세션)에서 찍으면 Claude Code가 시작 화면에 인증 안내(⚠ Both ... set)를 붙인다.
    제품 화면이 아니고 그 컨테이너의 흔적이라, 그 줄부터 다음 빈 줄 앞까지 뺀다. 내 컴퓨터에서는 나오지 않는다."""
    out, skipping = [], False
    for line in text.split('\n'):
        plain = re.sub(r'\x1b\[[0-9;:]*m', '', line)
        starts = re.match(r'\s*(⚠ Both \S+ and \S+ set|· to use \S+:|then say "No" to the API key approval)', plain)
        skipping = bool(starts) or (skipping and plain.strip() != '')
        if not skipping:
            out.append(line)
    return '\n'.join(out)


def wait_for(cond, what, timeout):
    end = time.time() + timeout
    while time.time() < end:
        if cond(screen()):
            return
        time.sleep(0.25)
    sys.exit(f'timed out waiting for {what!r}\n{screen()}')


def note_id(en):
    return re.sub(r'\s+', ' ', en.lower()).strip()


def make_home(scene, name):
    # 저장소 밖에 둔다. 경로에 `.claude/`가 끼면(작업 트리 안 등) Claude Code가 고칠 때마다 허락을 묻는다.
    home = pathlib.Path(tempfile.gettempdir()).resolve() / 'hellolingo-shoot' / name
    shutil.rmtree(home, ignore_errors=True)
    project = home / 'hellolingo' / scene['project']
    shutil.copytree(ROOT / 'projects' / scene.get('source', scene['project']), project)
    git = ['git', '-C', str(project)]
    subprocess.run(['git', 'init', '-q', '-b', 'main', str(project)], check=True)
    subprocess.run([*git, 'config', 'user.name', 'hellolingo'], check=True)
    subprocess.run([*git, 'config', 'user.email', 'hellolingo@example.invalid'], check=True)
    subprocess.run([*git, 'add', '-A'], check=True)
    subprocess.run([*git, 'commit', '-q', '-m', '첫 커밋'], check=True)
    version = subprocess.run([CLAUDE, '--version'], capture_output=True, text=True).stdout.split()[0]
    (home / '.claude.json').write_text(json.dumps({
        'numStartups': 5, 'hasCompletedOnboarding': True, 'theme': 'dark', 'hasSeenAutoDefaultNotice': True,
        'hasResetAutoModeOptInForDefaultOffer': True, 'hasSeenAutoDefaultNudge': True,
        'lastReleaseNotesSeen': version, 'officialMarketplaceAutoInstallAttempted': True,
        'customApiKeyResponses': {'approved': [KEY[-20:]], 'rejected': []},
        'projects': {str(project): {'hasTrustDialogAccepted': True, 'hasCompletedProjectOnboarding': True}},
    }))
    (home / '.claude' / 'plugins' / 'store').mkdir(parents=True)
    (home / '.claude' / 'settings.json').write_text(json.dumps({
        'permissions': {'defaultMode': 'acceptEdits', 'allow': ALLOW}, 'spinnerTipsEnabled': False}))
    now = int(time.time() * 1000)
    notes = {}
    for n in scene.get('notes', []):
        at = lambda days: now + int(days * DAY_MS)
        notes[note_id(n['en'])] = {'en': n['en'], 'ko': n['ko'], 'example': n.get('example', ''),
                                   'addedAt': at(n['added']), 'seenAt': at(n.get('seen', n['added'])),
                                   'level': n.get('level', 0), 'dueAt': at(n['due']), 'shownAt': None,
                                   # 학습하기에서 연습한 배울 점이면 그 틀과 복습 때 낼 문제들
                                   **({'point': n['point'], 'drills': n['drills']} if 'point' in n else {}),
                                   # 영어 프롬프트에서 고친 곳이면 내가 쓴 틀린 말
                                   **({'wrong': n['wrong']} if 'wrong' in n else {})}
    (home / '.claude' / 'plugins' / 'store' / STORE).write_text(json.dumps({'notes': notes}, ensure_ascii=False))
    return home, project


def story_tz(hhmm):
    """화면의 시각이 장면 시각(예: "10:20")의 시(時)로 보이게 하는 TZ 값. 분은 실제 분이다.
    Etc/GMT는 부호가 거꾸로라서, UTC보다 9시간 빠른 곳이 Etc/GMT-9다."""
    hour = int(hhmm.split(':')[0])
    off = (hour - time.gmtime().tm_hour + 12) % 24 - 12
    return f'Etc/GMT{-off:+d}' if off else 'Etc/GMT'


def launch(scene, home, project):
    # 장면 속 Claude가 git, node, npm을 실제로 돌린다. node가 기본 경로 밖에 있으면 그 폴더도 넣는다.
    node = os.path.dirname(shutil.which('node') or '/usr/local/bin/node')
    env = {'HOME': str(home), 'USER': 'hellolingo', 'LOGNAME': 'hellolingo',
           'SHELL': '/bin/zsh' if os.path.exists('/bin/zsh') else '/bin/bash',
           'PATH': f'/usr/bin:/bin:/usr/sbin:/sbin:/opt/homebrew/bin:/usr/local/bin:{node}', 'LANG': 'ko_KR.UTF-8',
           'TERM': 'xterm-256color', 'COLORTERM': 'truecolor', 'TZ': story_tz(scene.get('time', '10:00')),
           'ANTHROPIC_BASE_URL': f'http://127.0.0.1:{PORT}', 'ANTHROPIC_API_KEY': KEY,
           'DISABLE_AUTOUPDATER': '1', 'CLAUDE_CODE_DISABLE_NONESSENTIAL_TRAFFIC': '1'}
    cmd = shlex.join(['env', '-i', *(f'{k}={v}' for k, v in env.items()), CLAUDE, '--permission-mode', 'acceptEdits', '--allowedTools', *ALLOW,
                       '--plugin-dir', str(REPO)])
    cols, rows = scene.get('size', [100, 40])
    tmux('new-session', '-d', '-s', SESSION, '-x', str(cols), '-y', str(rows), '-c', str(project), cmd)
    wait_for(lambda s: 'accept edits on' in s, 'ready', 30)
    time.sleep(1.5)


def run(scene, out, record):
    cols = scene.get('size', [100, 40])[0]
    title = f'~/hellolingo/{scene["project"]}'
    for a in scene['actions']:
        # 조각 맞추기를 푼 뒤에만 나오는 화면은 녹화할 때 기다리지 않는다: 녹화할 때는 풀지 않는다.
        if record and a.get('play_only'):
            continue
        if 'say' in a:
            tmux('send-keys', '-t', SESSION, '-l', a['say'])
            time.sleep(0.3)
            tmux('send-keys', '-t', SESSION, 'Enter')
        elif 'type' in a:
            tmux('send-keys', '-t', SESSION, '-l', a['type'])
        elif 'paste' in a:
            tmux('load-buffer', '-b', 'hl', '-', input=a['paste'])
            tmux('paste-buffer', '-p', '-d', '-b', 'hl', '-t', SESSION)
        elif 'keys' in a:
            tmux('send-keys', '-t', SESSION, *a['keys'])
        elif 'wait' in a:
            wait_for(lambda s: a['wait'] in s, a['wait'], a.get('timeout', 60))
        elif 'gone' in a:
            wait_for(lambda s: a['gone'] not in s, f'gone: {a["gone"]}', a.get('timeout', 60))
        elif 'sleep' in a:
            time.sleep(a['sleep'])
        elif 'resize' in a:
            tmux('resize-window', '-t', SESSION, '-x', str(a['resize'][0]), '-y', str(a['resize'][1]))
            cols = a['resize'][0]
        elif 'arrange' in a and not record:
            arrange(scene, wrong=a['arrange'] == 'wrong')
        elif 'shot' in a and not record:
            ansi = out / f'{a["shot"]}.ansi'
            ansi.write_text(screen(ansi=True))
            ansi.with_suffix('.cols').write_text(str(cols))
            print('shot', a['shot'])


def arrange(scene, wrong=False):
    """학습하기와 복습의 조각 맞추기를 푼다. 화면의 한국어 문장을 녹화한 학습하기나 장면의 노트에서 찾아
    영어 순서를 알고, 남은 조각 버튼 가운데 다음 조각의 번호(왼쪽부터 1, 2, 3)를 누른다.
    wrong이면 첫 조각을 일부러 틀리게 고른다."""
    cards = json.loads(CARDS.read_text())
    drills = [d for k, v in cards.items() if k.startswith('LESSON:') for d in (v.get('drills') or [])]
    drills += [d for n in scene.get('notes', []) for d in n.get('drills', [])]
    plain = re.sub(r'\x1b\[[0-9;:]*m', '', screen())
    drill = next((d for d in drills if d['ko'] in plain), None)
    if drill is None:
        sys.exit('arrange: 화면의 문장을 녹화한 문제에서 찾지 못했어요')
    pieces = []
    for p in drill['parts']:
        # 글자가 없는 조각(끝의 ".")은 mod처럼 앞 조각에 붙인다.
        if pieces and not re.search(r'\w', p['en']):
            pieces[-1] += p['en']
        elif re.search(r'\w', p['en']):
            pieces.append(p['en'])
    labels = [piece_label(en, i == 0) for i, en in enumerate(pieces)]
    for i, want in enumerate(labels):
        # 버튼 글 앞의 번호("1 the order")는 떼고 견준다.
        found = re.findall(r'\[ ([^\]]+?) \]', re.sub(r'\x1b\[[0-9;:]*m', '', screen()))
        shown = [b for b in (re.sub(r'^\d ', '', f) for f in found) if b in labels]
        at = shown.index(want) if not (wrong and i == 0) else next(j for j, b in enumerate(shown) if b != want)
        tmux('send-keys', '-t', SESSION, str(at + 1))
        time.sleep(0.8)
        if wrong:
            return


def piece_label(en, is_first):
    """hooks/register.tsx의 pieceLabel과 같다: 첫 조각의 대문자와 끝의 문장 부호를 버튼에서 지운다."""
    bare = re.sub(r'[.?!,]+$', '', en)
    return bare[0].lower() + bare[1:] if is_first and re.match(r'[A-Z][a-z]', bare) else bare


def leaks(out):
    """화면에 이 컴퓨터의 흔적(사용자 이름, 홈 경로, 기기 이름)이 남았는지"""
    me = [os.environ.get('USER', ''), os.path.expanduser('~'), socket.gethostname().split('.')[0], '/Users/', '/private/',
          'CCR', '/tmp/claude-']
    found = []
    for f in sorted(out.glob('*.ansi')):
        text = re.sub(r'\x1b\[[0-9;:]*m', '', f.read_text())
        found += [f'{f.name}: {w}' for w in me if w and w in text]
    return found


def rerender(name):
    """찍어 둔 화면(.ansi)을 다시 그리기만 한다. 그리는 방식만 바꿨을 때 장면을 다시 돌리지 않으려고."""
    scene = json.loads((ROOT / 'scenes' / f'{name}.json').read_text())
    for ansi in sorted((ROOT / 'out' / name).glob('*.ansi')):
        ansi.write_text(without_host_notice(ansi.read_text()))
        render(ansi, IMAGES / f'{ansi.stem}.png', int(ansi.with_suffix('.cols').read_text()), f'~/hellolingo/{scene["project"]}')
        print('rendered', ansi.stem)


def main():
    name, record = sys.argv[1], '--record' in sys.argv
    if '--render' in sys.argv:
        return rerender(name)
    scene_path = ROOT / 'scenes' / f'{name}.json'
    scene = json.loads(scene_path.read_text())
    out = ROOT / 'out' / name
    out.mkdir(parents=True, exist_ok=True)
    IMAGES.mkdir(parents=True, exist_ok=True)
    for f in out.glob('*.ansi'):
        f.unlink()
    if not CARDS.exists():
        CARDS.write_text('{}')
    log = out / 'mock.log'
    log.write_text('')
    home, project = make_home(scene, name)
    resolved = out / 'scene.json'
    resolved.write_text(scene_path.read_text().replace('{project}', str(project)))
    mock = subprocess.Popen([sys.executable, '-I', str(ROOT / 'mock.py'), str(resolved), str(CARDS), str(log), str(PORT),
                             *(['--record'] if record else [])])
    try:
        for _ in range(40):
            try:
                urllib.request.urlopen(f'http://127.0.0.1:{PORT}/', timeout=1)
                break
            except OSError:
                time.sleep(0.25)
        launch(scene, home, project)
        run(scene, out, record)
    finally:
        subprocess.run(['tmux', 'kill-session', '-t', SESSION], capture_output=True)
        mock.terminate()
    # 그림은 장면이 끝난 뒤에 그린다. 장면이 도는 동안 Chrome을 처음 띄우면 멈추는 일이 있었다.
    if not record:
        rerender(name)
    misses = [l for l in log.read_text().splitlines() if l.endswith('MISS')]
    problems = misses + leaks(out)
    if problems:
        sys.exit('problems:\n' + '\n'.join(problems))
    print('ok', name)


if __name__ == '__main__':
    main()
