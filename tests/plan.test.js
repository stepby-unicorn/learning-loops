// node tests/plan.test.js — 학습 일정 밀림·앞섬, 이번 주 학습량·연속 학습일, 다가오는 재점검 확인
const assert = require("node:assert");
const E = require("../assets/engine.js");
const P = require("../assets/plan.js");
// 2026-11-18(수) 9시
const now = new Date(2026, 10, 18, 9, 0).getTime();
const at = (m, d, h = 10) => new Date(2026, m - 1, d, h, 0).getTime();
const topic = {
  id: "t", title: "시험 주제",
  chapters: [
    { id: "T01", title: "T01 장 1", items: [{ id: "T01#a", title: "a" }, { id: "T01#b", title: "b" }], cards: [{ id: "T01-Q01", q: "q", a: "a" }] },
    { id: "T02", title: "장 2", items: [{ id: "T02#a", title: "a" }], cards: [{ id: "T02-Q01", q: "q", a: "a" }] },
    { id: "T03", title: "장 3", items: [{ id: "T03#a", title: "a" }], cards: [] },
    { id: "T04", title: "장 4", items: [{ id: "T04#a", title: "a" }], cards: [] },
  ],
  schedule: [
    { date: "2026-11-16", chapters: ["T01"] },
    { date: "2026-11-18", chapters: ["T02", "T99"] },
    { date: "2026-11-20", chapters: ["T03"] },
  ],
};
const cases = [];
cases.push(["일정 없는 주제는 null", () => {
  assert.strictEqual(P.scheduleStatus({ ...topic, schedule: undefined }, E.emptyState(), now), null);
  assert.strictEqual(P.scheduleStatus({ ...topic, schedule: [] }, E.emptyState(), now), null);
}]);
cases.push(["어제 이전 장이 안 끝났으면 밀림, 오늘 장은 할 일(밀림 아님)", () => {
  const s = P.scheduleStatus(topic, E.emptyState(), now);
  assert.deepStrictEqual(s.pending.map((p) => [p.chapter.id, p.late]), [["T01", true], ["T02", false]]);
  assert.deepStrictEqual([s.behind, s.ahead, s.start, s.started], [1, 0, "2026-11-16", true]);
  assert.deepStrictEqual(P.scheduleLine(s), { text: "1장 밀림", late: true });
  assert.strictEqual(s.dateOf.has("T99"), false);
}]);
cases.push(["읽기만 하고 테스트 전이면 안 끝남, 문항 없는 장은 다 읽으면 끝남 → 앞섬", () => {
  const st = E.emptyState();
  st.read["T01#a"] = now; st.read["T01#b"] = now;
  assert.strictEqual(P.chapterDone(st, topic.chapters[0]), false);
  st.cards["T01-Q01"] = { box: 1, due: now + E.DAY };
  st.read["T02#a"] = now; st.cards["T02-Q01"] = { box: 1, due: now + E.DAY };
  st.read["T03#a"] = now;
  const s = P.scheduleStatus(topic, st, now);
  assert.deepStrictEqual([s.pending.length, s.behind, s.ahead], [0, 0, 1]);
  assert.strictEqual(P.scheduleLine(s).text, "1장 앞섬");
}]);
cases.push(["첫 날짜 전이면 「M/D 시작」, 다 맞으면 「일정대로」", () => {
  const early = new Date(2026, 10, 10, 9).getTime();
  assert.strictEqual(P.scheduleLine(P.scheduleStatus(topic, E.emptyState(), early)).text, "11/16 시작");
  const st = E.emptyState();
  st.read["T01#a"] = now; st.read["T01#b"] = now; st.cards["T01-Q01"] = { box: 1, due: now + E.DAY };
  assert.strictEqual(P.scheduleLine(P.scheduleStatus(topic, st, now)).text, "일정대로");
}]);
cases.push(["이번 주 월~일 학습량과 연속 학습일(장 1개 또는 문항 3개)", () => {
  const st = E.emptyState();
  // 11/16(월) T04 한 항목 + T03 한 항목 → 장 2개 끝 · 11/17(화) 문항 3개 · 11/18(수) 오늘은 T01 항목 1개만(장 안 끝남 — 아직 학습일 아님)
  st.read["T04#a"] = at(11, 16); st.read["T03#a"] = at(11, 16, 11);
  st.log.push({ id: "T01-Q01", t: at(11, 17), grade: 2 }, { id: "T01-Q01", t: at(11, 17, 11), grade: 0 }, { id: "T01-Q01", t: at(11, 17, 12), grade: 2 });
  st.read["T01#a"] = at(11, 18, 8);
  const w = P.weekActivity([{ topic, state: st }], now);
  assert.deepStrictEqual(w.days.map((d) => d.date), ["2026-11-16", "2026-11-17", "2026-11-18", "2026-11-19", "2026-11-20", "2026-11-21", "2026-11-22"]);
  assert.deepStrictEqual(w.days.slice(0, 3).map((d) => [d.items, d.answers, d.today]), [[2, 0, false], [0, 3, false], [1, 0, true]]);
  assert.strictEqual(w.days[3].future, true);
  assert.deepStrictEqual([w.streak, w.studiedToday], [2, false]);
  // 오늘 문항 3개를 더 풀면 오늘부터 3일
  for (let i = 0; i < P.STREAK_MIN_ANSWERS; i++) st.log.push({ id: "T02-Q01", t: at(11, 18, 8 + i / 10), grade: 2 });
  assert.strictEqual(P.weekActivity([{ topic, state: st }], now).streak, 3);
}]);
cases.push(["다가오는 7일 재점검 = 내일부터, 다 읽은 장 문항만", () => {
  const st = E.emptyState();
  const t0 = E.todayStart(now);
  st.read["T01#a"] = now; st.read["T01#b"] = now;
  st.cards["T01-Q01"] = { box: 2, due: t0 + 3 * E.DAY };
  st.cards["T02-Q01"] = { box: 1, due: t0 + 1 * E.DAY }; // T02 는 안 읽음 → 빠짐
  const up = P.upcomingReviews([{ topic, state: st }], now);
  assert.deepStrictEqual([up.length, up[0].date, up[2].date, up[2].n, up.reduce((n, d) => n + d.n, 0)], [7, "2026-11-19", "2026-11-21", 1, 1]);
}]);
cases.push(["재점검 간격 안내는 엔진 값", () => {
  assert.strictEqual(P.intervalText(), E.SCHEDULE.intervals.filter(Boolean).join("·"));
}]);
let fail = 0;
for (const [name, fn] of cases) { try { fn(); console.log("ok  ", name); } catch (e) { fail++; console.log("FAIL", name, e.message); } }
console.log(`${cases.length - fail}/${cases.length} 통과`);
process.exit(fail ? 1 : 0);
