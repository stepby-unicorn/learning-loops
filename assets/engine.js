// 학습 온보딩 엔진 — 화면과 무관한 규칙(읽음·항목 단계·재점검 일정). 브라우저와 node 시험이 같이 쓴다.
// 진행 상태는 이 브라우저 localStorage 에 저장하고, 동기화를 켜면 비공개 저장소의 사본과 mergeStates 로 합친다.
const SCHEDULE = {
  // 상자 번호 → 다음 점검까지 날 수. 상자 0 = 아직 첫 회차를 통과하지 않은 카드
  intervals: [0, 1, 3, 7, 21, 60, 180],
  // 마지막 상자를 통과해도 이 간격으로 계속 다시 점검한다(졸업 없음)
  maintenance: 180,
  // 새 카드는 첫 회차 안에서 이 횟수만큼 맞혀야 상자 1로 간다. 여러 날 반복은 재점검 간격이 맡는다
  initialCriterion: 1,
  // 한 회차에서 틀린 카드를 회차 끝에 다시 내는 횟수. 그래도 틀리면 회차를 끝내고 다음 회차·재점검으로 넘긴다
  retriesPerSession: 1,
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

// questions = 항목마다 「모르는 것」 질문 [{ t, text }] — 지운 질문은 del(지운 시각)만 남겨 다른 기기 사본과 합쳐도 되살아나지 않게 한다
function emptyState() {
  return { read: {}, unread: {}, cards: {}, log: [], questions: {} };
}

// 저장소가 없거나 깨졌으면 빈 상태. 옛 필드가 빠졌으면 채운다.
function normalizeState(raw) {
  const s = raw && typeof raw === "object" ? raw : {};
  const q = s.questions && typeof s.questions === "object" && !Array.isArray(s.questions) ? s.questions : {};
  return { read: s.read || {}, unread: s.unread || {}, cards: s.cards || {}, log: Array.isArray(s.log) ? s.log : [], questions: q };
}

// 읽음 체크·취소 — 취소는 unread 에 시각을 남겨 다른 기기의 옛 읽음보다 나중이면 이긴다(mergeStates)
function setRead(state, itemId, on, t = Date.now()) {
  if (on) { state.read[itemId] = t; delete state.unread[itemId]; }
  else { delete state.read[itemId]; state.unread[itemId] = t; }
}

// 질문 더하기 — 빈 글은 넣지 않고 null. 같은 항목에 같은 시각이 있으면 1ms 뒤로 밀어 (항목, t) 를 겹치지 않게 한다
function addQuestion(state, itemId, text, t = Date.now()) {
  const body = String(text ?? "").trim();
  if (!body) return null;
  const list = state.questions[itemId] || (state.questions[itemId] = []);
  while (list.some((q) => q.t === t)) t++;
  const q = { t, text: body };
  list.push(q);
  return q;
}

// 질문 지우기 — 글은 비우고 지운 시각만 남긴다(tombstone)
function deleteQuestion(state, itemId, t, now = Date.now()) {
  const q = (state.questions[itemId] || []).find((x) => x.t === t);
  if (!q) return false;
  q.text = "";
  q.del = now;
  return true;
}

// 화면·요약에 보일 질문(지운 것 뺌, 시각 순)
function itemQuestions(state, itemId) {
  return (state.questions[itemId] || []).filter((q) => !q.del).sort((a, b) => a.t - b.t);
}

// 항목 updated("YYYY-MM-DD") → 그날 00:00 로컬 시각, 없거나 꼴이 틀리면 0
function updatedTime(item) {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(item?.updated || "");
  return m ? new Date(Number(m[1]), Number(m[2]) - 1, Number(m[3])).getTime() : 0;
}

// 항목 표시: "answered" = 질문 뒤에 내용이 바뀜(읽음 여부와 상관없이), "updated" = 읽은 뒤에 내용이 바뀜, null = 표시 없음.
// 둘 다 읽음 시각이 updated 이후면(다시 읽음 체크) 사라진다. 날짜 단위라 같은 날 읽거나 물은 뒤의 변경은 잡지 못한다
function itemNotice(state, item) {
  const u = updatedTime(item);
  if (!u) return null;
  const read = state.read[item.id];
  if (read && read >= u) return null;
  const asked = itemQuestions(state, item.id);
  if (asked.length && u > asked[asked.length - 1].t) return "answered";
  return read ? "updated" : null;
}
const NOTICE_LABEL = { updated: "업데이트 있음", answered: "질문 답 있음" };

// 다시 볼 항목 — 주제 순서대로 [{ ...항목, chapterId, notice }]
function noticeItems(topic, state) {
  return allItems(topic).map((it) => ({ ...it, notice: itemNotice(state, it) })).filter((it) => it.notice);
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

// 한 회차 진행기 — 틀린 카드는 회차 끝에 retriesPerSession 번 다시 나오고, 새 카드는 initialCriterion 번 맞히면 통과한다.
// 회차 길이는 카드 수 + 다시 나온 수로 정해져 반드시 끝난다. 화면은 next() 로 카드를 받고 grade() 로 결과를 넘긴다.
// state 를 직접 고치므로 호출한 쪽이 저장한다.
function createSession(state, cards, now = () => Date.now(), shuffle = shuffleInPlace) {
  const queue = shuffle(cards.map((c) => c.id));
  const byId = Object.fromEntries(cards.map((c) => [c.id, c]));
  const hits = {};
  const retries = {};
  const lapsed = new Set();
  const unsure = [];
  let passed = 0;
  let answered = 0;
  let steps = cards.length;
  const failed = [];
  return {
    total: cards.length,
    get passed() { return passed; },
    get answered() { return answered; },
    // 이 회차에서 답할 전체 수(다시 나온 카드 포함) — 진행 막대 분모
    get steps() { return steps; },
    // 다시 나와서도 틀려 이 회차에 통과하지 못한 카드 id
    get failed() { return failed.slice(); },
    // 맞혔지만 확신이 「모름」이던 카드 id — 끝 화면에 따로 보여 준다
    get unsure() { return unsure.slice(); },
    next() { return queue.length ? byId[queue[0]] : null; },
    // correct = 확신으로 낮추기 전 원래 채점이 맞음(2)인지 — 새 카드는 맞혔으면 확신과 상관없이 통과
    grade(grade, conf, answer, correct = grade === 2) {
      const id = queue.shift();
      if (correct && conf === 0 && !unsure.includes(id)) unsure.push(id);
      answered++;
      const cs = state.cards[id] || { box: 0 };
      state.log.push({ id, t: now(), grade, conf, answer: answer || undefined });
      const isNew = !cs.box;
      const retry = () => {
        if ((retries[id] || 0) < SCHEDULE.retriesPerSession) { retries[id] = (retries[id] || 0) + 1; queue.push(id); steps++; }
        else failed.push(id);
      };
      if (grade === 0) {
        if (!isNew) { Object.assign(cs, nextReview(cs, 0, now())); lapsed.add(id); }
        hits[id] = 0;
        retry();
      } else if (lapsed.has(id)) {
        // 이번 회차에 틀렸던 기존 카드: 다시 맞혀도 상자 1·내일 점검은 그대로 둔다
        passed++;
      } else if (isNew) {
        hits[id] = (hits[id] || 0) + (correct ? 1 : 0);
        if (hits[id] >= SCHEDULE.initialCriterion) { Object.assign(cs, nextReview({ box: 0 }, 2, now())); passed++; }
        else retry();
      } else {
        Object.assign(cs, nextReview(cs, grade, now()));
        passed++;
      }
      cs.last = now();
      state.cards[id] = cs;
    },
  };
}

// 두 기기의 진행 상태를 합친다 — 읽음은 항목마다 마지막으로 바꾼 쪽(읽음 시각 vs 취소 시각), 카드는 마지막으로 채점한(last 큰) 쪽, 기록은 (id, t) 로 중복 없이 시각순.
function mergeStates(a, b) {
  const x = normalizeState(a);
  const y = normalizeState(b);
  const latest = (p, q) => { const o = { ...p }; for (const [k, t] of Object.entries(q)) o[k] = Math.max(o[k] || 0, t); return o; };
  const read = latest(x.read, y.read);
  const unread = latest(x.unread, y.unread);
  for (const k of Object.keys(unread)) {
    if (read[k] && read[k] > unread[k]) delete unread[k]; else delete read[k];
  }
  const cards = { ...x.cards };
  for (const [k, c] of Object.entries(y.cards)) if (!cards[k] || (c.last || 0) > (cards[k].last || 0)) cards[k] = c;
  const seen = new Set();
  const log = [...x.log, ...y.log].filter((l) => { const key = `${l.id}|${l.t}`; if (seen.has(key)) return false; seen.add(key); return true; }).sort((p, q) => p.t - q.t);
  // 질문은 항목마다 t 로 합집합 — 한쪽이라도 지웠으면 지운 쪽(나중 del)을 남긴다
  const questions = {};
  for (const k of [...new Set([...Object.keys(x.questions), ...Object.keys(y.questions)])].sort()) {
    const byT = new Map();
    for (const q of [...(x.questions[k] || []), ...(y.questions[k] || [])]) {
      if (!q || typeof q.t !== "number") continue;
      const had = byT.get(q.t);
      if (!had || (q.del || 0) > (had.del || 0)) byT.set(q.t, q.del ? { t: q.t, text: "", del: q.del } : { t: q.t, text: q.text });
    }
    if (byT.size) questions[k] = [...byT.values()].sort((p, q) => p.t - q.t);
  }
  return { read, unread, cards, log, questions };
}

// 맞혔지만 확신이 없으면 부분으로 본다(운으로 맞힌 답은 일찍 다시 본다)
function adjustGrade(grade, conf) {
  return grade === 2 && conf === 0 ? 1 : grade;
}

// 리뷰 세션(Claude)에 붙여 넣을 요약 — 항목 단계·틀린 카드·확신했는데 틀린 카드
function feedbackSummary(topic, state, now = Date.now()) {
  const p = topicProgress(topic, state, now);
  const lines = [`[학습 결과] ${topic.title} (${topic.id}) ${localStamp(now)}`];
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
  // 모르는 것 — 항목 ID 로 장 노트 절을 찾아 답을 보완한다. 글의 줄바꿈은 들여쓴 줄로 둔다
  const asked = allItems(topic).map((it) => ({ it, qs: itemQuestions(state, it.id) })).filter((x) => x.qs.length);
  if (asked.length) {
    lines.push(`모르는 것 ${asked.reduce((n, x) => n + x.qs.length, 0)}건`);
    for (const { it, qs } of asked) {
      lines.push(`- ${it.id} ${it.title}`);
      for (const q of qs) lines.push(`  - ${localStamp(q.t)} ${q.text.replace(/\n/g, "\n    ")}`);
    }
  }
  return lines.join("\n");
}

// 로컬 시각 + 시간대 — 결과 파일 이름(로컬 시각)과 같은 시각으로 읽히게
function localStamp(t) {
  const d = new Date(t);
  const p2 = (n) => String(n).padStart(2, "0");
  const off = -d.getTimezoneOffset();
  return `${d.getFullYear()}-${p2(d.getMonth() + 1)}-${p2(d.getDate())}T${p2(d.getHours())}:${p2(d.getMinutes())}${off >= 0 ? "+" : "-"}${p2(Math.floor(Math.abs(off) / 60))}:${p2(Math.abs(off) % 60)}`;
}

function shuffleInPlace(a) {
  for (let i = a.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [a[i], a[j]] = [a[j], a[i]];
  }
  return a;
}

if (typeof module !== "undefined") {
  module.exports = { SCHEDULE, DAY, STORE_PREFIX, STAGE_LABEL, todayStart, emptyState, normalizeState, nextReview, cardStatus, allItems, itemStage, chapterStage, reviewQueue, topicProgress, createSession, setRead, mergeStates, adjustGrade, feedbackSummary, addQuestion, deleteQuestion, itemQuestions, updatedTime, itemNotice, NOTICE_LABEL, noticeItems };
}
