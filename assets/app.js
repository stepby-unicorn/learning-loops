// 학습 피드백 루프 — 카드 점검 엔진 (서버 없음, 진행 상태는 이 브라우저 localStorage)
// 일정 규칙은 process.html 「재점검 일정」 표와 같은 값을 쓴다. 바꿀 때는 두 곳을 같이 고친다.
const SCHEDULE = {
  // 상자 번호 → 다음 점검까지 날 수. 상자 0 = 새 카드(아직 통과 전)
  intervals: [0, 1, 3, 7, 21, 60, 180],
  // 마지막 상자를 통과해도 이 간격으로 계속 다시 점검한다(졸업 없음)
  maintenance: 180,
  // 새 카드는 첫 회차 안에서 이 횟수만큼 맞혀야 상자 1로 간다
  initialCriterion: 3,
  // 이 상자 이상이면 「숙달」(간격 둔 재점검 3회 통과 — 1·3·7일)
  masteredBox: 4,
};
const DAY = 86400000;
const STORE_PREFIX = "ll:";

function todayStart(t = Date.now()) {
  const d = new Date(t);
  d.setHours(0, 0, 0, 0);
  return d.getTime();
}
function fmtDate(t) {
  const d = new Date(t);
  return `${d.getMonth() + 1}/${d.getDate()}`;
}
function esc(s) {
  return String(s ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
}

function loadState(topicId) {
  try {
    return JSON.parse(localStorage.getItem(STORE_PREFIX + topicId)) || { cards: {}, log: [] };
  } catch {
    return { cards: {}, log: [] };
  }
}
function saveState(topicId, state) {
  localStorage.setItem(STORE_PREFIX + topicId, JSON.stringify(state));
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

function cardStatus(state, card, now = Date.now()) {
  const cs = state.cards[card.id];
  if (!cs || !cs.box) return "new";
  return cs.due <= now ? "due" : "later";
}

async function loadJSON(path) {
  const res = await fetch(path, { cache: "no-cache" });
  if (!res.ok) throw new Error(`${path} ${res.status}`);
  return res.json();
}

// ---------- 첫 화면: 주제 목록 ----------
async function renderIndex(root) {
  const list = await loadJSON("topics/topics.json");
  const now = Date.now();
  root.innerHTML = list.topics
    .map((t) => {
      return `<div class="card" data-topic="${esc(t.id)}">
        <h3><a href="topic.html?t=${encodeURIComponent(t.id)}">${esc(t.title)}</a></h3>
        <p class="muted">${esc(t.summary || "")}</p>
        <div class="row" data-counts>불러오는 중…</div>
      </div>`;
    })
    .join("");
  for (const t of list.topics) {
    const el = root.querySelector(`[data-topic="${CSS.escape(t.id)}"] [data-counts]`);
    try {
      const deck = await loadJSON(`topics/${t.id}/cards.json`);
      const state = loadState(t.id);
      const c = { new: 0, due: 0, later: 0 };
      deck.cards.forEach((card) => c[cardStatus(state, card, now)]++);
      const mastered = deck.cards.filter((card) => (state.cards[card.id]?.box ?? 0) >= SCHEDULE.masteredBox).length;
      el.innerHTML = `<span class="pill ${c.due ? "due" : ""}">오늘 점검 ${c.due}</span>
        <span class="pill">새 카드 ${c.new}</span><span class="pill ok">통과 ${c.later}</span><span class="pill ok">숙달 ${mastered}</span>`;
    } catch (e) {
      el.textContent = `카드 파일을 읽지 못함: ${e.message}`;
    }
  }
}

// ---------- 주제 화면 ----------
async function renderTopic(root) {
  const id = new URLSearchParams(location.search).get("t");
  if (!id) { root.textContent = "주제가 없습니다."; return; }
  const list = await loadJSON("topics/topics.json");
  const meta = list.topics.find((t) => t.id === id);
  const deck = await loadJSON(`topics/${id}/cards.json`);
  document.title = `${deck.title} · 학습 피드백 루프`;
  const view = () => topicHome(root, id, meta, deck);
  view();
}

function topicHome(root, id, meta, deck) {
  const state = loadState(id);
  const now = Date.now();
  const due = deck.cards.filter((c) => cardStatus(state, c, now) === "due");
  const nextDue = deck.cards
    .map((c) => state.cards[c.id])
    .filter((cs) => cs && cs.box && cs.due > now)
    .map((cs) => cs.due)
    .sort((a, b) => a - b)[0];
  const units = deck.units
    .map((u) => {
      const cards = deck.cards.filter((c) => c.unit === u.id);
      const fresh = cards.filter((c) => cardStatus(state, c, now) === "new");
      const passed = cards.length - fresh.length;
      const reads = (u.read || []).map((r) => `<li><a href="${esc(r.url)}" target="_blank" rel="noopener">${esc(r.label)}</a></li>`).join("");
      const goals = (u.goals || []).map((g) => `<li>${esc(g)}</li>`).join("");
      return `<div class="card">
        <h3>${esc(u.title)}</h3>
        ${goals ? `<p class="muted">학습 목표</p><ul>${goals}</ul>` : ""}
        ${reads ? `<p class="muted">읽을 것</p><ul>${reads}</ul>` : ""}
        <div class="progress"><span style="width:${cards.length ? (passed / cards.length) * 100 : 0}%"></span></div>
        <div class="row">
          <span class="pill">카드 ${cards.length} · 통과 ${passed}</span>
          <button class="primary" data-unit="${esc(u.id)}" ${fresh.length ? "" : "disabled"}>회차 테스트 (${fresh.length})</button>
        </div>
      </div>`;
    })
    .join("");
  root.innerHTML = `
    <h1>${esc(deck.title)}</h1>
    <p class="muted">${esc(meta?.summary || "")}</p>
    <div class="card">
      <h3>재점검</h3>
      <p>오늘 점검할 카드 <strong>${due.length}</strong>개${nextDue ? ` · 다음 점검 ${fmtDate(nextDue)}` : ""}</p>
      <button class="primary" id="btn-due" ${due.length ? "" : "disabled"}>재점검 시작</button>
    </div>
    <h2>회차</h2>
    ${units}
    <h2>기록</h2>
    <div class="card">
      <p class="muted">진행 상태는 이 기기 브라우저에만 저장됩니다. 다른 기기로 옮기거나 리뷰 세션에 넘길 때 내보냅니다.</p>
      <div class="row">
        <button id="btn-summary">결과 요약 복사</button>
        <button id="btn-export">백업 내보내기</button>
        <label class="btn">백업 가져오기<input type="file" id="file-import" accept="application/json" class="hidden"></label>
      </div>
      <pre id="summary-out" class="answer hidden"></pre>
    </div>`;
  root.querySelector("#btn-due").onclick = () => runSession(root, id, deck, due, "재점검", () => topicHome(root, id, meta, deck));
  root.querySelectorAll("button[data-unit]").forEach((b) => {
    b.onclick = () => {
      const unit = b.dataset.unit;
      const cards = deck.cards.filter((c) => c.unit === unit && cardStatus(loadState(id), c) === "new");
      runSession(root, id, deck, cards, deck.units.find((u) => u.id === unit).title, () => topicHome(root, id, meta, deck));
    };
  });
  root.querySelector("#btn-summary").onclick = async () => {
    const text = summaryText(id, deck);
    const out = root.querySelector("#summary-out");
    out.textContent = text;
    out.classList.remove("hidden");
    try { await navigator.clipboard.writeText(text); } catch { /* 복사 권한이 없으면 화면 글을 직접 복사 */ }
  };
  root.querySelector("#btn-export").onclick = () => {
    const blob = new Blob([JSON.stringify({ topic: id, exportedAt: new Date().toISOString(), state: loadState(id) }, null, 2)], { type: "application/json" });
    const a = document.createElement("a");
    a.href = URL.createObjectURL(blob);
    a.download = `learning-loop-${id}-${new Date().toISOString().slice(0, 10)}.json`;
    a.click();
  };
  root.querySelector("#file-import").onchange = async (e) => {
    const file = e.target.files[0];
    if (!file) return;
    const data = JSON.parse(await file.text());
    if (data.topic !== id || !data.state) { alert("이 주제의 백업이 아닙니다."); return; }
    saveState(id, data.state);
    topicHome(root, id, meta, deck);
  };
}

// 리뷰 세션(Claude)에 붙여 넣을 요약 — 틀린 카드·확신했는데 틀린 카드·다음 점검일
function summaryText(id, deck) {
  const state = loadState(id);
  const lines = [`[학습 결과] ${deck.title} (${id}) ${new Date().toLocaleString("ko-KR")}`];
  const byBox = {};
  for (const c of deck.cards) {
    const cs = state.cards[c.id];
    const box = cs?.box ?? 0;
    byBox[box] = (byBox[box] || 0) + 1;
  }
  lines.push(`상자별 카드 수: ${Object.entries(byBox).map(([b, n]) => `${b}:${n}`).join(" ")}`);
  const recent = state.log.slice(-200);
  const wrong = recent.filter((l) => l.grade === 0);
  const confidentWrong = wrong.filter((l) => l.conf === 2);
  lines.push(`최근 기록 ${recent.length}건 · 틀림 ${wrong.length} · 확신했는데 틀림 ${confidentWrong.length}`);
  const ids = [...new Set(wrong.map((l) => l.id))].slice(-15);
  for (const cid of ids) {
    const c = deck.cards.find((x) => x.id === cid);
    const last = [...recent].reverse().find((l) => l.id === cid && l.answer);
    lines.push(`- ${cid} ${c ? c.q.slice(0, 60) : ""}${last ? ` / 내 답: ${last.answer.slice(0, 80)}` : ""}`);
  }
  return lines.join("\n");
}

// ---------- 테스트 진행 ----------
// 틀린 카드는 같은 회차 끝에 다시 나온다. 새 카드는 initialCriterion 만큼 맞혀야 끝난다.
function runSession(root, id, deck, cards, label, done) {
  if (!cards.length) return done();
  const queue = shuffle(cards.map((c) => c.id));
  const hits = {};
  const lapsed = new Set();
  const total = cards.length;
  let finished = 0;
  const step = () => {
    if (!queue.length) {
      root.innerHTML = `<h1>${esc(label)} 끝</h1><div class="card"><p>${total}개 카드를 모두 통과했습니다. 다음 점검일은 주제 화면에 나옵니다.</p>
        <button class="primary" id="back">주제로</button></div>`;
      root.querySelector("#back").onclick = done;
      return;
    }
    const nextId = queue.shift();
    const card = deck.cards.find((c) => c.id === nextId);
    showCard(root, card, `${label} · ${finished}/${total} 완료`, finished / total, (grade, conf, answer) => {
      const state = loadState(id);
      const cs = state.cards[card.id] || { box: 0 };
      state.log.push({ id: card.id, t: Date.now(), grade, conf, answer: answer || undefined });
      const isNew = !cs.box;
      if (grade === 0) {
        // 다시 보기: 회차 끝으로 보냄. 기존 카드는 상자 1로 내림
        if (!isNew) Object.assign(cs, nextReview(cs, 0));
        if (!isNew) lapsed.add(card.id);
        hits[card.id] = 0;
        queue.push(card.id);
      } else if (lapsed.has(card.id)) {
        // 이번 회차에 틀렸던 기존 카드: 다시 맞혀도 상자 1·내일 점검은 그대로 둔다
        finished++;
      } else if (isNew) {
        hits[card.id] = (hits[card.id] || 0) + (grade === 2 ? 1 : 0);
        if (hits[card.id] >= SCHEDULE.initialCriterion) {
          Object.assign(cs, nextReview({ box: 0 }, 2));
          finished++;
        } else {
          queue.push(card.id);
        }
      } else {
        Object.assign(cs, nextReview(cs, grade));
        finished++;
      }
      cs.last = Date.now();
      state.cards[card.id] = cs;
      saveState(id, state);
      step();
    });
  };
  step();
}

function showCard(root, card, label, ratio, onGrade) {
  let conf = null;
  const choices = card.choices
    ? `<div class="row">${card.choices.map((c, i) => `<button data-choice="${i}">${esc(c)}</button>`).join("")}</div>`
    : `<textarea id="my-answer" placeholder="답을 먼저 적거나 소리 내어 말한 뒤 넘깁니다"></textarea>`;
  root.innerHTML = `
    <p class="muted">${esc(label)}</p>
    <div class="progress"><span style="width:${ratio * 100}%"></span></div>
    <div class="card">
      <p class="pill">${esc(card.type || "회상")}</p>
      <h3 style="white-space:pre-wrap">${esc(card.q)}</h3>
      ${choices}
      <p class="muted">얼마나 확신하나요?</p>
      <div class="grid3">
        <button data-conf="0">모름</button><button data-conf="1">애매함</button><button data-conf="2">확신</button>
      </div>
      <div id="reveal" class="hidden">
        <div class="answer">${esc(card.a)}</div>
        ${card.why ? `<p class="why">${esc(card.why)}</p>` : ""}
        ${card.ref ? `<p><a href="${esc(card.ref)}" target="_blank" rel="noopener">근거 자료</a></p>` : ""}
        <p class="muted">채점</p>
        <div class="grid3">
          <button class="bad" data-grade="0">틀림</button><button class="warn" data-grade="1">부분</button><button class="ok" data-grade="2">맞음</button>
        </div>
      </div>
    </div>`;
  let picked = null;
  root.querySelectorAll("[data-choice]").forEach((b) => {
    b.onclick = () => {
      picked = Number(b.dataset.choice);
      root.querySelectorAll("[data-choice]").forEach((x) => x.classList.toggle("primary", x === b));
    };
  });
  root.querySelectorAll("[data-conf]").forEach((b) => {
    b.onclick = () => {
      if (conf !== null) return;
      conf = Number(b.dataset.conf);
      root.querySelectorAll("[data-conf]").forEach((x) => (x.disabled = x !== b));
      b.classList.add("primary");
      root.querySelector("#reveal").classList.remove("hidden");
      if (card.choices && picked !== null && card.answerIndex !== undefined) {
        root.querySelectorAll("[data-grade]").forEach((g) => {
          const want = picked === card.answerIndex ? "2" : "0";
          if (g.dataset.grade !== want) g.disabled = true;
        });
      }
    };
  });
  root.querySelectorAll("[data-grade]").forEach((b) => {
    b.onclick = () => {
      let grade = Number(b.dataset.grade);
      // 맞았지만 확신이 없으면 부분으로 본다(운으로 맞힌 답은 일찍 다시 본다)
      if (grade === 2 && conf === 0) grade = 1;
      const answer = root.querySelector("#my-answer")?.value?.trim() || (picked !== null ? card.choices[picked] : "");
      onGrade(grade, conf, answer);
    };
  });
}

function shuffle(a) {
  for (let i = a.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [a[i], a[j]] = [a[j], a[i]];
  }
  return a;
}

if (typeof module !== "undefined") module.exports = { SCHEDULE, nextReview, todayStart, DAY };
