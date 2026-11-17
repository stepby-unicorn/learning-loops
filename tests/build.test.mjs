// 변환기 규칙 시험: node tests/build.test.mjs
import assert from "node:assert/strict";
import { parseToc, parseQuestions, buildChapter, findDenied, findSecrets, dropVaultCodes, applyReplace } from "../tools/build_topic_from_obsidian_notes.mjs";

let n = 0;
const t = (name, fn) => { fn(); n++; console.log(`ok ${n} ${name}`); };

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
console.log(`${n}/${n} 통과`);
