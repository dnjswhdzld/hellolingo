import { describe, expect, mock, test } from 'claude-code/testing'
import type { Engine, MockClock } from 'claude-code/testing'
import type { On } from 'claude-code'

import {
  DAY_MS,
  addPhrases,
  addPoint,
  answerNote,
  asNotes,
  intake,
  passOver,
  pickDue,
  practiceNote,
  rotateDrills,
  studyOrder,
} from '../hooks/notes'
import { drillSentence, drillsForReview, parseLesson, pickPiece, piecesLeft, startArrange } from '../hooks/lessons'
import { notesPaneRows, pieceLabel } from '../hooks/register'
import { isInSentence, isKorean, parseCard, segments, translatedPart } from '../hooks/cards'
import { asStats, bump, lastWeek, reviewed } from '../hooks/stats'
import type { DayStats, Note, Notes } from '../types'

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

describe('expression notebook and study panel', () => {
  const WIDE = { ...BAND, surface: 'terminal', props: { ...BAND.props, bodyColumns: 100 } } as const

  /** 학습하기를 누르면 모델이 돌려주는 배울 점과 문제들. 첫 조각은 대문자로 시작하고 조각은 셋씩이다. */
  const drill = (ko: string, ...parts: [string, string][]) => ({ ko, parts: parts.map(([k, en]) => ({ ko: k, en })) })
  const DRILLS = [
    drill('수량 바꾸는 버튼 추가해줘', ['버튼 추가해줘', 'Add a button'], ['바꾸는', 'to change'], ['수량', 'the quantity.']),
    drill('보고서 내려받는 링크 만들어줘', ['링크 만들어줘', 'Make a link'], ['내려받는', 'to download'], ['보고서', 'the report.']),
    drill('날짜 고르는 창 열어줘', ['창 열어줘', 'Open a window'], ['고르는', 'to pick'], ['날짜', 'a date.']),
    drill('필터 지우는 버튼 넣어줘', ['버튼 넣어줘', 'Add a button'], ['지우는', 'to clear'], ['필터', 'the filters.']),
  ]
  const POINT = { type: 'order', ko: '~하는 칸', en: 'a field to ~' } as const
  const LESSON_REPLY = JSON.stringify({ point: POINT, drills: DRILLS })

  /** 카드는 KO_REPLY, 학습하기는 `lesson`으로 답한다. */
  const replies = (lesson: string | null = LESSON_REPLY) => (prompt: string) => (prompt.includes('MODE: LESSON') ? lesson : KO_REPLY)

  /** 배울 점을 담은 노트 한 줄 */
  const pointNote = (fields: Partial<Note> = {}): Note =>
    note('a field to ~', '~하는 칸', { point: { ...POINT, hint: '영어는 꾸며 주는 말이 뒤로 가요' }, drills: DRILLS.slice(2), ...fields })

  const labels = async (ui: { findAll: (q: { type: 'Button' }) => Promise<{ props: { label?: unknown } }[]> }) =>
    (await ui.findAll({ type: 'Button' })).map(b => b.props.label)

  /** 조각 맞추기에서 조각을 영어 순서대로 누른다 */
  async function arrange(ui: { press: (q: { key: string }) => Promise<unknown> }, clock: MockClock, order: number[]) {
    for (const i of order) {
      await ui.press({ key: `piece-${i}` })
      await clock.settle()
    }
  }

  test("a card's key expression enters the notes", async ($, on) => {
    const clock = mock.clock(on)
    const stored: Record<string, unknown> = {}
    engine(on, () => KO_REPLY, stored)

    await $.prompt.submit(typed(KO_PROMPT))
    await clock.settle()

    expect(Object.keys(asNotes(stored.notes))).toEqual(['null check'])
  })

  test('nothing quizzes on its own: the card offers 학습하기, then 복습 and 학습 노트 once there are notes', async ($, on) => {
    const clock = mock.clock(on)
    engine(on, () => KO_REPLY)

    await $.session.start({ cwd: '/', surface: 'terminal', isInteractive: true })
    await $.prompt.submit(typed(KO_PROMPT))
    await clock.settle()
    const today = await $.ui.mount(WIDE)

    expect(await labels(today)).toEqual(['학습하기', '학습 노트'])
    expect((await today.findAll({ type: 'Button' })).map(b => b.props.hotkey)).toEqual(['s', 'b'])
    expect(await today.find({ type: 'Box', key: 'study' })).toBeUndefined()
    await today.unmount()

    // 하루 지나 복습할 때가 되어도 퀴즈를 저절로 내지 않는다. 버튼에 수만 보인다.
    await clock.advance(DAY_MS)
    await $.prompt.submit(typed('응 해줘'))
    await clock.settle()
    const tomorrow = await $.ui.mount(WIDE)

    expect(await labels(tomorrow)).toEqual(['학습하기', '복습 1', '학습 노트'])
    expect(await tomorrow.find({ type: 'Box', key: 'study' })).toBeUndefined()
    await tomorrow.unmount()
  })

  test('an English card has no 학습하기', async ($, on) => {
    const clock = mock.clock(on)
    engine(on, () => EN_REPLY)

    await $.prompt.submit(typed(EN_PROMPT))
    await clock.settle()
    const ui = await $.ui.mount(WIDE)

    expect(await ui.find({ type: 'Button', key: 'study-lesson' })).toBeUndefined()
    await ui.unmount()
  })

  test('복습 hides the answer until 정답 보기, on terminal and desktop, and recalling moves it 3 days later', async ($, on) => {
    const clock = mock.clock(on)
    const stored: Record<string, unknown> = {}
    engine(on, () => KO_REPLY, stored)

    await $.session.start({ cwd: '/', surface: 'terminal', isInteractive: true })
    await $.prompt.submit(typed(KO_PROMPT))
    await clock.settle()
    await clock.advance(DAY_MS)

    const opening = await $.ui.mount(WIDE)

    await opening.press({ key: 'study-review' })
    await clock.settle()
    await opening.unmount()

    for (const surface of ['terminal', 'desktop'] as const) {
      const ui = await $.ui.mount({ ...WIDE, surface })

      expect(await ui.find({ type: 'Box', key: 'study' })).toBeDefined()
      expect(await ui.find({ type: 'Text', text: /^복습 · 어제 본 표현$/ })).toBeDefined()
      expect(await ui.find({ type: 'Text', text: /"null 여부 확인" — 영어로 떠올려 보세요/ })).toBeDefined()
      expect(await ui.find({ type: 'Text', text: /^null check$/ })).toBeUndefined()
      await ui.unmount()
    }

    // 직접 연 퀴즈라 정답은 학습자가 볼 때 나온다. 시간이 지나도 저절로 나오지 않는다.
    await clock.advance(60_000)
    const ui = await $.ui.mount(WIDE)

    expect(await ui.find({ type: 'Text', text: /^null check$/ })).toBeUndefined()
    await ui.press({ key: 'quiz-reveal' })
    await clock.settle()
    expect(await ui.find({ type: 'Text', text: /^null check$/ })).toBeDefined()
    expect(await ui.find({ type: 'Text', text: /^예: Add a null check here\.$/ })).toBeDefined()
    // 들여쓰기는 안쪽 여백이라, 좁은 칸에서 넘친 줄도 같은 자리에서 이어진다.
    expect((await ui.find({ type: 'Box', text: /^예: Add a null check here\.$/ }))?.props.paddingLeft).toBe(4)
    expect(await labels(ui)).toEqual(['떠올렸어요', '못 떠올렸어요', '닫기'])
    await ui.press({ key: 'quiz-knew' })
    await clock.settle()
    expect(await ui.find({ type: 'Button', key: 'quiz-knew' })).toBeUndefined()
    expect(await ui.find({ type: 'Text', text: /좋아요! 3일 뒤에 다시 볼게요/ })).toBeDefined()
    // 복습할 것이 더 없으면 닫기만 남는다.
    expect(await labels(ui)).toEqual(['닫기'])
    expect(asNotes(stored.notes)['null check']).toMatchObject({ level: 1 })
    await ui.press({ key: 'study-close' })
    await clock.settle()
    expect(await ui.find({ type: 'Box', key: 'study' })).toBeUndefined()
    // 다시 복습할 것이 없으니 카드에도 복습 버튼이 없다.
    expect(await ui.find({ type: 'Button', key: 'study-review' })).toBeUndefined()
    await ui.unmount()
  })

  test('forgetting brings a phrase back tomorrow, and 다음 복습 goes on until every due phrase is done', async ($, on) => {
    const clock = mock.clock(on)
    const stored: Record<string, unknown> = {
      notes: { answered: note('answered', '답한 것', { seenAt: 1, level: 1 }), fresh: note('fresh', '새것') },
    }
    engine(on, () => KO_REPLY, stored)

    await $.session.start({ cwd: '/', surface: 'terminal', isInteractive: true })
    await $.prompt.submit(typed(KO_PROMPT))
    await clock.settle()
    const ui = await $.ui.mount(WIDE)

    await ui.press({ key: 'study-review' })
    await clock.settle()
    // 답한 적 있는 표현을 처음 보는 표현보다 먼저 낸다.
    expect(await ui.find({ type: 'Text', text: /"답한 것"/ })).toBeDefined()
    await ui.press({ key: 'quiz-reveal' })
    await clock.settle()
    await ui.press({ key: 'quiz-forgot' })
    await clock.settle()
    expect(await ui.find({ type: 'Text', text: /괜찮아요, 내일 다시 볼게요/ })).toBeDefined()
    expect(await labels(ui)).toEqual(['다음 복습', '닫기'])
    expect(asNotes(stored.notes).answered).toMatchObject({ level: 0 })

    await ui.press({ key: 'study-next' })
    await clock.settle()
    expect(await ui.find({ type: 'Text', text: /"새것"/ })).toBeDefined()
    await ui.press({ key: 'quiz-reveal' })
    await clock.settle()
    await ui.press({ key: 'quiz-knew' })
    await clock.settle()
    expect(await labels(ui)).toEqual(['닫기'])
    await ui.unmount()
  })

  test('buttons answer to keys: s, v, b on the card; r, o, x and q in a review', async ($, on) => {
    const clock = mock.clock(on)
    engine(on, () => KO_REPLY, { notes: { 'make sure': note('make sure', '꼭 ~하다') } })

    await $.session.start({ cwd: '/', surface: 'terminal', isInteractive: true })
    await $.prompt.submit(typed(KO_PROMPT))
    await clock.settle()
    const ui = await $.ui.mount(WIDE)
    const hotkeys = async () => (await ui.findAll({ type: 'Button' })).map(b => b.props.hotkey)

    expect(await hotkeys()).toEqual(['s', 'v', 'b'])
    await ui.press({ key: 'study-review' })
    await clock.settle()
    expect(await hotkeys()).toEqual(['r', 'q'])
    await ui.press({ key: 'quiz-reveal' })
    await clock.settle()
    expect(await hotkeys()).toEqual(['o', 'x', 'q'])
    await ui.unmount()
  })

  test('closing a review after its answer showed, without answering, waits a day at the same interval', async ($, on) => {
    const clock = mock.clock(on)
    const stored: Record<string, unknown> = { notes: { answered: note('answered', '답한 것', { seenAt: 1, level: 1 }) } }
    engine(on, () => KO_REPLY, stored)

    await $.session.start({ cwd: '/', surface: 'terminal', isInteractive: true })
    await $.prompt.submit(typed(KO_PROMPT))
    await clock.settle()
    const ui = await $.ui.mount(WIDE)
    // 모의 시계는 0에서 시작한다.
    const now = 0

    await ui.press({ key: 'study-review' })
    await clock.settle()
    await ui.press({ key: 'quiz-reveal' })
    await clock.settle()
    await ui.press({ key: 'study-close' })
    await clock.settle()

    expect(asNotes(stored.notes).answered).toMatchObject({ level: 1, dueAt: now + DAY_MS })
    expect(await ui.find({ type: 'Button', key: 'study-review' })).toBeUndefined()
    await ui.unmount()
  })

  test('the study panel sits beside the card, stacks when narrow, and stays across prompts and finished turns', async ($, on) => {
    const clock = mock.clock(on)
    // 다른 세션에서 모아 둔 표현도 복습에 나온다. 모양이 틀린 줄은 버린다.
    engine(on, () => KO_REPLY, { notes: { 'make sure': note('make sure', '꼭 ~하다'), broken: { en: 1 } } })

    await $.session.start({ cwd: '/', surface: 'terminal', isInteractive: true })
    await $.prompt.submit(typed(KO_PROMPT))
    await clock.settle()
    const working = await $.ui.mount(WIDE)

    await working.press({ key: 'study-review' })
    await clock.settle()
    // (100 - 카드 사이 2칸) / 2
    expect((await working.find({ type: 'Box', key: 'prompt' }))?.props.width).toBe(49)
    expect((await working.find({ type: 'Box', key: 'study' }))?.props).toMatchObject({
      width: 49,
      borderStyle: 'round',
      borderDimColor: true,
      paddingX: 1,
    })
    expect(await working.find({ type: 'Text', text: /"꼭 ~하다"/ })).toBeDefined()
    // 공부 칸이 열려 있으면 카드 위쪽 버튼은 숨는다.
    expect(await working.find({ type: 'Button', key: 'study-lesson' })).toBeUndefined()
    await working.unmount()

    const narrow = await $.ui.mount({ ...WIDE, props: { ...WIDE.props, bodyColumns: 60 } })

    expect((await narrow.find({ type: 'Box', key: 'prompt' }))?.props.width).toBeUndefined()
    expect((await narrow.find({ type: 'Box', key: 'study' }))?.props.width).toBeUndefined()
    await narrow.unmount()

    await $.turn.complete(answered(ANSWER))
    await $.prompt.submit(typed('응 해줘'))
    await $.prompt.submit({ ...typed('/lingo-notes'), command: { name: 'lingo-notes', args: '' } })
    await clock.settle()
    const later = await $.ui.mount(WIDE)

    expect(await later.find({ type: 'Box', key: 'study' })).toBeDefined()
    await later.unmount()
  })

  test('학습하기 practices one pattern in two new sentences: the first helped by colors, the second alone', async ($, on) => {
    const clock = mock.clock(on)
    const stored: Record<string, unknown> = {}
    const asked = engine(on, replies(), stored)

    await $.session.start({ cwd: '/', surface: 'terminal', isInteractive: true })
    await $.prompt.submit(typed(KO_PROMPT))
    await clock.settle()
    const ui = await $.ui.mount(WIDE)
    const now = 0

    await ui.press({ key: 'study-lesson' })
    await clock.settle()
    expect(asked).toHaveLength(2)
    expect(asked[1]?.prompt).toContain('MODE: LESSON')
    // 카드에서 본 한국어와 영어를 보낸다.
    expect(asked[1]?.prompt).toContain('로그인 핸들러에서 null 체크 고쳐줘')
    expect(asked[1]?.prompt).toContain('Fix the null check in the login handler.')

    expect(await ui.find({ type: 'Text', text: /^학습하기 · 1\/2$/ })).toBeDefined()
    expect(await ui.find({ type: 'Text', text: /^a field to ~$/ })).toBeDefined()
    expect(await ui.find({ type: 'Text', text: /^영어는 꾸며 주는 말이 뒤로 가요$/ })).toBeDefined()
    // 한국어 조각마다 그 영어 조각의 색. 버튼은 정답과 다른 순서로 섞여 있고, 왼쪽부터 1, 2, 3.
    expect((await ui.find({ type: 'Text', text: /^수량$/ }))?.props.color).toBeDefined()
    const pieces = (await ui.findAll({ type: 'Button' })).filter(b => String(b.key).startsWith('piece-'))

    // 첫 조각의 대문자와 끝의 마침표는 버튼에 쓰지 않는다: 그것만 보고 순서를 맞출 수 없게.
    expect(pieces.map(b => b.props.label).sort()).toEqual(['add a button', 'the quantity', 'to change'])
    expect(pieces.map(b => b.props.label)).not.toEqual(['add a button', 'to change', 'the quantity'])
    expect(pieces.map(b => b.props.hotkey)).toEqual(['1', '2', '3'])

    await arrange(ui, clock, [0, 1, 2])
    expect(await ui.find({ type: 'Text', text: /✓ 맞았어요!/ })).toBeDefined()
    // 정답 문장의 영어 조각은 한국어 조각과 같은 색이다.
    expect((await ui.find({ type: 'Text', text: /^to change$/ }))?.props.color).toBe(
      (await ui.find({ type: 'Text', text: /^바꾸는$/ }))?.props.color,
    )
    expect(await labels(ui)).toEqual(['다음 문제', '닫기'])

    await ui.press({ key: 'study-next' })
    await clock.settle()
    expect(await ui.find({ type: 'Text', text: /^학습하기 · 2\/2$/ })).toBeDefined()
    // 두 번째 문제는 배울 점도 색도 감춘다.
    expect(await ui.find({ type: 'Text', text: /^a field to ~$/ })).toBeUndefined()
    expect(await ui.find({ type: 'Text', text: /^보고서 내려받는 링크 만들어줘$/ })).toBeDefined()

    // 순서가 틀리면 그 자리에서 끝내고 정답을 보여 준다.
    await arrange(ui, clock, [2])
    expect(await ui.find({ type: 'Text', text: /^✗ 영어는 위 순서예요$/ })).toBeDefined()
    expect(await ui.find({ type: 'Text', text: /^a field to ~$/ })).toBeDefined()
    expect(await ui.find({ type: 'Text', text: /^2문제 가운데 1개를 맞혔어요\.$/ })).toBeDefined()
    expect(await labels(ui)).toEqual(['닫기'])

    // 배울 점은 노트에 담기고, 첫 복습은 하루 뒤. 복습은 지금 풀지 않은 문장부터.
    const saved = asNotes(stored.notes)['a field to ~']

    expect(saved).toMatchObject({ ko: '~하는 칸', level: 0, dueAt: now + DAY_MS, point: { type: 'order' } })
    expect(saved?.drills?.map(d => d.ko)).toEqual([DRILLS[2]?.ko, DRILLS[3]?.ko, DRILLS[0]?.ko, DRILLS[1]?.ko])
    expect(Object.values(asStats(stored.stats))[0]).toMatchObject({ cards: 1, lessons: 1, drills: 2, drillsRight: 1 })

    // 같은 카드에서 다시 누르면 모델을 또 부르지 않고 처음부터 푼다.
    await ui.press({ key: 'study-close' })
    await clock.settle()
    await ui.press({ key: 'study-lesson' })
    await clock.settle()
    expect(asked).toHaveLength(2)
    expect(await ui.find({ type: 'Text', text: /^학습하기 · 1\/2$/ })).toBeDefined()
    await ui.unmount()
  })

  test('학습하기 says so when there is nothing to practice, and asks again only after a failed call', async ($, on) => {
    const clock = mock.clock(on)
    let lesson: string | null = JSON.stringify({ point: null })
    const asked = engine(on, prompt => (prompt.includes('MODE: LESSON') ? lesson : KO_REPLY))

    await $.prompt.submit(typed(KO_PROMPT))
    await clock.settle()
    const ui = await $.ui.mount(WIDE)
    const lessonCalls = () => asked.filter(a => a.prompt.includes('MODE: LESSON')).length

    await ui.press({ key: 'study-lesson' })
    await clock.settle()
    expect(await ui.find({ type: 'Text', text: /따로 연습할 곳을 찾지 못했어요/ })).toBeDefined()
    // 쓸 만한 문제가 없는 답에는 한 번 더 물어본다. 그래도 없으면 그 카드에서는 다시 묻지 않는다.
    expect(lessonCalls()).toBe(2)
    await ui.press({ key: 'study-close' })
    await clock.settle()
    await ui.press({ key: 'study-lesson' })
    await clock.settle()
    expect(lessonCalls()).toBe(2)
    await ui.press({ key: 'study-close' })
    await clock.settle()

    // 다음 카드에서는 호출이 실패한다. 다시 누르면 다시 부른다.
    await $.prompt.submit(typed('회원가입 버튼 색 바꿔줘'))
    await clock.settle()
    lesson = null
    await ui.press({ key: 'study-lesson' })
    await clock.settle()
    expect(await ui.find({ type: 'Text', text: /문제를 만들지 못했어요/ })).toBeDefined()
    lesson = LESSON_REPLY
    await ui.press({ key: 'study-close' })
    await clock.settle()
    await ui.press({ key: 'study-lesson' })
    await clock.settle()
    expect(lessonCalls()).toBe(4)
    expect(await ui.find({ type: 'Text', text: /^학습하기 · 1\/2$/ })).toBeDefined()
    await ui.unmount()
  })

  test('a pattern comes back as a sentence not seen before; arranging it right is recalling it', async ($, on) => {
    const clock = mock.clock(on)
    const stored: Record<string, unknown> = { notes: { 'a field to ~': pointNote() } }
    engine(on, () => KO_REPLY, stored)

    await $.session.start({ cwd: '/', surface: 'terminal', isInteractive: true })
    await $.prompt.submit(typed(KO_PROMPT))
    await clock.settle()
    const ui = await $.ui.mount(WIDE)

    await ui.press({ key: 'study-review' })
    await clock.settle()
    expect(await ui.find({ type: 'Text', text: /^복습 · / })).toBeDefined()
    expect(await ui.find({ type: 'Text', text: /^날짜 고르는 창 열어줘$/ })).toBeDefined()
    // 복습에서는 배울 점을 답한 뒤에야 보여 준다.
    expect(await ui.find({ type: 'Text', text: /^a field to ~$/ })).toBeUndefined()

    await arrange(ui, clock, [0, 1, 2])
    expect(await ui.find({ type: 'Text', text: /^a field to ~$/ })).toBeDefined()
    expect(await ui.find({ type: 'Text', text: /좋아요! 3일 뒤에 다시 볼게요/ })).toBeDefined()
    // 결과는 한 줄만: 조각 맞추기의 "맞았어요"를 겹쳐 쓰지 않는다.
    expect(await ui.find({ type: 'Text', text: /맞았어요/ })).toBeUndefined()

    const saved = asNotes(stored.notes)['a field to ~']

    expect(saved).toMatchObject({ level: 1 })
    // 낸 문장은 맨 뒤로 가서, 다음 복습에는 다른 문장이 나온다.
    expect(saved?.drills?.map(d => d.ko)).toEqual([DRILLS[3]?.ko, DRILLS[2]?.ko])
    expect(Object.values(asStats(stored.stats))[0]).toMatchObject({ reviews: 1, knew: 1 })
    await ui.unmount()
  })

  test('a wrong order in a review brings the pattern back tomorrow', async ($, on) => {
    const clock = mock.clock(on)
    const stored: Record<string, unknown> = { notes: { 'a field to ~': pointNote({ level: 2, seenAt: 1 }) } }
    engine(on, () => KO_REPLY, stored)

    await $.session.start({ cwd: '/', surface: 'terminal', isInteractive: true })
    await $.prompt.submit(typed(KO_PROMPT))
    await clock.settle()
    const ui = await $.ui.mount(WIDE)

    await ui.press({ key: 'study-review' })
    await clock.settle()
    await arrange(ui, clock, [1])
    expect(await ui.find({ type: 'Text', text: /괜찮아요, 내일 다시 볼게요/ })).toBeDefined()
    expect(asNotes(stored.notes)['a field to ~']).toMatchObject({ level: 0 })
    await ui.unmount()
  })

  test('학습 노트 hides the English and lists due notes first; a note not yet due moves only when forgotten', async ($, on) => {
    const clock = mock.clock(on)
    const stored: Record<string, unknown> = {
      notes: {
        later: note('later', '나중 것', { dueAt: 5 * DAY_MS, level: 3 }),
        due: note('due', '지금 것', { level: 1, seenAt: 1 }),
        weak: note('weak', '약한 것', { dueAt: 3 * DAY_MS }),
      },
    }
    engine(on, () => KO_REPLY, stored)

    await $.session.start({ cwd: '/', surface: 'terminal', isInteractive: true })
    await $.prompt.submit(typed(KO_PROMPT))
    await clock.settle()
    const ui = await $.ui.mount(WIDE)
    const now = 0

    await ui.press({ key: 'study-list' })
    await clock.settle()
    expect(await ui.find({ type: 'Text', text: /^학습 노트 · 4개$/ })).toBeDefined()
    // 복습할 때가 된 것, 그다음은 덜 익힌 것부터. 영어는 보이지 않는다.
    const picks = (await ui.findAll({ type: 'Button' })).filter(b => String(b.key).startsWith('note-'))

    expect(picks.map(b => b.props.label)).toEqual(['지금 것', 'null 여부 확인', '약한 것', '나중 것'])
    expect(picks.map(b => b.props.hotkey)).toEqual(['1', '2', '3', '4'])
    expect(await ui.find({ type: 'Text', text: /^(due|later|weak)$/ })).toBeUndefined()

    // 아직 때가 아닌 표현을 떠올렸으면 일정은 그대로.
    await ui.press({ key: 'note-3' })
    await clock.settle()
    expect(await ui.find({ type: 'Text', text: /^연습 · / })).toBeDefined()
    await ui.press({ key: 'quiz-reveal' })
    await clock.settle()
    await ui.press({ key: 'quiz-knew' })
    await clock.settle()
    expect(await ui.find({ type: 'Text', text: /복습 날은 그대로예요/ })).toBeDefined()
    expect(asNotes(stored.notes).later).toMatchObject({ level: 3, dueAt: 5 * DAY_MS })

    // 못 떠올렸으면 내일로 당긴다. 간격(칸)은 그대로.
    await ui.press({ key: 'study-next' })
    await clock.settle()
    await ui.press({ key: 'note-3' })
    await clock.settle()
    await ui.press({ key: 'quiz-reveal' })
    await clock.settle()
    await ui.press({ key: 'quiz-forgot' })
    await clock.settle()
    expect(asNotes(stored.notes).later).toMatchObject({ level: 3, dueAt: now + DAY_MS })
    expect(Object.values(asStats(stored.stats))[0]).toMatchObject({ practices: 2, reviews: 0 })
    await ui.unmount()
  })

  test('/lingo-notes opens a pane with the English hidden, closed by Esc; picking a note quizzes it above the prompt', async ($, on) => {
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

    const pane = (surface: 'terminal' | 'desktop') =>
      $.ui.mount({
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

    for (const surface of ['terminal', 'desktop'] as const) {
      const ui = await pane(surface)

      expect(await ui.find({ type: 'Text', text: /모두 1개 · 지금 복습할 것 0개/ })).toBeDefined()
      expect((await ui.find({ type: 'Button', key: 'pane-note-0' }))?.props.label).toBe('null 여부 확인')
      expect(await ui.find({ type: 'Text', text: /내일 복습/ })).toBeDefined()
      expect(await ui.find({ type: 'Text', text: /null check/ })).toBeUndefined()
      await ui.unmount()
    }

    const ui = await pane('terminal')

    await ui.press({ key: 'pane-note-0' })
    await clock.settle()
    await ui.unmount()
    const band = await $.ui.mount(WIDE)

    expect(await band.find({ type: 'Text', text: /^연습 · 오늘 본 표현$/ })).toBeDefined()
    expect(await band.find({ type: 'Text', text: /"null 여부 확인" — 영어로 떠올려 보세요/ })).toBeDefined()
    await band.unmount()
  })

  test("/lingo-notes lists every note, scrolls through them, and sums up the week's study", async ($, on) => {
    const clock = mock.clock(on)
    const many = Array.from({ length: 30 }, (_, i) => note(`phrase ${i}`, `뜻 ${i}`, { dueAt: i * DAY_MS }))
    const day = (fields: Partial<DayStats>): DayStats => ({
      cards: 0,
      lessons: 0,
      drills: 0,
      drillsRight: 0,
      reviews: 0,
      knew: 0,
      longReviews: 0,
      longKnew: 0,
      practices: 0,
      ...fields,
    })
    engine(on, () => KO_REPLY, {
      notes: Object.fromEntries(many.map(n => [n.en, n])),
      // 오늘(20일째)과 그 전날. 10일 전 기록은 최근 7일에 들지 않는다.
      stats: {
        '20': day({ reviews: 3, knew: 3, longReviews: 3, longKnew: 2 }),
        '19': day({ reviews: 2, knew: 2, longReviews: 2, longKnew: 2 }),
        '10': day({ reviews: 9 }),
      },
    })

    await clock.advance(20 * DAY_MS)
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
    expect((await ui.find({ type: 'Button', key: 'pane-note-29' }))?.props.label).toBe('뜻 29')
    expect(await ui.find({ type: 'Text', text: /^최근 7일: 2일 공부 · 복습 5번 · 3일 넘게 지난 복습 기억률 80%$/ })).toBeDefined()
    await ui.unmount()
  })
})

describe('local helpers', () => {
  /** /lingo-notes 패널의 글 줄들 */
  const paneTexts = (notes: Notes, now: number) =>
    notesPaneRows(notes, {}, now, () => undefined).map(r => ('text' in r ? r.text : ''))

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
    expect(paneTexts(notes, 10)).toContain('새 표현 5개를 다 모았어요. 하루가 지나면 다시 모아요.')
    // 24시간이 지나면 다시 모은다.
    expect(Object.keys(addPhrases(notes, [phrase('p5')], DAY_MS + 5))).toContain('p5')

    const due: Notes = Object.fromEntries(Array.from({ length: 10 }, (_, i) => [`d${i}`, note(`d${i}`, '밀림', { dueAt: 0 })]))

    expect(intake(due, DAY_MS)).toBe('backlog')
    expect(addPhrases(due, [phrase('new')], DAY_MS)).toBe(due)
    expect(paneTexts(due, DAY_MS)).toContain(
      '복습할 표현이 10개 이상 쌓여서, 새 표현은 잠시 모으지 않아요.',
    )
    expect(intake({}, 0)).toBe('open')
  })

  /** 학습하기 답 하나. 문제마다 [한국어, [한국어 조각, 영어 조각]...] */
  const lessonReply = (point: unknown, ...drills: [string, ...[string, string][]][]) =>
    JSON.stringify({ point, drills: drills.map(([ko, ...parts]) => ({ ko, parts: parts.map(([k, en]) => ({ ko: k, en })) })) })
  const ORDER = { type: 'order', ko: '~하는 칸', en: 'a field to ~' }
  const GOOD: [string, ...[string, string][]] = ['날짜 고르는 창 열어줘', ['창 열어줘', 'Open a window'], ['고르는', 'to pick'], ['날짜', 'a date.']]

  test('a lesson keeps only drills with one right order: 3 or 4 pieces, English order, nothing that could move', async () => {
    const reply = lessonReply(
      ORDER,
      GOOD,
      // 끝의 "."만 든 조각은 앞 조각에 붙는다.
      ['보고서 내려받는 링크 만들어줘', ['링크 만들어줘', 'Make a link'], ['내려받는', 'to download'], ['보고서', 'the report'], ['', '.']],
      // 조각이 둘뿐이면 순서가 뻔하다.
      ['버튼 만들어줘', ['버튼', 'Make a button'], ['만들어줘', 'now.']],
      // 문장 앞으로도 갈 수 있는 조각("in three lines")은 맞는 순서가 둘이다.
      ['세 줄로 회의록 요약해줘', ['요약해줘', 'Summarize'], ['회의록', 'the notes'], ['세 줄로', 'in three lines.']],
      // only는 여러 자리에 올 수 있다.
      ['실패한 테스트만 돌려줘', ['돌려줘', 'Rerun'], ['테스트만', 'only the tests'], ['실패한', 'that failed.']],
      // 한국어 순서로 준 조각: 첫 조각이 문장의 첫머리가 아니다.
      ['답장 줄여줘', ['답장', 'a reply'], ['고객에게', 'to the customer'], ['줄여줘', 'shorten']],
      // 똑같은 조각이 둘이면 어느 쪽을 먼저 놓아도 맞는다.
      ['그거 그거 해줘', ['해줘', 'Do it'], ['그거', 'the thing'], ['그거', 'the thing']],
      // 카드에서 본 문장과 같으면 새 문제가 아니다. 띄어쓰기와 끝 문장 부호는 무시한다.
      ['로그인 핸들러에서 null 체크 고쳐줘.', ['고쳐줘', 'Fix'], ['null 체크', 'the null check'], ['로그인 핸들러에서', 'in the login handler.']],
    )
    const lesson = parseLesson(reply, '로그인 핸들러에서  null 체크 고쳐줘')

    expect(lesson?.point).toEqual({ ...ORDER, hint: '영어는 꾸며 주는 말이 뒤로 가요' })
    expect(lesson?.drills.map(drillSentence)).toEqual(['Open a window to pick a date.', 'Make a link to download the report.'])
  })

  test('a lesson needs a point that is an order or a chunk in real words, and a chunk must be in its drills', async () => {
    const chunk = { type: 'chunk', ko: '~있으면 알려줘', en: 'Tell me if ~' }
    const withChunk = parseLesson(
      lessonReply(chunk, ['빌드 깨지면 알려줘', ['알려줘', 'Tell me if'], ['빌드', 'the build'], ['깨지면', 'breaks.']], GOOD),
      '',
    )

    expect(withChunk?.drills.map(d => d.ko)).toEqual(['빌드 깨지면 알려줘'])
    expect(withChunk?.point.hint).toBe('이 말은 한 덩어리로 기억해요')
    // 낱말 고르기는 맞는 답이 여럿이라 다루지 않는다.
    expect(parseLesson(lessonReply({ ...ORDER, type: 'word' }, GOOD), '')).toBeNull()
    // "[명사] + [설명]" 같은 꼬리표는 학습자에게 보여 줄 수 없다.
    expect(parseLesson(lessonReply({ ...ORDER, ko: '[명사] + [설명]' }, GOOD), '')).toBeNull()
    expect(parseLesson(lessonReply(null, GOOD), '')).toBeNull()
    expect(parseLesson(lessonReply(ORDER), '')).toBeNull()
    expect(parseLesson('not json', '')).toBeNull()
  })

  test('piece buttons hide the capital and the full stop that would give the order away', async () => {
    expect(pieceLabel('Add a button', true)).toBe('add a button')
    expect(pieceLabel('the report.', false)).toBe('the report')
    expect(pieceLabel('Can you check', true)).toBe('can you check')
    expect(pieceLabel('API docs?', true)).toBe('API docs')
    expect(pieceLabel('I made yesterday.', false)).toBe('I made yesterday')
    expect(pieceLabel('Minji sent', false)).toBe('Minji sent')
  })

  test('arranging: pieces come shuffled, the right next piece is placed, any other ends the drill', async () => {
    const drill = parseLesson(lessonReply(ORDER, GOOD), '')?.drills[0]

    if (drill === undefined) {
      throw new Error('no drill')
    }

    // 어떤 seed로 섞어도 정답 순서 그대로는 내지 않는다. 같은 seed는 같은 순서다.
    for (let seed = 0; seed < 50; seed++) {
      expect(startArrange(drill, true, seed).shown).not.toEqual([0, 1, 2])
      expect([...startArrange(drill, true, seed).shown].sort()).toEqual([0, 1, 2])
    }
    expect(startArrange(drill, true, 7).shown).toEqual(startArrange(drill, true, 7).shown)

    const start = startArrange(drill, true, 1)
    const one = pickPiece(start, 0)

    expect(one).toMatchObject({ placed: 1, result: null })
    expect(piecesLeft(one)).toEqual(start.shown.filter(i => i !== 0))
    expect(pickPiece(one, 0)).toBe(one)
    expect(pickPiece(one, 2)).toMatchObject({ placed: 1, result: 'wrong' })
    expect(pickPiece(pickPiece(one, 1), 2)).toMatchObject({ placed: 3, result: 'right' })

    const over = pickPiece(one, 2)

    expect(pickPiece(over, 1)).toBe(over)
  })

  test('a studied pattern enters the notes even past the daily limit, due a day later, and studying it again adds drills', async () => {
    const lesson = parseLesson(
      lessonReply(ORDER, GOOD, ['보고서 내려받는 링크 만들어줘', ['링크 만들어줘', 'Make a link'], ['내려받는', 'to download'], ['보고서', 'the report.']]),
      '',
    )

    if (lesson === null) {
      throw new Error('no lesson')
    }

    // 복습할 표현이 10개 넘게 밀려 있어도, 학습자가 직접 연습한 배울 점은 담는다.
    const backlog: Notes = Object.fromEntries(Array.from({ length: 10 }, (_, i) => [`d${i}`, note(`d${i}`, '밀림')]))
    const added = addPoint(backlog, lesson, drillsForReview(lesson.drills), 100)

    expect(added['a field to ~']).toMatchObject({ en: 'a field to ~', ko: '~하는 칸', level: 0, dueAt: 100 + DAY_MS })
    // 지금 푼 두 문제는 복습 때 맨 뒤에 나온다.
    expect(drillsForReview([1, 2, 3, 4].map(i => ({ ko: `${i}`, parts: [] }))).map(d => d.ko)).toEqual(['3', '4', '1', '2'])

    // 이미 있는 배울 점은 새 문제만 더하고, 복습 날이 늦으면 하루 뒤로 당긴다. 간격(칸)은 그대로.
    const later: Notes = { 'a field to ~': { ...(added['a field to ~'] as Note), level: 3, dueAt: 30 * DAY_MS } }
    const again = addPoint(later, { ...lesson, drills: [{ ko: '새 문장', parts: [] }] }, [{ ko: '새 문장', parts: [] }], DAY_MS)

    expect(again['a field to ~']).toMatchObject({ level: 3, dueAt: 2 * DAY_MS })
    expect(again['a field to ~']?.drills?.map(d => d.ko)).toEqual(['새 문장', '날짜 고르는 창 열어줘', '보고서 내려받는 링크 만들어줘'])
    expect(rotateDrills(again, 'a field to ~')['a field to ~']?.drills?.[0]?.ko).toBe('날짜 고르는 창 열어줘')
  })

  test('practicing a note before it is due changes nothing when recalled, and pulls it to tomorrow when not', async () => {
    const notes: Notes = { later: note('later', '나중', { level: 3, dueAt: 10 * DAY_MS }), due: note('due', '지금', { level: 1 }) }

    expect(practiceNote(notes, 'later', true, DAY_MS)).toEqual({ notes, days: null })
    expect(practiceNote(notes, 'later', false, DAY_MS)).toMatchObject({ days: 1, notes: { later: { level: 3, dueAt: 2 * DAY_MS } } })
    // 복습할 때가 된 표현을 골랐으면 복습과 같다.
    expect(practiceNote(notes, 'due', true, DAY_MS)).toMatchObject({ days: 7, notes: { due: { level: 2 } } })
    expect(practiceNote(notes, 'gone', true, DAY_MS)).toEqual({ notes, days: null })
  })

  test('the notes list shows due notes first, then the least learned', async () => {
    const notes: Notes = {
      strong: note('strong', '익힌 것', { level: 4, dueAt: 2 * DAY_MS }),
      weak: note('weak', '약한 것', { level: 0, dueAt: 3 * DAY_MS }),
      due2: note('due2', '나중에 된 것', { dueAt: 5 }),
      due1: note('due1', '먼저 된 것', { dueAt: 1 }),
    }

    expect(studyOrder(notes, 10).map(([id]) => id)).toEqual(['due1', 'due2', 'weak', 'strong'])
  })

  test('notes keep a pattern and its drills, and drop only broken lesson fields', async () => {
    const point = { type: 'order', ko: '~하는 칸', en: 'a field to ~', hint: '영어는 꾸며 주는 말이 뒤로 가요' }
    const drills = [{ ko: '창 열어줘', parts: [{ ko: '창', en: 'Open a window' }] }]
    const read = asNotes({
      good: note('good', '좋은 것', { point, drills } as Partial<Note>),
      badPoint: { ...note('bad', '틀린 것'), point: { type: 'word' }, drills },
      badDrills: { ...note('bad2', '틀린 것'), point, drills: [{ ko: 1 }] },
    })

    expect(read.good).toMatchObject({ point, drills })
    expect(read.badPoint).not.toHaveProperty('point')
    expect(read.badDrills).not.toHaveProperty('drills')
    expect(Object.keys(read)).toEqual(['good', 'badPoint', 'badDrills'])
  })

  test('daily stats add up per day, keep 400 days, and sum the last 7 days', async () => {
    let stats = bump({}, 0, { cards: 1 })

    stats = bump(stats, 1000, { ...reviewed(true, 5), cards: 1 })
    stats = bump(stats, DAY_MS, reviewed(false, 1))

    expect(stats['0']).toMatchObject({ cards: 2, reviews: 1, knew: 1, longReviews: 1, longKnew: 1 })
    expect(stats['1']).toMatchObject({ reviews: 1, knew: 0, longReviews: 0 })
    expect(lastWeek(stats, DAY_MS)).toMatchObject({ studyDays: 2, reviews: 2, cards: 2 })
    expect(lastWeek(stats, 8 * DAY_MS)).toMatchObject({ studyDays: 0, reviews: 0 })
    // 400일째에는 0일째 기록이 지워지고 1일째부터 남는다.
    expect(Object.keys(bump(stats, 400 * DAY_MS, {}))).toEqual(['1', '400'])
    expect(asStats({ '3': { cards: 1 }, x: stats['0'], '4': stats['0'] })).toEqual({ '4': stats['0'] })
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
