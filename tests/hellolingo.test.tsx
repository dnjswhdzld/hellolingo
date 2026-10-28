import { describe, expect, mock, test } from 'claude-code/testing'
import type { Engine, MockClock } from 'claude-code/testing'
import type { On } from 'claude-code'

import { DAY_MS, addPhrases, answerNote, asNotes, intake, passOver, pickDue } from '../hooks/notes'
import { notesPaneRows } from '../hooks/register'
import { isInSentence, isKorean, parseCard, segments, translatedPart } from '../hooks/cards'
import type { Note, Notes } from '../types'

const BAND = {
  plugin: 'hellolingo',
  component: 'AbovePrompt',
  props: {
    hasSurvey: false,
    isWorking: true,
    maxRows: 20,
    bodyColumns: 80,
    scroll: { offset: 0, bodyRows: 20 },
    view: {},
  },
} as const

const USAGE = {
  input_tokens: 1,
  output_tokens: 1,
  cache_read_input_tokens: 0,
  cache_creation_input_tokens: 0,
}

const KO_PROMPT = '로그인 핸들러에서 null 체크 고쳐줘'
const EN_PROMPT = 'I want know why this test fails'

const KO_REPLY = JSON.stringify({
  english: 'Fix the null check in the login handler.',
  parts: [
    { ko: '로그인 핸들러에서', en: 'in the login handler' },
    { ko: 'null 체크', en: 'the null check' },
    { ko: '고쳐줘', en: 'Fix' },
  ],
  phrases: [{ en: 'null check', ko: 'null 여부 확인', example: 'Add a null check here.' }],
})

const EN_REPLY = JSON.stringify({
  fixes: [{ wrong: 'I want know', right: 'I want to know', why: 'want 뒤에는 to + 동사' }],
})

const ANSWER = '로그인 핸들러의 null 체크를 고쳤어요. 이 핸들러에 테스트도 추가할까요?'

const PENDING_ROW = /^다음 문장 옮기는 중…$/
const KO_ENGLISH_LINE = /^Fix the null check in the login handler\.$/

const answered = (answer: string) =>
  ({ answer, durationMs: 1000, isAborted: false, turnId: 't1', reason: 'answer' }) as const

/** 노트 한 줄. 따로 주지 않은 값은 지금(0) 복습할 때가 된 새 표현. */
const note = (en: string, ko: string, fields: Partial<Note> = {}): Note => ({
  en,
  ko,
  example: '',
  addedAt: 0,
  seenAt: 0,
  level: 0,
  dueAt: 0,
  shownAt: null,
  ...fields,
})

/** 모델 답을 테스트가 정한 때에 돌려준다. `release(i, text)`는 붙잡아 둔 i번째 호출에 답한다. */
function held() {
  const waiting: ((text: string | null) => void)[] = []

  return {
    hold: () => new Promise<string | null>(resolve => waiting.push(resolve)),
    release: (i: number, text: string | null) => waiting[i]?.(text),
  }
}

/**
 * 엔진 대신 아래에서 답하는 훅들. 모델에 간 요청을 모아서 돌려준다. `stored`는 저장소 자체라서
 * 테스트가 나중에 들여다볼 수 있다. 처음 값을 넣어 두면 다른 세션이 남긴 것처럼 읽힌다.
 */
function engine(
  on: On,
  reply: (prompt: string, model: string) => string | null | Promise<string | null>,
  stored: Record<string, unknown> = {},
) {
  const asked: { model: string; prompt: string }[] = []
  const opened: unknown[] = []
  const copy = (v: unknown) => (v === undefined ? undefined : JSON.parse(JSON.stringify(v)))

  on('store.get', (_, e) => ({ value: copy(stored[e.key]) }))
  on('store.set', (_, e) => {
    stored[e.key] = copy(e.value)

    return { value: undefined }
  })
  on('prompt.submit', (_, e) => ({ text: e.text }))
  on('turn.complete', (_, e) => ({ text: e.answer }))
  // 패널을 여는 명령과 패널 자체도 엔진 대신 받는다.
  on('session.start', (_, e) => ({ cwd: e.cwd }))
  on('command.register', (_, e) => ({ value: { command: e.name } }))
  on('ui.open', (_, e) => {
    opened.push(e)

    return { value: { isPlaced: true } }
  })
  on('model.complete', async (_, e) => {
    asked.push({ model: e.model, prompt: e.prompt })
    const text = await reply(e.prompt, e.model)

    return {
      value:
        text === null
          ? { isAnswered: false, reason: 'api-error', status: 529, error: 'overloaded', usage: USAGE }
          : { isAnswered: true, text, usage: USAGE },
    }
  })
  on('ui.render', ($, e) => {
    const { Text } = $.ui.resolve(e)

    return <Text>engine</Text>
  })

  return Object.assign(asked, { opened })
}

const typed = (text: string) => ({ text, wait: false, origin: { kind: 'composer' } }) as const

describe('band above the prompt', () => {
  test('a Korean prompt shows its English and a phrase, on terminal and desktop', async ($, on) => {
    const clock = mock.clock(on)
    const asked = engine(on, () => KO_REPLY)

    await $.prompt.submit(typed(KO_PROMPT))
    await clock.settle()

    expect(asked).toHaveLength(1)
    expect(asked[0]?.model).toBe('haiku')
    expect(asked[0]?.prompt).toContain('MODE: KOREAN PROMPT')

    for (const surface of ['terminal', 'desktop'] as const) {
      const ui = await $.ui.mount({ ...BAND, surface })

      // 영어 아래에 내 한국어를 쓰인 순서 그대로. 번호 없이 글만.
      expect(await ui.find({ type: 'Text', text: KO_ENGLISH_LINE })).toBeDefined()
      expect(await ui.find({ type: 'Text', text: /^로그인 핸들러에서 null 체크 고쳐줘$/ })).toBeDefined()

      // 줄 안의 조각들: 짝마다 같은 색, 짝마다 다른 색.
      const piece = async (text: string) => (await ui.find({ type: 'Text', text: new RegExp(`^${text}$`) }))?.props
      const fix = [await piece('Fix'), await piece('고쳐줘')]
      const handler = [await piece('in the login handler'), await piece('로그인 핸들러에서')]

      expect(fix[0]?.color).toBeDefined()
      expect(fix[0]?.color).toBe(fix[1]?.color)
      expect(handler[0]?.color).toBe(handler[1]?.color)
      expect(fix[0]?.color).not.toBe(handler[0]?.color)
      // 짝 없는 한국어 조각은 흐리게.
      expect((await ui.findAll({ type: 'Text', text: /^ $/ })).some(t => t.props.dimColor === true)).toBe(true)
      // 핵심 표현 하나. 예문은 카드에 없다: 바로 위 영어 문장이 그 예문이다.
      expect(await ui.find({ type: 'Text', text: /^• null check — null 여부 확인$/ })).toBeDefined()
      expect(await ui.find({ type: 'Text', text: /Add a null check here/ })).toBeUndefined()
      // 카드는 둥근 테두리로 터미널의 다른 내용과 구분된다. 테두리를 어긋나게 하는 이모지는 없다.
      expect((await ui.find({ type: 'Box', key: 'prompt' }))?.props).toMatchObject({
        borderStyle: 'round',
        borderDimColor: true,
        paddingX: 1,
      })
      expect(await ui.find({ type: 'Text', text: /\p{Extended_Pictographic}/u })).toBeUndefined()
      // 같은 자리의 원래 내용도 함께 보인다.
      expect(await ui.find({ type: 'Text', text: /^engine$/ })).toBeDefined()
      await ui.unmount()
    }
  })

  test('without matched parts, the English line and the original show instead', async ($, on) => {
    const clock = mock.clock(on)
    engine(on, () => JSON.stringify({ ...JSON.parse(KO_REPLY), parts: [] }))

    await $.prompt.submit(typed(KO_PROMPT))
    await clock.settle()

    const ui = await $.ui.mount({ ...BAND, surface: 'terminal' })

    expect(await ui.find({ type: 'Text', text: KO_ENGLISH_LINE })).toBeDefined()
    expect((await ui.find({ type: 'Text', text: /^로그인 핸들러에서 null 체크 고쳐줘/ }))?.props.dimColor).toBe(true)
    await ui.unmount()
  })

  test('a prompt with pasted text shows only the translated part, and only expressions in the English', async ($, on) => {
    const clock = mock.clock(on)
    const pasted =
      'fix: 회원가입 폼 pattern 끝 개행까지 막도록 고정 Tyler 20 minutes ago 3f9c2a1e 이 커밋이 추가되었는데 ' +
      '03번 이후 브랜치들에서는 커밋이 없어 그래도 괜찮아 ?'
    engine(on, () =>
      JSON.stringify({
        // 모델은 질문 부분만 고르고, 띄어쓰기는 조금 다르게 옮겼다.
        original: '이 커밋이 추가되었는데 03번 이후 브랜치들에서는 커밋이 없어 그래도 괜찮아?',
        english: "This commit fixed the form pattern, but branches after 03 don't have it. Is that still okay?",
        parts: [
          { ko: '03번 이후 브랜치들에서는', en: 'branches after 03' },
          { ko: '커밋이 없어', en: "don't have it" },
          { ko: '그래도 괜찮아 ?', en: 'Is that still okay?' },
        ],
        phrases: [
          { en: 'take a look', ko: '한번 보다', example: '' },
          { en: 'as long as', ko: '~하는 한', example: '' },
          { en: "don't have", ko: '없다', example: "We don't have it yet." },
        ],
      }),
    )

    await $.prompt.submit(typed(pasted))
    await clock.settle()
    const ui = await $.ui.mount({ ...BAND, surface: 'terminal' })

    // 한글 줄에는 붙여넣은 커밋 정보 없이, 프롬프트에 쓴 그대로의 질문 부분만.
    expect(
      await ui.find({ type: 'Text', text: /^이 커밋이 추가되었는데 03번 이후 브랜치들에서는 커밋이 없어 그래도 괜찮아 \?$/ }),
    ).toBeDefined()
    expect(await ui.find({ type: 'Text', text: /3f9c2a1e/ })).toBeUndefined()
    // 영어 문장에 없는 표현은 빠진다.
    expect(await ui.find({ type: 'Text', text: /take a look|as long as/ })).toBeUndefined()
    expect(await ui.find({ type: 'Text', text: /^• don't have — 없다$/ })).toBeDefined()
    await ui.unmount()
  })

  test('a sentence mixing in a branch name keeps it as written, in both languages', async ($, on) => {
    const clock = mock.clock(on)
    const mixed = 'feature/login-session-timeout to develop conflicts 나는데 확인해봐'
    engine(on, () =>
      JSON.stringify({
        original: mixed,
        english: 'Merging feature/login-session-timeout into develop causes conflicts. Can you check it?',
        parts: [
          { ko: 'feature/login-session-timeout to develop', en: 'Merging feature/login-session-timeout into develop' },
          { ko: 'conflicts 나는데', en: 'causes conflicts' },
          { ko: '확인해봐', en: 'Can you check it?' },
        ],
        phrases: [],
      }),
    )

    await $.prompt.submit(typed(mixed))
    await clock.settle()
    const ui = await $.ui.mount({ ...BAND, surface: 'terminal' })
    const piece = async (text: string) => (await ui.find({ type: 'Text', text: new RegExp(`^${text}$`) }))?.props

    expect(await ui.find({ type: 'Text', text: new RegExp(`^${mixed}$`) })).toBeDefined()
    expect((await piece('conflicts 나는데'))?.color).toBe((await piece('causes conflicts'))?.color)
    expect((await piece('feature/login-session-timeout to develop'))?.color).toBe(
      (await piece('Merging feature/login-session-timeout into develop'))?.color,
    )
    await ui.unmount()
  })

  test('pasted lines reach the model as lines, so it can tell them from the sentence', async ($, on) => {
    const clock = mock.clock(on)
    const question = '이 커밋이 추가되었는데 03번 이후 브랜치들에서는 커밋이 없어 그래도 괜찮아 ?'
    const asked = engine(on, () =>
      JSON.stringify({ ...JSON.parse(KO_REPLY), original: question, parts: [], english: 'Is that okay?' }),
    )

    await $.prompt.submit(
      typed(`fix: 회원가입 폼   pattern 고정  \n\n  Tyler authored 20 minutes ago\n3f9c2a1e\n\`\`\`\nconst x = 1\n\`\`\`\n${question}`),
    )
    await clock.settle()

    // 줄 안의 공백은 하나로, 빈 줄과 코드 블록은 빼고, 줄바꿈은 그대로.
    expect(asked[0]?.prompt).toContain(
      `<<<\nfix: 회원가입 폼 pattern 고정\nTyler authored 20 minutes ago\n3f9c2a1e\n${question}\n>>>`,
    )

    const ui = await $.ui.mount({ ...BAND, surface: 'terminal' })

    expect(await ui.find({ type: 'Text', text: new RegExp(`^${question.replace('?', '\\?')}$`) })).toBeDefined()
    expect(await ui.find({ type: 'Text', text: /3f9c2a1e/ })).toBeUndefined()
    await ui.unmount()
  })

  test('an English prompt with a mistake shows the fix', async ($, on) => {
    const clock = mock.clock(on)
    const asked = engine(on, () => EN_REPLY)

    await $.prompt.submit(typed(EN_PROMPT))
    await clock.settle()

    expect(asked[0]?.prompt).toContain('MODE: ENGLISH PROMPT')

    const ui = await $.ui.mount({ ...BAND, surface: 'terminal' })

    expect(await ui.find({ type: 'Text', text: /✗ I want know/ })).toBeDefined()
    expect(await ui.find({ type: 'Text', text: /✓ I want to know/ })).toBeDefined()
    await ui.unmount()
  })

  test('an English prompt without mistakes shows a more natural phrase, its example, and notes it', async ($, on) => {
    const clock = mock.clock(on)
    const stored: Record<string, unknown> = {}
    engine(
      on,
      () =>
        JSON.stringify({
          fixes: [],
          natural: { en: 'Can you take a look?', ko: '한번 봐 줄래요?', example: 'Can you take a look at this PR?' },
        }),
      stored,
    )

    await $.prompt.submit(typed('Please check why this test fails'))
    await clock.settle()
    const ui = await $.ui.mount({ ...BAND, surface: 'terminal' })

    expect(await ui.find({ type: 'Text', text: /^• Can you take a look\? — 한번 봐 줄래요\?$/ })).toBeDefined()
    expect(await ui.find({ type: 'Text', text: /^예: Can you take a look at this PR\?$/ })).toBeDefined()
    expect(Object.keys(asNotes(stored.notes))).toEqual(['can you take a look?'])
    await ui.unmount()
  })

  test('short prompts, slash commands and machine prompts are skipped', async ($, on) => {
    const clock = mock.clock(on)
    const asked = engine(on, () => KO_REPLY)

    await $.prompt.submit(typed('고쳐줘'))
    await $.prompt.submit({ ...typed('/review 이 파일 리뷰해줘'), command: { name: 'review', args: '이 파일 리뷰해줘' } })
    await $.prompt.submit({ text: '백그라운드 작업이 끝났습니다 결과를 확인하세요', wait: false, origin: { kind: 'task-notification' } })
    await clock.settle()

    expect(asked).toHaveLength(0)

    const ui = await $.ui.mount({ ...BAND, surface: 'terminal' })
    const texts = await ui.findAll({ type: 'Text' })

    expect(texts.map(t => t.text)).toEqual(['engine'])
    await ui.unmount()
  })

  test('a finished turn makes no model call and leaves the reply as it is', async ($, on) => {
    const clock = mock.clock(on)
    const asked = engine(on, () => KO_REPLY)

    await $.prompt.submit(typed(KO_PROMPT))
    await clock.settle()

    expect(asked).toHaveLength(1)

    const result = await $.turn.complete(answered(ANSWER))
    await clock.settle()

    expect(result.text).toBe(ANSWER)
    expect(asked).toHaveLength(1)
  })

  test('while the next card is made the previous card stays with a pending row, then the new card replaces it', async ($, on) => {
    const clock = mock.clock(on)
    const english = held()
    engine(on, prompt => (prompt.includes('MODE: ENGLISH PROMPT') ? english.hold() : KO_REPLY))

    await $.prompt.submit(typed(KO_PROMPT))
    await clock.settle()
    await $.prompt.submit(typed(EN_PROMPT))
    await clock.settle()
    const making = await $.ui.mount({ ...BAND, surface: 'terminal' })

    expect(await making.find({ type: 'Text', text: PENDING_ROW })).toBeDefined()
    expect(await making.find({ type: 'Text', text: KO_ENGLISH_LINE })).toBeDefined()
    expect(await making.find({ type: 'Text', text: /✗ I want know/ })).toBeUndefined()
    await making.unmount()

    english.release(0, EN_REPLY)
    await clock.settle()
    const ready = await $.ui.mount({ ...BAND, surface: 'terminal' })

    expect(await ready.find({ type: 'Text', text: /✗ I want know/ })).toBeDefined()
    expect(await ready.find({ type: 'Text', text: KO_ENGLISH_LINE })).toBeUndefined()
    expect(await ready.find({ type: 'Text', text: PENDING_ROW })).toBeUndefined()
    await ready.unmount()
  })

  test('when the next card fails, the previous card stays and the pending row goes', async ($, on) => {
    const clock = mock.clock(on)
    const english = held()
    engine(on, prompt => (prompt.includes('MODE: ENGLISH PROMPT') ? english.hold() : KO_REPLY))

    await $.prompt.submit(typed(KO_PROMPT))
    await clock.settle()
    await $.prompt.submit(typed(EN_PROMPT))
    await clock.settle()
    english.release(0, null)
    await clock.settle()
    const ui = await $.ui.mount({ ...BAND, surface: 'terminal' })

    expect(await ui.find({ type: 'Text', text: KO_ENGLISH_LINE })).toBeDefined()
    expect(await ui.find({ type: 'Text', text: PENDING_ROW })).toBeUndefined()
    await ui.unmount()
  })

  test('a late card for an older prompt does not cover the newer card, nor enter the notes', async ($, on) => {
    const clock = mock.clock(on)
    const replies = held()
    const stored: Record<string, unknown> = {}
    engine(on, () => replies.hold(), stored)

    await $.prompt.submit(typed(KO_PROMPT))
    await $.prompt.submit(typed(EN_PROMPT))
    await clock.settle()
    // 두 번째 프롬프트의 답이 먼저 온다.
    replies.release(1, EN_REPLY)
    await clock.settle()
    replies.release(0, KO_REPLY)
    await clock.settle()
    const ui = await $.ui.mount({ ...BAND, surface: 'terminal' })

    expect(await ui.find({ type: 'Text', text: /✗ I want know/ })).toBeDefined()
    expect(await ui.find({ type: 'Text', text: KO_ENGLISH_LINE })).toBeUndefined()
    expect(await ui.find({ type: 'Text', text: PENDING_ROW })).toBeUndefined()
    expect(Object.keys(asNotes(stored.notes))).toEqual([])
    await ui.unmount()
  })

  test('a survey keeps the band to itself', async ($, on) => {
    const clock = mock.clock(on)
    engine(on, () => KO_REPLY)

    await $.prompt.submit(typed(KO_PROMPT))
    await clock.settle()

    const ui = await $.ui.mount({ ...BAND, surface: 'terminal', props: { ...BAND.props, hasSurvey: true } })

    expect((await ui.findAll({ type: 'Text' })).map(t => t.text)).toEqual(['engine'])
    await ui.unmount()
  })
})

describe('expression notebook and review quiz', () => {
  const QUIZ_BAND = { ...BAND, surface: 'terminal', props: { ...BAND.props, bodyColumns: 100 } } as const

  /** 카드로 'null check'를 모으고 하루 지나 짧은 프롬프트를 보낸다: 그 표현이 퀴즈로 나와 있다. */
  async function quizADayLater($: Engine, clock: MockClock) {
    await $.prompt.submit(typed(KO_PROMPT))
    await clock.settle()
    await clock.advance(DAY_MS)
    await $.prompt.submit(typed('응 해줘'))
    await clock.settle()
  }

  test("a card's key expression enters the notes", async ($, on) => {
    const clock = mock.clock(on)
    const stored: Record<string, unknown> = {}
    engine(on, () => KO_REPLY, stored)

    await $.prompt.submit(typed(KO_PROMPT))
    await clock.settle()

    expect(Object.keys(asNotes(stored.notes))).toEqual(['null check'])
  })

  test('a phrase from a card comes back as a quiz a day later, answer hidden, on terminal and desktop', async ($, on) => {
    const clock = mock.clock(on)
    engine(on, () => KO_REPLY)

    await $.prompt.submit(typed(KO_PROMPT))
    await clock.settle()
    // 같은 날에는 아직 복습할 때가 아니다.
    await $.prompt.submit(typed('응 해줘'))
    await clock.settle()
    const sameDay = await $.ui.mount(QUIZ_BAND)

    expect(await sameDay.find({ type: 'Box', key: 'quiz' })).toBeUndefined()
    await sameDay.unmount()

    await clock.advance(DAY_MS)
    await $.prompt.submit(typed('응 해줘'))
    await clock.settle()

    for (const surface of ['terminal', 'desktop'] as const) {
      const ui = await $.ui.mount({ ...QUIZ_BAND, surface })

      expect(await ui.find({ type: 'Box', key: 'quiz' })).toBeDefined()
      expect(await ui.find({ type: 'Text', text: /어제 본 표현/ })).toBeDefined()
      expect(await ui.find({ type: 'Text', text: /"null 여부 확인" — 영어로 떠올려 보세요/ })).toBeDefined()
      expect(await ui.find({ type: 'Text', text: /^null check$/ })).toBeUndefined()
      expect(await ui.find({ type: 'Button', key: 'quiz-reveal' })).toBeDefined()
      await ui.unmount()
    }
  })

  test('after a card and a finished turn, a short reply shows the due quiz', async ($, on) => {
    const clock = mock.clock(on)
    engine(on, () => KO_REPLY, { notes: { 'make sure': note('make sure', '꼭 ~하다') } })

    await $.prompt.submit(typed(KO_PROMPT))
    await clock.settle()
    await $.turn.complete(answered(ANSWER))
    await clock.settle()
    await $.prompt.submit(typed('응 해줘'))
    await clock.settle()
    const ui = await $.ui.mount(QUIZ_BAND)

    expect(await ui.find({ type: 'Box', key: 'quiz' })).toBeDefined()
    expect(await ui.find({ type: 'Text', text: /"꼭 ~하다" — 영어로 떠올려 보세요/ })).toBeDefined()
    await ui.unmount()
  })

  test('the answer shows after 10 seconds, and recalling it moves the next review to 3 days later', async ($, on) => {
    const clock = mock.clock(on)
    engine(on, () => KO_REPLY)
    await quizADayLater($, clock)

    await clock.advance(5000)
    const early = await $.ui.mount(QUIZ_BAND)

    expect(await early.find({ type: 'Text', text: /10초 뒤에 정답이 나와요/ })).toBeDefined()
    expect(await early.find({ type: 'Text', text: /^null check$/ })).toBeUndefined()
    await early.unmount()

    await clock.advance(5000)
    const ui = await $.ui.mount(QUIZ_BAND)

    expect(await ui.find({ type: 'Text', text: /^null check$/ })).toBeDefined()
    expect(await ui.find({ type: 'Text', text: /^예: Add a null check here\.$/ })).toBeDefined()
    // 들여쓰기는 안쪽 여백이라, 좁은 칸에서 넘친 줄도 같은 자리에서 이어진다.
    expect((await ui.find({ type: 'Box', text: /^예: Add a null check here\.$/ }))?.props.paddingLeft).toBe(4)
    expect((await ui.findAll({ type: 'Button' })).map(b => b.props.label)).toEqual(['떠올렸어요', '못 떠올렸어요'])
    await ui.press({ key: 'quiz-knew' })
    // 답한 뒤에는 버튼이 사라진다.
    expect(await ui.find({ type: 'Button', key: 'quiz-knew' })).toBeUndefined()
    expect(await ui.find({ type: 'Text', text: /좋아요! 3일 뒤에 다시 볼게요/ })).toBeDefined()
    await ui.unmount()

    // 이틀 뒤에는 안 나오고, 사흘 뒤에 다시 나온다.
    await clock.advance(2 * DAY_MS)
    await $.prompt.submit(typed('응 해줘'))
    await clock.settle()
    const twoDays = await $.ui.mount(QUIZ_BAND)

    expect(await twoDays.find({ type: 'Box', key: 'quiz' })).toBeUndefined()
    await twoDays.unmount()

    await clock.advance(DAY_MS)
    await $.prompt.submit(typed('응 해줘'))
    await clock.settle()
    const threeDays = await $.ui.mount(QUIZ_BAND)

    expect(await threeDays.find({ type: 'Box', key: 'quiz' })).toBeDefined()
    await threeDays.unmount()
  })

  test('정답 보기 shows the answer at once, and forgetting brings it back tomorrow', async ($, on) => {
    const clock = mock.clock(on)
    engine(on, () => KO_REPLY)
    await quizADayLater($, clock)

    const ui = await $.ui.mount(QUIZ_BAND)

    await ui.press({ key: 'quiz-reveal' })
    expect(await ui.find({ type: 'Text', text: /^null check$/ })).toBeDefined()
    await ui.press({ key: 'quiz-forgot' })
    expect(await ui.find({ type: 'Text', text: /괜찮아요, 내일 다시 볼게요/ })).toBeDefined()
    await ui.unmount()

    await clock.advance(DAY_MS)
    await $.prompt.submit(typed('응 해줘'))
    await clock.settle()
    const tomorrow = await $.ui.mount(QUIZ_BAND)

    expect(await tomorrow.find({ type: 'Box', key: 'quiz' })).toBeDefined()
    await tomorrow.unmount()
  })

  test('quiz buttons answer to r, o and x', async ($, on) => {
    const clock = mock.clock(on)
    engine(on, () => KO_REPLY)
    await quizADayLater($, clock)

    const ui = await $.ui.mount(QUIZ_BAND)
    const hotkeys = async () => (await ui.findAll({ type: 'Button' })).map(b => b.props.hotkey)

    expect(await hotkeys()).toEqual(['r'])
    await ui.press({ key: 'quiz-reveal' })
    expect(await hotkeys()).toEqual(['o', 'x'])
    await ui.unmount()
  })

  test('a quiz dropped for a quicker next prompt does not count its phrase as shown', async ($, on) => {
    const clock = mock.clock(on)
    engine(on, () => KO_REPLY, {
      notes: { first: note('first', '첫째', { dueAt: 0 }), second: note('second', '둘째', { dueAt: 1 }) },
    })

    await clock.advance(DAY_MS)
    await $.prompt.submit(typed('응 해줘'))
    await $.prompt.submit(typed('응 그것도'))
    await clock.settle()
    const ui = await $.ui.mount(QUIZ_BAND)

    expect(await ui.find({ type: 'Text', text: /"첫째" — 영어로 떠올려 보세요/ })).toBeDefined()
    await ui.unmount()
  })

  test('a quiz passed over gives way to another due phrase, even to one never answered', async ($, on) => {
    const clock = mock.clock(on)
    engine(on, () => KO_REPLY, {
      notes: { answered: note('answered', '답한 것', { seenAt: 1, level: 1 }), fresh: note('fresh', '새것') },
    })
    const asked: string[] = []

    await clock.advance(DAY_MS)

    // 정답이 나오기 전에 답하지 않고 다음 프롬프트를 보낸다.
    for (const text of ['응 해줘', '응 그것도', '그다음']) {
      await $.prompt.submit(typed(text))
      await clock.settle()
      const ui = await $.ui.mount(QUIZ_BAND)

      asked.push((await ui.find({ type: 'Text', text: /영어로 떠올려 보세요/ }))?.text ?? '')
      await ui.unmount()
      await clock.advance(1000)
    }

    expect(asked).toEqual([
      '"답한 것" — 영어로 떠올려 보세요',
      '"새것" — 영어로 떠올려 보세요',
      '"답한 것" — 영어로 떠올려 보세요',
    ])
  })

  test('a quiz passed over after its answer showed comes back the next day, at the same interval', async ($, on) => {
    const clock = mock.clock(on)
    const stored: Record<string, unknown> = {
      notes: { answered: note('answered', '답한 것', { seenAt: 1, level: 1 }) },
    }
    engine(on, () => KO_REPLY, stored)

    await clock.advance(DAY_MS)
    await $.prompt.submit(typed('응 해줘'))
    await clock.settle()
    await clock.advance(10_000)
    await $.prompt.submit(typed('응 그것도'))
    await clock.settle()

    expect(asNotes(stored.notes).answered).toMatchObject({ level: 1, dueAt: 2 * DAY_MS + 10_000 })

    const ui = await $.ui.mount(QUIZ_BAND)

    expect(await ui.find({ type: 'Box', key: 'quiz' })).toBeUndefined()
    await ui.unmount()
  })

  test('a slash command keeps the quiz on screen', async ($, on) => {
    const clock = mock.clock(on)
    engine(on, () => KO_REPLY)
    await quizADayLater($, clock)

    await $.prompt.submit({ ...typed('/lingo-notes'), command: { name: 'lingo-notes', args: '' } })
    await clock.settle()
    const ui = await $.ui.mount(QUIZ_BAND)

    expect(await ui.find({ type: 'Box', key: 'quiz' })).toBeDefined()
    await ui.unmount()
  })

  test('the quiz sits beside the prompt card, stacks when narrow, and stays when the turn ends', async ($, on) => {
    const clock = mock.clock(on)
    // 다른 세션에서 모아 둔 표현도 퀴즈에 나온다. 모양이 틀린 줄은 버린다.
    engine(on, () => KO_REPLY, { notes: { 'make sure': note('make sure', '꼭 ~하다'), broken: { en: 1 } } })

    await $.prompt.submit(typed(KO_PROMPT))
    await clock.settle()
    const working = await $.ui.mount(QUIZ_BAND)

    // (100 - 카드 사이 2칸) / 2
    expect((await working.find({ type: 'Box', key: 'prompt' }))?.props.width).toBe(49)
    expect((await working.find({ type: 'Box', key: 'quiz' }))?.props).toMatchObject({
      width: 49,
      borderStyle: 'round',
      borderDimColor: true,
      paddingX: 1,
    })
    expect(await working.find({ type: 'Text', text: /"꼭 ~하다"/ })).toBeDefined()
    await working.unmount()

    const narrow = await $.ui.mount({ ...QUIZ_BAND, props: { ...QUIZ_BAND.props, bodyColumns: 60 } })

    expect((await narrow.find({ type: 'Box', key: 'prompt' }))?.props.width).toBeUndefined()
    expect((await narrow.find({ type: 'Box', key: 'quiz' }))?.props.width).toBeUndefined()
    await narrow.unmount()

    await $.turn.complete(answered(ANSWER))
    await clock.settle()
    const done = await $.ui.mount(QUIZ_BAND)

    expect(await done.find({ type: 'Box', key: 'quiz' })).toBeDefined()
    await done.unmount()
  })

  test('/lingo-notes opens a pane listing the notebook, closed by Esc', async ($, on) => {
    const clock = mock.clock(on)
    const { opened } = engine(on, () => KO_REPLY)

    await $.session.start({ cwd: '/', surface: 'desktop', isInteractive: true })
    await $.prompt.submit(typed(KO_PROMPT))
    await clock.settle()
    const ran = await $.command.run({
      command: 'lingo-notes',
      args: '',
      origin: { kind: 'composer' },
      presentation: { isFullscreen: true, columns: 120 },
    })

    expect(ran.text).toContain('표현 노트')
    // 빈 입력창에서 Esc로 닫을 수 있다.
    expect(opened).toEqual([expect.objectContaining({ id: 'lingo-notes', closeOnEscape: true })])

    for (const surface of ['terminal', 'desktop'] as const) {
      const ui = await $.ui.mount({
        plugin: 'hellolingo',
        component: 'Pane',
        requestId: 'lingo-notes',
        surface,
        props: {
          title: '표현 노트',
          isFocused: false,
          bodyColumns: 60,
          placement: 'dock',
          scroll: { offset: 0, bodyRows: 20 },
          view: {},
        },
      })

      expect(await ui.find({ type: 'Text', text: /모두 1개 · 지금 복습할 것 0개/ })).toBeDefined()
      expect(await ui.find({ type: 'Text', text: /• null check — null 여부 확인/ })).toBeDefined()
      expect(await ui.find({ type: 'Text', text: /내일 복습/ })).toBeDefined()
      await ui.unmount()
    }
  })

  test('/lingo-notes lists every note, and the pane scrolls through them', async ($, on) => {
    mock.clock(on)
    const many = Array.from({ length: 30 }, (_, i) => note(`phrase ${i}`, `뜻 ${i}`, { dueAt: i * DAY_MS }))
    engine(on, () => KO_REPLY, { notes: Object.fromEntries(many.map(n => [n.en, n])) })

    await $.session.start({ cwd: '/', surface: 'terminal', isInteractive: true })
    const ui = await $.ui.mount({
      plugin: 'hellolingo',
      component: 'Pane',
      requestId: 'lingo-notes',
      surface: 'terminal',
      props: {
        title: '표현 노트',
        isFocused: false,
        bodyColumns: 60,
        placement: 'inline',
        scroll: { offset: 0, bodyRows: 10 },
        view: {},
      },
    })

    expect(await ui.find({ type: 'Text', text: /모두 30개/ })).toBeDefined()
    expect(await ui.find({ type: 'Text', text: /• phrase 29 — 뜻 29/ })).toBeDefined()
    await ui.unmount()
  })
})

describe('local helpers', () => {
  test('spaced review: knowing goes 1 → 3 → 7 → 14 → 30 days, forgetting goes back to 1', async () => {
    let notes: Notes = { x: note('x', '엑스') }
    const days: number[] = []

    for (let i = 0; i < 5; i++) {
      const r = answerNote(notes, 'x', true, 0)
      notes = r.notes
      days.push(r.days)
    }

    expect(days).toEqual([3, 7, 14, 30, 30])
    expect(answerNote(notes, 'x', false, 0)).toMatchObject({ days: 1, notes: { x: { level: 0, dueAt: DAY_MS } } })
  })

  test('the quiz picks a due phrase not shown yet, then the one shown longest ago', async () => {
    const notes = {
      a: note('a', '에이', { shownAt: 5 }),
      b: note('b', '비', { shownAt: 2 }),
      later: note('later', '나중', { dueAt: 100 }),
    }

    expect(pickDue(notes, 10)?.en).toBe('b')
    expect(pickDue({ ...notes, c: note('c', '씨') }, 10)?.en).toBe('c')
    expect(pickDue({ later: notes.later }, 10)).toBeNull()
  })

  test('the quiz picks a due phrase answered before ahead of one never answered', async () => {
    const notes = {
      fresh: note('fresh', '새것'),
      answered: note('answered', '답한 것', { seenAt: 5, shownAt: 5, level: 1 }),
    }

    expect(pickDue(notes, 10)?.en).toBe('answered')
    expect(pickDue({ fresh: notes.fresh }, 10)?.en).toBe('fresh')
  })

  test('a phrase shown and passed over since its last answer goes behind the other due phrases', async () => {
    const notes = {
      fresh: note('fresh', '새것'),
      passed: note('passed', '넘긴 것', { seenAt: 5, shownAt: 8, level: 1 }),
      older: note('older', '먼저 넘긴 것', { shownAt: 6 }),
    }

    expect(pickDue(notes, 10)?.en).toBe('fresh')
    expect(pickDue({ passed: notes.passed, older: notes.older }, 10)?.en).toBe('older')
  })

  test('passing over waits a day only for a phrase still due', async () => {
    const notes = {
      due: note('due', '복습할 것', { level: 2 }),
      later: note('later', '나중', { dueAt: 3 * DAY_MS }),
    }

    expect(passOver(notes, 'due', 10).due).toMatchObject({ level: 2, dueAt: 10 + DAY_MS })
    expect(passOver(notes, 'later', 10)).toBe(notes)
    expect(passOver(notes, 'gone', 10)).toBe(notes)
  })

  test('new expressions stop at 5 a day, and while 10 reviews are due; the notes pane says why', async () => {
    const phrase = (en: string) => ({ en, ko: en, example: '' })
    let notes: Notes = {}

    for (let i = 0; i < 6; i++) {
      notes = addPhrases(notes, [phrase(`p${i}`)], i)
    }

    expect(Object.keys(notes)).toEqual(['p0', 'p1', 'p2', 'p3', 'p4'])
    expect(intake(notes, 10)).toBe('full-today')
    expect(notesPaneRows(notes, 10).map(r => r.text)).toContain('새 표현 5개를 다 모았어요. 하루가 지나면 다시 모아요.')
    // 24시간이 지나면 다시 모은다.
    expect(Object.keys(addPhrases(notes, [phrase('p5')], DAY_MS + 5))).toContain('p5')

    const due: Notes = Object.fromEntries(Array.from({ length: 10 }, (_, i) => [`d${i}`, note(`d${i}`, '밀림', { dueAt: 0 })]))

    expect(intake(due, DAY_MS)).toBe('backlog')
    expect(addPhrases(due, [phrase('new')], DAY_MS)).toBe(due)
    expect(notesPaneRows(due, DAY_MS).map(r => r.text)).toContain(
      '복습할 표현이 10개 이상 쌓여서, 새 표현은 잠시 모으지 않아요.',
    )
    expect(intake({}, 0)).toBe('open')
  })

  test('a phrase is noted once, whatever its case and spaces', async () => {
    const once = addPhrases({}, [{ en: 'Want me to ...?', ko: '~해 드릴까요?', example: '' }], 0)
    const twice = addPhrases(once, [{ en: 'want  me to ...?', ko: '다른 뜻', example: '' }], 5)

    expect(twice).toBe(once)
    expect(Object.keys(asNotes({ ...once, bad: { en: 'x' }, worse: null }))).toEqual(['want me to ...?'])
  })

  test('language detection', async () => {
    expect(isKorean('이 함수에서 NullPointerException 나는 거 고쳐줘')).toBe(true)
    expect(isKorean('fix the failing test in UserServiceTest')).toBe(false)
    expect(isKorean("change the label to '저장'")).toBe(false)
    expect(isKorean('UserServiceImpl.findByEmailAndStatus 에서 NPE 나요')).toBe(true)
  })

  test('overlapping fixes keep only the narrower one', async () => {
    const reply = JSON.stringify({
      fixes: [
        { wrong: 'Please fix it and run test again', right: 'Please fix it and run the tests again', why: '' },
        { wrong: 'run test again', right: 'run the tests again', why: 'test가 여러 개면 tests로 써요.' },
        { wrong: 'Run test again', right: 'run the tests again', why: '' },
      ],
    })
    const card = parseCard(false, reply, 'Please fix it and run test again')

    expect(card?.kind === 'en-fix' ? card.fixes.map(f => f.why) : null).toEqual(['test가 여러 개면 tests로 써요.'])
  })

  test('replies that are not the expected JSON give no card', async () => {
    expect(parseCard(true, 'Sure! Here is the translation.', KO_PROMPT)).toBeNull()
    expect(parseCard(true, '{"phrases": []}', KO_PROMPT)).toBeNull()
    expect(parseCard(false, '{"fixes": [], "natural": {"en": ""}}', KO_PROMPT)).toBeNull()
    expect(parseCard(true, '```json\n' + KO_REPLY + '\n```', KO_PROMPT)).toMatchObject({ kind: 'ko', original: KO_PROMPT })
  })

  test('a long prompt shows only the sentence the model picked, with every part matched', async () => {
    const prompt = '다음 주에 팀 워크숍이 있어. 다들 바빠서 준비할 시간이 없거든. 계획하고 준비해줘! 장소는 회의실이면 돼.'
    const reply = JSON.stringify({
      original: '계획하고 준비해줘!',
      english: 'Make a plan and get everything ready.',
      parts: [
        { ko: '계획하고', en: 'Make a plan and' },
        { ko: '준비해줘!', en: 'get everything ready.' },
      ],
      phrases: [{ en: 'get everything ready', ko: '전부 미리 준비해 두다', example: 'Get everything ready before the meeting.' }],
    })

    expect(parseCard(true, reply, prompt)).toMatchObject({
      kind: 'ko',
      original: '계획하고 준비해줘!',
      parts: [{ ko: '계획하고' }, { ko: '준비해줘!' }],
      phrases: [{ en: 'get everything ready' }],
    })
  })

  test('parts not found in both sentences are dropped, and fewer than 2 drop the map', async () => {
    const reply = (parts: unknown) => JSON.stringify({ english: 'Fix the null check in the login handler.', parts })
    const kept = (r: string) => {
      const c = parseCard(true, r, KO_PROMPT)

      return c?.kind === 'ko' ? c.parts.map(p => p.ko) : null
    }

    expect(kept(KO_REPLY)).toEqual(['로그인 핸들러에서', 'null 체크', '고쳐줘'])
    // 한국어에 없는 조각('회원가입'), 영어에 없는 조각('Repair')은 빠진다.
    expect(
      kept(
        reply([
          { ko: '로그인 핸들러에서', en: 'in the login handler' },
          { ko: '회원가입', en: 'sign-up' },
          { ko: 'null 체크', en: 'the null check' },
          { ko: '고쳐줘', en: 'Repair' },
        ]),
      ),
    ).toEqual(['로그인 핸들러에서', 'null 체크'])
    expect(kept(reply([{ ko: '고쳐줘', en: 'Fix' }]))).toEqual([])
    // 문장 부호만 있는 조각은 짝이 아니다.
    expect(
      kept(
        reply([
          { ko: '로그인 핸들러에서', en: 'in the login handler' },
          { ko: 'null 체크', en: 'the null check' },
          { ko: '고쳐줘', en: '.' },
        ]),
      ),
    ).toEqual(['로그인 핸들러에서', 'null 체크'])
    // 색만으로 구분되게 짝은 넷까지.
    expect(
      kept(
        reply([
          { ko: '로그인', en: 'login' },
          { ko: '핸들러에서', en: 'handler' },
          { ko: 'null', en: 'null' },
          { ko: '체크', en: 'check' },
          { ko: '고쳐줘', en: 'Fix' },
        ]),
      ),
    ).toEqual(['로그인', '핸들러에서', 'null', '체크'])
    expect(kept(reply('not a list'))).toEqual([])
  })

  test('the translated part is cut from the prompt as written, or the whole prompt when it is not there', async () => {
    const prompt = 'git log 붙여넣음 abc123   이거 다시 확인해 줘 ?'

    expect(translatedPart('이거 다시 확인해줘?', prompt)).toBe('이거 다시 확인해 줘 ?')
    expect(translatedPart('없는 문장', prompt)).toBe(prompt)
    expect(translatedPart(undefined, prompt)).toBe(prompt)
    expect(translatedPart('   ', prompt)).toBe(prompt)
    // 고른 부분이 없거나 안 맞으면, 짝지은 한국어 조각들이 차지하는 범위(뒤의 물음표까지).
    const parts = [
      { ko: '이거', en: 'this' },
      { ko: '확인해 줘', en: 'check' },
    ]

    expect(translatedPart('다르게 옮긴 문장', prompt, parts)).toBe('이거 다시 확인해 줘 ?')
    expect(translatedPart(undefined, prompt, [{ ko: '이거', en: 'this' }])).toBe(prompt)
  })

  test('a key expression counts as in the sentence when most of its words are, articles and placeholders aside', async () => {
    const english = 'Merge #2 first, then open the MR for #3. That is the cleanest.'

    expect(isInSentence('open an MR', english)).toBe(true)
    expect(isInSentence('Want me to ...?', 'Want me to add tests too?')).toBe(true)
    expect(isInSentence("don't have", "Branches after 03 don't have it.")).toBe(true)
    expect(isInSentence('take a look', english)).toBe(false)
    expect(isInSentence('the cleanest way to', english)).toBe(false)
    expect(isInSentence('...', english)).toBe(false)
    // 카드도 같은 기준으로 거른다.
    const card = parseCard(
      true,
      JSON.stringify({
        english,
        phrases: [
          { en: 'take a look', ko: '한번 보다', example: '' },
          { en: 'open an MR', ko: 'MR을 열다', example: '' },
          { en: 'Merge #2 first', ko: '2번 먼저 병합', example: '' },
        ],
      }),
      '2번 병합 후 3번 MR을 여는 게 가장 깔끔해',
    )

    // 문장 안에 있는 첫 표현 하나만.
    expect(card?.kind === 'ko' ? card.phrases.map(p => p.en) : null).toEqual(['open an MR'])
  })

  test('segments keep the sentence as written and number the pieces, case-insensitive and without overlap', async () => {
    expect(segments('Fix it, then fix it again.', ['fix it', 'Fix it'])).toEqual([
      { text: 'Fix it', pair: 0 },
      { text: ', then ', pair: null },
      { text: 'fix it', pair: 1 },
      { text: ' again.', pair: null },
    ])
    expect(segments('없는 조각', ['다른'])).toEqual([{ text: '없는 조각', pair: null }])
  })
})
