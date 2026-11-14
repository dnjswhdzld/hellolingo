# 가이드 화면 다시 찍기

[가이드](../../docs/guide/README.md)의 화면은 이 폴더의 도구로 찍었습니다. UI가 바뀌면 명령 하나로 같은 장면을 다시 찍을 수 있습니다.

## 어떻게 찍나요

- 실제 Claude Code와 이 저장소의 플러그인 코드를 그대로 씁니다.
- Claude의 답만 각본 서버(`mock.py`)가 돌려줍니다. Claude가 부르는 도구(파일 읽기, 고치기, 테스트)는 데모 프로젝트에서 진짜로 실행됩니다.
- 카드 문장과 학습하기 문제는 실제 haiku가 만든 답을 한 번 녹화해(`cards.json`) 다시 씁니다. 학습하기 녹화는 `LESSON:`과 카드의 한국어를 열쇠로 둡니다.
- Claude Code는 임시 폴더의 빈 홈에서 켭니다. 그래서 화면에는 `~/hellolingo/<프로젝트>`만 보이고, 내 컴퓨터의 경로나 이름은 나오지 않습니다. 내 설정과 노트도 건드리지 않습니다.
- tmux 화면을 그대로 받아 두었다가, 장면이 끝나면 크롬으로 창 모양의 PNG를 그립니다.

## 필요한 것

- tmux, Python 3, Chrome. macOS에서는 Google Chrome을 씁니다. 다른 곳에서는 `CHROME` 환경 변수로 Chrome이나 chrome-headless-shell의 경로를 줍니다. 한글 글꼴(예: Noto Sans CJK)도 있어야 합니다.
- git, Node.js. 장면 속 데모 프로젝트에서 Claude가 git과 테스트를 실제로 돌립니다.
- Claude Code (`claude`)
- 녹화할 때만, 터미널 `claude`에 로그인되어 있어야 합니다.

## 명령

장면 하나를 찍습니다. 화면은 `docs/guide/images/`에 저장됩니다.

```bash
python3 -I tools/screenshots/shoot.py yujin-day1
```

녹화한 카드가 없는 프롬프트를 실제 haiku로 먼저 녹화합니다. 이때는 화면을 찍지 않습니다.

```bash
python3 -I tools/screenshots/shoot.py yujin-day1 --record
```

그리는 방식만 바꿨을 때는, 찍어 둔 화면을 다시 그리기만 합니다.

```bash
python3 -I tools/screenshots/shoot.py yujin-day1 --render
```

장면은 `scenes/`에 있습니다. `yujin-day1`, `yujin-day2`, `doyun`, `haneul`, `haneul-backlog`, `min`입니다.

장면의 동작에는 이런 것이 있습니다.

| 동작 | 하는 일 |
| --- | --- |
| `say`, `type`, `paste`, `keys` | 입력창에 말하거나, 글을 치거나, 붙여넣거나, 키를 누릅니다. |
| `wait`, `gone` | 화면에 글이 나오거나 사라질 때까지 기다립니다. |
| `shot` | 화면을 찍습니다. |
| `arrange` | 조각 맞추기를 풉니다. `"right"`는 맞게, `"wrong"`은 첫 조각을 일부러 틀리게 고릅니다. 화면의 한국어 문장을 녹화한 학습하기나 장면의 노트에서 찾아 답을 압니다. |
| `play_only` | 이 표시가 붙은 동작은 녹화할 때 건너뜁니다. 녹화할 때는 조각 맞추기를 풀지 않아서, 푼 뒤에만 나오는 글을 기다리면 안 되기 때문입니다. |

공부 칸으로 키를 보내기 전에는 `ctrl+x`, `tab`으로 옮겨 갑니다. Claude의 답이 막 끝났을 때는 Claude Code가 키를 입력창으로 되돌리기도 해서, 잠시 기다린 뒤에 옮겨 갑니다.

## 찍기가 실패하는 경우

아래 중 하나라도 있으면 실패로 끝납니다. 문서에 틀린 화면이 들어가지 않게 하려는 것입니다.

- 각본에 없는 요청이 왔을 때
- 녹화한 카드가 없을 때
- 화면에 내 사용자 이름, 홈 경로, 기기 이름, `/Users/`, `/private/`, `CCR`이 보일 때

클라우드 세션 같은 호스팅된 컨테이너에서 찍으면 Claude Code가 시작 화면에 인증 안내(`⚠ Both ... set`)를 붙입니다. 제품 화면이 아니라서 그 묶음만 빼고 찍습니다.

## 파일

| 파일 | 하는 일 |
| --- | --- |
| `shoot.py` | 홈 폴더를 만들고, 각본 서버와 Claude Code를 띄우고, 장면대로 입력하고 찍습니다. |
| `mock.py` | Anthropic API 대신 각본과 녹화한 카드로 답합니다. |
| `render.py` | tmux 화면을 창 모양의 PNG로 그립니다. |
| `scenes/*.json` | 장면마다 프로젝트, 미리 모아 둔 노트, Claude의 답, 입력 순서, 찍을 화면 |
| `cards.json` | 실제 haiku가 만든 카드 답. 프롬프트마다 하나 |
| `projects/` | 데모 프로젝트. 장면마다 임시 홈으로 복사해 씁니다. |

CI에서는 돌리지 않습니다. tmux와 크롬, 그리고 녹화할 때는 로그인이 필요하기 때문입니다.
