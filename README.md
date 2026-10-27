# hellolingo

[English summary](#in-english)

Claude에게 한국어로 일을 시키면, 그 문장을 영어로 보여주고 나중에 다시 떠올리게 해 주는 Claude Code mod입니다.

따로 공부할 시간을 낼 필요가 없습니다. 평소처럼 프롬프트를 보내면 됩니다.

## 이렇게 배웁니다

1. **보기.** 프롬프트를 보내면 입력창 위에 영어 문장이 나옵니다. 같은 뜻의 조각은 같은 색입니다.
2. **모으기.** 다시 쓸 만한 표현 하나가 노트에 모입니다.
3. **떠올리기.** 다음 날부터, Claude가 일하는 동안 그 표현을 퀴즈로 냅니다.

카드는 이렇게 생겼습니다.

```
영어로는
  Fix the null check in the login handler.
  로그인 핸들러에서 null 체크 고쳐줘
  • null check — null 여부 확인
```

퀴즈는 카드 옆에 나옵니다.

```
복습 · 어제 본 표현
  "null 여부 확인" — 영어로 떠올려 보세요
    10초 뒤에 정답이 나와요
  [ 정답 보기 ]
```

영어로 프롬프트를 쓰면 틀린 곳을 고쳐 줍니다. 틀린 곳이 없으면 더 자연스러운 말을 하나 알려 줍니다.

## 설치

Claude Code v2.1.287 이상이 필요합니다. 터미널과 데스크톱 앱에서 보입니다. VS Code 확장에서는 보이지 않습니다.

1. Claude Code에 아래 줄을 입력합니다.

   ```
   /plugin install hellolingo --marketplace dnjswhdzld/hellolingo
   ```

2. 새 세션을 엽니다.
3. 한국어로 프롬프트를 보냅니다. 10자 이상이면 카드가 나옵니다.

## 퀴즈 하는 법

- 한국어 뜻을 보고 영어를 머릿속으로 떠올려 봅니다. 쓰지 않아도 됩니다.
- 10초 뒤에 정답이 나옵니다. 바로 보려면 `r`을 누릅니다.
- 떠올렸으면 `o`, 못 떠올렸으면 `x`를 누릅니다.
- 떠올릴수록 다음 퀴즈가 늦게 나옵니다. 1일, 3일, 7일, 14일, 30일 뒤입니다.
- 못 떠올려도 괜찮습니다. 다음 날 다시 나옵니다. 떠올리려고 애쓴 것만으로도 기억에 도움이 됩니다.

키를 누르기 전에 퀴즈를 한 번 클릭하거나, `ctrl+x`를 누른 다음 `tab`을 눌러 퀴즈로 옮겨 갑니다.

## 노트 보기

`/lingo-notes`를 입력하면 모은 표현이 옆 패널에 나옵니다.

새 표현은 하루에 5개까지만 모읍니다. 복습할 표현이 10개 이상 쌓이면, 복습해서 줄어들 때까지 새 표현은 모으지 않습니다. 많이 모으는 것보다 잊지 않는 것이 중요하기 때문입니다.

## 알아 두세요

- **사용량.** 학습할 프롬프트 하나에 haiku 모델을 한 번 부릅니다. Claude Code 사용량에 들어갑니다.
- **보내는 것.** 내 프롬프트만 haiku에 보냅니다. 코드 블록은 빼고 앞 1500자까지입니다. Claude의 답, 코드, 파일은 읽지도 바꾸지도 않습니다.
- **저장.** 노트는 내 컴퓨터에만 있습니다. `~/.claude/plugins/store/` 폴더의 `hellolingo_`로 시작하는 파일입니다. 지우려면 Claude Code를 모두 닫고 그 파일을 지웁니다.
- **초기 버전.** 이 mod가 쓰는 Claude Code 기능이 아직 미리 보기(early access) 단계입니다. Claude Code가 바뀌면 동작이 깨질 수 있습니다.

## 더 읽을거리

- [학습 설계와 근거](docs/learning-design.md). 왜 이렇게 만들었는지, 어떤 연구를 따랐는지 적었습니다.
- [동작 방식](docs/how-it-works.md). 기여하는 사람을 위한 자세한 설명입니다.
- [로드맵](ROADMAP.md), [바뀐 내용](CHANGELOG.md), [기여하기](CONTRIBUTING.md).

## In English

hellolingo is a Claude Code mod for Korean developers who want to learn English from the prompts they already write.

1. **See.** Send a prompt in Korean and its English version appears above the prompt box. Matching parts of the two sentences share a color.
2. **Collect.** One reusable expression from it goes into a notebook.
3. **Recall.** From the next day, while Claude works, that expression comes back as a spaced-repetition quiz. Recall it in your head. The answer shows after 10 seconds, or press `r`. Press `o` if you recalled it and `x` if not.

Prompts written in English get their mistakes corrected. It collects at most 5 new expressions a day and pauses when 10 reviews are due. Each learnable prompt goes to haiku once, through Claude Code's own model call. It never reads or changes Claude's replies, your code or your files, and your notes stay on your machine. It needs Claude Code v2.1.287 or later and supports Korean to English only. The design and the research behind it are in [docs/learning-design.md](docs/learning-design.md) (Korean).

## 라이선스

MIT. [LICENSE](LICENSE)를 보세요.
