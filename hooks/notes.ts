// 표현 노트: 카드에 나온 표현을 모아 두고, 간격 반복으로 언제 다시 볼지 정한다.
// 값만 다루는 함수들이다. 저장소에서 읽고 쓰는 일은 register.tsx가 한다.

import type { Note, Notes, Phrase } from '../types'

export const DAY_MS = 24 * 60 * 60 * 1000

/** 알았을 때마다 다음 복습까지 늘어나는 날 수. 몰랐으면 첫 칸(1일)으로 돌아간다. */
export const INTERVAL_DAYS = [1, 3, 7, 14, 30] as const

const MAX_NOTES = 1000

/** 새 표현은 최근 24시간에 이만큼까지만 모은다. 하나가 처음 두 달에 다섯 번 복습되니, 하루 복습이 25번쯤이다. */
export const NEW_PER_DAY = 5

/** 복습할 때가 된 표현이 이만큼 쌓이면, 복습을 먼저 하도록 새 표현을 모으지 않는다. */
export const MAX_DUE = 10

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
      notes[id] = note
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
 * 복습할 때가 된 표현 하나. 퀴즈에 답한 적 있는 표현을 처음 보는 표현보다 먼저 낸다: 새 표현이 계속
 * 들어와도 3일, 7일 뒤 복습이 밀리지 않게. 같은 무리 안에서는 아직 퀴즈에 안 낸 것, 낸 지 오래된 것,
 * 복습 날이 이른 것부터.
 */
export function pickDue(notes: Notes, now: number): Note | null {
  const due = Object.values(notes).filter(n => n.dueAt <= now)
  const isNew = (n: Note) => (n.seenAt > n.addedAt ? 0 : 1)

  due.sort((a, b) => isNew(a) - isNew(b) || (a.shownAt ?? -1) - (b.shownAt ?? -1) || a.dueAt - b.dueAt)

  return due[0] ?? null
}

/** 퀴즈에 냈다고 적어 둔다. */
export function markShown(notes: Notes, id: string, now: number): Notes {
  const note = notes[id]

  return note === undefined ? notes : { ...notes, [id]: { ...note, shownAt: now } }
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
