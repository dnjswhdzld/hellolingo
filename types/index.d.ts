/** 학습할 표현 하나: 영어 / 한국어 뜻 / 짧은 예문 */
export type Phrase = { en: string; ko: string; example: string }

/** 영어 프롬프트에서 고칠 부분 하나 */
export type Fix = { wrong: string; right: string; why: string }

/** 한국어 문장의 한 조각과, 그 조각이 영어에서 된 조각. 둘 다 문장에 쓰인 그대로. */
export type Part = { ko: string; en: string }

/**
 * 번역한 영어 한 문장과 그 짝짓기. parts는 한국어 순서이고, 두 문장 모두에서 찾은 것만
 * 남는다 (못 맞췄으면 빈 배열). original: 번역하기 전 한국어.
 */
export type SentenceMap = {
  english: string
  original: string | null
  parts: readonly Part[]
  phrases: readonly Phrase[]
}

/** 프롬프트 위에 보여줄 카드 */
export type Card =
  | ({ kind: 'ko' } & SentenceMap)
  | { kind: 'en-fix'; fixes: readonly Fix[] }
  | { kind: 'en-natural'; phrase: Phrase }

/**
 * 프롬프트 위 영역의 카드 자리. card는 보이는 카드이고 cardSeq는 그 카드를 만든 프롬프트의 번호다.
 * pendingSeq는 영어로 옮기는 중인 가장 최근 프롬프트의 번호. 옮기는 중이 아니면 null.
 */
export type Layer = { card: Card | null; cardSeq: number; pendingSeq: number | null }

/** 표현 노트의 한 줄: 카드에 나온 표현과 그 복습 일정 (간격 반복) */
export type Note = Phrase & {
  /** 처음 모은 때 (ms) */
  addedAt: number
  /** 마지막으로 보거나 답한 때 (ms) */
  seenAt: number
  /** 연속으로 알았던 횟수. 0은 새 표현이거나 마지막에 몰랐던 표현 */
  level: number
  /** 다음 복습할 때 (ms) */
  dueAt: number
  /** 마지막으로 퀴즈에 낸 때 (ms). 답하지 않고 넘어간 표현만 계속 나오지 않게 */
  shownAt: number | null
}

/** 표현 노트 전체: noteId(en) → 노트 */
export type Notes = Record<string, Note>

/** Claude가 작업하는 동안 오른쪽에 내는 복습 퀴즈 */
export type Quiz = {
  /** 이 퀴즈를 낸 프롬프트의 번호. 늦게 온 타이머가 다음 퀴즈를 건드리지 않게 */
  id: number
  noteId: string
  en: string
  ko: string
  example: string
  /** 마지막으로 본 지 며칠 */
  seenDaysAgo: number
  isRevealed: boolean
  /** 누른 답. 아직 안 눌렀으면 null */
  answer: 'knew' | 'forgot' | null
  /** 답한 뒤 다음 복습까지 며칠 */
  nextInDays: number | null
}

declare module 'claude-code' {
  interface PluginState {
    'hellolingo': {
      layer: Layer
      quiz: Quiz | null
      notes: Notes
    }
  }
}
