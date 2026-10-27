// hellolingo
// 프롬프트 위 영역에 영어 학습 레이어를 고정해 둔다. 왼쪽에는 내가 마지막으로 보낸 프롬프트의 카드:
//  - 한국어 프롬프트: 영어 문장과 내 한국어 문장 (같은 뜻의 조각에 같은 색) + 핵심 표현 1개
//  - 영어 프롬프트: 틀린 부분 → 고친 부분 (없으면 더 자연스러운 표현 1개)
// 새 프롬프트를 보내도 카드는 지우지 않는다: 새 카드가 준비될 때까지 이전 카드를 그대로 둔다.
// 카드의 핵심 표현은 표현 노트에 모아 두고, Claude가 작업하는 동안 복습할 때가 된 것을
// 오른쪽에 퀴즈로 낸다. /lingo-notes 로 노트를 옆 패널에서 본다.
// 본 작업(프롬프트, 응답, 코드)은 건드리지 않는다.

import { atom, read, update } from 'claude-code'
import type { ElementTable, EngineInterface, PromptSubmitInput, Register } from 'claude-code'

import type { Card, Layer, Notes, Phrase, Quiz, SentenceMap } from '../types'
import { isKorean, notNull, parseCard, segments } from './cards'
import type { Segment } from './cards'
import { EN_TASK, KO_TASK, SYSTEM } from './prompts'
import { DAY_MS, MAX_DUE, NEW_PER_DAY, addPhrases, answerNote, asNotes, intake, markShown, noteId, pickDue } from './notes'

const layer = atom({ plugin: 'hellolingo', key: 'layer' } as const, { card: null, cardSeq: 0, pendingSeq: null })
const quiz = atom({ plugin: 'hellolingo', key: 'quiz' } as const, null)
// 표현 노트는 $.store에 두고(세션이 바뀌어도 남는다), 여기는 패널을 그리기 위한 사본이다.
const notesView = atom({ plugin: 'hellolingo', key: 'notes' } as const, {})

const NOTES_KEY = 'notes'
const NOTES_PANE = 'lingo-notes'
const REVEAL_MS = 10_000 // 퀴즈를 내고 이만큼 지나면 정답을 보여준다. 천천히 읽는 사람도 떠올려 볼 틈이 있게

const MODEL = 'haiku' // 가장 저렴한 모델
const MIN_CHARS = 10
const MAX_INPUT_CHARS = 1500 // 긴 붙여넣기는 앞부분만 보낸다 (비용)
const MAX_TOKENS = 800 // 짝짓기까지 담은 JSON이 잘리지 않게
const TIMEOUT_MS = 20_000
const MIN_SPLIT_COLUMNS = 70 // 영역이 이보다 좁으면 반으로 나누지 않고 위아래로 쌓는다
const GAP = 2
// 카드 테두리. 이모지는 터미널마다 폭을 다르게 세서 테두리를 어긋나게 하니, 카드 안에는 쓰지 않는다.
const CARD_BORDER = 'round'

// 사람이 직접 입력한 프롬프트만. 알림, 예약 작업, 다른 세션 메시지 등은 건너뛴다.
const USER_ORIGINS: ReadonlySet<string> = new Set(['composer', 'bridge', 'unclassified'])

// 프롬프트를 보낼 때마다 올라간다. 늦게 도착한 이전 결과가 새 카드를 덮지 않게 한다.
let seq = 0

// 한 세션 안의 저장소 쓰기를 차례로 줄 세운다.
let persisting: Promise<unknown> = Promise.resolve()

// 답을 누른 퀴즈의 번호.
const answering = new Set<number>()

export const register: Register = on => {
  on('session.start', async ($, e, next) => {
    try {
      await $.command.register({ name: 'lingo-notes', description: '영어 표현 노트를 옆 패널에 보여줘요' })
      await loadNotes($)
    } catch {
      // 노트를 못 읽어도 카드는 그대로 동작한다.
    }

    return next(e)
  })

  on('command.run', { command: 'lingo-notes' }, async $ => {
    // 다른 세션이 그사이 모은 표현도 보이게 저장소에서 다시 읽는다.
    await loadNotes($)
    await $.ui.open({ id: NOTES_PANE, title: '표현 노트' })

    return { text: '영어 표현 노트를 열었어요.' }
  })

  on('ui.render', { component: 'Pane', requestId: NOTES_PANE }, async ($, e) => {
    const { Box, Text } = $.ui.resolve(e)
    const now = await $.clock.now()
    const rows = notesPaneRows(await read($, notesView), now)
    const room = Math.max(1, (e.viewport?.rows ?? 24) - 4)

    return (
      <Box flexDirection="column">
        {rows.slice(0, room).map(row => (
          <Text color={row.color} bold={row.bold} dimColor={row.dim} wrap="wrap">
            {row.text}
          </Text>
        ))}
      </Box>
    )
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

      // 짧은 프롬프트에도 Claude는 작업하니, 그동안 복습할 표현이 있으면 퀴즈를 낸다.
      if (isPersonPrompt(e)) {
        // 카드는 지우지 않는다. 지난 턴의 퀴즈만 거둔다.
        await update($, quiz, () => null)
        $.clock.after(0, () => {
          void startQuiz($, mine)
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
    const review = await read($, quiz)
    const promptPanel =
      card !== null
        ? { key: 'prompt', rows: pendingSeq === null ? cardRows(card) : [NEWER_PENDING_ROW, ...cardRows(card)] }
        : pendingSeq !== null
          ? { key: 'prompt', rows: pendingRows() }
          : null
    const quizPanel =
      review === null
        ? null
        : {
            key: 'quiz',
            rows: quizRows(review, {
              reveal: () => void revealQuiz($, review.id),
              knew: () => void answerQuiz($, review.id, true),
              forgot: () => void answerQuiz($, review.id, false),
            }),
          }
    const cards = [promptPanel, quizPanel].filter(notNull)

    if (cards.length === 0) {
      return next(e)
    }

    const el = $.ui.resolve(e)
    const { Box } = el
    // 같은 자리를 쓰는 다른 mod나 Claude Code 자체의 내용도 함께 보이게 아래에 붙인다.
    const below = await next(e)
    // 카드 둘은 자리가 되면 좌우 반씩, 좁으면 위아래로.
    const isSplit = cards.length === 2 && e.props.bodyColumns >= MIN_SPLIT_COLUMNS
    const cardWidth = isSplit ? Math.floor((e.props.bodyColumns - GAP) / 2) : undefined

    // 칸마다 둥근 테두리를 둘러서, 터미널의 다른 내용과 그리고 서로 구분되게 한다.
    // 너비는 테두리와 안쪽 여백까지 포함한 값이다.
    return (
      <Box flexDirection="column">
        <Box flexDirection={isSplit ? 'row' : 'column'} columnGap={GAP} marginBottom={1}>
          {cards.map(panel => (
            <Box
              key={panel.key}
              flexDirection="column"
              width={cardWidth}
              flexShrink={0}
              borderStyle={CARD_BORDER}
              borderDimColor
              paddingX={1}
            >
              {drawRows(el, panel.rows)}
            </Box>
          ))}
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
    prompt: `${korean ? KO_TASK : EN_TASK}\n\nPROMPT:\n<<<\n${text}\n>>>`,
    maxTokens: MAX_TOKENS,
    effort: 'low',
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
 * 저장소의 노트를 바꾼다. 다른 세션이 쓴 것까지 담긴 최신 노트에 `change`를 적용해 저장하고,
 * 패널용 사본도 맞춘다. `change`는 바뀐 노트와 함께 호출한 쪽에 돌려줄 값을 준다.
 */
function changeNotes<T>($: EngineInterface, change: (notes: Notes, now: number) => [Notes, T]): Promise<T> {
  const run = persisting.then(async () => {
    const now = await $.clock.now()
    const stored = asNotes(await $.store.get(NOTES_KEY))
    const [changed, result] = change(stored, now)

    if (changed !== stored) {
      await $.store.set(NOTES_KEY, changed)
    }

    await update($, notesView, () => changed)

    return result
  })

  // 한 번 실패해도 다음 쓰기는 이어지게.
  persisting = run.catch(() => undefined)

  return run
}

/** 저장소의 노트를 패널용 사본으로 읽어 온다. */
async function loadNotes($: EngineInterface): Promise<void> {
  await changeNotes($, notes => [notes, undefined])
}

async function savePhrases($: EngineInterface, phrases: readonly Phrase[]): Promise<void> {
  if (phrases.length > 0) {
    await changeNotes($, (notes, now) => [addPhrases(notes, phrases, now), undefined])
  }
}

/** 복습할 때가 된 표현이 있으면 퀴즈로 내고, 잠시 뒤 정답을 보여준다. */
async function startQuiz($: EngineInterface, mine: number): Promise<void> {
  try {
    const picked = await changeNotes($, (notes, now) => {
      // 그사이 다음 프롬프트가 왔으면 낼 퀴즈가 아니니, 냈다고 적지도 않는다.
      const note = mine === seq ? pickDue(notes, now) : null

      return note === null ? [notes, null] : [markShown(notes, noteId(note.en), now), { note, now }]
    })

    if (picked === null || mine !== seq) {
      return
    }

    const { note, now } = picked

    await update($, quiz, () => ({
      id: mine,
      noteId: noteId(note.en),
      en: note.en,
      ko: note.ko,
      example: note.example,
      seenDaysAgo: Math.floor((now - note.seenAt) / DAY_MS),
      isRevealed: false,
      answer: null,
      nextInDays: null,
    }))
    $.clock.after(REVEAL_MS, () => {
      void revealQuiz($, mine)
    })
  } catch {
    // 퀴즈를 못 내도 본 작업과 카드는 그대로다.
  }
}

async function revealQuiz($: EngineInterface, id: number): Promise<void> {
  await update($, quiz, q => (q !== null && q.id === id && !q.isRevealed ? { ...q, isRevealed: true } : q))
}

/** 떠올렸어요/못 떠올렸어요. 다음 복습 날을 정하고 퀴즈에 결과를 적는다. 두 번 눌러도 한 번만. */
async function answerQuiz($: EngineInterface, id: number, knew: boolean): Promise<void> {
  // 저장이 끝나기 전에 또 눌러도, 첫 번째 누름만 반영한다.
  if (answering.has(id)) {
    return
  }

  answering.add(id)

  try {
    const current = await read($, quiz)

    if (current === null || current.id !== id || current.answer !== null) {
      return
    }

    const days = await changeNotes($, (notes, now) => {
      const answered = answerNote(notes, current.noteId, knew, now)

      return [answered.notes, answered.days]
    })

    const answer: Quiz['answer'] = knew ? 'knew' : 'forgot'

    await update($, quiz, q => (q !== null && q.id === id ? { ...q, isRevealed: true, answer, nextInDays: days } : q))
  } catch {
    // 저장에 실패했으면 다시 누를 수 있게 둔다.
    answering.delete(id)
  }
}

type TextRow = { text: string; color?: string; bold?: boolean; dim?: boolean }

type RowButton = { key: string; label: string; hotkey: string; onPress: () => void }

/** 글 한 줄, 한 줄 안에서 토막마다 모양이 다른 줄, 또는 버튼 한 줄 */
type Row = TextRow | { runs: readonly TextRow[] } | { buttons: readonly RowButton[] }

/** 카드 줄들을 그린다: 글 한 줄, 토막마다 모양이 다른 줄, 버튼 줄 */
function drawRows({ Box, Button, Text }: ElementTable, rows: readonly Row[]) {
  return rows.map(row =>
    'buttons' in row ? (
      <Box flexDirection="row" columnGap={1} marginLeft={2}>
        {row.buttons.map(b => (
          <Button key={b.key} label={b.label} hotkey={b.hotkey} onPress={b.onPress} />
        ))}
      </Box>
    ) : 'runs' in row ? (
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
    ),
  )
}

/** 보여줄 카드가 아직 없을 때, 첫 카드를 영어로 옮기는 동안의 줄 */
function pendingRows(): Row[] {
  return [
    { text: '영어로는', color: ACCENT, bold: true },
    { text: '  영어로 옮기는 중…', dim: true },
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

export function cardRows(c: Card): Row[] {
  switch (c.kind) {
    case 'ko':
      // 핵심 표현의 예문은 퀴즈 정답에서 보여준다. 카드에서는 바로 위 영어 문장이 그 예문이다.
      return [{ text: '영어로는', color: ACCENT, bold: true }, ...sentenceRows(c), ...c.phrases.map(phraseRow)]
    case 'en-fix':
      return [
        { text: '이렇게 고치면 좋아요', color: ACCENT, bold: true },
        ...c.fixes.flatMap(f => [
          { text: `  ✗ ${f.wrong}`, color: BAD },
          { text: `  ✓ ${f.right}`, color: GOOD },
          { text: `    ${f.why}`, dim: true },
        ]),
      ]
    case 'en-natural':
      return [
        { text: '잘 썼어요! 이렇게도 말해요', color: ACCENT, bold: true },
        phraseRow(c.phrase),
        ...exampleRows(c.phrase.example),
      ]
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
        { runs: [{ text: '  ' }, ...segments(c.english, c.parts.map(p => p.en)).map(s => pairRun(s, false))] },
        { runs: [{ text: '  ' }, ...segments(c.original, c.parts.map(p => p.ko)).map(s => pairRun(s, true))] },
      ]
    : [{ text: `  ${c.english}` }, ...(c.original ? [{ text: `  ${c.original}`, dim: true }] : [])]
}

/** 짝지은 조각은 그 짝의 색, 나머지 한국어는 흐리게 */
function pairRun(s: Segment, isKoreanLine: boolean): TextRow {
  return s.pair === null ? { text: s.text, dim: isKoreanLine } : { text: s.text, color: pairColor(s.pair) }
}

function pairColor(pair: number): string {
  return PAIR_COLORS[pair % PAIR_COLORS.length] ?? ACCENT
}

/**
 * 복습 퀴즈: 한국어 뜻을 보고 영어를 떠올린다. 몇 초 뒤(누르면 바로) 정답이 나오고,
 * 떠올렸는지 누르면 다음 복습 날이 정해진다.
 */
export function quizRows(q: Quiz, on: { reveal: () => void; knew: () => void; forgot: () => void }): Row[] {
  const head: Row[] = [
    { text: `복습 · ${daysAgo(q.seenDaysAgo)} 본 표현`, color: ACCENT, bold: true },
    { text: `  "${q.ko}" — 영어로 떠올려 보세요` },
  ]

  if (!q.isRevealed) {
    return [
      ...head,
      { text: `    ${REVEAL_MS / 1000}초 뒤에 정답이 나와요`, dim: true },
      { buttons: [{ key: 'quiz-reveal', label: '정답 보기', hotkey: 'r', onPress: on.reveal }] },
    ]
  }

  const answer: Row[] = [{ text: `  ${q.en}`, bold: true }, ...exampleRows(q.example)]

  if (q.answer === null) {
    return [
      ...head,
      ...answer,
      {
        buttons: [
          { key: 'quiz-knew', label: '떠올렸어요', hotkey: 'o', onPress: on.knew },
          { key: 'quiz-forgot', label: '못 떠올렸어요', hotkey: 'x', onPress: on.forgot },
        ],
      },
    ]
  }

  const result: Row =
    q.answer === 'knew'
      ? { text: `  ✓ 좋아요! ${inDays(q.nextInDays)} 다시 볼게요`, color: GOOD }
      : { text: `  ↺ 괜찮아요, ${inDays(q.nextInDays)} 다시 볼게요`, dim: true }

  return [...head, ...answer, result]
}

/** /lingo-notes 패널: 모은 표현을 복습할 때가 가까운 것부터. */
export function notesPaneRows(notes: Notes, now: number): TextRow[] {
  const all = Object.values(notes).sort((a, b) => a.dueAt - b.dueAt)

  if (all.length === 0) {
    return [{ text: '아직 모은 표현이 없어요. 카드에 나온 표현이 여기에 모여요.', dim: true }]
  }

  const due = all.filter(n => n.dueAt <= now).length

  return [
    { text: `모두 ${all.length}개 · 지금 복습할 것 ${due}개`, color: ACCENT, bold: true },
    ...intakeRows(notes, now),
    ...all.flatMap(n => [{ text: `• ${n.en} — ${n.ko}` }, { text: `    ${dueLabel(n.dueAt, now)}`, dim: true }]),
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
  return { text: `  • ${p.en} — ${p.ko}` }
}

function exampleRows(example: string): Row[] {
  return example === '' ? [] : [{ text: `    예: ${example}`, dim: true }]
}
