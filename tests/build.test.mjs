// 변환기 규칙 시험: node tests/build.test.mjs
import assert from "node:assert/strict";
import { parseToc, parseQuestions, buildChapter, findDenied, findSecrets, dropVaultCodes, applyReplace, parseSchedule, exampleIpEnabled, parseArgs, htmlHash, stampUpdated } from "../tools/build_topic_from_obsidian_notes.mjs";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { execFileSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import { assetVersion } from "../tools/stamp_asset_version.mjs";

let n = 0;
const t = (name, fn) => { fn(); n++; console.log(`ok ${n} ${name}`); };

t("예시 IP 허용은 pages_allow_example_ip 주제만 — 사설·link-local·넷마스크·공용 resolver", () => {
  const s = "10.0.1.10 172.16.0.0 192.168.0.0 169.254.169.254 255.255.255.192 8.8.8.8 100.64.0.1";
  assert.equal(findSecrets(s).length, 7);
  assert.deepEqual(findSecrets(s, { exampleIp: true }), []);
  assert.deepEqual(findSecrets("52.95.110.1 172.32.0.1", { exampleIp: true }), ["IP 52.95.110.1", "IP 172.32.0.1"]);
  assert.deepEqual(findSecrets("224.0.0.5 240.0.0.0 198.18.0.0 168.63.129.16 http://app http://10.0.12.34 http://a.example.internal", { exampleIp: true }), []);
  assert.deepEqual(findSecrets("http://billing-prod http://x.corp", { exampleIp: true }).map((h) => h.split(" ").pop()), ["http://billing-prod", "http://x.corp"]);
});

t("목차 줄 순서 = 장 순서, ### = 부", () => {
  const toc = parseToc("## 목차\n설명\n### 1부 기초\n- [[AUT01 용어|AUT01]] 용어\n- [[AUT41 비교|AUT41]] 비교\n### 2부 심화\n- [[AUT02 수준]] 수준\n## 주요 결정\n- [[AUT03 x]]", "AUT");
  assert.deepEqual(toc.map((c) => [c.id, c.part]), [["AUT01", "1부 기초"], ["AUT41", "1부 기초"], ["AUT02", "2부 심화"]]);
});

t("새 꼴 문항 ID·정답·이유·단서", () => {
  const cards = parseQuestions(["> [!question]- AUT01-Q03 질문?", "> 정답 한 줄", "> 이유: 원리", "> 단서: RFC 9110", ""], "AUT01");
  assert.deepEqual(cards, [{ id: "AUT01-Q03", q: "질문?", a: "정답 한 줄", why: "원리", hint: "RFC 9110" }]);
});

t("옛 꼴 번호 문항은 순서대로 <장>-Q01", () => {
  const cards = parseQuestions(["> [!question]- 1. 첫 질문", "> 답 **굵게**", "", "> [!question]- 2. 둘째", "> 답2"], "AUT07");
  assert.deepEqual(cards.map((c) => [c.id, c.q, c.a]), [["AUT07-Q01", "첫 질문", "답 굵게"], ["AUT07-Q02", "둘째", "답2"]]);
});

t("항목에서 검수·출처·이해 확인 질문·제외 절을 뺀다", () => {
  const md = "---\nchapter: AUT01\n---\n# AUT01 제목\n\n## 원리\n본문\n## 회사 적용\n사내\n## 이해 확인 질문\n> [!question]- AUT01-Q01 q\n> a\n## 출처\n- x\n## 검수\n- y\n";
  const ch = buildChapter(md, "AUT01", ["회사 적용"]);
  assert.deepEqual(ch.items.map((i) => i.id), ["AUT01#원리"]);
  assert.equal(ch.cards.length, 1);
  assert.equal(ch.title, "AUT01 제목");
});

t("코드 블록 안 ## 는 절이 아니다", () => {
  const ch = buildChapter("# X\n## 원리\n```\n## 주석\n```\n", "AUT02", []);
  assert.equal(ch.items.length, 1);
});

t("금지어는 대소문자 구분 없이 찾는다", () => {
  assert.deepEqual(findDenied("Hello ACME corp", ["acme", "zzz"]), ["acme"]);
});

t("절 이름 바꾸기는 화면 제목만 바꾸고 항목 ID 는 그대로", () => {
  const ch = buildChapter("# X\n## 회사 적용\n본문\n", "AUT03", [], { "회사 적용": "적용 사례" });
  assert.deepEqual(ch.items.map((i) => [i.id, i.title]), [["AUT03#회사 적용", "적용 사례"]]);
});

t("비밀값 꼴(키·토큰·IP·AWS 계정 번호·내부 URL)을 찾는다", () => {
  const kinds = (s) => findSecrets(s).map((h) => h.split(" ")[0]);
  assert.deepEqual(kinds("key AKIAABCDEFGHIJKLMNOP"), ["AWS"]);
  assert.deepEqual(kinds("t glpat-abcdefghijklmnop1234"), ["토큰"]);
  assert.deepEqual(kinds("-----BEGIN RSA PRIVATE KEY-----"), ["개인"]);
  assert.deepEqual(kinds("서버 10.20.30.40 에"), ["IP"]);
  assert.deepEqual(kinds("계정 123456789012 의"), ["AWS"]);
  assert.deepEqual(kinds("http://gitlab/x 와 https://svc.corp/y"), ["내부", "내부"]);
});

t("명세 절 번호·예시 대역·localhost·공개 예시 값은 비밀값이 아니다", () => {
  assert.deepEqual(findSecrets("§3.1.1.2 V3.1.1.2 #section-6.1.3.2 192.0.2.1 127.0.0.1 http://localhost:8080/a https://example.com \"248289761001\""), []);
});
t("볼트 세션·결정 번호는 걷어 내고 해시 방식 이름 S256 은 남긴다", () => {
  assert.equal(dropVaultCodes("결정 S1000043-D1 은 [[S403 M365 교체]] 참고(S1000083-D5), [확인: S294 조사] — S1000078-D1, 끝"),
    "내부 결정 은 [[M365 교체]] 참고, [확인: 조사] — 내부 결정, 끝");
  assert.equal(dropVaultCodes("method=S256 x5t#S256 RS256 ES256"), "method=S256 x5t#S256 RS256 ES256");
});
t("선택지 줄 → choices·answerIndex, 답·이유는 그대로", () => {
  const [c] = parseQuestions(["> [!question]- LSC01-Q02 질문?", "> 시험 연습과 분산 학습", "> 선택지: 다시 읽기와 요약 | **시험 연습과 분산 학습** | 형광펜", "> 이유: 효용 높음", ""], "LSC01");
  assert.deepEqual([c.choices, c.answerIndex, c.a, c.why], [["다시 읽기와 요약", "시험 연습과 분산 학습", "형광펜"], 1, "시험 연습과 분산 학습", "효용 높음"]);
});
t("굵은 정답이 없거나 둘이면 오류", () => {
  assert.throws(() => parseQuestions(["> [!question]- LSC01-Q02 질문?", "> 답", "> 선택지: 가 | 나", ""], "LSC01"), /굵게 0/);
  assert.throws(() => parseQuestions(["> [!question]- LSC01-Q02 질문?", "> 답", "> 선택지: **가** | **나**", ""], "LSC01"), /굵게 2/);
});
t("pages_replace 는 긴 말부터 한 번에 바꾸고 바꾼 결과를 다시 바꾸지 않는다", () => {
  const pairs = { "LP 포털": "투자자 포털", "AI Portal": "사내 AI 포털", "AI 포털": "사내 AI 포털", "Circle": "사내 그룹웨어" };
  assert.equal(applyReplace("## LP 포털 어드민 적용\nCircle SSO 로 AI Portal 진입, AI 포털 a.b(x)", pairs),
    "## 투자자 포털 어드민 적용\n사내 그룹웨어 SSO 로 사내 AI 포털 진입, 사내 AI 포털 a.b(x)");
  assert.equal(applyReplace("그대로", {}), "그대로");
});
t("pages_replace 로 바꾼 절 제목은 항목 ID 와 화면 제목에 같이 들어간다", () => {
  const md = applyReplace("# AUT01 장\n\n## LP 포털 적용\n본문 LP 포털\n", { "LP 포털": "투자자 포털" });
  const ch = buildChapter(md, "AUT01", []);
  assert.deepEqual([ch.items[0].id, ch.items[0].title], ["AUT01#투자자 포털 적용", "투자자 포털 적용"]);
  assert.ok(!ch.items[0].html.includes("LP 포털"));
});
t("--allow-example-ip 0·false·값 없음은 끔, 1·true 와 앞머리 true 만 켬", () => {
  assert.equal(exampleIpEnabled({}, { "allow-example-ip": "0" }), false);
  assert.equal(exampleIpEnabled({}, { "allow-example-ip": "false" }), false);
  assert.equal(exampleIpEnabled({}, {}), false);
  assert.equal(exampleIpEnabled({ pages_allow_example_ip: "false" }, {}), false);
  assert.equal(exampleIpEnabled({}, { "allow-example-ip": "1" }), true);
  assert.equal(exampleIpEnabled({}, { "allow-example-ip": "true" }), true);
  assert.equal(exampleIpEnabled({ pages_allow_example_ip: "true" }, {}), true);
  // 값 자리에 다음 옵션이 오면 값 없음(끔) — --dry-run 은 그대로 켜진다
  const a = parseArgs(["entry.md", "--allow-example-ip", "--dry-run", "--key", "AUT"]);
  assert.equal(a.dryRun, true);
  assert.equal(a.key, "AUT");
  assert.deepEqual(a._, ["entry.md"]);
  assert.equal(exampleIpEnabled({}, a), false);
  assert.equal(exampleIpEnabled({}, parseArgs(["--allow-example-ip", "1", "--dry-run"])), true);
});
t("학습 일정 절 → [{date, chapters}] — 요일로 연도, 목차에 없는 장·장 없는 줄은 뺌", () => {
  const body = "# 주제\n## 학습 일정\n설명 문단 11/19 은 줄이 아님\n- [ ] 11/19(목) — AUT01 · AUT02\n- [x] 11/20(금) — [[AUT03 암호|AUT03]] · AUT04 + [[2611 대조 표]]\n- [ ] 11/23(월) — AUT99\n- 2027-01-04 — AUT05\n## 목차\n- 12/01 — AUT06\n";
  const ids = new Set(["AUT01", "AUT02", "AUT03", "AUT04", "AUT05", "AUT06"]);
  // 기준 시각이 다음 해여도 첫 줄은 기준 시각에 가장 가까운 해(2026) — 요일도 그 해와 맞는다
  assert.deepEqual(parseSchedule(body, "AUT", ids, new Date(2027, 1, 1)), [
    { date: "2026-11-19", chapters: ["AUT01", "AUT02"] },
    { date: "2026-11-20", chapters: ["AUT03", "AUT04"] },
    { date: "2027-01-04", chapters: ["AUT05"] },
  ]);
});
t("학습 일정 — 요일이 없으면 기준 해, 달이 줄면 다음 해 · 절이 없으면 빈 목록 · 요일이 틀리거나 없는 날이면 오류", () => {
  const body = "## 학습 일정\n- 12/30 — NET01\n- 01/02 — NET02\n";
  assert.deepEqual(parseSchedule(body, "NET", null, new Date(2026, 10, 18)).map((e) => e.date), ["2026-12-30", "2027-01-02"]);
  assert.deepEqual(parseSchedule("# x\n## 목차\n- [[NET01 a]]\n", "NET"), []);
  assert.throws(() => parseSchedule("## 학습 일정\n- 11/19(일) — NET01\n", "NET", null, new Date(2026, 10, 18)), /요일이 맞는 해/);
  assert.throws(() => parseSchedule("## 학습 일정\n- 02/30 — NET01\n", "NET", null, new Date(2026, 10, 18)), /없는 날/);
  // 요일 오타는 요일이 맞는 다른 해(2025-11-19 수)로 옮기지 않고 오류 — 메시지에 그 줄을 담는다
  assert.throws(() => parseSchedule("## 학습 일정\n- 11/19(수) — AUT01\n", "AUT", null, new Date(2026, 10, 18)), /요일이 맞는 해.*11\/19\(수\) — AUT01/);
  // 둘째 줄부터는 앞 줄에서 센 해로 판정
  assert.throws(() => parseSchedule("## 학습 일정\n- 11/19(목) — AUT01\n- 11/20(목) — AUT02\n", "AUT", null, new Date(2026, 10, 18)), /11\/20\(목\)/);
});
t("version.json 의 v 가 지금 assets 내용 해시와 같음(코드를 고치면 node tools/stamp_asset_version.mjs)", () => {
  const repo = path.dirname(path.dirname(fileURLToPath(import.meta.url)));
  assert.equal(JSON.parse(fs.readFileSync(path.join(repo, "version.json"), "utf8")).v, assetVersion());
});
t("updated — 바뀐 항목·새 항목은 빌드 날짜, 같으면(공백만 다름 포함) 이전 값 유지·없으면 넣지 않음, 첫 빌드는 넣지 않음", () => {
  assert.equal(htmlHash("<p>가 나</p>\n<ul>\n <li>x</li></ul>"), htmlHash("<p>가  나</p><ul><li>x</li></ul>"));
  assert.notEqual(htmlHash("<p>가 나</p>"), htmlHash("<p>가 다</p>"));
  const prev = [
    { id: "A#같음", html: "<p>a</p>" },
    { id: "A#같음옛값", html: "<p>b</p>", updated: "2026-11-01" },
    { id: "A#바뀜", html: "<p>c</p>", updated: "2026-11-01" },
    { id: "A#공백만", html: "<p>d  e</p>\n" },
  ];
  const items = [
    { id: "A#같음", html: "<p>a</p>" },
    { id: "A#같음옛값", html: "<p>b</p>" },
    { id: "A#바뀜", html: "<p>c 고침</p>" },
    { id: "A#공백만", html: "<p>d e</p>" },
    { id: "A#새 항목", html: "<p>n</p>" },
  ];
  stampUpdated(items, prev, "2026-11-19");
  assert.deepEqual(items.map((i) => [i.id, i.updated]), [["A#같음", undefined], ["A#같음옛값", "2026-11-01"], ["A#바뀜", "2026-11-19"], ["A#공백만", undefined], ["A#새 항목", "2026-11-19"]]);
  assert.ok(!("updated" in items[0]));
  const first = [{ id: "A#x", html: "<p>x</p>" }];
  stampUpdated(first, null, "2026-11-19");
  assert.ok(!("updated" in first[0]));
});
t("updated — 변환기를 같은 출력 폴더로 다시 돌리면 첫 빌드 없음 → 고친 절만 그날 → 그대로면 유지(장 파일·index.json 둘 다)", () => {
  const repo = path.dirname(path.dirname(fileURLToPath(import.meta.url)));
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "ll-build-"));
  try {
    const notes = path.join(tmp, "notes");
    fs.cpSync(path.join(repo, "examples/learning-science"), notes, { recursive: true });
    const entry = path.join(notes, "학습 과학 기초.md");
    const out = path.join(tmp, "out");
    const build = (date) => execFileSync(process.execPath, [path.join(repo, "tools/build_topic_from_obsidian_notes.mjs"), entry, "--out", out, "--date", date], { encoding: "utf8" });
    const read = () => {
      const dir = path.join(out, "learning-science");
      const ch = JSON.parse(fs.readFileSync(path.join(dir, "LSC01.json"), "utf8"));
      const idx = JSON.parse(fs.readFileSync(path.join(dir, "index.json"), "utf8"));
      return { body: ch.items.map((i) => i.updated), index: idx.chapters.find((c) => c.id === "LSC01").items.map((i) => i.updated), ids: ch.items.map((i) => i.id) };
    };
    build("2026-11-18");
    let r = read();
    assert.ok(r.body.every((u) => u === undefined) && r.index.every((u) => u === undefined));
    const chFile = fs.readdirSync(path.join(notes, "노트")).find((f) => f.startsWith("LSC01"));
    const chPath = path.join(notes, "노트", chFile);
    const md = fs.readFileSync(chPath, "utf8");
    const target = r.ids[1].split("#")[1];
    const at = md.indexOf(`## ${target}\n`);
    assert.ok(at >= 0);
    const end = at + `## ${target}\n`.length;
    fs.writeFileSync(chPath, md.slice(0, end) + "\n고친 문장을 하나 더함.\n" + md.slice(end));
    assert.match(build("2026-11-19T09:31"), /"updated":1/);
    r = read();
    assert.deepEqual(r.body.map((u, i) => [i, u]).filter(([, u]) => u), [[1, "2026-11-19T09:31"]]);
    assert.deepEqual(r.index, r.body);
    build("2026-11-20");
    r = read();
    assert.deepEqual(r.body.map((u, i) => [i, u]).filter(([, u]) => u), [[1, "2026-11-19T09:31"]]);
    assert.deepEqual(r.index, r.body);
  } finally { fs.rmSync(tmp, { recursive: true, force: true }); }
});
console.log(`${n}/${n} 통과`);
