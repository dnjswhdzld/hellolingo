// 모델 답(JSON)을 카드로 바꾸고, 한국어·영어 문장에서 짝지은 조각의 자리를 찾는다.
// 값만 다루는 함수들이라 엔진 밖(샘플 점검 스크립트)에서도 그대로 쓴다.

import type { Card, Fix, Part, Phrase } from '../types'

const MAX_FIELD_CHARS = 240
const MAX_PARTS = 4 // 짝마다 색을 하나씩 쓴다. 번호 없이 색만으로 구분되는 수까지
const MIN_PARTS = 2 // 이보다 적게 맞으면 짝짓기는 버리고 영어 한 줄과 원문을 보여준다

/**
 * 따옴표·백틱 안을 뺀 본문에 한글이 2자 이상이면 한국어 프롬프트로 본다 (로컬 판단).
 * "change the label to '저장'"처럼 영어 문장 속 한국어 문자열은 영어로 본다.
 */
export function isKorean(text: string): boolean {
  const body = text.replace(/`[^`]*`|'[^']*'|"[^"]*"|“[^”]*”|‘[^’]*’/g, ' ')
  const hangul = (body.match(/[가-힣ㄱ-ㆎ]/g) ?? []).length

  return hangul >= 2
}

/** 모델 답(JSON)을 카드로. 모양이 틀리면 null. 한국어 카드에는 `prompt`를 원문으로 붙인다. */
export function parseCard(korean: boolean, reply: string, prompt: string): Card | null {
  const data = parseObject(reply)

  if (data === null) {
    return null
  }

  if (korean) {
    const english = str(data.english)

    if (english === null) {
      return null
    }

    const original = str(translatedPart(data.original, prompt, list(data.parts).map(toPart).filter(notNull)))

    return { kind: 'ko', english, original, parts: matchedParts(data, original, english), phrases: phrasesIn(data, english) }
  }

  const fixes = list(data.fixes).map(toFix).filter(notNull).slice(0, 3)

  if (fixes.length > 0) {
    return { kind: 'en-fix', fixes }
  }

  const phrase = toPhrase(data.natural)

  return phrase === null ? null : { kind: 'en-natural', phrase }
}

/**
 * 프롬프트에서 영어로 옮긴 부분. 붙여넣은 로그·커밋 정보를 빼려고:
 * 1. 모델이 고른 부분이 프롬프트에 (띄어쓰기만 다르게라도) 있으면, 프롬프트에 쓰인 그대로 잘라 온다.
 * 2. 없으면, 짝지은 한국어 조각들(모델이 그대로 옮긴 것)이 프롬프트에서 차지하는 앞뒤 범위.
 * 3. 그것도 안 되면 프롬프트 전체.
 */
export function translatedPart(stated: unknown, prompt: string, parts: readonly Part[] = []): string {
  return statedIn(stated, prompt) ?? partsSpan(parts, prompt) ?? prompt
}

/** 짝지은 한국어 조각이 2개 이상 프롬프트에 있으면, 처음 조각부터 마지막 조각(뒤의 ?.!까지)까지 */
function partsSpan(parts: readonly Part[], prompt: string): string | null {
  const spans = locate(prompt, parts.map(p => p.ko)).filter(notNull)

  if (spans.length < MIN_PARTS) {
    return null
  }

  const start = Math.min(...spans.map(s => s.start))
  let end = Math.max(...spans.map(s => s.end))

  while (end < prompt.length && /[\s?.!？。！]/.test(prompt[end] ?? '')) {
    end++
  }

  return prompt.slice(start, end).trim()
}

/** 모델이 고른 부분을 공백을 무시하고 프롬프트에서 찾아, 프롬프트에 쓰인 그대로 잘라 온다. 없으면 null. */
function statedIn(stated: unknown, prompt: string): string | null {
  const part = typeof stated === 'string' ? stated.replace(/\s+/g, '') : ''

  if (part === '') {
    return null
  }

  // 공백을 뺀 글자마다 프롬프트에서의 자리를 적어 두고, 공백을 뺀 채로 찾는다.
  const at: number[] = []
  let packed = ''

  for (let i = 0; i < prompt.length; i++) {
    const ch = prompt[i] ?? ''

    if (!/\s/.test(ch)) {
      at.push(i)
      packed += ch
    }
  }

  const start = packed.indexOf(part)
  const from = at[start]
  const to = at[start + part.length - 1]

  return start < 0 || from === undefined || to === undefined ? null : prompt.slice(from, to + 1)
}

/** 핵심 표현은 영어 문장에 실제로 있는 첫 하나만. 문장 밖에서 지어낸 표현은 버린다. */
function phrasesIn(data: Record<string, unknown>, english: string): Phrase[] {
  return list(data.phrases)
    .map(toPhrase)
    .filter(notNull)
    .filter(p => isInSentence(p.en, english))
    .slice(0, 1)
}

/**
 * 표현의 낱말이 문장에 충분히 있는지. "Want me to ...?"의 자리표시(..., ~, sb, sth)와 관사는
 * 빼고 세서, "open an MR"과 "open the MR"처럼 관사만 다른 건 같은 표현으로 본다.
 */
export function isInSentence(expression: string, sentence: string): boolean {
  const said = new Set(words(sentence))
  const asked = words(expression.replace(/\.\.\.|…|~|\b(sb|sth|someone|something)\b/gi, ' ')).filter(
    w => !ARTICLES.has(w),
  )

  return asked.length > 0 && asked.filter(w => said.has(w)).length / asked.length >= 0.6
}

const ARTICLES: ReadonlySet<string> = new Set(['a', 'an', 'the'])

function words(text: string): string[] {
  return text.toLowerCase().match(/[a-z0-9]+(?:'[a-z]+)?/g) ?? []
}

/** 한국어·영어 짝. 두 문장 모두에서 찾은 것만 남기고, 그런 짝이 2개가 안 되면 짝짓기는 버린다. */
function matchedParts(data: Record<string, unknown>, korean: string | null, english: string): readonly Part[] {
  if (korean === null) {
    return []
  }

  const parts = list(data.parts).map(toPart).filter(notNull).slice(0, MAX_PARTS)
  const inKorean = locate(korean, parts.map(p => p.ko))
  const inEnglish = locate(english, parts.map(p => p.en))
  const found = parts.filter((_, i) => inKorean[i] !== null && inEnglish[i] !== null)

  return found.length >= MIN_PARTS ? found : []
}

/** 조각 하나가 문장에서 차지하는 자리: [start, end) */
export type Span = { start: number; end: number }

/**
 * 문장에서 각 조각이 쓰인 자리. 대소문자는 가리지 않고, 앞 조각이 차지한 자리와
 * 겹치지 않는 첫 자리를 찾는다. 못 찾은 조각은 null.
 */
export function locate(sentence: string, pieces: readonly string[]): (Span | null)[] {
  const lower = sentence.toLowerCase()
  const taken: Span[] = []

  return pieces.map(piece => {
    const target = piece.toLowerCase()

    for (let at = lower.indexOf(target); target !== '' && at >= 0; at = lower.indexOf(target, at + 1)) {
      const span = { start: at, end: at + target.length }

      if (!taken.some(t => span.start < t.end && t.start < span.end)) {
        taken.push(span)

        return span
      }
    }

    return null
  })
}

/** 문장의 한 토막: 짝지은 조각이면 그 짝의 번호(0부터, 한국어 순서), 아니면 null */
export type Segment = { text: string; pair: number | null }

/** 문장을 짝지은 조각과 그 사이 글로 나눈다. 순서는 문장에 쓰인 그대로. */
export function segments(sentence: string, pieces: readonly string[]): Segment[] {
  const spans = locate(sentence, pieces)
    .map((span, pair) => (span === null ? null : { ...span, pair }))
    .filter(notNull)
    .sort((a, b) => a.start - b.start)
  const out: Segment[] = []
  let at = 0

  for (const span of spans) {
    if (span.start > at) {
      out.push({ text: sentence.slice(at, span.start), pair: null })
    }

    out.push({ text: sentence.slice(span.start, span.end), pair: span.pair })
    at = span.end
  }

  if (at < sentence.length) {
    out.push({ text: sentence.slice(at), pair: null })
  }

  return out
}

/** 답에서 첫 `{`부터 마지막 `}`까지를 JSON 객체로. 아니면 null. */
function parseObject(reply: string): Record<string, unknown> | null {
  const start = reply.indexOf('{')
  const end = reply.lastIndexOf('}')

  if (start < 0 || end <= start) {
    return null
  }

  try {
    const data: unknown = JSON.parse(reply.slice(start, end + 1))

    return isObject(data) ? data : null
  } catch {
    return null
  }
}

function toPart(v: unknown): Part | null {
  if (!isObject(v)) {
    return null
  }

  const ko = str(v.ko)
  const en = str(v.en)

  return ko === null || en === null ? null : { ko, en }
}

function toPhrase(v: unknown): Phrase | null {
  if (!isObject(v)) {
    return null
  }

  const en = str(v.en)
  const ko = str(v.ko)

  return en === null || ko === null ? null : { en, ko, example: str(v.example) ?? '' }
}

function toFix(v: unknown): Fix | null {
  if (!isObject(v)) {
    return null
  }

  const wrong = str(v.wrong)
  const right = str(v.right)

  if (wrong === null || right === null || wrong === right) {
    return null
  }

  return { wrong, right, why: str(v.why) ?? '' }
}

function isObject(v: unknown): v is Record<string, unknown> {
  return typeof v === 'object' && v !== null && !Array.isArray(v)
}

function list(v: unknown): readonly unknown[] {
  return Array.isArray(v) ? v : []
}

function str(v: unknown): string | null {
  if (typeof v !== 'string') {
    return null
  }

  const s = v.replace(/\s+/g, ' ').trim()

  if (s === '') {
    return null
  }

  return s.length > MAX_FIELD_CHARS ? `${s.slice(0, MAX_FIELD_CHARS)}…` : s
}

export function notNull<T>(v: T | null): v is T {
  return v !== null
}
