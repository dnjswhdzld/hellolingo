# 학습 설계와 근거

hellolingo가 왜 이렇게 생겼는지 적은 문서입니다. 기능을 더하거나 뺄 때 이 문서를 기준으로 봅니다.

## 누구를 위한 것인가

한국어로 Claude에게 일을 시키는 사람입니다. 개발자가 가장 많지만, 데이터 분석가나 마케터처럼 개발자가 아닌 사람도 씁니다. 영어 공부할 시간을 따로 내기 어렵고, 긴 설명을 읽는 것도 부담스러운 사람을 기준으로 삼습니다.

그렇게 정한 이유는 두 가지입니다.

- 2023년 OECD 성인역량조사(PIAAC)에서 한국 성인의 문해력 평균은 249점으로, OECD 평균 260점보다 낮았습니다. 2011~12년 조사보다도 떨어졌습니다. 다만 16~24세는 276점으로 OECD 평균보다 높았습니다. 이 숫자만으로 사용자의 읽기 능력을 말할 수는 없습니다.
- 그래도 쉬운 글은 모두에게 이롭습니다. 쉬운 글로 고친 사이트에서 글 읽기가 어려운 사람의 과제 성공률은 46%에서 82%로, 잘 읽는 사람도 68%에서 93%로 올랐습니다(Nielsen, 2005). 그래서 글을 잘 읽는 사람만 쓸 수 있는 도구로 만들지 않습니다.

## 다섯 가지 원칙

### 1. 따로 공부하지 않는다

이미 하는 일(프롬프트 보내기)에 학습을 붙입니다. 공부하려고 앱을 여는 순간이 없습니다.

- 근거. 습관 연구(Lally 외, 2010)는 매일 같은 신호에 행동을 묶었습니다. 습관이 자리 잡는 데 걸린 기간은 사람마다 18일에서 254일까지 달랐습니다. 하루 이틀 빠져도 크게 흔들리지 않았습니다.
- 그래서. 퀴즈는 Claude가 일하는 동안, 어차피 기다리는 시간에 나옵니다. 하루 빠져도 밀린 숙제처럼 보이지 않게 합니다.

### 2. 적게 보여준다

카드 한 장에 영어 문장 하나와 핵심 표현 하나만 둡니다.

- 근거. Mayer의 일관성 원리는 꼭 필요하지 않은 내용을 빼면 더 깊이 배운다는 것입니다. 23번의 실험에서 모두 그랬습니다. 반대로 중요한 것을 색이나 굵은 글씨로 짚어 주면(신호 원리) 도움이 됩니다.
- 근거. 글 읽기가 어려운 사람은 훑어보지 않고 한 낱말씩 읽고, 글이 빽빽하면 건너뜁니다(Nielsen, 2005).
- 근거. 문법을 설명으로 배우는 것은 작업 기억을 더 씁니다. 문법 용어 자체가 어려워서 배우기를 막기도 합니다.
- 그래서. 조사·어미를 영어 문법과 잇는 설명 줄을 뺐습니다. 문법이 쓸모없어서가 아니라, "조사", "어미", "to + 동사" 같은 용어로 된 줄이 읽기 부담이라서입니다. 대신 같은 뜻의 조각에 같은 색을 칠해서, 글을 읽지 않고도 어순이 어떻게 바뀌는지 보이게 합니다. 용어 없이 쓰임만 알려 주는 짧은 힌트는 v1.1에서 시험합니다.
- 그래서. 프롬프트가 길면 주된 부탁 한 문장만 카드에 옮깁니다. 문단 전체를 옮기면 영어가 세 문장을 넘고, 짝을 맞추지 못한 한국어가 길게 남습니다.
- 한계. 지금은 짝을 색으로만 보여줍니다. 색을 구분하기 어려운 사람은 짝을 알아보기 어렵습니다. 그래도 영어 문장, 내 문장, 핵심 표현은 그대로 읽힙니다.

### 3. 다시 떠올리게 한다

다시 읽기보다 떠올리기가 오래 남습니다.

- 근거. 학습 기법 10가지를 비교한 연구(Dunlosky 외, 2013)에서 가장 높은 점수를 받은 것은 둘이었습니다. 스스로 시험 보기(떠올리기)와 시간 두고 나눠 하기(간격 두기)입니다. 다시 읽기와 밑줄 긋기는 낮은 점수를 받았습니다.
- 근거. 답을 입으로 말하거나 쓰지 않고 머릿속으로만 떠올려도 효과가 비슷했습니다(Smith, Roediger, Karpicke, 2013).
- 근거. 떠올리기에 실패해도, 바로 정답을 보면 그다음에 더 잘 배웁니다(Kornell, Hays, Bjork, 2009). 정답을 알려 주는 것이 시험 효과를 키웁니다(Rowland, 2014).
- 그래서. 퀴즈는 한국어 뜻을 보여주고 영어를 머릿속으로 떠올리게 합니다. 타자를 칠 필요가 없습니다. 답 버튼도 질문과 같은 말로 "떠올렸어요", "못 떠올렸어요"입니다. 못 떠올렸어도 "괜찮아요"라고 말합니다.
- 그래서. 정답은 10초 뒤에 꼭 나옵니다. 천천히 읽는 사람도 떠올려 볼 틈을 주면서, 버튼을 누르지 않는 사람도 정답을 보게 하려는 것입니다. 10초는 연구에서 나온 값이 아니라 정한 값이라, v1.1에서 직접 연 퀴즈와 비교해 다시 정합니다.

### 4. 시간을 두고 다시 만난다

같은 표현을 1일, 3일, 7일, 14일, 30일 뒤에 다시 냅니다.

- 근거. 복습 간격은 너무 짧아도 너무 길어도 손해입니다. 가장 좋은 간격은 기억해야 할 기간이 길수록 길어집니다(Cepeda 외, 2008).
- 근거. 다 안다고 느낀 카드를 빼 버리면 오히려 덜 배웁니다(Kornell, Bjork, 2008). 사람은 자기가 얼마나 아는지를 정확히 판단하지 못합니다.
- 그래서. 떠올렸어요를 눌러도 표현은 노트에서 빠지지 않습니다. 간격만 늘어납니다.
- 그래서. 정답을 본 뒤 답하지 않고 넘긴 표현은 하루 뒤로 미룹니다. 미루지 않으면 버튼을 누르지 않는 사람은 같은 표현 몇 개를 하루에도 여러 번 봅니다. 미루면 한 표현을 하루에 한 번만 보고, 날을 나눠 다시 만납니다. 떠올렸는지는 알 수 없어서 간격은 늘리지 않습니다.

### 5. 감당할 만큼만 모은다

새 표현은 하루(24시간)에 5개까지만 노트에 모읍니다. 복습할 표현이 10개 이상 쌓이면 새 표현은 모으지 않습니다.

- 이유. 퀴즈는 프롬프트를 보낼 때마다 하나씩 나옵니다. 새 표현 하나는 처음 두 달 동안 다섯 번 복습해야 합니다. 하루 5개면 복습이 하루 25번쯤입니다. 하루 50개를 모으면 복습이 밀리기만 하고, "밀린 복습 300개" 같은 숫자는 학습자를 지치게 합니다.
- 하루 5개도 모두가 감당할 수 있는 양은 아닙니다. 30일 간격 복습은 끝없이 이어지고, 못 떠올린 표현은 처음부터 다시 돕니다. 프롬프트를 적게 보내는 날도 있습니다. 그래서 밀린 복습이 10개가 되면 새 표현을 멈춥니다. 상한 하나보다, 실제로 복습하는 속도에 맞춰 들어오는 양이 줄어듭니다.
- 답을 누르지 않는 사람도 멈춘 채로 남지 않습니다. 정답을 본 표현이 하루 뒤로 미뤄지면서 밀린 복습이 줄고, 새 표현이 다시 들어옵니다. 하루에 보는 퀴즈 수만큼만 노트가 늡니다.
- 5와 10은 연구에서 바로 나온 값이 아니라 위의 계산으로 정한 값입니다. v1.1에서 실제 복습 기록을 보고 다시 정합니다.

## 무엇을 배우나: 낱말보다 덩어리

핵심 표현은 낱말 하나가 아니라 "take a look", "Can you check ..." 같은 덩어리입니다.

- 근거. 자주 함께 쓰이는 말 덩어리(formulaic sequence)를 알면 말이 유창해집니다. 다만 덩어리는 아주 천천히 익혀집니다(Boers, Lindstromberg, 2012; Wray, 2002). 그래서 한 번 보여주고 끝내지 않고 간격을 두고 반복합니다.
- 근거. 내 문장과 영어 문장을 나란히 보면, 내가 몰랐던 부분이 눈에 들어옵니다(Schmidt의 알아차림 가설).
- 근거. 퀴즈는 한국어 → 영어 방향입니다. 영어 → 한국어보다 어렵지만, 배우는 말로 직접 말하고 쓰는 것이 목표라서 이 방향을 고릅니다. 영어로 직접 써 볼 때 내가 모르는 것을 알게 됩니다(Swain의 출력 가설). 그래서 나중에는 프롬프트를 영어로 직접 써 보게 하려고 합니다.

## 글쓰기 규칙

화면에 나오는 한국어, README, 모델 지시문의 한국어 출력 모두 이 규칙을 따릅니다.

- 한 문장에 한 가지 생각만 씁니다(쉬운 글쓰기 지침들의 공통 원칙).
- 가장 중요한 것을 맨 위에 둡니다.
- 문법 용어와 한자어 대신 매일 쓰는 말을 씁니다. "부정사"가 아니라 "to 뒤에 동사".
- "e.g." 같은 약어를 쓰지 않습니다. "예:"라고 씁니다.
- 긴 문장 대신 목록을 씁니다.

## 하지 않는 것

v1을 만들면서 뺀 기능입니다. 다시 넣자고 제안하려면, 그 기능이 보기, 모으기, 떠올리기에 어떻게 더 도움이 되는지 함께 이슈로 올려 주세요.

- 카드의 문법 설명 줄(조사·어미와 영어 문법 잇기). 문법 용어가 읽기 부담이고, 같은 색 짝이 어순을 보여줍니다. 용어 없는 힌트는 v1.1에서 시험합니다.
- 문법 퀴즈. 정답이 하나로 정해지지 않아 채점할 수 없습니다.
- 한 카드에 핵심 표현 여러 개. 카드가 길어지고, 노트가 감당하지 못할 만큼 빨리 찹니다.
- Claude의 답을 영어로 옮긴 카드. 내가 쓴 문장이 아니고, 퀴즈와 같은 자리를 다툽니다.
- 학습 기록 패널, 코치 대화, 최근 질문 목록. 세 단계 밖의 기능입니다. 지난 카드를 다시 읽는 것보다 퀴즈로 떠올리는 편이 오래 남습니다.
- 마우스를 올리면 짝을 밝히는 기능. 색만으로 짝이 보입니다.

## 무엇을 재나 (v1.1)

모든 숫자는 학습자의 컴퓨터에만 남습니다. 밖으로 보내지 않습니다.

| 지표 | 뜻 | 왜 보나 |
| --- | --- | --- |
| 기억률 | 3일 이상 지난 복습에서 떠올렸어요를 누른 비율 | 85~90%면 간격이 알맞습니다. Anki도 90%를 기본 목표로 둡니다. 훨씬 낮으면 간격이 깁니다. |
| 퀴즈 응답률 | 낸 퀴즈 가운데 답을 누른 비율 | 낮으면 퀴즈가 눈에 안 띄거나 귀찮다는 뜻입니다. |
| 하루 복습 수 | 하루에 답한 퀴즈 수 | 하루 5개, 밀린 복습 10개라는 값을 다시 정하는 근거입니다. |
| 계속 쓰는 날 | 7일 중 퀴즈에 답한 날 수 | 습관이 붙는지 봅니다. |

## 출처

- OECD. [Survey of Adult Skills 2023: Korea](https://www.oecd.org/en/publications/survey-of-adults-skills-2023-country-notes_ab4f6b8c-en/korea-republic-of_5f95963c-en.html).
- Dunlosky 외 (2013). Improving students' learning with effective learning techniques. [APS 보도자료](https://www.psychologicalscience.org/news/releases/which-study-strategies-make-the-grade.html).
- Mayer. 일관성·신호 원리. [Cambridge Handbook of Multimedia Learning](https://www.cambridge.org/core/books/abs/cambridge-handbook-of-multimedia-learning/principles-for-reducing-extraneous-processing-in-multimedia-learning-coherence-signaling-redundancy-spatial-contiguity-and-temporal-contiguity-principles/C98AB3A6CE760DD63C048936EA0B3B44).
- Nielsen (2005). [Lower-Literacy Users: Writing for a Broad Consumer Audience](https://www.nngroup.com/articles/writing-for-lower-literacy-users/).
- Smith, Roediger, Karpicke (2013). Covert retrieval practice benefits retention as much as overt retrieval practice. [Purdue Learning Lab 논문 목록](https://learninglab.psych.purdue.edu/publications).
- Kornell, Hays, Bjork (2009). [Unsuccessful retrieval attempts enhance subsequent learning](https://pubmed.ncbi.nlm.nih.gov/19586265/).
- Rowland (2014). [The effect of testing versus restudy on retention: a meta-analytic review](https://courseware.epfl.ch/assets/courseware/v1/fdde2f0aa590bf3b1324077a6bf1540c/asset-v1%3AEPFL%2BDEMO%2B2020%2Btype%40asset%2Bblock/Rowland2014-meta-analysis.pdf).
- Cepeda 외 (2008). [Spacing effects in learning: a temporal ridgeline of optimal retention](https://pubmed.ncbi.nlm.nih.gov/19076480/).
- Kornell, Bjork (2008). [Optimising self-regulated study: the benefits and costs of dropping flashcards](https://bjorklab.psych.ucla.edu/wp-content/uploads/sites/13/2016/07/Kornell_Bjork_2008_Memory.pdf).
- Lally 외 (2010). How are habits formed. [Surrey 대학 인터뷰](https://www.surrey.ac.uk/news/does-it-really-take-66-days-form-habit-we-asked-expert-dr-pippa-lally).
- Boers, Lindstromberg (2012). Experimental and intervention studies on formulaic sequences in a second language. Annual Review of Applied Linguistics.
- Schmidt의 알아차림 가설과 Swain의 출력 가설. [Columbia TESOL Working Papers](https://journals.library.columbia.edu/index.php/SALT/article/download/1428/483/3628).
- 쉬운 글쓰기. [Digital.gov Plain Language Guide](https://digital.gov/guides/plain-language/writing/clear-short).
- 기억률 목표 90%. [Anki 설명서, Deck Options](https://docs.ankiweb.net/deck-options.html).
