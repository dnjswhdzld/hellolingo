# 기여하기

hellolingo는 Claude Code 플러그인입니다. Claude Code의 mod 기능으로 만들어서, 아래에서는 mod라고 부릅니다. 코드는 `hooks/`에, 타입은 `types/`에, 테스트는 `tests/`에 있습니다. `hooks/register.tsx`가 훅을 등록하고, 나머지 파일은 값만 다루는 함수와 모델에 보내는 지시문입니다.

먼저 읽을 문서는 둘입니다.

- [학습 설계와 근거](docs/learning-design.md). 기능을 더하거나 뺄 때의 기준입니다.
- [동작 방식](docs/how-it-works.md). 지금 동작을 자세히 적었습니다.

## 폴더로 불러와서 써 보기

1. 저장소를 받습니다.

   ```bash
   git clone https://github.com/dnjswhdzld/hellolingo
   ```

2. 받은 폴더를 mod로 불러옵니다.

   ```bash
   claude --plugin-dir ./hellolingo
   ```

   데스크톱 앱 Code 탭처럼 플래그를 줄 수 없는 곳에서는 `~/.claude/settings.json`에 추가합니다.

   ```json
   { "env": { "CLAUDE_CODE_PLUGIN_DIRS": "/path/to/hellolingo" } }
   ```

3. 코드를 바꿨으면 새 세션을 엽니다. 열려 있는 세션은 바뀐 코드를 다시 불러오지 않습니다.

## 확인 명령

받은 폴더 안에서 실행합니다. Claude Code v2.1.311 이상이 필요합니다.

```bash
claude plugin validate .
```

```bash
claude plugin test .
```

`claude plugin test`는 `tests/` 아래의 `*.test.tsx`를 모두 돌립니다. 테스트는 모델 호출에 가짜 답을 돌려주므로 API를 부르지 않고, 로그인도 필요 없습니다. 풀 리퀘스트마다 GitHub Actions가 이 두 명령을 돌립니다.

타입 검사에는 `.claude-plugin/types/`가 필요합니다. Claude Code가 이 폴더를 mod로 한 번 불러오면 만들어 주고, `.gitignore`에 들어 있어서 커밋되지 않습니다. 그 뒤에 실행합니다.

```bash
npx --yes -p typescript@5.6.3 tsc -p tsconfig.json
```

## 지키는 것

- Claude의 응답, 코드, 커밋 메시지, 파일은 바꾸지 않습니다. 이 mod는 읽기만 합니다.
- 학습 기능이 실패해도 프롬프트는 그대로 지나가야 합니다. 훅마다 `.catch`로 원래 흐름을 잇습니다.
- 카드 테두리 안에는 이모지를 쓰지 않습니다. 터미널마다 이모지 폭을 다르게 세서 오른쪽 테두리가 어긋납니다.
- 줄을 들여 쓸 때는 글 앞에 공백을 붙이지 않고 `indent`를 줍니다. 공백으로 들여 쓰면 줄이 넘칠 때 다음 줄이 맨 앞에서 시작합니다.
- 화면에 나오는 글과 모델이 쓰는 한국어는 [학습 설계와 근거](docs/learning-design.md#글쓰기-규칙)의 글쓰기 규칙을 따릅니다. 한 문장에 한 생각, 문법 용어 없이, 가장 중요한 것을 먼저 씁니다.
- 카드에 줄을 더하는 변경은 그 줄이 배우는 데 어떻게 도움이 되는지 풀 리퀘스트에 적습니다. [로드맵](ROADMAP.md)의 "하지 않는 것"도 확인합니다.
- 동작을 바꾸면 그 동작을 확인하는 테스트도 같이 고칩니다.
- 화면이 바뀌면 [가이드](docs/guide/README.md)의 화면도 다시 찍습니다. 방법은 [tools/screenshots](tools/screenshots/README.md)에 있습니다.

## 풀 리퀘스트

- `claude plugin validate .`와 `claude plugin test .`가 통과해야 합니다.
- 사용자가 알아챌 변화는 `CHANGELOG.md` 맨 위에 `## 다음 버전` 제목을 두고 그 아래에 한 줄씩 적습니다. 맨 위 버전에 아직 태그가 없으면, 그 버전 아래에 적습니다.

## 릴리스

1. `.claude-plugin/plugin.json`의 `version`을 올립니다.
2. `CHANGELOG.md`의 `## 다음 버전`을 그 버전 번호로 바꿉니다.
3. 태그를 만들어 올립니다. `claude plugin tag`는 `plugin.json`과 `marketplace.json`이 맞는지 확인한 뒤 `hellolingo--v<버전>` 태그를 만듭니다.

   ```bash
   claude plugin tag . --push
   ```
