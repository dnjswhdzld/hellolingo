"""Draw a tmux ANSI capture as a terminal window PNG (title bar, colors, Hangul two cells wide) with headless Chrome."""
import html, pathlib, re, subprocess, unicodedata

CHROME = '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome'
CW, LH = 14 * 0.60205, 17.0  # Menlo 14px 한 칸의 폭과 줄 높이
BG, FG = '#1e1e1e', '#d4d4d4'
BASE = ['#000000', '#cd3131', '#0dbc79', '#e5e510', '#2472c8', '#bc3fbc', '#11a8cd', '#e5e5e5',
        '#666666', '#f14c4c', '#23d18b', '#f5f543', '#3b8eea', '#d670d6', '#29b8db', '#ffffff']
RESET = {'fg': None, 'bg': None, 'b': False, 'd': False, 'inv': False}


def c256(n):
    if n < 16:
        return BASE[n]
    if n < 232:
        n -= 16
        v = [0, 95, 135, 175, 215, 255]
        return '#%02x%02x%02x' % (v[n // 36], v[n // 6 % 6], v[n % 6])
    g = 8 + (n - 232) * 10
    return '#%02x%02x%02x' % (g, g, g)


def apply(st, codes):
    i = 0
    while i < len(codes):
        c = codes[i]
        if c == 0:
            st = dict(RESET)
        elif c == 1:
            st['b'] = True
        elif c == 2:
            st['d'] = True
        elif c == 22:
            st['b'] = st['d'] = False
        elif c == 7:
            st['inv'] = True
        elif c == 27:
            st['inv'] = False
        elif 30 <= c <= 37:
            st['fg'] = BASE[c - 30]
        elif 90 <= c <= 97:
            st['fg'] = BASE[c - 82]
        elif 40 <= c <= 47:
            st['bg'] = BASE[c - 40]
        elif c == 39:
            st['fg'] = None
        elif c == 49:
            st['bg'] = None
        elif c in (38, 48) and i + 1 < len(codes):
            key = 'fg' if c == 38 else 'bg'
            if codes[i + 1] == 5:
                st[key] = c256(codes[i + 2])
                i += 2
            elif codes[i + 1] == 2:
                st[key] = '#%02x%02x%02x' % tuple(codes[i + 2:i + 5])
                i += 4
        i += 1
    return st


def line_html(line, cols):
    st, cells, col = dict(RESET), [], 0
    for tok in re.split(r'(\x1b\[[0-9;:]*m)', line):
        m = re.fullmatch(r'\x1b\[([0-9;:]*)m', tok)
        if m:
            st = apply(st, [int(x) if x else 0 for x in re.split('[;:]', m.group(1))] or [0])
            continue
        for ch in tok:
            w = 2 if unicodedata.east_asian_width(ch) in ('W', 'F') else 1
            if col + w > cols:
                break
            fg, bg = st['fg'] or FG, st['bg']
            if st['inv']:
                fg, bg = (bg or BG), fg
            style = f'color:{fg};' + (f'background:{bg};' if bg else '') + \
                    ('font-weight:700;' if st['b'] else '') + ('opacity:.55;' if st['d'] else '')
            # 영문과 상자 글자는 Menlo 폭 그대로 이어 그리고, 한글 같은 나머지는 칸 폭에 맞춰 가운데 둔다.
            flows = ord(ch) < 128 or 0x2500 <= ord(ch) <= 0x257F
            if not flows:
                style += f'display:inline-block;width:{w * CW}px;text-align:center;' + \
                         ('font-size:16.2px;letter-spacing:-.2px;' if w == 2 else '')
            if cells and flows and cells[-1][0] == style:
                cells[-1][1] += ch
            else:
                cells.append([style, ch])
            col += w
    return '<div class="l">' + ''.join(f'<span style="{s}">{html.escape(t)}</span>' for s, t in cells) + '</div>'


def squeeze(lines):
    """빈 줄이 넷 이상 이어지면 한 줄로 줄이고, 끝의 빈 줄은 뺀다. 화면 가운데가 텅 비어 보이지 않게."""
    out, run = [], []
    for line in lines:
        if not re.sub(r'\x1b\[[0-9;:]*m', '', line).strip():
            run.append(line)
            continue
        out += run if len(run) < 4 else run[:1]
        run = []
        out.append(line)
    return out


def render(ansi_path, png_path, cols, title):
    lines = squeeze(pathlib.Path(ansi_path).read_text().splitlines())
    pad, bar, margin = 18, 34, 28
    w = int(cols * CW + 2 * pad) + 2
    h = int(len(lines) * LH + 2 * pad + bar)
    page = f'''<!doctype html><meta charset="utf-8"><style>
html,body{{margin:0;background:transparent;}}
body{{padding:{margin}px;}}
.win{{width:{w}px;border-radius:10px;overflow:hidden;background:{BG};
  box-shadow:0 18px 40px rgba(0,0,0,.35),0 0 0 1px rgba(255,255,255,.08);}}
.bar{{height:{bar}px;background:#2b2b2b;display:flex;align-items:center;position:relative;
  font:13px -apple-system,"Apple SD Gothic Neo",sans-serif;color:#9a9a9a;}}
.dots{{position:absolute;left:14px;display:flex;gap:8px;}}
.dots i{{width:12px;height:12px;border-radius:50%;display:block;}}
.t{{width:100%;text-align:center;}}
.term{{padding:{pad}px;font:14px/{LH}px Menlo,"Apple SD Gothic Neo",monospace;}}
.l{{height:{LH}px;white-space:pre;}}
</style><div class="win"><div class="bar"><span class="dots"><i style="background:#ff5f57"></i>
<i style="background:#febc2e"></i><i style="background:#28c840"></i></span><span class="t">{html.escape(title)}</span></div>
<div class="term">{''.join(line_html(l, cols) for l in lines)}</div></div>'''
    png = pathlib.Path(png_path).resolve()
    page_path = pathlib.Path(ansi_path).resolve().with_suffix('.html')
    page_path.write_text(page)
    subprocess.run([CHROME, '--headless=new', '--disable-gpu', '--hide-scrollbars', '--run-all-compositor-stages-before-draw',
                    '--virtual-time-budget=1500',
                    f'--user-data-dir={page_path.parent / ".chrome-profile"}', '--force-device-scale-factor=1.75',
                    '--default-background-color=00000000', f'--window-size={w + 2 * margin},{h + 2 * margin}',
                    f'--screenshot={png}', page_path.as_uri()], check=True, capture_output=True, timeout=60)
