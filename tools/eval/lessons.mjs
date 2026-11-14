//   node tools/eval/lessons.mjs                 사례마다 3번씩: 카드를 만들고, 그 카드로 학습하기 문제를 만든다
//   node tools/eval/lessons.mjs --runs 1
//   node tools/eval/lessons.mjs --judge         sonnet이 문제 문장을 원어민 편집자처럼 판정한다 (비용이 더 든다)
//   node tools/eval/lessons.mjs --parse         haiku를 부르지 않고 저장해 둔 답만 다시 센다
//   node tools/eval/lessons.mjs --hooks ../base/hooks --out tools/eval/out/lessons-before

import { spawn } from 'node:child_process'
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { register } from 'node:module'
import { tmpdir } from 'node:os'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

// hooks/의 파일은 서로를 확장자 없이 부른다('./cards'). Claude Code는 그대로 찾지만 Node는 못 찾으니 .ts를 붙여 준다.
register(
  `data:text/javascript,${encodeURIComponent(`
export async function resolve(specifier, context, next) {
  try {
    return await next(specifier, context)
  } catch (error) {
    if (specifier.startsWith('.') && !/\\.[a-z]+$/.test(specifier)) return next(specifier + '.ts', context)
    throw error
  }
}`)}`,
)

const args = process.argv.slice(2)
const option = name => (args.includes(name) ? args[args.indexOf(name) + 1] : undefined)
const here = dirname(fileURLToPath(import.meta.url))
const hooks = resolve(option('--hooks') ?? join(here, '..', '..', 'hooks'))
const out = resolve(option('--out') ?? join(here, 'out', 'lessons'))
const { EFFORT, MODEL, SYSTEM, cardPrompt, lessonPrompt } = await import(join(hooks, 'prompts.ts'))
const { parseCard } = await import(join(hooks, 'cards.ts'))
const { DRILLS_NOW, drillSentence, parseLesson } = await import(join(hooks, 'lessons.ts'))

// 하한. 학습하기를 누르면 지금 풀 문제가 나와야 하고, 판정하면 문제 문장이 자연스럽고 조각 순서가 하나뿐이어야 한다.
const FLOOR = { made: 0.8, drills: 0.85 }
const JUDGE_MODEL = 'sonnet'
const JUDGE = [
  'You are a careful native English editor. Each numbered item is a Korean work request to an AI assistant,',
  'its English, and the English split into pieces. For each item answer two questions:',
  '"natural": is the English a natural, correct way to say the Korean in a work message?',
  '"unique": would a native speaker write these exact pieces in only this order, with this meaning? Answer false',
  'only if another order of the same pieces is something people really write in a work message and means the same',
  '(like moving "in three lines" or "please" to the start). Ignore orders that are stilted or change the meaning.',
  'Reply with JSON only: {"items": [{"natural": true, "unique": true, "note": "short reason when false"}]}',
].join('\n')

const runs = Number(option('--runs') ?? 3)
const parseOnly = args.includes('--parse')
const judge = args.includes('--judge')
const jobs = 6
const cases = JSON.parse(readFileSync(join(here, 'lessons.json'), 'utf8'))
const trials = cases.flatMap(c => Array.from({ length: runs }, (_, i) => ({ c, run: i + 1, file: join(out, `${c.id}-${i + 1}.json`) })))

mkdirSync(out, { recursive: true })

if (!parseOnly) {
  let next = 0
  const worker = async () => {
    while (next < trials.length) {
      const t = trials[next++]

      try {
        const cardReply = await ask(MODEL, SYSTEM, cardPrompt(true, t.c.prompt), EFFORT)
        const card = parseCard(true, cardReply.result ?? '', t.c.prompt)
        const korean = card?.kind === 'ko' ? (card.original ?? t.c.prompt) : null
        const lessonReply = korean === null ? null : await ask(MODEL, SYSTEM, lessonPrompt(korean, card.english), EFFORT)
        const lesson = lessonReply === null ? null : parseLesson(lessonReply.result ?? '', korean)
        const drills = lesson?.drills ?? []
        const verdict =
          judge && drills.length > 0
            ? await ask(
                JUDGE_MODEL,
                JUDGE,
                drills
                  .map((d, i) => `${i + 1}. ${d.ko}\n   ${drillSentence(d)}\n   pieces: ${d.parts.map(p => `[${p.en}]`).join(' ')}`)
                  .join('\n'),
              )
            : null

        writeFileSync(t.file, JSON.stringify({ card, cardReply, lessonReply, verdict }, null, 2))
      } catch (e) {
        // 실패한 시도는 지난 답이 남지 않게 빈 기록으로 덮는다. 세기에서 "답이 없는 시도"로 잡힌다.
        writeFileSync(t.file, JSON.stringify({ error: e.message }))
        console.error(`${t.c.id} #${t.run}: ${e.message}`)
      }
      process.stderr.write('.')
    }
  }
  await Promise.all(Array.from({ length: jobs }, worker))
  process.stderr.write('\n')
}

let cost = 0
let missing = 0
let made = 0
let total = 0
let judged = 0
let goodDrills = 0
let judgedDrills = 0
const types = {}

for (const t of trials) {
  const saved = existsSync(t.file) ? JSON.parse(readFileSync(t.file, 'utf8')) : { error: 'no file' }

  if (saved.error !== undefined) {
    missing++
    continue
  }

  const original = saved.card?.original ?? t.c.prompt
  const lesson = saved.lessonReply === null ? null : parseLesson(saved.lessonReply.result ?? '', original)
  const isMade = lesson !== null && lesson.drills.length >= DRILLS_NOW
  const items = saved.verdict === null ? null : parseVerdict(saved.verdict.result ?? '')

  cost += (saved.cardReply?.total_cost_usd ?? 0) + (saved.lessonReply?.total_cost_usd ?? 0)
  total++
  made += isMade ? 1 : 0
  types[lesson?.point.type ?? 'none'] = (types[lesson?.point.type ?? 'none'] ?? 0) + 1
  judged += items === null ? 0 : 1

  const point = lesson === null ? '(배울 점 없음)' : `[${lesson.point.type}] ${lesson.point.ko} → ${lesson.point.en} | ${lesson.point.hint}`

  console.log(`${isMade ? '    ' : 'NONE'} ${t.c.id} #${t.run}  ${point}`)

  for (const [i, d] of (lesson?.drills ?? []).entries()) {
    const v = items?.[i]
    const ok = v === undefined ? null : v.natural === true && v.unique === true

    if (v !== undefined) {
      judgedDrills++
      goodDrills += ok ? 1 : 0
    }

    const mark = ok === null ? ' ' : ok ? '✓' : '✗'

    console.log(`      ${mark} ${d.ko}  →  ${d.parts.map(p => `[${p.en}]`).join(' ')}${ok === false ? `  (${v.note ?? ''})` : ''}`)
  }
}

console.log('')

let failed = false
const line = (label, pass, all, floor) => {
  const ok = all > 0 && pass / all >= floor

  failed ||= !ok
  console.log(`${ok ? 'ok  ' : 'FAIL'} ${label}: ${pass}/${all} (하한 ${floor * 100}%)`)
}

line(`학습하기를 누르면 문제 ${DRILLS_NOW}개 이상이 나온다`, made, total, FLOOR.made)

if (judgedDrills > 0) {
  line('문제 문장이 자연스럽고 조각 순서가 하나뿐이다 (sonnet 판정)', goodDrills, judgedDrills, FLOOR.drills)
}

console.log(`배울 점 종류: ${Object.entries(types).map(([k, n]) => `${k} ${n}`).join(', ')}`)

if (missing > 0) {
  failed = true
  console.log(`FAIL 답이 없는 시도 ${missing}개`)
}

console.log(`haiku 비용 $${cost.toFixed(4)}${judged > 0 ? ' (sonnet 판정 비용은 빼고)' : ''}`)
process.exitCode = failed ? 1 : 0

function parseVerdict(text) {
  try {
    return JSON.parse(text.slice(text.indexOf('{'), text.lastIndexOf('}') + 1)).items ?? null
  } catch {
    return null
  }
}

/** claude는 실행한 폴더의 CLAUDE.md와 설정을 읽는다. 그것이 답에 섞이지 않게 빈 폴더에서 부른다. */
function ask(model, system, prompt, effort) {
  const cli = ['-p', '--model', model, ...(effort === undefined ? [] : ['--effort', effort]), '--tools', '', '--system-prompt', system]
  const quiet = ['--setting-sources', 'project', '--no-session-persistence', '--output-format', 'json']

  return new Promise((resolve, reject) => {
    const child = spawn('claude', [...cli, ...quiet], { cwd: tmpdir(), stdio: ['pipe', 'pipe', 'inherit'] })
    let stdout = ''

    child.stdout.on('data', chunk => (stdout += chunk))
    child.on('error', reject)
    child.on('close', code => (code === 0 ? resolve(JSON.parse(stdout)) : reject(new Error(`claude exited with ${code}`))))
    child.stdin.end(prompt)
  })
}
