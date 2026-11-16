// node tests/engine.test.js — 읽음 체크·항목 단계·복습 대상·회차 진행 규칙 확인
const assert = require("node:assert");
const E = require("../assets/engine.js");
const now = new Date(2026, 10, 16, 9, 0).getTime();
const topic = {
  id: "t", title: "시험 주제",
  chapters: [
    { id: "T01", title: "장 1", items: [{ id: "T01#원리", title: "원리" }, { id: "T01#방법", title: "방법" }],
      cards: [{ id: "T01-Q01", q: "Q1", a: "A1" }, { id: "T01-Q02", q: "Q2", a: "A2" }] },
    { id: "T02", title: "장 2", items: [{ id: "T02#원리", title: "원리" }], cards: [{ id: "T02-Q01", q: "Q3", a: "A3" }] },
    { id: "T03", title: "장 3", items: [{ id: "T03#원리", title: "원리" }], cards: [] },
  ],
};
const ch = (id) => topic.chapters.find((c) => c.id === id);
const noShuffle = (a) => a;
const cases = [];
cases.push(["빈 상태 = 모두 읽기 전, 복습 대상 0", () => {
  const p = E.topicProgress(topic, E.emptyState(), now);
  assert.deepStrictEqual([p.items, p.readTotal, p.unread, p.fresh, p.due], [4, 0, 3, 0, 0]);
}]);
cases.push(["장 항목을 일부만 읽으면 읽는 중, 문항은 아직 안 나옴", () => {
  const s = E.emptyState(); s.read["T01#원리"] = now;
  assert.strictEqual(E.chapterStage(s, ch("T01")), "reading");
  assert.strictEqual(E.reviewQueue(topic, s, now).fresh.length, 0);
}]);
cases.push(["장 항목을 모두 읽으면 그 장 문항만 새 문항으로 나옴", () => {
  const s = E.emptyState(); s.read["T01#원리"] = now; s.read["T01#방법"] = now;
  assert.deepStrictEqual(E.reviewQueue(topic, s, now).fresh.map((c) => c.id), ["T01-Q01", "T01-Q02"]);
  assert.strictEqual(E.reviewQueue(topic, s, now, "T02").fresh.length, 0);
}]);
cases.push(["문항 없는 장은 읽음이 끝 단계", () => {
  const s = E.emptyState(); s.read["T03#원리"] = now;
  assert.strictEqual(E.chapterStage(s, ch("T03")), "read");
}]);
cases.push(["첫 회차: 문항마다 3번 맞혀야 끝, 끝나면 테스트 통과", () => {
  const s = E.emptyState(); s.read["T01#원리"] = now; s.read["T01#방법"] = now;
  const sess = E.createSession(s, E.reviewQueue(topic, s, now).fresh, () => now, noShuffle);
  let n = 0;
  while (sess.next()) { sess.grade(2, 2, ""); n++; }
  assert.strictEqual(n, 6);
  assert.strictEqual(E.chapterStage(s, ch("T01")), "tested");
  assert.strictEqual(E.cardStatus(s, "T01-Q01", now), "later");
}]);
cases.push(["틀린 문항은 회차 끝에 다시 나옴", () => {
  const s = E.emptyState(); s.read["T02#원리"] = now;
  const sess = E.createSession(s, E.reviewQueue(topic, s, now).fresh, () => now, noShuffle);
  sess.grade(0, 2, "모름");
  assert.strictEqual(sess.next().id, "T02-Q01");
  assert.strictEqual(s.log.length, 1);
}]);
cases.push(["다음 날 재점검 대상으로 나오고, 모두 상자 4 이상이면 숙달", () => {
  const s = E.emptyState(); s.read["T02#원리"] = now;
  s.cards["T02-Q01"] = { box: 1, due: E.todayStart(now) + E.DAY };
  assert.strictEqual(E.reviewQueue(topic, s, now + E.DAY).due.length, 1);
  s.cards["T02-Q01"].box = E.SCHEDULE.masteredBox;
  assert.strictEqual(E.chapterStage(s, ch("T02")), "mastered");
}]);
cases.push(["맞혔지만 모름이면 부분으로 채점", () => {
  assert.strictEqual(E.adjustGrade(2, 0), 1);
  assert.strictEqual(E.adjustGrade(2, 2), 2);
}]);
cases.push(["깨진 저장값은 빈 상태로", () => {
  assert.deepStrictEqual(E.normalizeState(null), E.emptyState());
  assert.deepStrictEqual(E.normalizeState({ read: { a: 1 } }).cards, {});
}]);
cases.push(["피드백 요약에 문항 ID 별 틀린 횟수·확신 오답이 들어감", () => {
  const s = E.emptyState(); s.read["T02#원리"] = now;
  s.log.push({ id: "T02-Q01", t: now, grade: 0, conf: 2, answer: "틀린 답" });
  const text = E.feedbackSummary(topic, s, now);
  assert.match(text, /확신했는데 틀림 1/);
  assert.match(text, /- T02-Q01 틀림 1 \(확신 1\)/);
}]);
let fail = 0;
for (const [name, fn] of cases) { try { fn(); console.log("ok  ", name); } catch (e) { fail++; console.log("FAIL", name, e.message); } }
console.log(`${cases.length - fail}/${cases.length} 통과`);
process.exit(fail ? 1 : 0);
