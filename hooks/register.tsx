// hellolingo
// 프롬프트 위 영역에 영어 학습 레이어를 고정해 둔다. 왼쪽에는 내가 마지막으로 보낸 프롬프트의 카드:
//  - 한국어 프롬프트: 영어 문장과 내 한국어 문장 (같은 뜻의 조각에 같은 색) + 핵심 표현 1개
//  - 영어 프롬프트: 틀린 부분 → 고친 부분 (없으면 더 자연스러운 표현 1개)
// 새 프롬프트를 보내도 카드는 지우지 않는다: 새 카드가 준비될 때까지 이전 카드를 그대로 둔다.
// 카드의 핵심 표현은 표현 노트에 모은다. 공부는 학습자가 카드 위쪽의 버튼을 눌렀을 때만 한다.
// 그동안은 카드 자리에 공부 칸만 보이고, 닫으면 카드가 돌아온다:
//  - 학습하기: 이 문장에서 한국어 사용자가 막히는 한 곳을 같은 틀의 새 문장 2개로 조각 맞추기
//  - 복습: 복습할 때가 된 표현을 차례로 떠올리기
//  - 학습 노트: 모은 표현을 영어를 가린 채 보고, 골라서 떠올리기
// /lingo-notes 로 노트 전체를 패널에서 본다. 본 작업(프롬프트, 응답, 코드)은 건드리지 않는다.

import { atom, read, update } from 'claude-code'
import type { ElementTable, EngineInterface, PromptSubmitInput, Register } from 'claude-code'

import type { Arrange, Card, DayStats, Layer, Lesson, Note, Notes, Phrase, SentenceMap, Stats, Study } from '../types'
import { isKorean, notNull, parseCard, segments } from './cards'
import type { Segment } from './cards'
import { DRILLS_NOW, drillsForReview, parseLesson, pickPiece, piecesLeft, startArrange } from './lessons'
import {
  DAY_MS,
  MAX_DUE,
  NEW_PER_DAY,
  addPhrases,
  addPoint,
  answerNote,
  asNotes,
  dueCount,
  intake,
  markShown,
  nextDrill,
  noteId,
  passOver,
  pickDue,
  practiceNote,
  rotateDrills,
  studyOrder,
} from './notes'
import { EFFORT, MODEL, SYSTEM, cardPrompt, lessonPrompt } from './prompts'
import { asStats, bump, lastWeek, reviewed } from './stats'

const layer = atom({ plugin: 'hellolingo', key: 'layer' } as const, { card: null, cardSeq: 0, pendingSeq: null })
const study = atom({ plugin: 'hellolingo', key: 'study' } as const, null)
// 표현 노트와 학습 기록은 $.store에 두고(세션이 바뀌어도 남는다), 여기는 화면을 그리기 위한 사본이다.
const notesView = atom({ plugin: 'hellolingo', key: 'notes' } as const, {})
const statsView = atom({ plugin: 'hellolingo', key: 'stats' } as const, {})

const NOTES_KEY = 'notes'
const STATS_KEY = 'stats'
const NOTES_PANE = 'lingo-notes'

const MIN_CHARS = 10
const MAX_INPUT_CHARS = 1500 // 긴 붙여넣기는 앞부분만 보낸다 (비용)
const MAX_TOKENS = 800 // 짝짓기까지 담은 JSON이 잘리지 않게
const LESSON_MAX_TOKENS = 1500 // 배울 점과 문제 5개
const LESSON_ATTEMPTS = 2 // 쓸 만한 문제가 없는 답이 오면 한 번 더 부른다
const TIMEOUT_MS = 20_000
const LIST_ROWS = 8 // 공부 칸의 노트 목록에 보이는 표현 수. 숫자 키 1~8로 고른다
// 카드 테두리. 이모지는 터미널마다 폭을 다르게 세서 테두리를 어긋나게 하니, 카드 안에는 쓰지 않는다.
const CARD_BORDER = 'round'

// 사람이 직접 입력한 프롬프트만. 알림, 예약 작업, 다른 세션 메시지 등은 건너뛴다.
const USER_ORIGINS: ReadonlySet<string> = new Set(['composer', 'bridge', 'unclassified'])

// 프롬프트를 보낼 때마다 올라간다. 늦게 도착한 이전 결과가 새 카드를 덮지 않게 한다.
let seq = 0

// 공부 칸을 열거나 다음 문제로 넘어갈 때마다 올라간다. 늦게 온 결과나 두 번 누른 버튼이 다른 칸을 건드리지 않게 한다.
let studySeq = 0

// 한 세션 안의 저장소 쓰기를 차례로 줄 세운다.
let persisting: Promise<unknown> = Promise.resolve()

// 카드마다 만든 학습하기. 같은 카드에서 다시 눌러도 모델을 또 부르지 않는다. null은 만들지 못한 것.
const lessons = new Map<number, Lesson | null>()
const MAX_CACHED_LESSONS = 5

// 카드마다 지금 만드는 중인 학습하기. 화면이 바뀌기 전에 두 번 눌러도 모델은 한 번만 부른다.
const making = new Map<number, Promise<Lesson | null>>()

// 답을 저장하는 중인 공부 칸 번호. 저장이 끝나기 전에 또 눌러도 한 번만 반영한다.
const answering = new Set<number>()

export const register: Register = on => {
  on('session.start', async ($, e, next) => {
    try {
      await $.command.register({ name: 'lingo-notes', description: '영어 표현 노트를 패널에 보여줘요' })
      await loadStore($)
    } catch {
      // 노트를 못 읽어도 카드는 그대로 동작한다.
    }

    return next(e)
  })

  on('command.run', { command: 'lingo-notes' }, async $ => {
    // 다른 세션이 그사이 모은 표현도 보이게 저장소에서 다시 읽는다.
    await loadStore($)
    // 빈 입력창에서 Esc를 누르면 닫힌다. 없으면 마우스로 ✕를 눌러야만 닫혀서.
    await $.ui.open({ id: NOTES_PANE, title: '표현 노트', closeOnEscape: true })

    return { text: '영어 표현 노트를 열었어요.' }
  })

  on('ui.render', { component: 'Pane', requestId: NOTES_PANE }, async ($, e) => {
    const el = $.ui.resolve(e)
    const now = await $.clock.now()
    const rows = notesPaneRows(await read($, notesView), await read($, statsView), now, id => void openNote($, id))

    // 노트가 패널보다 길면 패널이 스크롤한다. 잘라 내면 뒤쪽 노트는 볼 수 없다.
    return <el.Box flexDirection="column">{drawRows(el, rows)}</el.Box>
  })

  on('prompt.submit', async ($, e, next) => {
    const mine = ++seq

    try {
      const text = learnableText(e)

      if (text !== null) {
        await update($, layer, l => ({ ...l, pendingSeq: mine }))
        // 모델 호출은 타이머로 넘겨서, 프롬프트 전송을 기다리게 하지 않는다.
        $.clock.after(0, () => {
          void translate($, text, mine)
        })
      }
    } catch {
      // 학습 기능이 실패해도 본 작업은 그대로 진행한다.
    }

    return next(e)
  })
    // 훅이 어떤 이유로든 실패하면 프롬프트는 원래대로 보낸다.
    .catch(($, e, next) => next(e))

  on('ui.render', { component: 'AbovePrompt' }, async ($, e, next) => {
    if (e.props.hasSurvey) {
      return next(e)
    }

    const { card, pendingSeq } = await read($, layer)
    const open = await read($, study)
    const notes = await read($, notesView)
    const now = await $.clock.now()
    // 한 번에 한 칸만 보인다. 공부 칸이 열려 있으면 카드는 숨긴다: 볼 것이 하나라야 쉽고,
    // 카드의 영어 문장이 옆에 보이면 혼자 맞추는 문제의 답을 미리 알려 준다. 닫으면 카드가 돌아온다.
    const panel =
      open !== null
        ? { key: 'study', rows: studyRows(open, notes, now, actions($, open.id)) }
        : card !== null
          ? {
              key: 'prompt',
              rows: [
                ...(pendingSeq === null ? [] : [NEWER_PENDING_ROW]),
                ...cardRows(
                  card,
                  headerButtons(card, notes, now, {
                    lesson: () => void openLesson($),
                    review: () => void openReview($),
                    list: () => void openList($),
                  }),
                ),
              ],
            }
          : pendingSeq !== null
            ? { key: 'prompt', rows: pendingRows() }
            : null

    if (panel === null) {
      return next(e)
    }

    const el = $.ui.resolve(e)
    const { Box } = el
    // 같은 자리를 쓰는 다른 mod나 Claude Code 자체의 내용도 함께 보이게 아래에 붙인다.
    const below = await next(e)

    // 둥근 테두리를 둘러서 터미널의 다른 내용과 구분되게 한다.
    return (
      <Box flexDirection="column">
        <Box key={panel.key} flexDirection="column" borderStyle={CARD_BORDER} borderDimColor paddingX={1} marginBottom={1}>
          {drawRows(el, panel.rows)}
        </Box>
        {below}
      </Box>
    )
  })
    // 그리기가 실패하면 원래 화면을 그대로 둔다.
    .catch(($, e, next) => next(e))
}

/** 사람이 직접 입력한 프롬프트인지. 슬래시 명령, 숨은 메시지, 자동 메시지는 아니다. */
function isPersonPrompt(e: PromptSubmitInput): boolean {
  return e.command === undefined && e.isMeta !== true && USER_ORIGINS.has(e.origin.kind)
}

/** 학습 대상이 아니면 null, 맞으면 모델에 보낼 텍스트 */
function learnableText(e: PromptSubmitInput): string | null {
  if (!isPersonPrompt(e)) {
    return null
  }

  // 붙여넣은 코드 블록은 빼고 문장만 본다. 줄바꿈은 남긴다: 붙여넣은 로그·커밋 정보는 보통 제 줄에
  // 있어서, 모델이 그것과 내 문장(영어 낱말·브랜치 이름이 섞여 있어도)을 가려낼 수 있게.
  const text = e.text
    .replace(/```[\s\S]*?```/g, '\n')
    .replace(/[^\S\n]+/g, ' ')
    .replace(/ *\n\s*/g, '\n')
    .trim()

  if (text.length < MIN_CHARS) {
    return null
  }

  return text.length > MAX_INPUT_CHARS ? text.slice(0, MAX_INPUT_CHARS) : text
}

/**
 * 프롬프트(번호 `mine`)를 카드로 만든다. 실패하면 이전 카드를 그대로 둔다.
 * 노트에는 화면에 나온 카드의 표현만 모은다: 더 새 카드가 먼저 나와 묻힌 카드는 본 적이 없으니.
 */
async function translate($: EngineInterface, text: string, mine: number): Promise<void> {
  const made = await makeCard($, text).catch(() => null)
  let isShown = false

  try {
    await update($, layer, l => {
      const changed = settled(l, mine, made)

      isShown = made !== null && changed.card === made

      return changed
    })

    if (made !== null && isShown) {
      await savePhrases($, cardPhrases(made))
      await changeStats($, { cards: 1 })
    }
  } catch {
    // 노트를 못 써도 카드는 그대로 보인다.
  }
}

async function makeCard($: EngineInterface, text: string): Promise<Card | null> {
  const korean = isKorean(text)
  const r = await $.model.complete({
    model: MODEL,
    system: SYSTEM,
    prompt: cardPrompt(korean, text),
    maxTokens: MAX_TOKENS,
    effort: EFFORT,
    timeoutMs: TIMEOUT_MS,
  })

  return r.isAnswered ? parseCard(korean, r.text, text) : null
}

/**
 * 프롬프트 `mine`의 호출이 끝났을 때의 레이어. 만든 카드는 지금 카드보다 새 프롬프트의 것일 때만 바꿔 단다.
 * 옮기는 중 표시는 그 프롬프트가 아직 가장 최근 것일 때만 거둔다.
 */
function settled(l: Layer, mine: number, made: Card | null): Layer {
  const isNewer = made !== null && mine >= l.cardSeq

  return {
    card: isNewer ? made : l.card,
    cardSeq: isNewer ? mine : l.cardSeq,
    pendingSeq: l.pendingSeq === mine ? null : l.pendingSeq,
  }
}

/**
 * 카드에서 노트에 모을 것: 핵심 표현만. 문법 연결은 영어 쪽이 "동사로 시작" 같은 한국어 설명일 때가 많고,
 * 한 어미에 맞는 영어가 여럿이라 퀴즈로 내지 않는다.
 */
function cardPhrases(c: Card): readonly Phrase[] {
  switch (c.kind) {
    case 'ko':
      return c.phrases
    case 'en-natural':
      return [c.phrase]
    case 'en-fix':
      return []
  }
}

/**
 * 저장소의 값 하나를 바꾼다. 다른 세션이 쓴 것까지 담긴 최신 값에 `change`를 적용해 저장하고,
 * 화면용 사본도 맞춘다. `change`는 바뀐 값과 함께 호출한 쪽에 돌려줄 값을 준다.
 */
function changeStored<V, T>(
  $: EngineInterface,
  key: string,
  parse: (v: unknown) => V,
  view: (v: V) => Promise<unknown>,
  change: (value: V, now: number) => [V, T],
): Promise<T> {
  const run = persisting.then(async () => {
    const now = await $.clock.now()
    const stored = parse(await $.store.get(key))
    const [changed, result] = change(stored, now)

    if (changed !== stored) {
      await $.store.set(key, changed)
    }

    await view(changed)

    return result
  })

  // 한 번 실패해도 다음 쓰기는 이어지게.
  persisting = run.catch(() => undefined)

  return run
}

function changeNotes<T>($: EngineInterface, change: (notes: Notes, now: number) => [Notes, T]): Promise<T> {
  return changeStored($, NOTES_KEY, asNotes, notes => update($, notesView, () => notes), change)
}

/** 오늘 학습 기록에 더한다. 기록을 못 써도 학습은 그대로 이어진다. */
async function changeStats($: EngineInterface, add: Partial<DayStats>): Promise<void> {
  await changeStored($, STATS_KEY, asStats, stats => update($, statsView, () => stats), (stats: Stats, now) => [
    bump(stats, now, add),
    undefined,
  ]).catch(() => undefined)
}

/** 저장소의 노트와 기록을 화면용 사본으로 읽어 온다. */
async function loadStore($: EngineInterface): Promise<void> {
  await changeNotes($, notes => [notes, undefined])
  await changeStored($, STATS_KEY, asStats, stats => update($, statsView, () => stats), stats => [stats, undefined])
}

async function savePhrases($: EngineInterface, phrases: readonly Phrase[]): Promise<void> {
  if (phrases.length > 0) {
    await changeNotes($, (notes, now) => [addPhrases(notes, phrases, now), undefined])
  }
}

/** 공부 칸을 새로 연다. 번호가 바뀌어서, 이전 칸을 노린 늦은 결과는 무시된다. */
async function setStudy($: EngineInterface, make: (id: number) => Study | null): Promise<number> {
  const id = ++studySeq

  await update($, study, () => make(id))

  return id
}

/** 지금 공부 칸이 `id`이면 바꾼다. 그사이 다른 칸이 열렸으면 그대로 둔다. */
async function changeStudy($: EngineInterface, id: number, change: (s: Study) => Study): Promise<void> {
  await update($, study, s => (s !== null && s.id === id ? change(s) : s))
}

/** 학습하기: 카드의 문장에서 배울 한 곳을 같은 틀의 새 문장으로 연습한다. 문제는 그때 한 번 모델로 만든다. */
async function openLesson($: EngineInterface): Promise<void> {
  try {
    const { card, cardSeq } = await read($, layer)

    if (card?.kind !== 'ko') {
      return
    }

    const id = await setStudy($, id => ({ id, view: 'making' }))

    void changeStats($, { lessons: 1 })

    const lesson = lessons.has(cardSeq) ? (lessons.get(cardSeq) ?? null) : await lessonFor($, card, cardSeq)

    if (lesson === null) {
      await changeStudy($, id, s => ({ id: s.id, view: 'no-lesson', reason: lessons.has(cardSeq) ? 'none' : 'failed' }))

      return
    }

    // 만드는 사이 학습자가 칸을 닫았거나 다른 칸을 열었으면, 보지 않은 문제이니 노트에 담지 않는다.
    if ((await read($, study))?.id !== id) {
      return
    }

    // 학습자가 직접 고른 배울 점이라 노트에 담는다. 복습 때는 지금 풀지 않은 문장부터 낸다.
    await changeNotes($, (notes, now) => [addPoint(notes, lesson, drillsForReview(lesson.drills), now), undefined]).catch(
      () => undefined,
    )

    const drills = lesson.drills.slice(0, DRILLS_NOW)
    const first = drills[0]

    if (first !== undefined) {
      await changeStudy($, id, s => ({
        id: s.id,
        view: 'lesson',
        point: lesson.point,
        drills,
        step: 0,
        arrange: startArrange(first, true, s.id),
        rights: 0,
      }))
    }
  } catch {
    // 학습하기가 실패해도 카드와 본 작업은 그대로다. 만드는 중으로 멈춰 있지 않게 알린다.
    await update($, study, (s): Study | null => (s?.view === 'making' ? { id: s.id, view: 'no-lesson', reason: 'failed' } : s)).catch(
      () => undefined,
    )
  }
}

/** 이 카드의 학습하기를 만든다. 이미 만드는 중이면 그 결과를 함께 기다린다. 실패하면 null. */
function lessonFor($: EngineInterface, card: SentenceMap, cardSeq: number): Promise<Lesson | null> {
  const inFlight = making.get(cardSeq)

  if (inFlight !== undefined) {
    return inFlight
  }

  const made = makeLesson($, card, cardSeq)
    .catch(() => null)
    .finally(() => making.delete(cardSeq))

  making.set(cardSeq, made)

  return made
}

/**
 * 모델로 학습하기를 만든다. 답을 받았으면 (배울 점이 없더라도) 카드별로 기억해서 다시 부르지 않는다.
 * 호출이 실패했으면 기억하지 않는다: 다시 누르면 다시 부른다.
 * 답은 받았는데 쓸 만한 문제가 없으면 한 번 더 부른다. haiku는 같은 요청에도 답이 흔들려서,
 * 한 번 실패한 문장도 다시 부르면 대개 문제가 나온다. 학습자에게 "없어요"를 보이기 전에 한 번만 더 묻는다.
 */
async function makeLesson($: EngineInterface, card: SentenceMap, cardSeq: number): Promise<Lesson | null> {
  const korean = card.original ?? ''
  let lesson: Lesson | null = null

  for (let attempt = 0; attempt < LESSON_ATTEMPTS && lesson === null; attempt++) {
    const r = await $.model.complete({
      model: MODEL,
      system: SYSTEM,
      prompt: lessonPrompt(korean, card.english),
      maxTokens: LESSON_MAX_TOKENS,
      effort: EFFORT,
      timeoutMs: TIMEOUT_MS,
    })

    if (!r.isAnswered) {
      return null
    }

    lesson = parseLesson(r.text, korean)
  }

  lessons.set(cardSeq, lesson)

  for (const old of lessons.keys()) {
    if (lessons.size > MAX_CACHED_LESSONS) {
      lessons.delete(old)
    }
  }

  return lesson
}

/** 복습: 복습할 때가 된 표현 하나를 낸다. 없으면 다 했다고 알린다. */
async function openReview($: EngineInterface): Promise<void> {
  try {
    await leaveQuiz($)

    const picked = await changeNotes($, (notes, now) => {
      const note = pickDue(notes, now)

      return note === null ? [notes, null] : [markShown(notes, noteId(note.en), now), { note, now, notes }]
    })

    await setStudy($, id => (picked === null ? { id, view: 'all-done' } : quizOf(id, picked.note, 'review', picked.now)))
  } catch {
    // 복습을 못 열어도 카드와 본 작업은 그대로다.
  }
}

/** 노트 목록에서 고른 표현을 떠올린다. 복습할 때가 됐으면 복습, 아니면 연습이다. */
async function openNote($: EngineInterface, id: string): Promise<void> {
  try {
    await leaveQuiz($)

    const picked = await changeNotes($, (notes, now) => {
      const note = notes[id]

      return note === undefined ? [notes, null] : [notes, { note, now }]
    })

    if (picked !== null) {
      const mode = picked.note.dueAt <= picked.now ? 'review' : 'practice'

      await setStudy($, sid => quizOf(sid, picked.note, mode, picked.now))
    }
  } catch {
    // 고른 표현을 못 열어도 카드와 본 작업은 그대로다.
  }
}

async function openList($: EngineInterface): Promise<void> {
  await leaveQuiz($)
  await loadStore($).catch(() => undefined)
  await setStudy($, id => ({ id, view: 'list' }))
}

async function closeStudy($: EngineInterface): Promise<void> {
  await leaveQuiz($)
  await setStudy($, () => null)
}

/**
 * 공부 칸에서 떠나기 전에: 정답을 보고도 답하지 않은 복습은 하루 뒤로 미룬다. 간격은 그대로 둔다.
 * 그래야 답하지 않고 넘긴 표현이 바로 또 나오지 않는다.
 */
async function leaveQuiz($: EngineInterface): Promise<void> {
  const s = await read($, study)

  if (s?.view === 'quiz' && s.recall?.isRevealed === true && !s.isAnswered && !answering.has(s.id)) {
    await changeNotes($, (notes, now) => [passOver(notes, s.noteId, now), undefined]).catch(() => undefined)
  }
}

/** 노트 한 줄을 퀴즈로. 배울 점이면 조각 맞추기, 핵심 표현이면 떠올리기. */
function quizOf(id: number, note: Note, mode: 'review' | 'practice', now: number): Study {
  const drill = nextDrill(note)

  return {
    id,
    view: 'quiz',
    mode,
    noteId: noteId(note.en),
    ko: note.ko,
    en: note.en,
    example: note.example,
    point: note.point ?? null,
    seenDaysAgo: Math.floor((now - note.seenAt) / DAY_MS),
    arrange: drill === null ? null : startArrange(drill, false, id),
    recall: drill === null ? { isRevealed: false, answer: null } : null,
    nextInDays: null,
    isAnswered: false,
    hasMore: false,
  }
}

/** 공부 칸의 버튼이 부르는 것. 모두 이 칸(`id`)에만 듣는다. */
type StudyActions = {
  piece: (i: number) => void
  next: () => void
  reveal: () => void
  knew: () => void
  forgot: () => void
  review: () => void
  list: () => void
  pick: (noteId: string) => void
  close: () => void
}

function actions($: EngineInterface, id: number): StudyActions {
  return {
    piece: i => void pressPiece($, id, i),
    next: () => void nextProblem($, id),
    reveal: () => void changeStudy($, id, s => (s.view === 'quiz' && s.recall !== null ? { ...s, recall: { ...s.recall, isRevealed: true } } : s)),
    knew: () => void answerQuiz($, id, true),
    forgot: () => void answerQuiz($, id, false),
    review: () => void openReview($),
    list: () => void openList($),
    pick: noteId => void openNote($, noteId),
    close: () => void closeStudy($),
  }
}

/** 조각 하나를 고른다. 학습하기면 결과를 세고, 복습이면 맞혔는지가 곧 답이다. */
async function pressPiece($: EngineInterface, id: number, piece: number): Promise<void> {
  // 빠르게 연달아 눌러도 앞의 누름이 반영된 상태에서 고르도록, 지금 상태를 바꾸는 함수 안에서 고른다.
  const finished: Arrange[] = []

  await changeStudy($, id, s => {
    const before = s.view === 'lesson' || s.view === 'quiz' ? s.arrange : null
    const after = before === null ? null : pickPiece(before, piece)

    if (before === null || after === null || after === before) {
      return s
    }

    if (after.result !== null) {
      finished.push(after)
    }

    return s.view === 'lesson'
      ? { ...s, arrange: after, rights: s.rights + (after.result === 'right' ? 1 : 0) }
      : s.view === 'quiz'
        ? { ...s, arrange: after }
        : s
  })

  const done = finished[0]
  const s = await read($, study)

  if (done === undefined || s === null || s.id !== id) {
    return
  }

  if (s.view === 'lesson') {
    await changeStats($, { drills: 1, drillsRight: done.result === 'right' ? 1 : 0 })
  } else if (s.view === 'quiz') {
    await answerQuiz($, id, done.result === 'right')
  }
}

/** 학습하기의 다음 문제, 또는 복습의 다음 표현. */
async function nextProblem($: EngineInterface, id: number): Promise<void> {
  const s = await read($, study)

  if (s === null || s.id !== id) {
    return
  }

  if (s.view === 'lesson') {
    const drill = s.drills[s.step + 1]

    if (drill !== undefined) {
      await setStudy($, nid => ({ ...s, id: nid, step: s.step + 1, arrange: startArrange(drill, false, nid) }))
    }

    return
  }

  if (s.view === 'quiz') {
    await (s.mode === 'review' ? openReview($) : openList($))
  }
}

/**
 * 떠올렸어요/못 떠올렸어요, 또는 조각 맞추기의 결과. 복습이면 다음 복습 날을 정하고,
 * 연습이면 못 떠올렸을 때만 내일로 당긴다. 두 번 눌러도 한 번만.
 */
async function answerQuiz($: EngineInterface, id: number, knew: boolean): Promise<void> {
  if (answering.has(id)) {
    return
  }

  answering.add(id)

  try {
    const current = await read($, study)

    if (current?.view !== 'quiz' || current.id !== id || current.isAnswered) {
      return
    }

    const result = await changeNotes($, (notes, now) => {
      const note = notes[current.noteId]
      const isDue = note !== undefined && note.dueAt <= now
      const answered = current.mode === 'review' ? answerNote(notes, current.noteId, knew, now) : practiceNote(notes, current.noteId, knew, now)
      const rotated = current.arrange === null ? answered.notes : rotateDrills(answered.notes, current.noteId)

      return [rotated, { days: answered.days, isDue, hasMore: dueCount(rotated, now) > 0 }]
    })

    await changeStudy($, id, s =>
      s.view === 'quiz'
        ? {
            ...s,
            recall: s.recall === null ? null : { isRevealed: true, answer: knew ? 'knew' : 'forgot' },
            nextInDays: result.days,
            isAnswered: true,
            hasMore: result.hasMore,
          }
        : s,
    )
    await changeStats($, result.isDue ? reviewed(knew, current.seenDaysAgo) : { practices: 1 })
  } catch {
    // 저장에 실패했으면 다시 누를 수 있게 둔다.
    answering.delete(id)
  }
}

/** 글 한 토막의 모양 */
type Run = { text: string; color?: string; bold?: boolean; dim?: boolean }

/** 글 한 줄. indent칸만큼 들여 쓴다. */
type TextRow = Run & { indent?: number }

type RowButton = { key: string; label: string; hotkey?: string; onPress: () => void }

/**
 * 한 줄: 글, 토막마다 모양이 다른 글, 버튼들, 제목과 그 오른쪽 버튼들, 또는 버튼 하나와 그 옆의 흐린 글
 */
type Row =
  | TextRow
  | { runs: readonly Run[]; indent?: number }
  | { buttons: readonly RowButton[] }
  | { title: Run; buttons: readonly RowButton[] }
  | { pick: RowButton; note: string }

/** 줄들을 그린다 */
function drawRows({ Box, Button, Text }: ElementTable, rows: readonly Row[]) {
  const button = (b: RowButton) => <Button key={b.key} label={b.label} hotkey={b.hotkey} onPress={b.onPress} />

  return rows.map(row => {
    if ('buttons' in row && 'title' in row) {
      // 제목은 왼쪽, 버튼은 오른쪽. 자리가 모자라면 버튼이 다음 줄로 내려간다.
      return (
        <Box flexDirection="row" flexWrap="wrap" justifyContent="space-between" columnGap={2}>
          <Text color={row.title.color} bold={row.title.bold}>
            {row.title.text}
          </Text>
          <Box flexDirection="row" columnGap={1}>
            {row.buttons.map(button)}
          </Box>
        </Box>
      )
    }

    if ('buttons' in row) {
      return (
        <Box flexDirection="row" flexWrap="wrap" columnGap={1} marginLeft={2}>
          {row.buttons.map(button)}
        </Box>
      )
    }

    if ('pick' in row) {
      return (
        <Box flexDirection="row" columnGap={1} marginLeft={2}>
          {button(row.pick)}
          <Text dimColor wrap="wrap">
            {row.note}
          </Text>
        </Box>
      )
    }

    const line =
      'runs' in row ? (
        // 한 줄 안에서 토막마다 색을 달리한다. 넘치면 글처럼 줄을 바꾼다.
        <Text wrap="wrap">
          {row.runs.map(run => (
            <Text color={run.color} bold={run.bold} dimColor={run.dim}>
              {run.text}
            </Text>
          ))}
        </Text>
      ) : (
        <Text color={row.color} bold={row.bold} dimColor={row.dim} wrap="wrap">
          {row.text}
        </Text>
      )

    // 들여쓰기는 앞에 공백을 붙이지 않고 안쪽 여백으로 한다. 공백이면 넘친 다음 줄이 맨 앞에서 시작한다.
    return row.indent === undefined ? line : <Box paddingLeft={row.indent}>{line}</Box>
  })
}

/** 보여줄 카드가 아직 없을 때, 첫 카드를 영어로 옮기는 동안의 줄 */
function pendingRows(): Row[] {
  return [
    { text: '영어로는', color: ACCENT, bold: true },
    { text: '영어로 옮기는 중…', dim: true, indent: 2 },
  ]
}

/** 다음 프롬프트를 옮기는 동안 이전 카드 맨 위에 붙여서, 보이는 카드가 지난 문장임을 알린다. */
const NEWER_PENDING_ROW: Row = { text: '다음 문장 옮기는 중…', dim: true }

const ACCENT = 'cyan'
const GOOD = 'green'
const BAD = 'red'

// 짝마다 같은 색. 번호 없이 색만으로 짝을 찾으니, 서로 잘 구분되는 넷만 쓴다 (짝도 넷까지).
// 테마 색 이름이라 밝은·어두운 테마를 따라간다.
const PAIR_COLORS = ['claude', 'permission', 'success', 'autoAccept'] as const

/**
 * 카드 위쪽 오른쪽의 버튼. 한국어 카드에만 학습하기, 복습할 표현이 있으면 복습, 노트가 있으면 학습 노트.
 * 학습자가 누를 때만 공부한다: 일하는 흐름을 끊지 않고, 공부할 순간은 학습자가 고른다.
 */
function headerButtons(
  card: Card | null,
  notes: Notes,
  now: number,
  on: { lesson: () => void; review: () => void; list: () => void },
): RowButton[] {
  const due = dueCount(notes, now)

  return [
    card?.kind === 'ko' ? { key: 'study-lesson', label: '학습하기', hotkey: 's', onPress: on.lesson } : null,
    due > 0 ? { key: 'study-review', label: `복습 ${due}`, hotkey: 'v', onPress: on.review } : null,
    Object.keys(notes).length > 0 ? { key: 'study-list', label: '학습 노트', hotkey: 'b', onPress: on.list } : null,
  ].filter(notNull)
}

export function cardRows(c: Card, tools: readonly RowButton[] = []): Row[] {
  const head = (text: string): Row =>
    tools.length === 0 ? { text, color: ACCENT, bold: true } : { title: { text, color: ACCENT, bold: true }, buttons: tools }

  switch (c.kind) {
    case 'ko':
      // 핵심 표현의 예문은 퀴즈 정답에서 보여준다. 카드에서는 바로 위 영어 문장이 그 예문이다.
      return [head('영어로는'), ...sentenceRows(c), ...c.phrases.map(phraseRow)]
    case 'en-fix':
      return [
        head('이렇게 고치면 좋아요'),
        ...c.fixes.flatMap(f => [
          { text: `✗ ${f.wrong}`, color: BAD, indent: 2 },
          { text: `✓ ${f.right}`, color: GOOD, indent: 2 },
          { text: f.why, dim: true, indent: 4 },
        ]),
      ]
    case 'en-natural':
      return [head('잘 썼어요! 이렇게도 말해요'), phraseRow(c.phrase), ...exampleRows(c.phrase.example)]
  }
}

/**
 * 영어 문장 아래에 내 한국어를 쓰인 순서 그대로 두고, 짝지은 조각마다 같은 색을 칠한다.
 * 한국어는 앞에서부터 읽히고, 같은 색이 영어에서 어디로 갔는지가 어순의 차이다.
 * 짝을 못 맞췄으면 영어 한 줄과 그 아래 흐린 원문.
 */
function sentenceRows(c: SentenceMap): Row[] {
  return c.parts.length > 0 && c.original !== null
    ? [
        { runs: segments(c.english, c.parts.map(p => p.en)).map(s => pairRun(s, false)), indent: 2 },
        { runs: segments(c.original, c.parts.map(p => p.ko)).map(s => pairRun(s, true)), indent: 2 },
      ]
    : [{ text: c.english, indent: 2 }, ...(c.original ? [{ text: c.original, dim: true, indent: 2 }] : [])]
}

/** 짝지은 조각은 그 짝의 색, 나머지 한국어는 흐리게 */
function pairRun(s: Segment, isKoreanLine: boolean): Run {
  return s.pair === null ? { text: s.text, dim: isKoreanLine } : { text: s.text, color: pairColor(s.pair) }
}

function pairColor(pair: number): string {
  return PAIR_COLORS[pair % PAIR_COLORS.length] ?? ACCENT
}

/** 공부 칸. 학습하기, 복습, 노트 목록. 열려 있는 동안 카드 자리를 대신한다 */
function studyRows(s: Study, notes: Notes, now: number, on: StudyActions): Row[] {
  const close: RowButton = { key: 'study-close', label: '닫기', hotkey: 'q', onPress: on.close }

  switch (s.view) {
    case 'making':
      return [{ text: '학습하기', color: ACCENT, bold: true }, { text: '문제를 만드는 중…', dim: true, indent: 2 }, { buttons: [close] }]
    case 'no-lesson':
      return [
        { text: '학습하기', color: ACCENT, bold: true },
        {
          text: s.reason === 'none' ? '이 문장에서는 따로 연습할 곳을 찾지 못했어요.' : '문제를 만들지 못했어요. 잠시 뒤에 다시 눌러 보세요.',
          indent: 2,
        },
        { buttons: [close] },
      ]
    case 'lesson':
      return lessonRows(s, on, close)
    case 'quiz':
      return quizRows(s, on, close)
    case 'list':
      return listRows(notes, now, on, close)
    case 'all-done':
      return [{ text: '복습', color: ACCENT, bold: true }, { text: '지금 복습할 표현을 다 봤어요.', color: GOOD, indent: 2 }, { buttons: [close] }]
  }
}

/**
 * 학습하기 한 문제: 새 한국어 문장을 보고 영어 조각을 영어 순서대로 고른다.
 * 첫 문제는 배울 점과 한 줄 도움말을 보여 주고, 한국어 조각에 영어 조각과 같은 색을 칠한다.
 * 다음 문제는 둘 다 감추고 혼자 맞춘다. 다 맞추거나 틀리면 정답을 색으로 보여 준다.
 */
function lessonRows(s: Extract<Study, { view: 'lesson' }>, on: StudyActions, close: RowButton): Row[] {
  const a = s.arrange
  const total = s.drills.length
  const isLast = s.step === total - 1
  const isOver = a.result !== null
  const showPoint = s.step === 0 || isOver
  const after: Row[] = !isOver
    ? []
    : isLast
      ? [
          { text: `${total}문제 가운데 ${s.rights}개를 맞혔어요.`, indent: 2 },
          { text: '노트에 담았어요. 내일 새 문장으로 다시 물어볼게요.', dim: true, indent: 2 },
          { buttons: [close] },
        ]
      : [{ buttons: [{ key: 'study-next', label: '다음 문제', hotkey: 'n', onPress: on.next }, close] }]

  return [
    { text: `학습하기 · ${s.step + 1}/${total}`, color: ACCENT, bold: true },
    ...(showPoint ? pointRows(s.point) : []),
    ...arrangeRows(a, on, close),
    ...after,
  ]
}

/** 배울 점: 한국어 틀 → 영어 틀, 그리고 용어 없는 한 줄 */
function pointRows(p: { ko: string; en: string; hint: string }): Row[] {
  return [
    { runs: [{ text: `${p.ko} → ` }, { text: p.en, bold: true }], indent: 2 },
    ...(p.hint === '' ? [] : [{ text: p.hint, dim: true, indent: 4 }]),
  ]
}

/**
 * 조각 맞추기: 한국어 문장, 지금까지 놓은 영어, 남은 조각 버튼. 버튼은 왼쪽부터 숫자 키 1, 2, 3.
 * 끝나면 버튼 대신 결과와, 정답 문장을 한국어 조각과 같은 색으로 보여 준다.
 */
function arrangeRows(a: Arrange, on: StudyActions, close: RowButton, saysRight = true): Row[] {
  const parts = a.drill.parts
  const korean = (colors: boolean): Row => ({
    runs: colors ? segments(a.drill.ko, parts.map(p => p.ko)).map(seg => pairRun(seg, true)) : [{ text: a.drill.ko }],
    indent: 2,
  })
  const english = (count: number, colors: boolean): Row => ({
    runs: parts.slice(0, count).flatMap((p, i) => [
      ...(i === 0 ? [] : [{ text: ' ' }]),
      { text: p.en, color: colors ? pairColor(i) : undefined, bold: true },
    ]),
    indent: 2,
  })

  if (a.result === null) {
    const left = piecesLeft(a)

    return [
      korean(a.colors),
      a.placed === 0 ? { text: '영어 조각을 순서대로 눌러 보세요', dim: true, indent: 2 } : english(a.placed, a.colors),
      {
        // 남은 조각은 늘 왼쪽부터 1, 2, 3. 버튼에 번호가 보이지 않으니 규칙이 하나여야 쉽다.
        // 푸는 중에도 그만둘 수 있게 닫기를 끝에 둔다.
        buttons: [
          ...left.map((i, at) => ({
            key: `piece-${i}`,
            label: pieceLabel(parts[i]?.en ?? '', i === 0),
            hotkey: String(at + 1),
            onPress: () => on.piece(i),
          })),
          close,
        ],
      },
    ]
  }

  return [
    korean(true),
    english(parts.length, true),
    ...(a.result === 'right'
      ? saysRight
        ? [{ text: '✓ 맞았어요!', color: GOOD, indent: 2 }]
        : []
      : [
          { text: '✗ 영어는 위 순서예요', color: BAD, indent: 2 },
          { text: '같은 색이 같은 뜻이에요', dim: true, indent: 4 },
        ]),
  ]
}

/**
 * 버튼에 쓰는 조각 글. 첫 조각의 대문자와 끝의 문장 부호는 지운다: 그것만 보고도 첫 조각과 끝 조각을 알아서,
 * 조각이 셋이면 영어를 떠올리지 않고도 맞출 수 있다. 놓은 뒤에는 문장에 쓰인 그대로 보여 준다.
 * 이름처럼 원래 대문자인 낱말("I", "API")은 그대로 둔다.
 */
export function pieceLabel(en: string, isFirst: boolean): string {
  const bare = en.replace(/[.?!,]+$/, '')

  return isFirst && /^[A-Z][a-z]/.test(bare) ? `${bare.charAt(0).toLowerCase()}${bare.slice(1)}` : bare
}

/**
 * 복습과 연습. 배울 점은 처음 보는 문장으로 조각 맞추기, 핵심 표현은 한국어 뜻을 보고 머릿속으로 떠올리기.
 * 직접 연 퀴즈라서 정답은 학습자가 보고 싶을 때 본다.
 */
function quizRows(s: Extract<Study, { view: 'quiz' }>, on: StudyActions, close: RowButton): Row[] {
  const title = `${s.mode === 'review' ? '복습' : '연습'} · ${daysAgo(s.seenDaysAgo)} 본 표현`
  const next: RowButton =
    s.mode === 'review'
      ? { key: 'study-next', label: '다음 복습', hotkey: 'n', onPress: on.next }
      : { key: 'study-next', label: '목록으로', hotkey: 'n', onPress: on.next }
  const end: Row[] = s.isAnswered ? [resultRow(s), { buttons: s.mode === 'review' && !s.hasMore ? [close] : [next, close] }] : []

  if (s.arrange !== null) {
    return [
      { text: title, color: ACCENT, bold: true },
      ...(s.arrange.result === null || s.point === null ? [] : pointRows(s.point)),
      // 맞혔을 때는 아래 결과 줄이 말해 주니 여기서는 쓰지 않는다.
      ...arrangeRows(s.arrange, on, close, false),
      ...end,
    ]
  }

  const recall = s.recall ?? { isRevealed: false, answer: null }
  const head: Row[] = [
    { text: title, color: ACCENT, bold: true },
    { text: `"${s.ko}" — 영어로 떠올려 보세요`, indent: 2 },
  ]

  if (!recall.isRevealed) {
    return [...head, { buttons: [{ key: 'quiz-reveal', label: '정답 보기', hotkey: 'r', onPress: on.reveal }, close] }]
  }

  const answer: Row[] = [{ text: s.en, bold: true, indent: 2 }, ...exampleRows(s.example)]

  if (!s.isAnswered) {
    return [
      ...head,
      ...answer,
      {
        buttons: [
          { key: 'quiz-knew', label: '떠올렸어요', hotkey: 'o', onPress: on.knew },
          { key: 'quiz-forgot', label: '못 떠올렸어요', hotkey: 'x', onPress: on.forgot },
          close,
        ],
      },
    ]
  }

  return [...head, ...answer, ...end]
}

/** 답한 뒤의 한 줄: 다음에 언제 다시 보는지 */
function resultRow(s: Extract<Study, { view: 'quiz' }>): Row {
  const knew = s.recall !== null ? s.recall.answer === 'knew' : s.arrange?.result === 'right'

  if (s.nextInDays === null) {
    return { text: '✓ 좋아요! 복습 날은 그대로예요', color: GOOD, indent: 2 }
  }

  return knew
    ? { text: `✓ 좋아요! ${inDays(s.nextInDays)} 다시 볼게요`, color: GOOD, indent: 2 }
    : { text: `↺ 괜찮아요, ${inDays(s.nextInDays)} 다시 볼게요`, dim: true, indent: 2 }
}

/**
 * 공부 칸의 노트 목록. 영어는 가리고 한국어 뜻만 보여 준다: 무엇을 고르든 떠올리기가 되게.
 * 복습할 때가 된 것, 아직 몇 번 못 맞힌 것부터.
 */
function listRows(notes: Notes, now: number, on: StudyActions, close: RowButton): Row[] {
  const all = studyOrder(notes, now)
  const due = dueCount(notes, now)
  const shown = all.slice(0, LIST_ROWS)

  return [
    { text: `학습 노트 · ${all.length}개`, color: ACCENT, bold: true },
    { text: due > 0 ? `지금 복습할 것 ${due}개 · 하나를 골라 떠올려 보세요` : '하나를 골라 떠올려 보세요', dim: true, indent: 2 },
    ...shown.map(([id, n], i) => ({
      pick: { key: `note-${i}`, label: n.ko, hotkey: String(i + 1), onPress: () => on.pick(id) },
      note: dueLabel(n.dueAt, now),
    })),
    ...(all.length > shown.length ? [{ text: `나머지 ${all.length - shown.length}개는 /lingo-notes에서 볼 수 있어요`, dim: true, indent: 2 }] : []),
    { buttons: [...(due > 0 ? [{ key: 'study-review', label: '복습하기', hotkey: 'v', onPress: on.review }] : []), close] },
  ]
}

/**
 * /lingo-notes 패널: 모은 표현을 복습할 때가 가까운 것부터. 영어는 가리고, 누르면 프롬프트 위에서 떠올린다.
 * 맨 위에는 새 표현을 모으지 않는 까닭과 최근 7일의 기록을 한 줄씩.
 */
export function notesPaneRows(notes: Notes, stats: Stats, now: number, pick: (id: string) => void): Row[] {
  const all = studyOrder(notes, now)

  if (all.length === 0) {
    return [{ text: '아직 모은 표현이 없어요. 카드에 나온 표현이 여기에 모여요.', dim: true }]
  }

  return [
    { text: `모두 ${all.length}개 · 지금 복습할 것 ${dueCount(notes, now)}개`, color: ACCENT, bold: true },
    ...intakeRows(notes, now),
    ...weekRows(stats, now),
    { text: '영어는 가려 두었어요. 누르면 프롬프트 위에서 떠올려 볼 수 있어요.', dim: true },
    ...all.map(([id, n], i) => ({ pick: { key: `pane-note-${i}`, label: n.ko, onPress: () => pick(id) }, note: dueLabel(n.dueAt, now) })),
  ]
}

/** 새 표현을 지금 모으지 않으면 그 까닭. 카드에 나온 표현이 노트에 없는 이유를 여기서 알 수 있게 */
function intakeRows(notes: Notes, now: number): TextRow[] {
  switch (intake(notes, now)) {
    case 'open':
      return []
    case 'full-today':
      return [{ text: `새 표현 ${NEW_PER_DAY}개를 다 모았어요. 하루가 지나면 다시 모아요.`, dim: true }]
    case 'backlog':
      return [{ text: `복습할 표현이 ${MAX_DUE}개 이상 쌓여서, 새 표현은 잠시 모으지 않아요.`, dim: true }]
  }
}

/** 최근 7일의 기록 한 줄. 공부한 날이 없으면 쓰지 않는다: 밀린 숙제처럼 보이지 않게. */
function weekRows(stats: Stats, now: number): TextRow[] {
  const week = lastWeek(stats, now)

  if (week.studyDays === 0) {
    return []
  }

  const rate = week.longReviews >= 5 ? ` · 3일 넘게 지난 복습 기억률 ${Math.round((week.longKnew / week.longReviews) * 100)}%` : ''

  return [{ text: `최근 7일: ${week.studyDays}일 공부 · 복습 ${week.reviews}번${rate}`, dim: true }]
}

function daysAgo(days: number): string {
  return days <= 0 ? '오늘' : days === 1 ? '어제' : `${days}일 전에`
}

function inDays(days: number | null): string {
  return days === null || days <= 1 ? '내일' : `${days}일 뒤에`
}

function dueLabel(dueAt: number, now: number): string {
  const days = Math.ceil((dueAt - now) / DAY_MS)

  return days <= 0 ? '지금 복습' : days === 1 ? '내일 복습' : `${days}일 뒤 복습`
}

function phraseRow(p: Phrase): Row {
  return { text: `• ${p.en} — ${p.ko}`, indent: 2 }
}

function exampleRows(example: string): Row[] {
  return example === '' ? [] : [{ text: `예: ${example}`, dim: true, indent: 4 }]
}
