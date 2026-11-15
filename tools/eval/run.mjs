//   node tools/eval/run.mjs              사례마다 3번씩 haiku를 부른다
//   node tools/eval/run.mjs --runs 1     사례마다 1번씩
//   node tools/eval/run.mjs --only keep-look,fix-test
//   node tools/eval/run.mjs --parse      haiku를 부르지 않고 저장해 둔 답만 다시 센다
//   node tools/eval/run.mjs --judge      한국어 카드의 영어를 sonnet이 원어민 편집자처럼 판정한다 (비용이 더 든다)
//   node tools/eval/run.mjs --hooks ../base/hooks --out tools/eval/out/before
//                                        다른 체크아웃의 지시문과 파서로 세고, 답을 다른 폴더에 둔다

import { spawn } from 'node:child_process'
import { existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

const args = process.argv.slice(2)
const option = name => (args.includes(name) ? args[args.indexOf(name) + 1] : undefined)
const here = dirname(fileURLToPath(import.meta.url))
const hooks = resolve(option('--hooks') ?? join(here, '..', '..', 'hooks'))
const out = resolve(option('--out') ?? join(here, 'out'))
const { EFFORT, MODEL, SYSTEM, cardPrompt } = await import(join(hooks, 'prompts.ts'))
const { isKorean, parseCard } = await import(join(hooks, 'cards.ts'))

const MAX_ORIGINAL_CHARS = 40

// floor는 2026-10-28에 사례마다 9번씩 잰 값(맞는 영어 72/72, 틀린 영어 65/72)에서 haiku의 흔들림만큼 뺀 하한이다.
const EXPECT = {
  keep: { label: '맞는 영어는 고치지 않는다', floor: 0.95, pass: card => card?.kind === 'en-natural' },
  fix: { label: '틀리거나 어색한 영어는 고친다', floor: 0.85, pass: card => card?.kind === 'en-fix' },
  ko: {
    label: '한국어는 한 문장을 짝지어 옮긴다',
    floor: 0.85,
    pass: card => card?.kind === 'ko' && card.parts.length >= 2 && (card.original ?? '').length <= MAX_ORIGINAL_CHARS,
  },
}

const JUDGE_MODEL = 'sonnet'
const JUDGE_BATCH = 20
// 2026-11-15에 잰 값은 83~94%였다. sonnet 판정도 같은 답에 흔들려서 하한을 넉넉히 둔다.
const JUDGE_FLOOR = 0.75
const JUDGE = [
  'You are a careful native English editor. Each numbered item is a Korean request to an AI assistant and its English.',
  '"natural": is the English correct and natural, as a native speaker would write it in a work message?',
  '"faithful": does it say what the Korean says, with nothing important dropped, added or changed?',
  'Reply with JSON only: {"items": [{"natural": true, "faithful": true, "note": "short reason when either is false"}]}',
].join('\n')

const runs = Number(option('--runs') ?? 3)
const only = option('--only')?.split(',')
const parseOnly = args.includes('--parse')
const judge = args.includes('--judge')
const jobs = 6

const cases = JSON.parse(readFileSync(join(here, 'cases.json'), 'utf8')).filter(c => !only || only.includes(c.id))
const trials = cases.flatMap(c => Array.from({ length: runs }, (_, i) => ({ c, run: i + 1, file: join(out, `${c.id}-${i + 1}.json`) })))

mkdirSync(out, { recursive: true })

if (!parseOnly) {
  let next = 0
  const worker = async () => {
    while (next < trials.length) {
      const t = trials[next++]
      rmSync(t.file, { force: true })
      const reply = await ask(cardPrompt(isKorean(t.c.prompt), t.c.prompt)).catch(e => (console.error(`${t.c.id} #${t.run}: ${e.message}`), null))

      if (reply !== null) {
        writeFileSync(t.file, reply)
      }
      process.stderr.write('.')
    }
  }
  await Promise.all(Array.from({ length: jobs }, worker))
  process.stderr.write('\n')
}

let cost = 0
let missing = 0
const tally = {}
const koCards = []

for (const t of trials) {
  if (!existsSync(t.file)) {
    missing++
    continue
  }

  const reply = JSON.parse(readFileSync(t.file, 'utf8'))
  const card = reply.is_error ? null : parseCard(isKorean(t.c.prompt), reply.result ?? '', t.c.prompt)
  const ok = EXPECT[t.c.expect].pass(card)

  cost += reply.total_cost_usd ?? 0
  tally[t.c.expect] ??= { pass: 0, total: 0, phraseless: 0 }
  tally[t.c.expect].total++
  tally[t.c.expect].pass += ok ? 1 : 0
  tally[t.c.expect].phraseless += card?.kind === 'ko' && card.phrases.length === 0 ? 1 : 0

  // 형식을 통과한 카드만 판정한다. 한 문장을 고르지 못한 카드는 위에서 이미 실패로 센다.
  if (card?.kind === 'ko' && ok) {
    koCards.push({ id: `${t.c.id} #${t.run}`, ko: card.original ?? t.c.prompt, en: card.english })
  }

  if (!ok) {
    console.log(`FAIL ${t.c.id} #${t.run}  ${describe(card)}`)
  }
}

console.log('')

let failed = false

for (const [expect, { pass, total, phraseless }] of Object.entries(tally)) {
  const ok = pass / total >= EXPECT[expect].floor
  const extra = expect === 'ko' ? `, 핵심 표현 없음 ${phraseless}` : ''

  failed ||= !ok
  console.log(`${ok ? 'ok  ' : 'FAIL'} ${EXPECT[expect].label}: ${pass}/${total} (하한 ${EXPECT[expect].floor * 100}%)${extra}`)
}

// 형식이 맞아도 영어가 어색하거나 뜻이 빠지면 학습자는 틀린 영어를 배운다. 그것은 판정으로만 잴 수 있다.
if (judge && koCards.length > 0) {
  const verdicts = []

  for (let at = 0; at < koCards.length; at += JUDGE_BATCH) {
    const batch = koCards.slice(at, at + JUDGE_BATCH)
    const reply = await ask(batch.map((c, i) => `${i + 1}. ${c.ko}\n   ${c.en}`).join('\n'), JUDGE_MODEL, JUDGE)
    const text = JSON.parse(reply).result ?? ''
    const items = JSON.parse(text.slice(text.indexOf('{'), text.lastIndexOf('}') + 1)).items ?? []

    batch.forEach((c, i) => verdicts.push({ ...c, ...(items[i] ?? {}) }))
  }

  const good = verdicts.filter(v => v.natural === true && v.faithful === true)
  const ok = good.length / verdicts.length >= JUDGE_FLOOR

  for (const v of verdicts.filter(v => !good.includes(v))) {
    console.log(`ODD  ${v.id}  ${v.ko}  →  ${v.en}  (${v.note ?? ''})`)
  }

  failed ||= !ok
  console.log(`${ok ? 'ok  ' : 'FAIL'} 한국어 카드의 영어가 자연스럽고 뜻이 같다 (sonnet 판정): ${good.length}/${verdicts.length} (하한 ${JUDGE_FLOOR * 100}%)`)
}

if (missing > 0) {
  failed = true
  console.log(`FAIL 답이 없는 시도 ${missing}개`)
}

console.log(`haiku 비용 $${cost.toFixed(4)}`)
process.exitCode = failed ? 1 : 0

/** claude는 실행한 폴더의 CLAUDE.md와 설정을 읽는다. 그것이 답에 섞이지 않게 빈 폴더에서 부른다. */
function ask(prompt, model = MODEL, system = SYSTEM) {
  const cli = ['-p', '--model', model, ...(model === MODEL ? ['--effort', EFFORT] : []), '--tools', '', '--system-prompt', system]
  const quiet = ['--setting-sources', 'project', '--no-session-persistence', '--output-format', 'json']

  return new Promise((resolve, reject) => {
    const child = spawn('claude', [...cli, ...quiet], { cwd: tmpdir(), stdio: ['pipe', 'pipe', 'inherit'] })
    let stdout = ''

    child.stdout.on('data', chunk => (stdout += chunk))
    child.on('error', reject)
    child.on('close', code => (code === 0 ? resolve(stdout) : reject(new Error(`claude exited with ${code}`))))
    child.stdin.end(prompt)
  })
}

function describe(card) {
  switch (card?.kind) {
    case undefined:
      return '카드 없음'
    case 'en-fix':
      return `고침: ${card.fixes.map(f => `${f.wrong} -> ${f.right}`).join(' | ')}`
    case 'en-natural':
      return `자연스러운 표현: ${card.phrase.en}`
    case 'ko':
      return `짝 ${card.parts.length}개, 원문 ${card.original?.length ?? 0}자: ${card.original}`
  }
}
