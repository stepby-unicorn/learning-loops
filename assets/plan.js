// 학습 일정·학습량 계산 — 엔진(assets/engine.js) 결과와 저장 상태(ll2:<주제>)를 읽기만 하고 고치지 않는다. 브라우저와 node 시험이 같이 쓴다.
// 일정은 topics/<주제>/index.json 의 schedule: [{ date: "YYYY-MM-DD", chapters: [장 ID…] }](변환기가 입구 노트 「## 학습 일정」에서 만듦). 없으면 일정 없는 주제.
const PLAN_ENGINE = typeof module !== "undefined" ? require("./engine.js") : { chapterStage, todayStart, DAY, SCHEDULE };

// 이 기기 시간대의 날짜 키
function dayKey(t) {
  const d = new Date(t);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
}
// "2026-11-20" → "11/20"
const shortDay = (key) => `${Number(key.slice(5, 7))}/${Number(key.slice(8, 10))}`;

// 일정상 끝난 장 = 테스트 통과 이상(문항이 없는 장은 다 읽음) — 「진행 %」 와 같은 기준
function chapterDone(state, ch) {
  const st = PLAN_ENGINE.chapterStage(state, ch);
  return st === "tested" || st === "mastered" || (st === "read" && !(ch.cards || []).length);
}

// 주제 일정 상태. 일정이 없으면 null
//   dateOf: 장 ID → 일정 날짜 키(같은 장이 두 번 나오면 앞 날짜)
//   pending: 오늘까지 잡힌 장 중 아직 안 끝난 장(일정 순서) — late = 어제 이전 날짜
//   behind: 어제 이전 날짜인데 안 끝난 장 수 · ahead: 내일 이후 날짜인데 이미 끝난 장 수 · start: 첫 날짜 키
function scheduleStatus(topic, state, now = Date.now()) {
  if (!Array.isArray(topic.schedule) || !topic.schedule.length) return null;
  const today = dayKey(now);
  const dateOf = new Map();
  for (const e of topic.schedule) for (const id of e.chapters) if (!dateOf.has(id) && topic.chapters.some((c) => c.id === id)) dateOf.set(id, e.date);
  if (!dateOf.size) return null;
  const pending = [];
  let behind = 0;
  let ahead = 0;
  for (const [id, date] of [...dateOf].sort((a, b) => (a[1] < b[1] ? -1 : a[1] > b[1] ? 1 : 0))) {
    const ch = topic.chapters.find((c) => c.id === id);
    const done = chapterDone(state, ch);
    if (date <= today && !done) pending.push({ chapter: ch, date, late: date < today });
    if (date < today && !done) behind++;
    if (date > today && done) ahead++;
  }
  const start = [...dateOf.values()].sort()[0];
  return { dateOf, pending, behind, ahead, start, started: start <= today };
}
// 「주제별 진행」 한 줄: 밀림이 먼저, 그다음 앞섬, 시작 전이면 시작 날짜
function scheduleLine(s) {
  if (s.behind) return { text: `${s.behind}장 밀림`, late: true };
  if (s.ahead) return { text: `${s.ahead}장 앞섬`, late: false };
  if (!s.started) return { text: `${shortDay(s.start)} 시작`, late: false };
  return { text: "일정대로", late: false };
}

// 이번 주(월~일) 날짜별 학습량 + 연속 학습일
// entries = [{ topic, state }]. 읽은 항목 수 = 그날 읽음 시각이 찍힌 항목(취소하면 빠짐), 푼 문항 수 = 그날 기록(log) 수.
// 학습한 날 = 그날 장 1개를 다 읽었거나(장의 마지막 읽음 시각이 그날) 문항 3개 이상 풀었음. 연속은 오늘부터 거꾸로 세고, 오늘이 아직이면 어제부터
const STREAK_MIN_ANSWERS = 3;
function weekActivity(entries, now = Date.now()) {
  const items = {};
  const answers = {};
  const chaptersDone = {};
  const bump = (o, k) => { o[k] = (o[k] || 0) + 1; };
  for (const { topic, state } of entries) {
    for (const t of Object.values(state.read)) bump(items, dayKey(t));
    for (const l of state.log) bump(answers, dayKey(l.t));
    for (const ch of topic.chapters) {
      const times = ch.items.map((it) => state.read[it.id]);
      if (times.length && times.every(Boolean)) bump(chaptersDone, dayKey(Math.max(...times)));
    }
  }
  const studied = (k) => (chaptersDone[k] || 0) >= 1 || (answers[k] || 0) >= STREAK_MIN_ANSWERS;
  const t0 = PLAN_ENGINE.todayStart(now);
  const today = dayKey(now);
  const monday = t0 - ((new Date(t0).getDay() + 6) % 7) * PLAN_ENGINE.DAY;
  const days = [];
  for (let i = 0; i < 7; i++) {
    // 하루 더하기는 정오 기준으로 — 서머타임이 있는 시간대에서도 날짜가 밀리지 않게
    const k = dayKey(monday + i * PLAN_ENGINE.DAY + PLAN_ENGINE.DAY / 2);
    days.push({ date: k, items: items[k] || 0, answers: answers[k] || 0, today: k === today, future: k > today });
  }
  let streak = 0;
  let d = t0 + PLAN_ENGINE.DAY / 2;
  if (!studied(today)) d -= PLAN_ENGINE.DAY;
  while (studied(dayKey(d))) { streak++; d -= PLAN_ENGINE.DAY; }
  return { days, streak, studiedToday: studied(today) };
}

// 내일부터 days 일 동안 날짜별 재점검 대기 수(항목을 모두 읽은 장의 문항만 — reviewQueue 와 같은 기준)
function upcomingReviews(entries, now = Date.now(), days = 7) {
  const t0 = PLAN_ENGINE.todayStart(now);
  const out = [];
  const index = {};
  for (let i = 1; i <= days; i++) {
    const k = dayKey(t0 + i * PLAN_ENGINE.DAY + PLAN_ENGINE.DAY / 2);
    index[k] = { date: k, n: 0 };
    out.push(index[k]);
  }
  for (const { topic, state } of entries) {
    for (const ch of topic.chapters) {
      if (!ch.items.every((it) => state.read[it.id])) continue;
      for (const c of ch.cards || []) {
        const cs = state.cards[c.id];
        if (cs && cs.box && index[dayKey(cs.due)]) index[dayKey(cs.due)].n++;
      }
    }
  }
  return out;
}

// 재점검 간격 안내 「1·3·7·21·60·180」 — 엔진 SCHEDULE 에서 읽는다
const intervalText = () => PLAN_ENGINE.SCHEDULE.intervals.filter(Boolean).join("·");

if (typeof module !== "undefined") {
  module.exports = { dayKey, shortDay, chapterDone, scheduleStatus, scheduleLine, weekActivity, upcomingReviews, intervalText, STREAK_MIN_ANSWERS };
}
