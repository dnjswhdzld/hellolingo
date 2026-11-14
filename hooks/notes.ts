// 표현 노트: 카드에 나온 표현과 학습하기에서 연습한 배울 점을 모아 두고, 간격 반복으로 언제 다시 볼지 정한다.
// 값만 다루는 함수들이다. 저장소에서 읽고 쓰는 일은 register.tsx가 한다.

import type { Drill, Lesson, Note, Notes, Part, Phrase, Point } from '../types'

export const DAY_MS = 24 * 60 * 60 * 1000

/** 알았을 때마다 다음 복습까지 늘어나는 날 수. 몰랐으면 첫 칸(1일)으로 돌아간다. */
export const INTERVAL_DAYS = [1, 3, 7, 14, 30] as const

const MAX_NOTES = 1000

/** 새 표현은 최근 24시간에 이만큼까지만 모은다. 하나가 처음 두 달에 다섯 번 복습되니, 하루 복습이 25번쯤이다. */
export const NEW_PER_DAY = 5

/** 복습할 때가 된 표현이 이만큼 쌓이면, 복습을 먼저 하도록 새 표현을 모으지 않는다. */
export const MAX_DUE = 10

/** 배울 점 하나에 남겨 두는 복습 문제 수 */
const MAX_DRILLS_KEPT = 6

/** 지금 새 표현을 모으는지: 모은다, 오늘 몫을 다 모았다, 밀린 복습이 많다 */
export type Intake = 'open' | 'full-today' | 'backlog'

export function intake(notes: Notes, now: number): Intake {
  const all = Object.values(notes)

  if (all.filter(n => n.dueAt <= now).length >= MAX_DUE) {
    return 'backlog'
  }

  return addedToday(all, now) >= NEW_PER_DAY ? 'full-today' : 'open'
}

function addedToday(all: readonly Note[], now: number): number {
  return all.filter(n => n.addedAt > now - DAY_MS).length
}

/** 같은 표현은 한 번만 모으도록 대소문자와 공백을 맞춘 키 */
export function noteId(en: string): string {
  return en.toLowerCase().replace(/\s+/g, ' ').trim()
}

/** 저장소에서 읽은 값을 노트로. 모양이 틀린 줄은 버린다. */
export function asNotes(v: unknown): Notes {
  if (!isRecord(v)) {
    return {}
  }

  const notes: Notes = {}

  for (const [id, note] of Object.entries(v)) {
    if (isNote(note)) {
      notes[id] = withLesson(note)
    }
  }

  return notes
}

/** 처음 보는 표현만, 지금 모을 수 있는 만큼 더한다. 첫 복습은 하루 뒤. */
export function addPhrases(notes: Notes, phrases: readonly Phrase[], now: number): Notes {
  const room = intake(notes, now) === 'open' ? NEW_PER_DAY - addedToday(Object.values(notes), now) : 0
  const fresh = phrases.filter(p => noteId(p.en) !== '' && notes[noteId(p.en)] === undefined).slice(0, room)

  if (fresh.length === 0) {
    return notes
  }

  const added: Notes = { ...notes }

  for (const p of fresh) {
    added[noteId(p.en)] = { ...p, addedAt: now, seenAt: now, level: 0, dueAt: now + DAY_MS, shownAt: null }
  }

  return keepNewest(added)
}

/**
 * 학습하기에서 연습한 배울 점을 노트에 담는다. 학습자가 직접 고른 것이라 하루 몫과 밀린 복습에 상관없이 담는다.
 * 첫 복습은 하루 뒤: 그 자리에서 맞혀도 간격을 건너뛰지 않는다. drills는 복습 때 낼 순서로 둔다.
 * 이미 있는 배울 점이면 새 문제를 더하고, 복습 날이 더 늦으면 하루 뒤로 당긴다.
 */
export function addPoint(notes: Notes, lesson: Lesson, drills: readonly Drill[], now: number): Notes {
  const id = noteId(lesson.point.en)
  const old = notes[id]

  if (id === '' || drills.length === 0) {
    return notes
  }

  if (old === undefined) {
    const note: Note = {
      en: lesson.point.en,
      ko: lesson.point.ko,
      example: '',
      addedAt: now,
      seenAt: now,
      level: 0,
      dueAt: now + DAY_MS,
      shownAt: null,
      point: lesson.point,
      drills,
    }

    return keepNewest({ ...notes, [id]: note })
  }

  const known = new Set((old.drills ?? []).map(d => d.ko))
  const merged = [...drills.filter(d => !known.has(d.ko)), ...(old.drills ?? [])].slice(0, MAX_DRILLS_KEPT)

  return {
    ...notes,
    [id]: { ...old, point: old.point ?? lesson.point, drills: merged, dueAt: Math.min(old.dueAt, now + DAY_MS) },
  }
}

/** 배울 점을 복습할 때 낼 문제. 핵심 표현이면 null. */
export function nextDrill(note: Note): Drill | null {
  return note.point === undefined ? null : (note.drills?.[0] ?? null)
}

/** 낸 문제를 맨 뒤로 보내서, 다음 복습에는 다른 문장이 나오게 한다. */
export function rotateDrills(notes: Notes, id: string): Notes {
  const note = notes[id]
  const [first, ...rest] = note?.drills ?? []

  return note === undefined || first === undefined ? notes : { ...notes, [id]: { ...note, drills: [...rest, first] } }
}

/** 지금 복습할 때가 된 표현 수 */
export function dueCount(notes: Notes, now: number): number {
  return Object.values(notes).filter(n => n.dueAt <= now).length
}

/**
 * 노트 목록에 보일 순서. 복습할 때가 된 것을 먼저, 그다음은 아직 몇 번 못 맞힌 것부터.
 * 학습자가 위에서부터 고르면 자연히 지금 필요한 표현을 고르게 된다.
 */
export function studyOrder(notes: Notes, now: number): [string, Note][] {
  const isDue = (n: Note) => (n.dueAt <= now ? 0 : 1)

  return Object.entries(notes).sort(
    ([, a], [, b]) => isDue(a) - isDue(b) || (isDue(a) === 0 ? a.dueAt - b.dueAt : a.level - b.level || a.dueAt - b.dueAt),
  )
}

/**
 * 노트에서 골라 떠올린 결과. 복습할 때가 된 표현이면 복습과 같다.
 * 아직 때가 아닌 표현은 떠올렸으면 일정을 그대로 두고, 못 떠올렸으면 내일로 당긴다.
 * 그래서 아는 표현만 골라도 간격이 부풀지 않고, 모르는 표현을 고르면 일찍 다시 만난다.
 * days: 다음 복습까지 며칠. 일정을 바꾸지 않았으면 null.
 */
export function practiceNote(notes: Notes, id: string, knew: boolean, now: number): { notes: Notes; days: number | null } {
  const note = notes[id]

  if (note === undefined) {
    return { notes, days: null }
  }

  if (note.dueAt <= now) {
    return answerNote(notes, id, knew, now)
  }

  if (knew) {
    return { notes, days: null }
  }

  const dueAt = Math.min(note.dueAt, now + DAY_MS)

  return { notes: { ...notes, [id]: { ...note, seenAt: now, dueAt } }, days: Math.ceil((dueAt - now) / DAY_MS) }
}

/**
 * 복습할 때가 된 표현 하나. 마지막으로 답한 뒤 퀴즈로 냈는데 답하지 않고 넘긴 표현은 맨 뒤로 보내고,
 * 그것끼리는 넘긴 지 오래된 것부터 돌아가며 낸다: 넘긴 퀴즈가 다음 프롬프트에 또 나오지 않게.
 * 나머지는 퀴즈에 답한 적 있는 표현을 처음 보는 표현보다 먼저 낸다: 새 표현이 계속 들어와도 3일, 7일 뒤
 * 복습이 밀리지 않게. 같은 무리 안에서는 아직 퀴즈에 안 낸 것, 낸 지 오래된 것, 복습 날이 이른 것부터.
 */
export function pickDue(notes: Notes, now: number): Note | null {
  const due = Object.values(notes).filter(n => n.dueAt <= now)
  const passedAt = (n: Note) => (n.shownAt !== null && n.shownAt > n.seenAt ? n.shownAt : null)
  const isNew = (n: Note) => (n.seenAt > n.addedAt ? 0 : 1)

  due.sort((a, b) => {
    const pa = passedAt(a)
    const pb = passedAt(b)

    if (pa !== null || pb !== null) {
      return pa === null ? -1 : pb === null ? 1 : pa - pb
    }

    return isNew(a) - isNew(b) || (a.shownAt ?? -1) - (b.shownAt ?? -1) || a.dueAt - b.dueAt
  })

  return due[0] ?? null
}

/** 퀴즈에 냈다고 적어 둔다. */
export function markShown(notes: Notes, id: string, now: number): Notes {
  const note = notes[id]

  return note === undefined ? notes : { ...notes, [id]: { ...note, shownAt: now } }
}

/**
 * 정답을 보고도 답하지 않고 넘긴 표현은 하루 뒤에 다시 낸다. 간격(칸)은 그대로 둔다: 떠올렸는지 모르니.
 * 답하지 않는 사람도 같은 표현을 하루에 몇 번씩 보지 않고, 날을 나눠 다시 만나게 한다.
 * 그사이 다른 세션에서 답해서 복습할 때가 아니면 그대로 둔다.
 */
export function passOver(notes: Notes, id: string, now: number): Notes {
  const note = notes[id]

  return note === undefined || note.dueAt > now ? notes : { ...notes, [id]: { ...note, dueAt: now + DAY_MS } }
}

/** 퀴즈 답을 반영한다. 알았으면 다음 칸으로, 몰랐으면 첫 칸으로. 다음 복습까지 며칠인지도. */
export function answerNote(notes: Notes, id: string, knew: boolean, now: number): { notes: Notes; days: number } {
  const note = notes[id]
  const level = knew && note !== undefined ? Math.min(note.level + 1, INTERVAL_DAYS.length - 1) : 0
  const days = INTERVAL_DAYS[level] ?? INTERVAL_DAYS[0]

  if (note === undefined) {
    return { notes, days }
  }

  return { notes: { ...notes, [id]: { ...note, level, seenAt: now, dueAt: now + days * DAY_MS } }, days }
}

/** 노트가 너무 많아지면 최근에 모은 것만 남긴다 (저장소는 모두 합쳐 4 MiB까지). */
function keepNewest(notes: Notes): Notes {
  const all = Object.entries(notes)

  if (all.length <= MAX_NOTES) {
    return notes
  }

  return Object.fromEntries(all.sort(([, a], [, b]) => b.addedAt - a.addedAt).slice(0, MAX_NOTES))
}

/** 배울 점과 문제의 모양이 틀렸으면 그 둘만 빼고 핵심 표현처럼 둔다. */
function withLesson(note: Note): Note {
  const { point, drills, ...phrase } = note
  const goodDrills = Array.isArray(drills) ? drills.filter(isDrill) : []

  return isPoint(point) && goodDrills.length > 0 ? { ...phrase, point, drills: goodDrills } : phrase
}

function isPoint(v: unknown): v is Point {
  return (
    isRecord(v) &&
    (v.type === 'order' || v.type === 'chunk') &&
    typeof v.ko === 'string' &&
    typeof v.en === 'string' &&
    typeof v.hint === 'string'
  )
}

function isDrill(v: unknown): v is Drill {
  return isRecord(v) && typeof v.ko === 'string' && Array.isArray(v.parts) && v.parts.length > 0 && v.parts.every(isPart)
}

function isPart(v: unknown): v is Part {
  return isRecord(v) && typeof v.ko === 'string' && typeof v.en === 'string'
}

function isNote(v: unknown): v is Note {
  return (
    isRecord(v) &&
    typeof v.en === 'string' &&
    typeof v.ko === 'string' &&
    typeof v.example === 'string' &&
    typeof v.addedAt === 'number' &&
    typeof v.seenAt === 'number' &&
    typeof v.level === 'number' &&
    typeof v.dueAt === 'number' &&
    (v.shownAt === null || typeof v.shownAt === 'number')
  )
}

function isRecord(v: unknown): v is Record<string, unknown> {
  return typeof v === 'object' && v !== null && !Array.isArray(v)
}
