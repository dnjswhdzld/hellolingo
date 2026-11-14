// 학습 기록: 날마다 카드, 학습하기, 복습을 몇 번 했는지 센다. 학습자의 컴퓨터에만 남고 밖으로 보내지 않는다.
// 5개, 10개, 간격 같은 값을 실제 기록으로 다시 정하려고 모은다 (docs/learning-design.md의 "무엇을 재나").
// 값만 다루는 함수들이다. 저장소에서 읽고 쓰는 일은 register.tsx가 한다.

import type { DayStats, Stats } from '../types'
import { DAY_MS } from './notes'

/** 이만큼 지난 날의 기록은 지운다 */
const KEEP_DAYS = 400

/** 이 이상 지나서 한 복습만 기억률에 넣는다. 하루 뒤 복습은 거의 다 떠올리니 간격이 알맞은지 알려 주지 않는다. */
export const LONG_DAYS = 3

const EMPTY: DayStats = {
  cards: 0,
  lessons: 0,
  drills: 0,
  drillsRight: 0,
  reviews: 0,
  knew: 0,
  longReviews: 0,
  longKnew: 0,
  practices: 0,
}

const FIELDS = Object.keys(EMPTY) as (keyof DayStats)[]

export function dayKey(now: number): string {
  return String(Math.floor(now / DAY_MS))
}

/** 오늘 기록에 더한다. 오래된 날은 지운다. */
export function bump(stats: Stats, now: number, add: Partial<DayStats>): Stats {
  const key = dayKey(now)
  const today = stats[key] ?? EMPTY
  const oldest = Math.floor(now / DAY_MS) - KEEP_DAYS
  const kept = Object.fromEntries(Object.entries(stats).filter(([k]) => Number(k) > oldest))

  return { ...kept, [key]: Object.fromEntries(FIELDS.map(f => [f, today[f] + (add[f] ?? 0)])) as DayStats }
}

/** 복습 하나에 답한 기록 */
export function reviewed(knew: boolean, daysSinceSeen: number): Partial<DayStats> {
  const isLong = daysSinceSeen >= LONG_DAYS

  return { reviews: 1, knew: knew ? 1 : 0, longReviews: isLong ? 1 : 0, longKnew: isLong && knew ? 1 : 0 }
}

/** 최근 7일(오늘 포함)을 합친 것과, 그 가운데 학습하기나 복습을 한 날 수 */
export function lastWeek(stats: Stats, now: number): DayStats & { studyDays: number } {
  const today = Math.floor(now / DAY_MS)
  const days = Array.from({ length: 7 }, (_, i) => stats[String(today - i)]).filter(d => d !== undefined)
  const sum = Object.fromEntries(FIELDS.map(f => [f, days.reduce((n, d) => n + d[f], 0)])) as DayStats

  return { ...sum, studyDays: days.filter(d => d.lessons + d.reviews + d.practices > 0).length }
}

/** 저장소에서 읽은 값을 기록으로. 모양이 틀린 날은 버린다. */
export function asStats(v: unknown): Stats {
  if (typeof v !== 'object' || v === null || Array.isArray(v)) {
    return {}
  }

  return Object.fromEntries(
    Object.entries(v).filter(
      (e): e is [string, DayStats] =>
        /^\d+$/.test(e[0]) &&
        typeof e[1] === 'object' &&
        e[1] !== null &&
        FIELDS.every(f => typeof (e[1] as Record<string, unknown>)[f] === 'number'),
    ),
  )
}
