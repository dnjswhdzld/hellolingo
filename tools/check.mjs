// CI가 npm 설치 없이 돌리도록 Node 기본 모듈만 쓴다.

import { execFileSync } from 'node:child_process'
import { existsSync, readFileSync, statSync } from 'node:fs'
import { dirname, extname, join, normalize, relative } from 'node:path'
import { fileURLToPath } from 'node:url'

const repo = join(dirname(fileURLToPath(import.meta.url)), '..')
const git = (...args) => execFileSync('git', args, { cwd: repo, encoding: 'utf8' })

const MAX_IMAGE_BYTES = 400 * 1024
const INTERNAL_FILES = ['HANDOFF.md', 'GUIDE-PLAN.md', '.claude/settings.local.json']
const TEXT_EXTENSIONS = new Set(['.md', '.ts', '.tsx', '.mjs', '.js', '.py', '.json', '.yml', '.yaml', '.txt', '.csv', '.sh', ''])
const IMAGE_EXTENSIONS = new Set(['.png', '.jpg', '.jpeg', '.gif', '.webp'])
const ALLOWED_EMAIL_DOMAINS = ['users.noreply.github.com', 'example.invalid', 'example.com', 'example.org']
// 학습자가 읽는 글에 쓰지 않는 문법 용어. docs/learning-design.md의 글쓰기 규칙.
const GRAMMAR_TERMS = ['조사', '어미', '부정사', '수동태', '동명사', '분사', '관계대명사', '전치사']
const LEARNER_DOCS = file => file === 'README.md' || file.startsWith('docs/guide/')
const USER_FACING = file => /^(hooks|types|\.claude-plugin)\//.test(file)

const base = process.env.GITHUB_BASE_REF ? `origin/${process.env.GITHUB_BASE_REF}` : 'origin/main'
const hasBase = (() => {
  try {
    git('rev-parse', '--verify', '--quiet', base)
    return true
  } catch {
    return false
  }
})()

const files = git('ls-files', '--cached', '--others', '--exclude-standard', '-z')
  .split('\0')
  .filter(f => f !== '' && existsSync(join(repo, f)))
const self = relative(repo, fileURLToPath(import.meta.url))
const textFiles = files.filter(f => f !== self && TEXT_EXTENSIONS.has(extname(f)))
const markdown = files.filter(f => extname(f) === '.md')
const read = f => readFileSync(join(repo, f), 'utf8')

const CHECKS = [
  { name: '개인 정보와 비밀 값', run: privacy },
  { name: '내부 문서가 커밋되지 않음', run: () => INTERNAL_FILES.filter(f => files.includes(f)).map(f => `${f}: .gitignore에 있어야 합니다`) },
  { name: '문서 링크와 그림 경로', run: links },
  { name: '그림 크기와 쓰이지 않는 그림', run: images },
  { name: '매니페스트와 CHANGELOG 버전', run: manifest },
  { name: '학습자 글에 문법 용어 없음', run: grammarTerms },
  { name: '커밋 메시지에 작성 도구 표기 없음', run: commitMessages, needsBase: true },
  { name: '동작이 바뀌면 CHANGELOG도', run: changelog, needsBase: true },
]

let failed = false

for (const check of CHECKS) {
  if (check.needsBase && !hasBase) {
    console.log(`skip ${check.name} (${base} 없음)`)
    continue
  }

  const problems = check.run()

  failed ||= problems.length > 0
  console.log(`${problems.length === 0 ? 'ok  ' : 'FAIL'} ${check.name}`)
  problems.forEach(p => console.log(`     ${p}`))
}

process.exitCode = failed ? 1 : 0

function privacy() {
  const patterns = [
    [/\/(?:Users|home)\/[A-Za-z0-9._-]+/, '내 컴퓨터의 홈 경로'],
    [/\/private\/var\/\w|\/var\/folders\/\w/, '내 컴퓨터의 임시 폴더 경로'],
    [/sk-ant-[A-Za-z0-9_-]{8,}/, 'Anthropic API 키 모양의 문자열'],
    [/gh[pousr]_[A-Za-z0-9]{20,}/, 'GitHub 토큰 모양의 문자열'],
  ]
  const email = /[A-Za-z0-9._%+-]+@([A-Za-z0-9.-]+\.[A-Za-z]{2,})/g

  return textFiles.flatMap(f =>
    read(f)
      .split('\n')
      .flatMap((line, i) => [
        ...patterns.filter(([re]) => re.test(line)).map(([, what]) => `${f}:${i + 1}: ${what}`),
        ...[...line.matchAll(email)]
          .filter(m => !ALLOWED_EMAIL_DOMAINS.some(d => m[1] === d || m[1].endsWith(`.${d}`)))
          .map(m => `${f}:${i + 1}: 이메일 주소 ${m[0]}`),
      ]),
  )
}

function links() {
  return markdown.flatMap(f =>
    linksIn(read(f)).flatMap(({ target, line }) => {
      if (/^[a-z]+:/i.test(target)) {
        return []
      }

      const [path, anchor] = target.split('#')
      const file = path === '' ? f : normalize(join(dirname(f), decodeURI(path)))

      if (!existsSync(join(repo, file))) {
        return [`${f}:${line}: 없는 파일 ${target}`]
      }

      return anchor && extname(file) === '.md' && !headingSlugs(read(file)).has(decodeURI(anchor))
        ? [`${f}:${line}: ${file}에 없는 제목 #${anchor}`]
        : []
    }),
  )
}

/** 코드 블록 밖의 [글](대상)과 ![그림](대상) */
function linksIn(text) {
  let inFence = false

  return text.split('\n').flatMap((line, i) => {
    if (/^\s*```/.test(line)) {
      inFence = !inFence
    }

    return inFence ? [] : [...line.replace(/`[^`]*`/g, '').matchAll(/\]\(([^)\s]+)(?:\s+"[^"]*")?\)/g)].map(m => ({ target: m[1], line: i + 1 }))
  })
}

/** GitHub가 제목에 붙이는 앵커: 소문자로, 글자·숫자·공백·하이픈만 남기고, 공백은 하이픈으로 */
function headingSlugs(text) {
  return new Set(
    text
      .split('\n')
      .filter(l => /^#{1,6} /.test(l))
      .map(l => l.replace(/^#+ /, '').trim().toLowerCase().replace(/[^\p{L}\p{N}\s-]/gu, '').replace(/\s/g, '-')),
  )
}

function images() {
  const used = new Set(markdown.flatMap(f => linksIn(read(f)).map(({ target }) => normalize(join(dirname(f), decodeURI(target.split('#')[0]))))))

  return files
    .filter(f => f.startsWith('docs/') && IMAGE_EXTENSIONS.has(extname(f).toLowerCase()))
    .flatMap(f => [
      ...(statSync(join(repo, f)).size > MAX_IMAGE_BYTES ? [`${f}: ${Math.round(statSync(join(repo, f)).size / 1024)}KB, ${MAX_IMAGE_BYTES / 1024}KB 이하로 줄여 주세요`] : []),
      ...(used.has(f) ? [] : [`${f}: 어느 문서도 쓰지 않는 그림입니다`]),
    ])
}

function manifest() {
  const plugin = JSON.parse(read('.claude-plugin/plugin.json'))
  const market = JSON.parse(read('.claude-plugin/marketplace.json'))
  const released = read('CHANGELOG.md').match(/^## (\d+\.\d+\.\d+)/m)?.[1]
  const hasEmail = value => JSON.stringify(value).includes('"email"')

  return [
    ...(released === plugin.version ? [] : [`plugin.json 버전 ${plugin.version}과 CHANGELOG의 마지막 버전 ${released}이 다릅니다`]),
    ...(market.plugins?.some(p => p.name === plugin.name) ? [] : [`marketplace.json에 ${plugin.name} 플러그인이 없습니다`]),
    ...(hasEmail(plugin) || hasEmail(market) ? ['매니페스트에 email이 있습니다. 이 저장소는 이메일을 싣지 않습니다'] : []),
  ]
}

function grammarTerms() {
  return markdown.filter(LEARNER_DOCS).flatMap(f =>
    read(f)
      .split('\n')
      .flatMap((line, i) => GRAMMAR_TERMS.filter(t => line.includes(t)).map(t => `${f}:${i + 1}: "${t}" 대신 쓰임을 말로 풀어 주세요`)),
  )
}

function commitMessages() {
  return git('log', `${base}..HEAD`, '--format=%h %B%x00')
    .split('\0')
    .filter(m => /^co-authored-by:|generated with \[?claude/im.test(m))
    .map(m => `${m.trim().split(/\s/)[0]}: Co-Authored-By나 생성 도구 표기를 빼 주세요`)
}

function changelog() {
  const changed = new Set([
    ...git('diff', '--name-only', `${base}...HEAD`).split('\n'),
    ...git('diff', '--name-only', 'HEAD').split('\n'),
    ...git('ls-files', '--others', '--exclude-standard').split('\n'),
  ])
  const behavior = [...changed].filter(USER_FACING)

  return behavior.length > 0 && !changed.has('CHANGELOG.md') ? [`${behavior.join(', ')}이 바뀌었는데 CHANGELOG.md에 적지 않았습니다`] : []
}
