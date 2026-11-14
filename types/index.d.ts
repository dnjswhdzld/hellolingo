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

/** 학습하기에서 연습하는 배울 점: 내 문장이 영어로 갈 때 그대로 옮겨지지 않는 한 곳 */
export type Point = {
  /** order: 영어에서 조각의 자리가 바뀐다. chunk: 통째로 다시 쓰는 부탁 덩어리 */
  type: 'order' | 'chunk'
  /** 한국어 틀. 예: "~하는 버튼" */
  ko: string
  /** 영어 틀. 예: "a button to ~" */
  en: string
  /** 용어 없이 쓰임을 말하는 한 줄. 종류마다 정해 둔 말이다 */
  hint: string
}

/** 조각 맞추기 문제 하나: 새 한국어 문장과, 그 영어를 영어 순서로 나눈 조각들. 조각마다 한국어 짝이 있다. */
export type Drill = { ko: string; parts: readonly Part[] }

/** 학습하기를 한 번 눌렀을 때 모델이 만든 것: 배울 점과 문제들 */
export type Lesson = { point: Point; drills: readonly Drill[] }

/** 표현 노트의 한 줄: 카드에 나온 표현이나 학습하기에서 연습한 배울 점, 그리고 그 복습 일정 (간격 반복) */
export type Note = Phrase & {
  /** 처음 모은 때 (ms) */
  addedAt: number
  /** 마지막으로 보거나 답한 때 (ms) */
  seenAt: number
  /** 연속으로 알았던 횟수. 0은 새 표현이거나 마지막에 몰랐던 표현 */
  level: number
  /** 다음 복습할 때 (ms) */
  dueAt: number
  /** 마지막으로 퀴즈에 낸 때 (ms). 답하지 않고 넘어간 표현이 바로 또 나오지 않게 */
  shownAt: number | null
  /** 학습하기에서 연습한 배울 점. 없으면 카드의 핵심 표현이다 */
  point?: Point
  /** 배울 점을 복습할 때 낼 문제들. 앞에서부터 내고, 낸 것은 맨 뒤로 보낸다 */
  drills?: readonly Drill[]
}

/** 표현 노트 전체: noteId(en) → 노트 */
export type Notes = Record<string, Note>

/** 조각 맞추기를 푸는 중 */
export type Arrange = {
  drill: Drill
  /** 버튼으로 보여 줄 조각의 순서 (drill.parts의 번호). 정답 순서와 다르게 섞여 있다 */
  shown: readonly number[]
  /** 영어 순서대로 맞게 놓은 조각 수 */
  placed: number
  /** 다 맞게 놓았으면 right, 순서가 틀렸으면 wrong, 푸는 중이면 null */
  result: 'right' | 'wrong' | null
  /** 한국어 조각에 영어 조각과 같은 색을 칠해 돕는지 */
  colors: boolean
}

/** 떠올리기 한 번: 한국어 뜻을 보고 영어를 머릿속으로 떠올린다 */
export type Recall = { isRevealed: boolean; answer: 'knew' | 'forgot' | null }

/** 프롬프트 위 오른쪽의 공부 칸. 학습자가 버튼을 눌렀을 때만 열린다. */
export type Study = { id: number } & (
  | { view: 'list' }
  | { view: 'making' }
  | { view: 'no-lesson'; reason: 'none' | 'failed' }
  | {
      view: 'lesson'
      point: Point
      /** 지금 풀 문제들. 첫 문제는 색으로 돕고, 다음 문제는 돕지 않는다 */
      drills: readonly Drill[]
      /** 지금 푸는 문제 번호 (0부터) */
      step: number
      arrange: Arrange
      /** 끝낸 문제 가운데 맞힌 수 */
      rights: number
    }
  | {
      view: 'quiz'
      /** review: 복습할 때가 된 표현. practice: 노트에서 골라, 복습 날이 되기 전에 떠올려 보는 표현 */
      mode: 'review' | 'practice'
      noteId: string
      ko: string
      en: string
      example: string
      point: Point | null
      /** 마지막으로 본 지 며칠 */
      seenDaysAgo: number
      /** 배울 점이면 조각 맞추기, 핵심 표현이면 떠올리기. 둘 중 하나만 있다 */
      arrange: Arrange | null
      recall: Recall | null
      /** 답한 뒤 다음 복습까지 며칠. 일정이 그대로면 null */
      nextInDays: number | null
      isAnswered: boolean
      /** 답한 뒤에도 복습할 표현이 남았는지 */
      hasMore: boolean
    }
  | { view: 'all-done' }
)

/** 하루 동안의 학습 기록. 학습자의 컴퓨터에만 남는다. */
export type DayStats = {
  /** 화면에 나온 카드 */
  cards: number
  /** 학습하기를 누른 수 */
  lessons: number
  /** 학습하기에서 푼 조각 맞추기와 그 가운데 맞힌 수 */
  drills: number
  drillsRight: number
  /** 복습할 때가 된 표현에 답한 수와 그 가운데 떠올린 수 */
  reviews: number
  knew: number
  /** 그 가운데 지난번에 본 지 3일 이상 지난 복습. 간격이 알맞은지 보는 기억률 */
  longReviews: number
  longKnew: number
  /** 복습 날이 되기 전에 노트에서 골라 떠올린 수 */
  practices: number
}

/** 날짜(1970년 1월 1일부터 UTC로 센 날 수) → 그날의 기록 */
export type Stats = Record<string, DayStats>

declare module 'claude-code' {
  interface PluginState {
    'hellolingo': {
      layer: Layer
      study: Study | null
      notes: Notes
      stats: Stats
    }
  }
}
