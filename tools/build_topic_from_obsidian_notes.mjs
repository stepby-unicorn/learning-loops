#!/usr/bin/env node
// 옵시디언 학습 노트(입구 노트 + 장 노트) → 사이트 데이터(topics/<slug>/index.json + 장마다 <장 ID>.json) 변환기.
// 원본은 옵시디언 노트이고 사이트는 보기용이다 — 사이트 쪽 JSON 은 손으로 고치지 않고 이 변환기로 다시 만든다.
//
// 쓰는 법:
//   node tools/build_topic_from_obsidian_notes.mjs <입구 노트.md> [--slug account-auth] [--key AUT]
//        [--title 제목] [--summary 한 줄] [--exclude "절 이름,절 이름"] [--rename "옛 절=보일 제목,…"]
//        [--deny-file 금지어.txt] [--out topics] [--dry-run]
//
// 읽는 규칙(학습 노트 스킬 「항목 단위」):
//   - 입구 노트 앞머리 learning_key·learning_slug(없으면 --key·--slug), pages_exclude(빼고 올릴 장 절 이름 목록),
//     pages_rename(`옛 절=보일 제목` 목록 — 항목 ID 는 옛 절 이름 그대로, 화면 제목만 바꿈)
//   - 입구 `## 목차` 의 `[[<KEY>## …]]` 로 시작하는 목록 줄 순서 = 장 순서, 그 위 `### ` 머리 = 부(part)
//   - 장 노트 `## ` 절 = 읽음 항목(ID `<장>#<절 제목>`). `검수`·`출처`·`이해 확인 질문` 과 제외 절은 항목이 아니다
//   - 문항 = `## 이해 확인 질문` 안 `> [!question]- <장>-Q03 질문` callout, 답 = 정답 → `이유:` → `단서:`.
//     옛 꼴 `> [!question]- 1. 질문` 은 순서대로 <장>-Q01 로 읽는다
//   - 선택지 문항 = callout 안 `선택지: 보기 | **정답 보기** | 보기` 줄 — 굵게 한 보기 하나가 정답이고 사이트가 자동 채점한다.
//     굵은 보기가 하나가 아니면 exit 1
//   - 출력에 비밀값 꼴(SECRET_PATTERNS — 키·토큰·개인 키·IP·AWS 계정 번호·내부 URL)이나
//     금지어 파일(줄마다 한 단어, # 은 설명)의 말이 있으면 쓰지 않고 exit 1
import fs from "node:fs";
import path from "node:path";
import { markdownToHtml, setWikiResolver } from "./markdown_to_html.mjs";

const NOT_ITEM = ["검수", "출처", "이해 확인 질문"];
const QUESTION_SECTION = "이해 확인 질문";

function parseArgs(argv) {
  const args = { _: [] };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === "--dry-run") args.dryRun = true;
    else if (a.startsWith("--")) args[a.slice(2)] = argv[++i];
    else args._.push(a);
  }
  return args;
}

export function splitFrontmatter(md) {
  const m = md.match(/^---\n([\s\S]*?)\n---\n?/);
  if (!m) return { fm: {}, body: md };
  const fm = {};
  for (const line of m[1].split("\n")) {
    const kv = line.match(/^([\w-]+):\s*(.*)$/);
    if (!kv) continue;
    let v = kv[2].trim();
    if (/^\[.*\]$/.test(v)) v = v.slice(1, -1).split(",").map((x) => x.trim().replace(/^["']|["']$/g, "")).filter(Boolean);
    else v = v.replace(/^["']|["']$/g, "");
    fm[kv[1]] = v;
  }
  return { fm, body: md.slice(m[0].length) };
}

// `## ` 로 나눈다 — 코드 블록 안 `## ` 는 머리가 아니다
export function splitSections(body) {
  const lines = body.split("\n");
  const sections = [];
  let cur = { title: null, lines: [] };
  let fence = null;
  for (const line of lines) {
    const f = line.match(/^\s*(```|~~~)/);
    if (f) fence = fence ? (line.trim().startsWith(fence) ? null : fence) : f[1];
    const h = !fence && line.match(/^## (.+?)\s*$/);
    if (h) { sections.push(cur); cur = { title: h[1].trim(), lines: [] }; }
    else cur.lines.push(line);
  }
  sections.push(cur);
  return sections;
}

// 입구 노트 `## 목차` → [{ id, file, part }]
export function parseToc(body, key) {
  const sec = splitSections(body).find((s) => s.title === "목차");
  if (!sec) throw new Error("입구 노트에 `## 목차` 가 없습니다");
  const out = [];
  let part = "";
  const re = new RegExp(`^\\s*[-*]\\s+\\[\\[(${key}\\d{2})([^\\]|#]*)(?:\\|[^\\]]*)?\\]\\]`);
  for (const line of sec.lines) {
    const h = line.match(/^###\s+(.+?)\s*$/);
    if (h) { part = h[1]; continue; }
    const m = line.match(re);
    if (m && !out.some((c) => c.id === m[1])) out.push({ id: m[1], file: (m[1] + m[2]).trim(), part });
  }
  return out;
}

// 문항 callout 하나의 답 → { a, why, hint }
function splitAnswer(lines) {
  const text = lines.join("\n").trim();
  const pick = (label) => {
    const m = text.match(new RegExp(`(?:^|\\n)\\s*(?:\\*\\*)?${label}(?:\\*\\*)?\\s*[:：]\\s*([\\s\\S]*?)(?=\\n\\s*(?:\\*\\*)?(?:이유|단서)(?:\\*\\*)?\\s*[:：]|$)`));
    return m ? m[1].trim() : "";
  };
  const first = text.split(/\n\s*(?:\*\*)?(?:이유|단서)(?:\*\*)?\s*[:：]/)[0].trim();
  return { a: first.replace(/^(?:\*\*)?정답(?:\*\*)?\s*[:：]\s*/, ""), why: pick("이유"), hint: pick("단서") };
}

const plain = (s) => s.replace(/\[\[([^\]|#]+)(?:#[^\]|]*)?(?:\|([^\]]+))?\]\]/g, (_, n, a) => a || n).replace(/\*\*([^*]+)\*\*/g, "$1").replace(/`([^`]+)`/g, "$1");

// `선택지: 보기 | **정답** | 보기` → { list, answerIndex }
export function parseChoices(line, id) {
  const list = line.replace(/^\s*(?:\*\*)?선택지(?:\*\*)?\s*[:：]\s*/, "").split(/\s+\|\s+/).map((x) => x.trim()).filter(Boolean);
  const marked = list.map((x, i) => (/^\*\*[\s\S]+\*\*$/.test(x) ? i : -1)).filter((i) => i >= 0);
  if (list.length < 2 || marked.length !== 1) throw new Error(`${id} 선택지: 보기 2개 이상, 굵게 한 정답 1개가 필요합니다 (보기 ${list.length} · 굵게 ${marked.length})`);
  return { list: list.map((x) => plain(x.replace(/^\*\*([\s\S]+)\*\*$/, "$1"))), answerIndex: marked[0] };
}

export function parseQuestions(lines, chapterId) {
  const cards = [];
  let cur = null;
  let seq = 0;
  for (const raw of lines) {
    const q = raw.match(/^>\s*\[!question\][-+]?\s*(.*)$/);
    if (q) {
      if (cur) cards.push(cur);
      seq++;
      const withId = q[1].match(new RegExp(`^(${chapterId}-Q\\d{2,})\\s+(.*)$`));
      const old = q[1].match(/^\d+[.)]\s*(.*)$/);
      cur = {
        id: withId ? withId[1] : `${chapterId}-Q${String(seq).padStart(2, "0")}`,
        q: withId ? withId[2] : old ? old[1] : q[1],
        body: [],
      };
      continue;
    }
    if (cur && raw.startsWith(">")) cur.body.push(raw.replace(/^>\s?/, ""));
    else if (cur && !raw.trim()) { cards.push(cur); cur = null; }
  }
  if (cur) cards.push(cur);
  return cards
    .filter((c) => !/^~~/.test(c.q))
    .map((c) => {
      const choiceLine = c.body.findIndex((l) => /^\s*(?:\*\*)?선택지(?:\*\*)?\s*[:：]/.test(l));
      const choices = choiceLine < 0 ? null : parseChoices(c.body.splice(choiceLine, 1)[0], c.id);
      const { a, why, hint } = splitAnswer(c.body);
      const card = { id: c.id, q: plain(c.q), a: plain(a) };
      if (choices) { card.choices = choices.list; card.answerIndex = choices.answerIndex; }
      if (why) card.why = plain(why);
      if (hint) card.hint = plain(hint);
      return card;
    });
}

// 볼트 세션·결정 번호(S294·S1000043-D1 등)는 사이트 독자가 따라갈 수 없으니 걷어 낸다.
// 해시 방식 이름 S256·S384·S512(PKCE·x5t#S256)는 그대로 둔다
const VAULT_CODE = String.raw`(?<![\w#])S(?:\d{3}|\d{7})(?:-[A-Z]\d+)?(?!\w)`;
const KEEP_CODES = new Set(["S256", "S384", "S512"]);
export function dropVaultCodes(text) {
  const keep = (m, out) => (KEEP_CODES.has(m.trim()) ? m : out);
  return text
    .replace(new RegExp(String.raw`결정\s+(${VAULT_CODE})`, "g"), (m, c) => keep(c, "내부 결정"))
    .replace(new RegExp(String.raw`\s?\((${VAULT_CODE})\)`, "g"), (m, c) => keep(c, ""))
    .replace(new RegExp(String.raw`(${VAULT_CODE}) (?=[^\s,.;:)\]}])`, "g"), (m, c) => (KEEP_CODES.has(c) ? m : ""))
    .replace(new RegExp(VAULT_CODE, "g"), (c) => keep(c, /-D\d/.test(c) ? "내부 결정" : "내부 기록"));
}

export function buildChapter(md, chapterId, exclude, rename = {}) {
  const { body } = splitFrontmatter(md);
  const sections = splitSections(body);
  const head = sections[0].lines.join("\n");
  const title = (head.match(/^# (.+)$/m)?.[1] || chapterId).trim();
  const summary = plain((head.match(/> \[!summary\][^\n]*\n((?:>.*\n?)*)/)?.[1] || "").replace(/^>\s?/gm, " ").replace(/\s+/g, " ").trim());
  const items = [];
  let cards = [];
  for (const s of sections.slice(1)) {
    if (s.title === QUESTION_SECTION) { cards = parseQuestions(s.lines.map(dropVaultCodes), chapterId); continue; }
    if (NOT_ITEM.includes(s.title) || exclude.includes(s.title)) continue;
    const text = dropVaultCodes(s.lines.join("\n")).trim();
    if (!text) continue;
    items.push({ id: `${chapterId}#${s.title}`, title: rename[s.title] || s.title, html: markdownToHtml(text) });
  }
  return { id: chapterId, title, summary, items, cards };
}

function readDeny(file) {
  if (!file) return [];
  return fs.readFileSync(file, "utf8").split("\n").map((l) => l.trim()).filter((l) => l && !l.startsWith("#"));
}

export function findDenied(text, words) {
  const lower = text.toLowerCase();
  return words.filter((w) => lower.includes(w.toLowerCase()));
}

// 공개 사이트에 올리면 안 되는 값의 꼴. 회사 맥락 문장은 막지 않고 값만 막는다.
const DOC_IP = /^(127\.|0\.0\.0\.0$|192\.0\.2\.|198\.51\.100\.|203\.0\.113\.)/; // loopback·문서용 예시 대역
const INTERNAL_HOST = /(^|\.)(internal|local|corp|intra|lan)$|^(10|192\.168|172\.(1[6-9]|2\d|3[01]))\./;
// 공개 명세에 실린 예시 값 — OpenID Connect Core 1.0 의 ID token 예시 `sub`
const PUBLIC_EXAMPLE_VALUES = new Set(["248289761001"]);
export const SECRET_PATTERNS = [
  ["개인 키", /-----BEGIN [A-Z ]*PRIVATE KEY-----/g],
  ["AWS access key", /\b(?:AKIA|ASIA)[0-9A-Z]{16}\b/g],
  ["토큰", /\b(?:ghp|gho|ghs|github_pat|glpat|xox[abps])[-_][A-Za-z0-9_-]{16,}|\bsk-[A-Za-z0-9_-]{20,}/g],
  ["AWS 계정 번호", /(?<![\d.\-:])\d{12}(?![\d.\-:])/g],
  // `§3.1.1.2`·`V3.1.1.2`·`#section-6.1.3.2` 같은 명세 절 번호는 IP 가 아니다
  ["IP", /(?<![\d.§A-Za-z-])(?:(?:25[0-5]|2[0-4]\d|1?\d?\d)\.){3}(?:25[0-5]|2[0-4]\d|1?\d?\d)(?![\d.])/g, (m) => !DOC_IP.test(m)],
  ["내부 URL", /https?:\/\/([A-Za-z0-9.-]+)/g, (m, host) => host !== "localhost" && (!host.includes(".") || INTERNAL_HOST.test(host.toLowerCase()))],
];

export function findSecrets(text) {
  const hits = [];
  for (const [kind, re, keep] of SECRET_PATTERNS) {
    for (const m of text.matchAll(re)) if (!PUBLIC_EXAMPLE_VALUES.has(m[0]) && (!keep || keep(m[0], m[1]))) hits.push(`${kind} ${m[0]}`);
  }
  return hits;
}

function parseRename(list) {
  const rename = {};
  for (const pair of list) {
    const at = String(pair).indexOf("=");
    if (at > 0) rename[String(pair).slice(0, at).trim()] = String(pair).slice(at + 1).trim();
  }
  return rename;
}

function main() {
  const args = parseArgs(process.argv.slice(2));
  const entry = args._[0];
  if (!entry) { console.error("입구 노트 경로가 필요합니다"); process.exit(2); }
  const { fm, body } = splitFrontmatter(fs.readFileSync(entry, "utf8"));
  const key = args.key || fm.learning_key;
  const slug = args.slug || fm.learning_slug;
  if (!key || !slug) { console.error("learning_key·learning_slug(또는 --key·--slug)가 필요합니다"); process.exit(2); }
  const exclude = [...(Array.isArray(fm.pages_exclude) ? fm.pages_exclude : fm.pages_exclude ? [fm.pages_exclude] : []), ...(args.exclude ? args.exclude.split(",").map((s) => s.trim()) : [])];
  const asList = (v) => (Array.isArray(v) ? v : v ? [v] : []);
  const rename = parseRename([...asList(fm.pages_rename), ...(args.rename ? args.rename.split(",") : [])]);
  const toc = parseToc(body, key);
  if (!toc.length) { console.error(`목차에 [[${key}## …]] 줄이 없습니다`); process.exit(2); }

  // 장 노트 찾기: 입구 노트 폴더 아래에서 파일 이름이 <장 ID> 로 시작하는 md
  const root = path.dirname(entry);
  const files = [];
  const walk = (d) => fs.readdirSync(d, { withFileTypes: true }).forEach((e) => (e.isDirectory() ? walk(path.join(d, e.name)) : e.name.endsWith(".md") && files.push(path.join(d, e.name))));
  walk(root);
  const chapterIds = new Set(toc.map((c) => c.id));
  setWikiResolver((name) => {
    const id = name.match(new RegExp(`^(${key}\\d{2})\\b`))?.[1];
    return id && chapterIds.has(id) ? `#/t/${slug}/c/${id}` : null;
  });

  const title = args.title || (body.match(/^# (.+)$/m)?.[1] || slug).trim();
  const summary = args.summary || fm.learning_summary || "";
  const index = { id: slug, key, title, summary, chapters: [] };
  const bodies = [];
  const missing = [];
  for (const c of toc) {
    const file = files.find((f) => path.basename(f).startsWith(c.id + " ") || path.basename(f) === `${c.id}.md`);
    if (!file) { missing.push(c.id); continue; }
    const ch = buildChapter(fs.readFileSync(file, "utf8"), c.id, exclude, rename);
    index.chapters.push({ id: ch.id, title: ch.title, part: c.part, summary: ch.summary, items: ch.items.map(({ id, title }) => ({ id, title })), cards: ch.cards });
    bodies.push({ id: ch.id, title: ch.title, items: ch.items });
  }

  const outDir = path.join(args.out || "topics", slug);
  const outputs = [[path.join(outDir, "index.json"), JSON.stringify(index, null, 1)], ...bodies.map((b) => [path.join(outDir, `${b.id}.json`), JSON.stringify(b)])];
  const denied = readDeny(args["deny-file"]);
  const hits = [];
  for (const [file, text] of outputs) {
    for (const w of findDenied(text, denied)) hits.push(`${path.basename(file)}: 금지어 ${w}`);
    for (const s of findSecrets(text)) hits.push(`${path.basename(file)}: ${s}`);
  }

  const report = {
    slug, key, chapters: index.chapters.length, missing,
    items: index.chapters.reduce((n, c) => n + c.items.length, 0),
    cards: index.chapters.reduce((n, c) => n + c.cards.length, 0),
    noCards: index.chapters.filter((c) => !c.cards.length).map((c) => c.id),
    excluded: exclude, renamed: rename, denied: hits.length,
  };
  if (hits.length) {
    console.error(`금지어 ${hits.length}건 — 쓰지 않음:\n${hits.slice(0, 30).join("\n")}`);
    console.log(JSON.stringify(report));
    process.exit(1);
  }
  if (missing.length && !args.dryRun) {
    console.error(`장 노트 ${missing.length}개 없음 — 쓰지 않음: ${missing.join(", ")}`);
    console.log(JSON.stringify(report));
    process.exit(1);
  }
  if (!args.dryRun) {
    fs.rmSync(outDir, { recursive: true, force: true });
    fs.mkdirSync(outDir, { recursive: true });
    for (const [file, text] of outputs) fs.writeFileSync(file, text + "\n");
    // 주제 목록 갱신(같은 id 는 바꾸고 새 id 는 뒤에)
    const listFile = path.join(args.out || "topics", "topics.json");
    const list = fs.existsSync(listFile) ? JSON.parse(fs.readFileSync(listFile, "utf8")) : { topics: [] };
    const entryRow = { id: slug, key, title, summary, chapters: report.chapters, items: report.items, cards: report.cards };
    const at = list.topics.findIndex((t) => t.id === slug);
    if (at >= 0) list.topics[at] = entryRow; else list.topics.push(entryRow);
    fs.writeFileSync(listFile, JSON.stringify(list, null, 2) + "\n");
  }
  console.log(JSON.stringify(report));
  if (missing.length) process.exit(1);
}

if (import.meta.url === `file://${process.argv[1]}`) main();
