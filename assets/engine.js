// 학습 온보딩 엔진 — 화면과 무관한 규칙(읽음·항목 단계·재점검 일정). 브라우저와 node 시험이 같이 쓴다.
// 진행 상태는 서버로 보내지 않고 이 브라우저 localStorage 에만 저장한다.
const SCHEDULE = {
  // 상자 번호 → 다음 점검까지 날 수. 상자 0 = 아직 첫 회차를 통과하지 않은 카드
  intervals: [0, 1, 3, 7, 21, 60, 180],
  // 마지막 상자를 통과해도 이 간격으로 계속 다시 점검한다(졸업 없음)
  maintenance: 180,
  // 새 카드는 첫 회차 안에서 이 횟수만큼 맞혀야 상자 1로 간다
  initialCriterion: 3,
  // 이 상자 이상이면 「숙달」(간격 둔 재점검 3회 통과 — 1·3·7일)
  masteredBox: 4,
};
const DAY = 86400000;
const STORE_PREFIX = "ll2:";

// 단계 — 항목(장 노트의 `## ` 절)은 읽기 전·읽음, 장은 읽기 전 → 읽는 중 → 읽음 → 테스트 통과 → 숙달.
// 문항은 장 단위다: 장의 항목을 모두 읽음 체크하면 그 장 문항이 복습·테스트에 나온다.
const STAGE_LABEL = { unread: "읽기 전", reading: "읽는 중", read: "읽음", tested: "테스트 통과", mastered: "숙달" };

function todayStart(t = Date.now()) {
  const d = new Date(t);
  d.setHours(0, 0, 0, 0);
  return d.getTime();
}

function emptyState() {
  return { read: {}, cards: {}, log: [] };
}

// 저장소가 없거나 깨졌으면 빈 상태. 옛 필드가 빠졌으면 채운다.
function normalizeState(raw) {
  const s = raw && typeof raw === "object" ? raw : {};
  return { read: s.read || {}, cards: s.cards || {}, log: Array.isArray(s.log) ? s.log : [] };
}

// 채점 결과로 다음 상자·점검일을 정한다
// grade: 2 = 맞음, 1 = 부분(또는 맞았지만 확신 없음), 0 = 틀림
function nextReview(cs, grade, now = Date.now()) {
  const box = cs.box ?? 0;
  let nextBox = box;
  if (grade === 2) nextBox = Math.min(box + 1, SCHEDULE.intervals.length - 1);
  else if (grade === 1) nextBox = Math.max(box, 1);
  else nextBox = 1;
  const days = box === SCHEDULE.intervals.length - 1 && grade === 2 ? SCHEDULE.maintenance : SCHEDULE.intervals[nextBox];
  return { box: nextBox, due: todayStart(now) + Math.max(days, 1) * DAY };
}

// 카드 상태: new = 첫 회차 전, due = 오늘 재점검, later = 다음 점검일 전
function cardStatus(state, cardId, now = Date.now()) {
  const cs = state.cards[cardId];
  if (!cs || !cs.box) return "new";
  return cs.due <= now ? "due" : "later";
}

function allItems(topic) {
  return topic.chapters.flatMap((ch) => ch.items.map((it) => ({ ...it, chapterId: ch.id })));
}

function itemStage(state, item) {
  return state.read[item.id] ? "read" : "unread";
}

function chapterStage(state, chapter) {
  const readCount = chapter.items.filter((it) => state.read[it.id]).length;
  if (!readCount) return "unread";
  if (readCount < chapter.items.length) return "reading";
  const cards = chapter.cards || [];
  if (!cards.length) return "read";
  const boxes = cards.map((c) => state.cards[c.id]?.box ?? 0);
  if (boxes.every((b) => b >= SCHEDULE.masteredBox)) return "mastered";
  if (boxes.every((b) => b >= 1)) return "tested";
  return "read";
}

// 복습·테스트 대상은 항목을 모두 읽은 장의 문항만 — 읽지 않은 내용은 묻지 않는다
function reviewQueue(topic, state, now = Date.now(), chapterId = null) {
  const fresh = [];
  const due = [];
  for (const ch of topic.chapters) {
    if (chapterId && ch.id !== chapterId) continue;
    if (!ch.items.every((it) => state.read[it.id])) continue;
    for (const c of ch.cards || []) {
      const st = cardStatus(state, c.id, now);
      const card = { ...c, chapterId: ch.id, chapterTitle: ch.title };
      if (st === "new") fresh.push(card);
      else if (st === "due") due.push(card);
    }
  }
  return { fresh, due };
}

function topicProgress(topic, state, now = Date.now()) {
  const items = allItems(topic);
  const readTotal = items.filter((it) => state.read[it.id]).length;
  const ch = { unread: 0, reading: 0, read: 0, tested: 0, mastered: 0 };
  topic.chapters.forEach((c) => ch[chapterStage(state, c)]++);
  const { fresh, due } = reviewQueue(topic, state, now);
  const nextDue = Object.values(state.cards)
    .filter((cs) => cs && cs.box && cs.due > now)
    .map((cs) => cs.due)
    .sort((a, b) => a - b)[0];
  return { items: items.length, readTotal, chapters: topic.chapters.length, ...ch, fresh: fresh.length, due: due.length, nextDue };
}

// 한 회차 진행기 — 틀린 카드는 회차 끝에 다시 나오고, 새 카드는 initialCriterion 번 맞혀야 끝난다.
// 화면은 next() 로 카드를 받고 grade() 로 결과를 넘긴다. state 를 직접 고치므로 호출한 쪽이 저장한다.
function createSession(state, cards, now = () => Date.now(), shuffle = shuffleInPlace) {
  const queue = shuffle(cards.map((c) => c.id));
  const byId = Object.fromEntries(cards.map((c) => [c.id, c]));
  const hits = {};
  const lapsed = new Set();
  let finished = 0;
  return {
    total: cards.length,
    get finished() { return finished; },
    next() { return queue.length ? byId[queue[0]] : null; },
    grade(grade, conf, answer) {
      const id = queue.shift();
      const cs = state.cards[id] || { box: 0 };
      state.log.push({ id, t: now(), grade, conf, answer: answer || undefined });
      const isNew = !cs.box;
      if (grade === 0) {
        if (!isNew) { Object.assign(cs, nextReview(cs, 0, now())); lapsed.add(id); }
        hits[id] = 0;
        queue.push(id);
      } else if (lapsed.has(id)) {
        // 이번 회차에 틀렸던 기존 카드: 다시 맞혀도 상자 1·내일 점검은 그대로 둔다
        finished++;
      } else if (isNew) {
        hits[id] = (hits[id] || 0) + (grade === 2 ? 1 : 0);
        if (hits[id] >= SCHEDULE.initialCriterion) { Object.assign(cs, nextReview({ box: 0 }, 2, now())); finished++; }
        else queue.push(id);
      } else {
        Object.assign(cs, nextReview(cs, grade, now()));
        finished++;
      }
      cs.last = now();
      state.cards[id] = cs;
    },
  };
}

// 맞혔지만 확신이 없으면 부분으로 본다(운으로 맞힌 답은 일찍 다시 본다)
function adjustGrade(grade, conf) {
  return grade === 2 && conf === 0 ? 1 : grade;
}

// 리뷰 세션(Claude)에 붙여 넣을 요약 — 항목 단계·틀린 카드·확신했는데 틀린 카드
function feedbackSummary(topic, state, now = Date.now()) {
  const p = topicProgress(topic, state, now);
  const lines = [`[학습 결과] ${topic.title} (${topic.id}) ${new Date(now).toISOString().slice(0, 16)}`];
  lines.push(`항목 읽음 ${p.readTotal}/${p.items} · 장 ${p.chapters}: 읽는 중 ${p.reading} · 읽음 ${p.read} · 테스트 통과 ${p.tested} · 숙달 ${p.mastered} / 오늘 재점검 ${p.due} · 새 문항 ${p.fresh}`);
  const recent = state.log.slice(-200);
  const wrong = recent.filter((l) => l.grade === 0);
  lines.push(`최근 기록 ${recent.length}건 · 틀림 ${wrong.length} · 확신했는데 틀림 ${wrong.filter((l) => l.conf === 2).length}`);
  const cardIndex = {};
  topic.chapters.forEach((ch) => (ch.cards || []).forEach((c) => (cardIndex[c.id] = c)));
  // 문항 ID 마다 틀린 횟수 — 학습 노트 스킬 9단계(복습 결과로 보완)가 이 ID 로 장을 찾는다
  const count = {};
  for (const l of wrong) count[l.id] = count[l.id] || { n: 0, confident: 0 }, count[l.id].n++, l.conf === 2 && count[l.id].confident++;
  for (const cid of Object.keys(count).slice(-20)) {
    const c = cardIndex[cid];
    const last = [...recent].reverse().find((l) => l.id === cid && l.answer);
    lines.push(`- ${cid} 틀림 ${count[cid].n}${count[cid].confident ? ` (확신 ${count[cid].confident})` : ""}${c ? ` ${c.q.slice(0, 60)}` : ""}${last ? ` / 내 답: ${last.answer.slice(0, 80)}` : ""}`);
  }
  return lines.join("\n");
}

function shuffleInPlace(a) {
  for (let i = a.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [a[i], a[j]] = [a[j], a[i]];
  }
  return a;
}

if (typeof module !== "undefined") {
  module.exports = { SCHEDULE, DAY, STORE_PREFIX, STAGE_LABEL, todayStart, emptyState, normalizeState, nextReview, cardStatus, allItems, itemStage, chapterStage, reviewQueue, topicProgress, createSession, adjustGrade, feedbackSummary };
}
