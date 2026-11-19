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
cases.push(["첫 회차: 문항마다 1번 맞히면 통과, 끝나면 테스트 통과", () => {
  const s = E.emptyState(); s.read["T01#원리"] = now; s.read["T01#방법"] = now;
  const sess = E.createSession(s, E.reviewQueue(topic, s, now).fresh, () => now, noShuffle);
  let n = 0;
  while (sess.next()) { sess.grade(2, 2, ""); n++; }
  assert.strictEqual(n, 2);
  assert.deepStrictEqual([sess.passed, sess.answered, sess.steps], [2, 2, 2]);
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
cases.push(["틀린 문항은 회차 끝에 한 번만 다시 나오고, 또 틀리면 회차가 끝남", () => {
  const s = E.emptyState(); s.read["T01#원리"] = now; s.read["T01#방법"] = now;
  const sess = E.createSession(s, E.reviewQueue(topic, s, now).fresh, () => now, noShuffle);
  sess.grade(0, 1, ""); // Q01 틀림 → 끝에 다시
  sess.grade(2, 2, ""); // Q02 맞음
  assert.deepStrictEqual([sess.answered, sess.steps, sess.passed], [2, 3, 1]);
  assert.strictEqual(sess.next().id, "T01-Q01");
  sess.grade(0, 1, ""); // 또 틀림 → 끝
  assert.strictEqual(sess.next(), null);
  assert.deepStrictEqual(sess.failed, ["T01-Q01"]);
  assert.strictEqual(E.cardStatus(s, "T01-Q01", now), "new");
}]);
cases.push(["두 기기 상태 합치기: 읽음 합집합·카드는 마지막 채점·기록 중복 없음", () => {
  const a = E.emptyState(); const b = E.emptyState();
  a.read["T01#원리"] = now + 5; b.read["T01#원리"] = now; b.read["T02#원리"] = now;
  a.cards["T01-Q01"] = { box: 1, due: 1, last: now }; b.cards["T01-Q01"] = { box: 2, due: 2, last: now + 1 };
  a.log.push({ id: "T01-Q01", t: now, grade: 2 }); b.log.push({ id: "T01-Q01", t: now, grade: 2 }, { id: "T01-Q01", t: now + 1, grade: 2 });
  const m = E.mergeStates(a, b);
  assert.deepStrictEqual(m.read, { "T01#원리": now + 5, "T02#원리": now });
  assert.strictEqual(m.cards["T01-Q01"].box, 2);
  assert.strictEqual(m.log.length, 2);
  assert.deepStrictEqual(E.mergeStates(m, m), m);
}]);
cases.push(["읽음 취소가 다른 기기의 옛 읽음보다 나중이면 합쳐도 취소 유지, 다시 읽으면 읽음", () => {
  const a = E.emptyState(); const b = E.emptyState();
  E.setRead(a, "T01#원리", true, now); E.setRead(b, "T01#원리", true, now);
  E.setRead(a, "T01#원리", false, now + 10);
  let m = E.mergeStates(a, b);
  assert.strictEqual(m.read["T01#원리"], undefined);
  assert.strictEqual(E.mergeStates(b, a).read["T01#원리"], undefined);
  E.setRead(b, "T01#원리", true, now + 20);
  m = E.mergeStates(m, b);
  assert.strictEqual(m.read["T01#원리"], now + 20);
  assert.strictEqual(m.unread["T01#원리"], undefined);
  assert.deepStrictEqual(E.mergeStates(m, m), m);
}]);
cases.push(["새 카드 정답 + 모름 = 통과, 확신 없이 맞힘으로 표시", () => {
  const s = E.emptyState(); s.read["T02#원리"] = now;
  const sess = E.createSession(s, [ch("T02").cards[0]], () => now, noShuffle);
  sess.grade(E.adjustGrade(2, 0), 0, "답", true);
  assert.strictEqual(sess.next(), null);
  assert.deepStrictEqual([sess.passed, sess.failed.length, sess.unsure], [1, 0, ["T02-Q01"]]);
  assert.strictEqual(E.cardStatus(s, "T02-Q01", now), "later");
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
cases.push(["옛 저장값(questions 없음)은 questions {} 로 채우고, 깨진 questions 도 빈 값", () => {
  assert.deepStrictEqual(E.normalizeState({ read: { a: 1 } }).questions, {});
  assert.deepStrictEqual(E.normalizeState({ questions: [1, 2] }).questions, {});
  assert.deepStrictEqual(E.normalizeState({ questions: "x" }).questions, {});
  assert.deepStrictEqual(E.mergeStates({ read: {}, cards: {}, log: [] }, null).questions, {});
}]);
cases.push(["질문 더하기·지우기 — 빈 글은 안 넣고, 같은 시각은 1ms 뒤로, 지운 질문은 목록에서 빠짐", () => {
  const s = E.emptyState();
  assert.strictEqual(E.addQuestion(s, "T01#원리", "   ", now), null);
  E.addQuestion(s, "T01#원리", " 둘째 ", now + 10);
  E.addQuestion(s, "T01#원리", "첫째", now);
  E.addQuestion(s, "T01#원리", "같은 시각", now);
  assert.deepStrictEqual(E.itemQuestions(s, "T01#원리").map((q) => [q.t - now, q.text]), [[0, "첫째"], [1, "같은 시각"], [10, "둘째"]]);
  assert.strictEqual(E.deleteQuestion(s, "T01#원리", now + 1, now + 20), true);
  assert.strictEqual(E.deleteQuestion(s, "T01#원리", 12345), false);
  assert.deepStrictEqual(E.itemQuestions(s, "T01#원리").map((q) => q.text), ["첫째", "둘째"]);
}]);
cases.push(["질문 합치기: 항목마다 t 로 합집합·시각 순, 지움(tombstone)이 이기고 다시 합쳐도 같음", () => {
  const a = E.emptyState(); const b = E.emptyState();
  E.addQuestion(a, "T01#원리", "A1", now); E.addQuestion(a, "T01#원리", "A2", now + 5);
  E.addQuestion(b, "T01#원리", "B1", now + 2); E.addQuestion(b, "T02#원리", "B2", now + 3);
  b.questions["T01#원리"].push({ t: now, text: "A1" });
  E.deleteQuestion(b, "T01#원리", now, now + 9);
  const m = E.mergeStates(a, b);
  assert.deepStrictEqual(m.questions["T01#원리"].map((q) => [q.t - now, q.text, q.del || 0]), [[0, "", now + 9], [2, "B1", 0], [5, "A2", 0]]);
  assert.deepStrictEqual(m.questions["T02#원리"].map((q) => q.text), ["B2"]);
  assert.deepStrictEqual(E.mergeStates(b, a), m);
  assert.deepStrictEqual(E.mergeStates(m, a), m);
  assert.deepStrictEqual(E.itemQuestions(m, "T01#원리").map((q) => q.text), ["B1", "A2"]);
}]);
cases.push(["업데이트 판정: 읽은 뒤 바뀜 = updated, 안 읽음·updated 없음 = 표시 없음, 다시 읽으면 사라짐", () => {
  const it = { id: "T01#원리", updated: "2026-11-18" };
  const u = new Date(2026, 10, 18).getTime();
  assert.strictEqual(E.updatedTime(it), u);
  assert.strictEqual(E.updatedTime({ updated: "11/18" }), 0);
  assert.strictEqual(E.updatedTime({ updated: "2026-11-18T09:05" }), new Date(2026, 10, 18, 9, 5).getTime());
  const s = E.emptyState();
  assert.strictEqual(E.itemNotice(s, it), null);
  s.read[it.id] = u - 1;
  assert.strictEqual(E.itemNotice(s, it), "updated");
  assert.strictEqual(E.itemNotice(s, { id: it.id }), null);
  E.setRead(s, it.id, true, u + 1);
  assert.strictEqual(E.itemNotice(s, it), null);
}]);
cases.push(["질문 답 판정(시각 꼴): 같은 날 질문 뒤에 보완하면 answered, 보완 뒤 질문이면 아님", () => {
  const s = E.emptyState();
  E.addQuestion(s, "T01#원리", "왜?", new Date(2026, 10, 19, 9, 30).getTime());
  assert.strictEqual(E.itemNotice(s, { id: "T01#원리", updated: "2026-11-19T07:40" }), null);
  assert.strictEqual(E.itemNotice(s, { id: "T01#원리", updated: "2026-11-19T09:31" }), "answered");
}]);
cases.push(["질문 답 판정: 마지막 질문 뒤에 바뀌면 읽음과 상관없이 answered, 질문이 updated 뒤면 아님, 다시 읽으면 사라짐", () => {
  const it = { id: "T01#원리", updated: "2026-11-18" };
  const u = new Date(2026, 10, 18).getTime();
  const s = E.emptyState();
  E.addQuestion(s, it.id, "모름", u - 1000);
  assert.strictEqual(E.itemNotice(s, it), "answered");
  s.read[it.id] = u - 5000;
  assert.strictEqual(E.itemNotice(s, it), "answered");
  E.addQuestion(s, it.id, "또 모름", u + 1000);
  assert.strictEqual(E.itemNotice(s, it), "updated");
  E.deleteQuestion(s, it.id, u + 1000);
  assert.strictEqual(E.itemNotice(s, it), "answered");
  E.setRead(s, it.id, true, u + 2000);
  assert.strictEqual(E.itemNotice(s, it), null);
  const t2 = { ...topic, chapters: [{ ...topic.chapters[0], items: [it, { id: "T01#방법", title: "방법", updated: "2026-11-18" }] }] };
  s.read["T01#원리"] = u - 1;
  assert.deepStrictEqual(E.noticeItems(t2, s).map((x) => [x.id, x.chapterId, x.notice]), [["T01#원리", "T01", "answered"]]);
}]);
cases.push(["피드백 요약에 모르는 것 절 — 항목 ID·제목·시각·글(지운 질문 뺌), 질문이 없으면 절 없음", () => {
  const s = E.emptyState();
  assert.doesNotMatch(E.feedbackSummary(topic, s, now), /모르는 것/);
  E.addQuestion(s, "T02#원리", "왜 이렇게 되나\n둘째 줄", now);
  E.addQuestion(s, "T01#방법", "지울 것", now + 1);
  E.deleteQuestion(s, "T01#방법", now + 1);
  const text = E.feedbackSummary(topic, s, now);
  assert.match(text, /모르는 것 1건\n- T02#원리 원리\n  - 2026-11-16T09:00[+-]\d{2}:\d{2} 왜 이렇게 되나\n    둘째 줄/);
  assert.doesNotMatch(text, /T01#방법/);
}]);
let fail = 0;
for (const [name, fn] of cases) { try { fn(); console.log("ok  ", name); } catch (e) { fail++; console.log("FAIL", name, e.message); } }
console.log(`${cases.length - fail}/${cases.length} 통과`);
process.exit(fail ? 1 : 0);
