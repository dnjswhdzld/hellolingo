// 학습하기: 모델이 만든 배울 점과 조각 맞추기 문제를 읽고, 푸는 동안의 상태를 다룬다.
// 값만 다루는 함수들이라 엔진 밖(평가 도구)에서도 그대로 쓴다.

import type { Arrange, Drill, Lesson, Part, Point } from '../types'
import { hasWord, isInSentence, isObject, list, notNull, parseObject, str } from './cards'

/** 조각은 셋이나 넷. 둘이면 순서가 뻔하고, 다섯부터는 맞는 순서가 여럿이 되기 쉽다. */
const MIN_PIECES = 3
const MAX_PIECES = 4
/** 초급자가 한눈에 읽을 수 있는 길이 */
const MAX_WORDS = 14
/** 지금 둘을 풀고, 나머지는 복습 때 낸다 */
const MAX_DRILLS = 4
/** 학습하기 한 번에 푸는 문제 수 */
export const DRILLS_NOW = 2
/**
 * 이 말로 시작하는 조각은 영어에서 문장 맨 앞에도 올 수 있다 ("In three lines, summarize ...").
 * 그런 조각이 첫 조각이 아니면 맞는 순서가 둘이 되어 채점할 수 없으니, 그 문제는 버린다.
 */
const MOVABLE = /^(in|on|at|for|with|without|when|while|after|before|during|by|from|because|if|once|until|unless|please|briefly|quickly|again|now|today|here)\b/i
/** only는 문장 여러 곳에 올 수 있어서 ("Only summarize ...", "Summarize only ..."), 든 문제는 버린다. */
const FLOATING = /\bonly\b/i

/**
 * 모델 답을 학습하기로. 문제마다 모양을 확인해서 쓸 수 없는 문제는 버린다.
 * 배울 점이 없거나, 쓸 만한 문제가 하나도 남지 않으면 null.
 * original: 학습자가 카드에서 본 한국어. 그와 같은 문장은 새 문제가 아니니 버린다.
 */
export function parseLesson(reply: string, original: string): Lesson | null {
  const data = parseObject(reply)
  const point = data === null ? null : toPoint(data.point)

  if (data === null || point === null) {
    return null
  }

  const seen = new Set([squash(original)])
  const drills = list(data.drills)
    .map(toDrill)
    .filter(notNull)
    // "tell me if" 같은 덩어리는 문제 문장에 그대로 있어야 한다. 어순 틀은 낱말이 바뀌므로 보지 않는다.
    .filter(d => point.type !== 'chunk' || isInSentence(point.en, drillSentence(d)))
    .filter(d => {
      const key = squash(d.ko)
      const isNew = !seen.has(key)

      seen.add(key)

      return isNew
    })
    .slice(0, MAX_DRILLS)

  return drills.length === 0 ? null : { point, drills }
}

/** 문제의 영어 문장: 조각을 영어 순서대로 잇는다 */
export function drillSentence(d: Drill): string {
  return d.parts.map(p => p.en).join(' ')
}

/**
 * 조각 맞추기를 시작한다. 조각은 정답 순서와 다르게 섞는다. seed가 같으면 늘 같은 순서라서,
 * 화면을 다시 그려도 버튼이 자리를 옮기지 않는다.
 */
export function startArrange(drill: Drill, colors: boolean, seed: number): Arrange {
  return { drill, shown: shuffled(drill.parts.length, seed + hash(drill.ko)), placed: 0, result: null, colors }
}

/**
 * 조각 하나를 고른다. 영어 순서대로 다음 조각이면 놓고, 아니면 그 문제는 틀린 것으로 끝낸다.
 * 다 놓으면 맞힌 것이다. 끝난 문제나 이미 놓은 조각은 그대로 둔다.
 */
export function pickPiece(a: Arrange, piece: number): Arrange {
  if (a.result !== null || piece < a.placed || piece >= a.drill.parts.length) {
    return a
  }

  if (piece !== a.placed) {
    return { ...a, result: 'wrong' }
  }

  const placed = a.placed + 1

  return { ...a, placed, result: placed === a.drill.parts.length ? 'right' : null }
}

/** 아직 놓지 않은 조각들, 버튼에 보여 줄 순서대로 */
export function piecesLeft(a: Arrange): number[] {
  return a.shown.filter(i => i >= a.placed)
}

/**
 * 복습할 때 낼 순서로 문제를 둔다. 지금 푸는 앞의 둘은 맨 뒤로 보내서, 처음 보는 문장부터 복습하게 한다.
 */
export function drillsForReview(drills: readonly Drill[]): Drill[] {
  return [...drills.slice(DRILLS_NOW), ...drills.slice(0, DRILLS_NOW)]
}

function toPoint(v: unknown): Point | null {
  if (!isObject(v)) {
    return null
  }

  const ko = str(v.ko)
  const en = str(v.en)

  // 낱말 고르기(create와 add처럼)는 맞는 답이 여럿이라 채점할 수 없다. 어순과 덩어리만 다룬다.
  // "[명사] + [설명]" 같은 꼬리표는 학습자에게 보여 줄 수 없으니, 실제 낱말로 쓴 틀만 받는다.
  if ((v.type !== 'order' && v.type !== 'chunk') || ko === null || en === null || /[[\]+]/.test(ko + en)) {
    return null
  }

  return { type: v.type, ko, en, hint: HINT[v.type] }
}

/**
 * 배울 점 아래의 한 줄. 모델에게 받지 않고 정해 둔 말을 쓴다: 모델이 쓴 힌트는 가끔 거꾸로 말했다
 * ("칸 앞에 하는 일을 붙여요"). 틀린 힌트는 없느니만 못하다. 구체적인 것은 바로 위의 틀 줄이 보여 준다.
 */
const HINT: Record<Point['type'], string> = {
  order: '영어는 꾸며 주는 말이 뒤로 가요',
  chunk: '이 말은 한 덩어리로 기억해요',
}

function toDrill(v: unknown): Drill | null {
  if (!isObject(v)) {
    return null
  }

  const ko = str(v.ko)
  const parts: Part[] = []

  for (const p of list(v.parts)) {
    const en = isObject(p) ? str(p.en) : null
    const last = parts.at(-1)

    if (en === null) {
      continue
    }

    // 끝의 "."처럼 글자가 없는 조각은 따로 고를 것이 아니라 앞 조각에 붙인다.
    if (!hasWord(en)) {
      if (last !== undefined) {
        parts[parts.length - 1] = { ...last, en: `${last.en}${en}` }
      }

      continue
    }

    parts.push({ ko: (isObject(p) ? str(p.ko) : null) ?? '', en })
  }

  const english = parts.map(p => p.en).join(' ')
  const keys = parts.map(p => p.en.toLowerCase())

  if (
    ko === null ||
    parts.length < MIN_PIECES ||
    parts.length > MAX_PIECES ||
    english.split(' ').length > MAX_WORDS ||
    // 첫 조각은 문장의 첫머리다. 소문자로 시작하면 조각을 영어 순서로 주지 않은 답이다.
    !/^[A-Z0-9]/.test(english) ||
    parts.slice(1).some(p => MOVABLE.test(p.en)) ||
    FLOATING.test(english) ||
    // 똑같은 조각이 둘이면 어느 쪽을 먼저 놓아도 맞아서 채점이 꼬인다.
    new Set(keys).size !== keys.length
  ) {
    return null
  }

  return { ko, parts }
}

/** 같은 문장인지 견줄 때: 공백과 끝 문장 부호를 무시한다 */
function squash(s: string): string {
  return s.replace(/[\s.?!。？！]+/g, '')
}

/** 0..n-1을 섞는다. 정답 순서(0, 1, 2, ...) 그대로는 내지 않는다. */
function shuffled(n: number, seed: number): number[] {
  const order = Array.from({ length: n }, (_, i) => i)
  let s = seed >>> 0 || 1

  for (let attempt = 0; attempt < 8; attempt++) {
    for (let i = n - 1; i > 0; i--) {
      s = (Math.imul(s, 1664525) + 1013904223) >>> 0
      const j = s % (i + 1)
      const t = order[i] ?? i

      order[i] = order[j] ?? j
      order[j] = t
    }

    if (order.some((v, i) => v !== i)) {
      return order
    }
  }

  // 섞어도 정답 순서만 나오면 한 칸씩 민다.
  return order.map((_, i) => (i + 1) % n)
}

function hash(s: string): number {
  let h = 2166136261

  for (let i = 0; i < s.length; i++) {
    h = Math.imul(h ^ s.charCodeAt(i), 16777619)
  }

  return h >>> 0
}
