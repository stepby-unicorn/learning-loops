// node tests/schedule.test.js — 재점검 일정 규칙 확인
const assert = require("node:assert");
const { SCHEDULE, nextReview, todayStart, DAY } = require("../assets/app.js");
const now = new Date(2026, 10, 16, 9, 0).getTime();
const t0 = todayStart(now);
const days = (r) => Math.round((r.due - t0) / DAY);
const cases = [];
// 새 카드 통과 → 상자 1, 1일 뒤
cases.push(["새 카드 통과", () => { const r = nextReview({ box: 0 }, 2, now); assert.strictEqual(r.box, 1); assert.strictEqual(days(r), 1); }]);
// 맞힐 때마다 간격이 표대로 늘어난다
cases.push(["맞힘 사다리", () => {
  let cs = { box: 1 };
  for (let b = 2; b < SCHEDULE.intervals.length; b++) { cs = nextReview(cs, 2, now); assert.strictEqual(cs.box, b); assert.strictEqual(days(cs), SCHEDULE.intervals[b]); }
}]);
// 마지막 상자에서 맞혀도 졸업하지 않고 유지 간격으로 다시 점검
cases.push(["마지막 상자 유지 점검", () => { const last = SCHEDULE.intervals.length - 1; const r = nextReview({ box: last }, 2, now); assert.strictEqual(r.box, last); assert.strictEqual(days(r), SCHEDULE.maintenance); }]);
// 틀리면 어느 상자든 상자 1, 1일 뒤
cases.push(["틀림 → 상자 1", () => { for (let b = 1; b < SCHEDULE.intervals.length; b++) { const r = nextReview({ box: b }, 0, now); assert.strictEqual(r.box, 1); assert.strictEqual(days(r), 1); } }]);
// 부분은 상자를 유지하고 그 상자 간격
cases.push(["부분 → 상자 유지", () => { const r = nextReview({ box: 3 }, 1, now); assert.strictEqual(r.box, 3); assert.strictEqual(days(r), SCHEDULE.intervals[3]); }]);
let fail = 0;
for (const [name, fn] of cases) { try { fn(); console.log("ok  ", name); } catch (e) { fail++; console.log("FAIL", name, e.message); } }
console.log(`${cases.length - fail}/${cases.length} 통과`);
process.exit(fail ? 1 : 0);
