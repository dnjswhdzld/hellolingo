# 카드 지시문 평가

`hooks/prompts.ts`의 지시문을 바꾸면, 이 도구로 실제 haiku가 만든 카드를 다시 셉니다. 테스트(`claude plugin test`)는 모델 답을 흉내만 내서, 지시문이 실제로 잘 듣는지는 알 수 없기 때문입니다.

## 어떻게 세나요

- 플러그인과 같은 요청(`cardPrompt`)을 같은 모델(haiku, 노력 low)에 보냅니다.
- 답은 플러그인과 같은 파서(`parseCard`)로 카드로 만듭니다. 그래서 학습자가 볼 카드를 기준으로 셉니다.
- 사례는 `cases.json`에 있습니다. 사례마다 기대하는 카드가 하나씩 있습니다.

| 기대 | 통과 조건 |
| --- | --- |
| `keep` | 맞는 영어. 고침 카드가 아니라 더 자연스러운 표현 카드가 나와야 합니다. |
| `fix` | 틀리거나 어색한 영어. 고침 카드가 나와야 합니다. |
| `ko` | 한국어. 짝이 2개 이상이고, 옮긴 원문이 40자 이하여야 합니다. |

기대마다 하한이 있습니다. 통과 비율이 하한보다 낮으면 실패로 끝납니다. 하한은 `run.mjs` 맨 위에 있습니다.

## 필요한 것

- Node.js 22.18 이상. `hooks/`의 `.ts` 파일을 그대로 불러옵니다.
- 로그인된 Claude Code (`claude`). 한 번 돌리는 데 haiku를 66번 부르고, 비용은 $0.03쯤입니다.

## 명령

사례마다 3번씩 부릅니다.

```bash
node tools/eval/run.mjs
```

haiku의 답은 부를 때마다 조금씩 달라서, 비교할 때는 횟수를 늘립니다.

```bash
node tools/eval/run.mjs --runs 9
```

일부 사례만 부릅니다.

```bash
node tools/eval/run.mjs --only keep-look,fix-test
```

haiku를 부르지 않고, 저장해 둔 답(`out/`)만 다시 셉니다. 파서를 고쳤을 때 씁니다.

```bash
node tools/eval/run.mjs --parse
```

## 바꾸기 전과 비교하기

기준 브랜치를 다른 폴더에 꺼내, 그 지시문과 파서로 한 번, 지금 것으로 한 번 셉니다. 답은 폴더를 나눠 둡니다. 지금 작업 중인 파일은 건드리지 않습니다.

```bash
git worktree add ../hellolingo-base origin/main
```

```bash
node tools/eval/run.mjs --runs 9 --hooks ../hellolingo-base/hooks --out tools/eval/out/before
```

```bash
node tools/eval/run.mjs --runs 9 --out tools/eval/out/after
```

```bash
git worktree remove ../hellolingo-base
```

## 사례를 더할 때

- 실제 사용자의 프롬프트를 그대로 넣지 않습니다. 같은 모양의 문장을 새로 씁니다.
- 지시문의 예시 문장을 사례로 넣지 않습니다. 지시문에 답이 들어 있어서, 잘 듣는지 알 수 없습니다.
