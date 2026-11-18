// 학습 온보딩 화면 — 주소(#/…)마다 화면을 그린다. 규칙은 assets/engine.js
// 아래 탭 4개(오늘 · 주제 · 복습 · 설정)를 모든 화면에 고정하고, 테스트 회차 중에만 숨긴다.
//   #/ · #/today                오늘 — 오늘 할 일(일정 장·재점검) · 이번 주 학습량 · 주제별 진행 · 다가오는 7일 재점검
//   #/topics                    주제 — 주제 카드 목록
//   #/t/<주제>                  목차(부별 접기·장 상태·일정 날짜)
//   #/t/<주제>/c/<장>           장 — 항목 읽음 체크 + 그 장 테스트
//   #/t/<주제>/i/<항목 id>      항목 읽기(항목 id = <장>#<절 이름>) — 위 「n / m」 줄 = 장 안 항목 목록 시트, 아래 이전·읽음·다음 바
//   #/t/<주제>/done/<장>        장 완료 — 장 테스트 · 다음 장 읽기
//   #/review                    복습 「전체」 — 주제 칩(대기 수)·숫자 3줄·재점검 시작(모든 주제 한 회차)·오늘 재점검 내역
//   #/t/<주제>/review           복습 — 칩에서 고른 주제만(항목을 모두 읽은 장의 문항)
//   #/settings · #/t/<주제>/log 설정 — 동기화 · 결과 보내기 · 요약 복사 · 백업(log 는 그 주제를 고른 설정)
// 일정·학습량 계산은 assets/plan.js
// 데이터: topics/topics.json(주제 목록) · topics/<주제>/index.json(구조·문항·일정 schedule) · topics/<주제>/<장>.json(장 본문, 열 때 불러옴)
const $ = (sel, root = document) => root.querySelector(sel);
const esc = (s) => String(s ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
const enc = encodeURIComponent;
const fmtDate = (t) => { const d = new Date(t); return `${d.getMonth() + 1}/${d.getDate()}`; };
const STAGE_ICON = { unread: "○", reading: "◔", read: "◑", tested: "◕", mastered: "●" };

let topicList = null;
const topicCache = {};
const chapterCache = {};

async function loadJSON(path) {
  const res = await fetch(path, { cache: "no-cache" });
  if (!res.ok) throw new Error(`${path} ${res.status}`);
  return res.json();
}
async function getTopics() {
  if (!topicList) topicList = (await loadJSON("topics/topics.json")).topics;
  return topicList;
}
async function getTopic(id) {
  if (!topicCache[id]) topicCache[id] = await loadJSON(`topics/${enc(id)}/index.json`);
  return topicCache[id];
}
async function getChapterBody(id, chapterId) {
  const key = `${id}/${chapterId}`;
  if (!chapterCache[key]) chapterCache[key] = await loadJSON(`topics/${enc(id)}/${enc(chapterId)}.json`);
  return chapterCache[key];
}
function loadState(id) {
  try { return normalizeState(JSON.parse(localStorage.getItem(STORE_PREFIX + id))); } catch { return emptyState(); }
}
function saveState(id, state) {
  localStorage.setItem(STORE_PREFIX + id, JSON.stringify(state));
  schedulePush(id);
}

// ---------- 동기화(assets/sync.js): 주제를 처음 열 때 받아 합치고, 저장 2초 뒤·화면을 떠날 때 올린다 ----------
const pulled = new Set();
// 주제마다 따로 기다린다 — 다른 주제를 열어도 앞 주제 push 가 취소되지 않게
const pushTimers = new Map();
let inSession = false;
function schedulePush(id) {
  if (!syncConfig()) return;
  clearTimeout(pushTimers.get(id));
  pushTimers.set(id, setTimeout(() => runSync(id, "저장 뒤"), 2000));
}
// why = 동기화를 부른 계기(내역에 남김): 주제 열기·저장 뒤·화면 떠남·당겨서·지금 동기화·모든 주제·결과 보내기
async function runSync(id, why) {
  clearTimeout(pushTimers.get(id));
  pushTimers.delete(id);
  const before = localStorage.getItem(STORE_PREFIX + id);
  try {
    const out = await syncTopic(id, loadState(id));
    if (!out) return false;
    // 받는 사이 이 기기에서 또 저장했으면 덮지 않고 다음 동기화에 맡긴다
    if (localStorage.getItem(STORE_PREFIX + id) !== before) {
      addSyncLog({ topic: id, why, result: "미룸", detail: "받는 사이 이 기기에서 또 저장함 — 2초 뒤 다시" });
      schedulePush(id);
      return false;
    }
    const text = JSON.stringify(out.state);
    localStorage.setItem(STORE_PREFIX + id, text);
    const received = text !== before;
    addSyncLog({ topic: id, why, result: received && out.pushed ? "받고 올림" : received ? "받음" : out.pushed ? "올림" : "그대로" });
    return received;
  } catch (e) {
    addSyncLog({ topic: id, why, result: "실패", detail: e.message });
    return false;
  }
}
// 내역 한 줄: 「11/17 11:30 · 저장 뒤 · 올림」 — 시각은 이 기기 시간대
function syncLogLine(e, title) {
  const d = new Date(e.at);
  const when = `${d.getMonth() + 1}/${d.getDate()} ${d.toTimeString().slice(0, 5)}`;
  return [when, title, e.why, e.result].filter(Boolean).join(" · ") + (e.detail ? ` — ${e.detail}` : "");
}
function lastSyncText(id) {
  const e = syncLog().find((x) => x.topic === id);
  return e ? syncLogLine(e) : "아직 안 함";
}
document.addEventListener("visibilitychange", () => {
  if (document.visibilityState === "hidden") for (const id of [...pushTimers.keys()]) runSync(id, "화면 떠남");
});
function toggleRead(id, itemId, on) {
  const s = loadState(id);
  setRead(s, itemId, on);
  saveState(id, s);
}
const findChapter = (topic, chapterId) => topic.chapters.find((c) => c.id === chapterId);
const chapterOfItem = (topic, itemId) => topic.chapters.find((c) => c.items.some((it) => it.id === itemId));
const readCount = (state, ch) => ch.items.filter((it) => state.read[it.id]).length;

// ---------- 공통 틀: 위 막대(뒤로 ‹ · 경로 한 줄) + 아래 탭 4개 ----------
// 아이콘은 선 그림 SVG(아이콘 글꼴 없음). 24×24 좌표, 색 = 글자 색
const TAB_ICON = {
  today: '<rect x="3.5" y="5" width="17" height="15" rx="2.5"/><path d="M3.5 10h17M8 3v4M16 3v4"/><path d="M8.5 14.5l2.2 2.2 4.3-4.4"/>',
  topics: '<path d="M4 5.5C4 4.7 4.7 4 5.5 4H10c1.1 0 2 .9 2 2v14c0-1.1-.9-2-2-2H5.5c-.8 0-1.5-.7-1.5-1.5z"/><path d="M20 5.5c0-.8-.7-1.5-1.5-1.5H14c-1.1 0-2 .9-2 2v14c0-1.1.9-2 2-2h4.5c.8 0 1.5-.7 1.5-1.5z"/>',
  review: '<path d="M19.5 12a7.5 7.5 0 1 1-2.2-5.3"/><path d="M19.5 4.5v4h-4"/><path d="M12 8.5V12l2.5 1.5"/>',
  settings: '<circle cx="12" cy="12" r="3"/><path d="M12 2.8v2.4M12 18.8v2.4M2.8 12h2.4M18.8 12h2.4M5.5 5.5l1.7 1.7M16.8 16.8l1.7 1.7M5.5 18.5l1.7-1.7M16.8 7.2l1.7-1.7"/><circle cx="12" cy="12" r="6.2"/>',
};
const TABS = [
  { key: "today", label: "오늘", href: "#/today" },
  { key: "topics", label: "주제", href: "#/topics" },
  { key: "review", label: "복습", href: "#/review" },
  { key: "settings", label: "설정", href: "#/settings" },
];
$("#tabbar").innerHTML = TABS.map((t) => `<a class="ll-tab" href="${t.href}" data-tab="${t.key}">
    <span class="ll-tab-ico"><svg viewBox="0 0 24 24" width="24" height="24" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${TAB_ICON[t.key]}</svg>${t.key === "review" ? '<span class="ll-badge hidden" id="review-badge"></span>' : ""}</span>
    <span class="ll-tab-label">${t.label}</span></a>`).join("");

// 지금 그린 틀(테스트 회차가 끝나면 이 틀로 되돌린다)
let lastFrame = null;
// opts: title(문서 제목·경로가 없을 때 가운데 글), tab(오늘·주제·복습·설정 중 지금 탭), topic(경로의 주제 — 누르면 주제 바꾸기 시트),
//       crumb·crumbHref(경로 둘째 칸, 예: 장 ID), back(왼쪽 ‹ 가 갈 주소, 없으면 버튼 없음)
function setFrame(opts) {
  lastFrame = opts;
  const { title, tab, topic, crumb, crumbHref, back } = opts;
  document.title = `${title} · 학습 온보딩`;
  $("#nav-left").innerHTML = back ? `<a class="link ll-nav-back" href="${back}" aria-label="뒤로"><span aria-hidden="true">‹</span></a>` : "";
  $("#page-title").innerHTML = topic
    ? `<a href="#" role="button" class="ll-path-topic" id="btn-topic-sheet" aria-haspopup="dialog" aria-label="${esc(topic.title)} — 주제 바꾸기"><span class="ll-path-name">${esc(topic.title)}</span><span class="ll-path-caret" aria-hidden="true">▾</span></a>${crumb
      ? `<span class="ll-path-sep" aria-hidden="true">›</span>${crumbHref ? `<a class="ll-path-crumb" href="${crumbHref}">${esc(crumb)}</a>` : `<span class="ll-path-crumb">${esc(crumb)}</span>`}` : ""}`
    : `<span class="ll-path-title">${esc(title)}</span>`;
  // <button> 으로 두면 폭이 글자보다 넓게 잡혀 ▾ 와 › 사이가 벌어진다(375px 실측) — 링크에 role=button 으로 둔다
  if (topic) $("#btn-topic-sheet").onclick = (e) => { e.preventDefault(); openTopicSheet(topic.id); };
  $("#tabbar").classList.remove("hidden");
  $("#page").classList.add("ll-has-tabbar");
  // 항목 읽기 아래 바 여백은 viewItem 만 다시 켠다
  $("#page").classList.remove("ll-has-itembar");
  $("#tabbar").querySelectorAll(".ll-tab").forEach((a) => {
    const on = a.dataset.tab === tab;
    a.classList.toggle("ll-tab-active", on);
    if (on) a.setAttribute("aria-current", "page"); else a.removeAttribute("aria-current");
  });
}
// 테스트 회차 중: 아래 탭을 숨기고 위 막대엔 「그만두기」만 — 답은 문제마다 저장돼 그만둬도 푼 만큼 남는다
function setSessionFrame(quitHref) {
  $("#tabbar").classList.add("hidden");
  $("#page").classList.remove("ll-has-tabbar");
  $("#page-title").innerHTML = "";
  $("#nav-left").innerHTML = `<a class="link ll-nav-quit" href="#" id="btn-quit">그만두기</a>`;
  // 회차는 주소를 바꾸지 않고 진행해 quitHref 가 지금 주소와 같을 수 있다 — 같으면 hashchange 가 없으니 직접 다시 그린다
  $("#btn-quit").onclick = (e) => { e.preventDefault(); if (location.hash === quitHref) route(); else location.hash = quitHref; };
}
// 「복습」 탭 배지 = 모든 주제의 오늘 재점검 대기 수
async function updateReviewBadge() {
  let due = 0;
  for (const t of await getTopics()) {
    try { due += topicProgress(await getTopic(t.id), loadState(t.id)).due; } catch { /* 못 읽은 주제는 빼고 센다 */ }
  }
  const b = $("#review-badge");
  b.textContent = due > 99 ? "99+" : String(due);
  b.classList.toggle("hidden", !due);
  b.closest(".ll-tab").setAttribute("aria-label", due ? `복습, 재점검 대기 ${due}` : "복습");
}
// 진행 % = 테스트 통과 이상 장 / 전체 장
const topicPercent = (p) => (p.chapters ? Math.round(((p.tested + p.mastered) / p.chapters) * 100) : 0);
// 다음 장 = 아직 안 읽은 첫 항목이 든 장
function nextUnread(topic, state) {
  const item = allItems(topic).find((it) => !state.read[it.id]);
  return item ? { item, chapter: findChapter(topic, item.chapterId) } : null;
}
// 장 이름 한 줄 — 제목에 장 ID 가 이미 들어 있으면(「AUT03 인증을 …」) 앞에 다시 붙이지 않는다
const chapterLabel = (ch) => (ch.title.startsWith(ch.id) ? ch.title : `${ch.id} ${ch.title}`);
// 장으로 가는 주소: 안 읽은 첫 항목, 다 읽었으면 장 완료(그 장 테스트)
function chapterHref(id, state, ch) {
  const it = ch.items.find((x) => !state.read[x.id]);
  return it ? `#/t/${enc(id)}/i/${enc(it.id)}` : `#/t/${enc(id)}/done/${enc(ch.id)}`;
}
// 모든 주제를 topics.json 순서로 불러온다 — 못 읽은 주제는 error 만 담는다
async function loadAllTopics() {
  return Promise.all((await getTopics()).map(async (t) => {
    try {
      const topic = await getTopic(t.id);
      const state = loadState(t.id);
      return { t, topic, state, p: topicProgress(topic, state), plan: scheduleStatus(topic, state) };
    } catch (e) { return { t, error: e.message }; }
  }));
}
// 오늘 일정 주제 = 오늘까지 잡힌 장 중 안 끝난 장이 있는 첫 주제(topics.json 순서)
const scheduledToday = (entries) => entries.find((r) => r.plan && r.plan.pending.length) || null;

// ---------- 아래에서 올라오는 시트(주제 바꾸기 · 장 안 항목 목록) — 가림막은 둘이 같이 쓴다 ----------
function closeSheet() {
  document.querySelectorAll(".ll-sheet").forEach((s) => {
    s.classList.remove("ll-sheet-in");
    s.setAttribute("aria-hidden", "true");
  });
  $("#sheet-backdrop").classList.remove("ll-sheet-backdrop-in");
}
function showSheet(sheet) {
  sheet.classList.add("ll-sheet-in");
  sheet.setAttribute("aria-hidden", "false");
  $("#sheet-backdrop").classList.add("ll-sheet-backdrop-in");
  $(".ll-sheet-close", sheet).focus();
}
// 주제 바꾸기 시트(경로의 주제 이름을 누르면 열림) — 순서는 「주제」 탭과 같은 topics.json 순서
async function openTopicSheet(currentId) {
  const rows = await Promise.all((await getTopics()).map(async (t) => {
    let line = "";
    try {
      const topic = await getTopic(t.id);
      const state = loadState(t.id);
      const n = nextUnread(topic, state);
      line = `진행 ${topicPercent(topicProgress(topic, state))}% · ${n ? `다음 ${esc(n.chapter.id)}` : "다 읽음"}`;
    } catch (e) { line = `읽지 못함: ${esc(e.message)}`; }
    const on = t.id === currentId;
    return `<li><a class="ll-sheet-row${on ? " ll-sheet-row-on" : ""}" href="#/t/${enc(t.id)}"${on ? ' aria-current="true"' : ""}>
      <span class="ll-sheet-text"><span class="ll-sheet-name">${esc(t.title)}</span><span class="ll-sheet-sub">${line}</span></span>
      <span class="ll-sheet-check" aria-hidden="true">${on ? "✓" : ""}</span></a></li>`;
  }));
  $("#topic-sheet-body").innerHTML = `<ul class="ll-sheet-list">${rows.join("")}</ul>`;
  // 지금 주제를 다시 누르면 주소가 같아 hashchange 가 없으니 시트만 닫는다
  $("#topic-sheet-body").querySelectorAll(".ll-sheet-row").forEach((a) => { a.onclick = () => closeSheet(); });
  showSheet($("#topic-sheet"));
}
// 장 안 항목 목록 시트(항목 읽기 위 「n / m」 줄을 누르면 열림) — 머리 = 장 ID·이름 + 읽은 수, 지금 항목 강조
function openItemSheet(id, ch, currentId) {
  const state = loadState(id);
  $("#item-sheet-title").innerHTML = `<span class="ll-sheet-sub">${esc(chapterLabel(ch))}</span><span class="ll-sheet-count">${ch.items.length}개 중 ${readCount(state, ch)}개 읽음</span>`;
  const rows = ch.items.map((x, i) => {
    const on = x.id === currentId;
    const read = !!state.read[x.id];
    return `<li><a class="ll-sheet-row${on ? " ll-sheet-row-on" : ""}" href="#/t/${enc(id)}/i/${enc(x.id)}"${on ? ' aria-current="true"' : ""} aria-label="${i + 1}. ${esc(x.title)}, ${read ? "읽음" : "안 읽음"}${on ? ", 지금 항목" : ""}">
      <span class="ll-sheet-mark${read ? " ll-sheet-mark-read" : ""}" aria-hidden="true">${read ? "✓" : STAGE_ICON.unread}</span>
      <span class="ll-sheet-text"><span class="ll-sheet-name">${i + 1}. ${esc(x.title)}</span></span></a></li>`;
  });
  $("#item-sheet-body").innerHTML = `<ul class="ll-sheet-list">${rows.join("")}</ul>`;
  // 지금 항목을 다시 누르면 주소가 같아 hashchange 가 없으니 시트만 닫는다
  $("#item-sheet-body").querySelectorAll(".ll-sheet-row").forEach((a) => { a.onclick = () => closeSheet(); });
  showSheet($("#item-sheet"));
  $("#item-sheet-body .ll-sheet-row-on")?.scrollIntoView({ block: "nearest" });
}
$("#sheet-backdrop").onclick = closeSheet;
document.querySelectorAll(".ll-sheet-close").forEach((b) => { b.onclick = closeSheet; });
document.addEventListener("keydown", (e) => { if (e.key === "Escape") closeSheet(); });
function progressBar(ratio) {
  return `<span class="progressbar" aria-valuenow="${Math.round(ratio * 100)}"><span style="transform:translate3d(${-100 + ratio * 100}%,0,0)"></span></span>`;
}
// 읽음·테스트 통과·숙달을 한 막대에 겹쳐 그린다(항목 수 기준 — 테스트 통과·숙달은 그 단계 장의 항목 수). 숫자 앞 점 색 = 막대 색
// legend = false 면 막대만(주제 카드)
function stageBar(topic, state, p, legend = true) {
  const itemsAt = (stages) => topic.chapters.filter((c) => stages.includes(chapterStage(state, c))).reduce((n, c) => n + c.items.length, 0);
  const tested = itemsAt(["tested", "mastered"]);
  const mastered = itemsAt(["mastered"]);
  const pct = (n) => (p.items ? (n / p.items) * 100 : 0).toFixed(1);
  return `<div class="ll-stack" role="img" aria-label="항목 ${p.items}개 중 읽음 ${p.readTotal}">
      <span class="ll-stack-read" style="width:${pct(p.readTotal)}%"></span><span class="ll-stack-tested" style="width:${pct(tested)}%"></span><span class="ll-stack-mastered" style="width:${pct(mastered)}%"></span></div>
    ${legend ? `<div class="ll-stack-legend"><span><i class="ll-dot ll-dot-read"></i>읽음 ${p.readTotal}</span><span><i class="ll-dot ll-dot-tested"></i>테스트 통과 ${p.tested + p.mastered}장</span><span><i class="ll-dot ll-dot-mastered"></i>숙달 ${p.mastered}장</span><span class="ll-stack-total">${p.items}항목</span></div>` : ""}`;
}
// 동기화 상태 한 줄(오늘·설정)
function syncRow() {
  const cfg = syncConfig();
  return `<a class="item-link item-content" href="#/settings"><div class="item-media"><i class="ll-dot ${cfg ? "ll-dot-on" : "ll-dot-off"}"></i></div><div class="item-inner">
    <div class="item-title">${cfg ? "동기화 연결됨" : "연결 안 됨"}<div class="item-footer">${cfg ? esc(cfg.repo) : "이 브라우저에만 저장 중"}</div></div>
    <div class="item-after">${cfg ? "설정" : "GitHub 연결"}</div></div></a>`;
}
// 이어 읽기: 가장 최근에 읽은 주제의 다음 안 읽은 항목(읽은 적이 없으면 첫 주제의 첫 항목)
function continueTarget(entries) {
  let best = null;
  for (const { t, topic, state } of entries) {
    const next = allItems(topic).find((it) => !state.read[it.id]);
    if (!next) continue;
    const last = Math.max(0, ...Object.values(state.read));
    if (!best || last > best.last) best = { t, topic, state, next, last };
  }
  return best;
}

// ---------- 오늘: ① 오늘 할 일 ② 이번 주 학습량 ③ 주제별 진행 ④ 다가오는 7일 재점검 · 동기화 한 줄 ----------
const WEEKDAY_LABEL = ["월", "화", "수", "목", "금", "토", "일"];
async function viewHome(root) {
  setFrame({ title: "오늘", tab: "today" });
  const all = await loadAllTopics();
  const entries = all.filter((r) => !r.error);
  const due = entries.reduce((n, r) => n + r.p.due, 0);
  const todo = entries.filter((r) => r.plan && r.plan.pending.length);

  // ① 오늘 할 일: 일정상 오늘까지 장(밀린 장은 빨강 「M/D 밀림」) + 재점검 대기 수. 채움 버튼 하나 — 일정 장 → 재점검 → 이어 읽기 순
  const todoRows = todo.map((r) => `<li class="ll-today-row"><a href="#/t/${enc(r.t.id)}"><span class="ll-today-topic">${esc(r.t.title)}</span>
      <span class="ll-today-chs">${r.plan.pending.map((x) => `<span class="ll-today-ch">${esc(x.chapter.id)}${x.late ? ` <span class="ll-late">${shortDay(x.date)} 밀림</span>` : ""}</span>`).join('<span aria-hidden="true"> · </span>')}</span></a></li>`).join("");
  const dueRow = due ? `<li class="ll-today-row"><a href="#/review"><span class="ll-today-topic">재점검 대기</span><span class="ll-today-num">${due}</span></a></li>` : "";
  const first = todo[0];
  const go = first ? null : continueTarget(entries);
  const primary = first
    ? `<a class="button button-fill button-large ll-actions" href="${chapterHref(first.t.id, first.state, first.plan.pending[0].chapter)}">${esc(first.plan.pending[0].chapter.id)} 시작</a>`
    : due ? `<a class="button button-fill button-large ll-actions" href="#/review">재점검 시작</a>`
    : go ? `<a class="button button-fill button-large ll-actions" href="#/t/${enc(go.t.id)}/i/${enc(go.next.id)}">이어 읽기: ${esc(go.next.chapterId)}</a>` : "";
  const todayCard = `<div class="card ll-today"><div class="card-content card-content-padding">
      <p class="ll-eyebrow">오늘 할 일</p>
      ${todoRows || dueRow ? `<ul class="ll-today-list">${todoRows}${dueRow}</ul>` : `<p class="ll-state">오늘 일정·재점검이 없어요.</p>
      ${go ? `<p class="ll-muted ll-today-next">이어 읽기 · ${esc(go.t.title)} · ${esc(go.next.title)}부터</p>` : ""}`}
      ${primary}</div></div>`;

  // ② 이번 주 학습량: 요일별 막대 두 개(읽은 항목 · 푼 문항) + 연속 학습일
  const week = weekActivity(entries);
  const max = Math.max(1, ...week.days.flatMap((d) => [d.items, d.answers]));
  const h = (n) => `${Math.round((n / max) * 100)}%`;
  const sumItems = week.days.reduce((n, d) => n + d.items, 0);
  const sumAnswers = week.days.reduce((n, d) => n + d.answers, 0);
  const weekCard = `<div class="card ll-week"><div class="card-content card-content-padding">
      <div class="ll-week-head"><p class="ll-eyebrow">이번 주 학습량</p><span class="ll-week-streak">연속 학습 <b>${week.streak}</b>일</span></div>
      <div class="ll-week-bars" role="img" aria-label="이번 주 읽은 항목 ${sumItems}개 · 푼 문항 ${sumAnswers}개">${week.days.map((d, i) => `<div class="ll-week-day${d.today ? " ll-week-today" : ""}${d.future ? " ll-week-future" : ""}">
        <div class="ll-week-pair"><span class="ll-week-bar ll-week-items" style="height:${h(d.items)}"></span><span class="ll-week-bar ll-week-answers" style="height:${h(d.answers)}"></span></div>
        <span class="ll-week-label">${WEEKDAY_LABEL[i]}</span></div>`).join("")}</div>
      <div class="ll-stack-legend"><span><i class="ll-dot ll-dot-read"></i>읽은 항목 ${sumItems}</span><span><i class="ll-dot ll-dot-tested"></i>푼 문항 ${sumAnswers}</span><span class="ll-stack-total">장 1개 또는 문항 ${STREAK_MIN_ANSWERS}개면 학습한 날</span></div>
    </div></div>`;

  // ③ 주제별 진행: 진행 % + 단계별 색 막대, 일정 있는 주제만 「일정대로 / N장 밀림」 한 줄
  const rows = all.map((r) => {
    if (r.error) return `<li class="item-content"><div class="item-inner">${esc(r.t.title)} — 읽지 못함: ${esc(r.error)}</div></li>`;
    const line = r.plan && scheduleLine(r.plan);
    return `<li><a class="item-link item-content" href="#/t/${enc(r.t.id)}"><div class="item-inner ll-topic-row">
      <div class="ll-progress-head"><span class="ll-progress-name">${esc(r.t.title)}</span><span class="ll-progress-pct">${topicPercent(r.p)}%</span></div>
      ${stageBar(r.topic, r.state, r.p, false)}
      ${line ? `<div class="ll-progress-plan${line.late ? " ll-late" : ""}">${esc(line.text)}</div>` : ""}</div></a></li>`;
  });

  // ④ 다가오는 7일 재점검: 날짜별 대기 수
  const up = upcomingReviews(entries);
  const upCard = `<div class="ll-upcoming" role="list">${up.map((d) => `<div class="ll-upcoming-day${d.n ? "" : " ll-upcoming-none"}" role="listitem" aria-label="${shortDay(d.date)} 재점검 ${d.n}"><span class="ll-upcoming-date">${shortDay(d.date)}</span><span class="ll-upcoming-n">${d.n}</span></div>`).join("")}</div>`;

  root.innerHTML = `${todayCard}${weekCard}
    <div class="block-title">주제별 진행</div>
    ${rows.length ? `<div class="list list-strong inset list-dividers ll-topics"><ul>${rows.join("")}</ul></div>
    <div class="block ll-progress-legend"><div class="ll-stack-legend"><span><i class="ll-dot ll-dot-read"></i>읽음</span><span><i class="ll-dot ll-dot-tested"></i>테스트 통과</span><span><i class="ll-dot ll-dot-mastered"></i>숙달</span><span class="ll-stack-total">진행 % = 테스트 통과 이상 장</span></div></div>` : `<div class="block">주제가 없습니다.</div>`}
    <div class="block-title">다가오는 7일 재점검</div>
    <div class="block">${upCard}</div>
    <div class="block-title">기기 동기화</div>
    <div class="list list-strong inset"><ul><li>${syncRow()}</li></ul></div>
    <div class="block"><p class="ll-muted">항목을 다 읽은 장은 문제로 테스트하고, ${intervalText()}일 뒤에 다시 점검합니다.</p></div>`;
}

// ---------- 주제: 주제 카드 한 줄에 하나 — 이름은 줄바꿈(말줄임 없음), 진행 막대, 「다음: <장 ID>」 이어 읽기 ----------
async function viewTopics(root) {
  setFrame({ title: "주제", tab: "topics" });
  const loaded = await loadAllTopics();
  // 채움 버튼은 하나 — 오늘 일정 주제(오늘까지 잡힌 안 끝난 장으로), 없으면 가장 최근에 읽은 주제
  const entries = loaded.filter((r) => !r.error);
  const sched = scheduledToday(entries);
  const go = sched || continueTarget(entries);
  const cards = loaded.map((r) => {
    if (r.error) return `<div class="card ll-topic-card"><div class="card-content card-content-padding"><div class="ll-topic-name">${esc(r.t.title)}</div><p class="ll-muted">읽지 못함: ${esc(r.error)}</p></div></div>`;
    const { t, topic, state, p } = r;
    const n = nextUnread(topic, state);
    const primary = go && go.t.id === t.id;
    const target = primary && sched ? { ch: sched.plan.pending[0].chapter, href: chapterHref(t.id, state, sched.plan.pending[0].chapter) }
      : n ? { ch: n.chapter, href: `#/t/${enc(t.id)}/i/${enc(n.item.id)}` } : null;
    const btn = target
      ? `<a class="button button-large ${primary ? "button-fill" : "button-tonal"} ll-topic-next" href="${target.href}">다음: ${esc(target.ch.id)}</a>`
      : `<p class="ll-state">모든 항목을 읽었어요.</p>`;
    return `<div class="card ll-topic-card"><div class="card-content card-content-padding">
      <a class="ll-topic-head" href="#/t/${enc(t.id)}"><span class="ll-topic-name">${esc(t.title)}</span><span class="ll-topic-more" aria-hidden="true">›</span></a>
      <p class="ll-muted ll-topic-meta">진행 ${topicPercent(p)}% · 읽음 ${p.readTotal}/${p.items}항목 · ${p.chapters}장</p>
      ${stageBar(topic, state, p, false)}
      ${btn}</div></div>`;
  });
  root.innerHTML = cards.length ? `<div class="ll-topic-cards">${cards.join("")}</div>` : `<div class="block">주제가 없습니다.</div>`;
}

// ---------- 목차: 부별 접기 · 장을 세로 경로로 잇고 상태 기호 · 「지금 장으로」 ----------
async function viewToc(root, id) {
  const topic = await getTopic(id);
  const state = loadState(id);
  const p = topicProgress(topic, state);
  setFrame({ title: topic.title, tab: "topics", topic, back: "#/topics" });
  const n = nextUnread(topic, state);
  const nextCh = n && n.chapter;
  // 일정 날짜(있으면): 안 끝난 장인데 날짜가 어제 이전이면 빨강 「M/D 밀림」
  const plan = scheduleStatus(topic, state);
  const today = dayKey(Date.now());
  const groups = [];
  for (const ch of topic.chapters) {
    const last = groups[groups.length - 1];
    if (last && last.part === (ch.part || "")) last.chapters.push(ch);
    else groups.push({ part: ch.part || "", chapters: [ch] });
  }
  // 장 행 오른쪽: 읽는 중·읽기 전은 읽은 수, 그 뒤 단계는 단계 이름. 지금 장(다음에 읽을 장)은 강조
  const rows = (g) => `<ol class="ll-path-list">${g.chapters.map((ch) => {
    const st = chapterStage(state, ch);
    const after = st === "unread" || st === "reading" ? `${readCount(state, ch)}/${ch.items.length}${st === "reading" ? " 읽음" : ""}` : STAGE_LABEL[st];
    const now = nextCh === ch;
    const date = plan && plan.dateOf.get(ch.id);
    const late = date && date < today && !chapterDone(state, ch);
    const dateHtml = date ? `<span class="ll-path-date${late ? " ll-late" : ""}">${shortDay(date)}${late ? " 밀림" : ""}</span>` : "";
    return `<li class="ll-path-row ll-path-${st}${now ? " ll-path-now" : ""}"${now ? ' id="toc-now"' : ""}><a href="#/t/${enc(id)}/c/${enc(ch.id)}"${now ? ' aria-current="step"' : ""}>
      <span class="ll-path-mark ll-stage-${st}" title="${STAGE_LABEL[st]}" aria-label="${STAGE_LABEL[st]}">${STAGE_ICON[st]}</span>
      <span class="ll-path-text">${esc(ch.title)}</span><span class="ll-path-after">${after}${dateHtml}</span></a></li>`;
  }).join("")}</ol>`;
  // 지금 장이 든 부만 펼친다(다 읽었으면 모두 펼침). 부 이름이 없으면 접지 않는다
  const html = groups.map((g) => {
    if (!g.part) return `<div class="ll-part">${rows(g)}</div>`;
    const done = g.chapters.filter((ch) => ["tested", "mastered"].includes(chapterStage(state, ch))).length;
    const open = !nextCh || g.chapters.includes(nextCh) || groups.length === 1;
    // 부 머리: 일정이 있으면 「N장 · M/D부터」(부 안 가장 이른 날짜), 없으면 「N장 · 통과 K」
    const from = plan && g.chapters.map((ch) => plan.dateOf.get(ch.id)).filter(Boolean).sort()[0];
    return `<details class="ll-part"${open ? " open" : ""}><summary class="ll-part-head"><span class="ll-part-name">${esc(g.part)}</span><span class="ll-part-count">${g.chapters.length}장 · ${from ? `${shortDay(from)}부터` : `통과 ${done}`}</span></summary>${rows(g)}</details>`;
  }).join("");
  root.innerHTML = `<div class="block">
      ${topic.summary ? `<p class="ll-muted">${esc(topic.summary)}</p>` : ""}
      ${stageBar(topic, state, p)}
      ${n ? `<a class="button button-fill button-large ll-actions" href="#/t/${enc(id)}/i/${enc(n.item.id)}">${esc(nextCh.id)} 이어 읽기</a>` : `<p class="ll-state">모든 항목을 읽었어요.</p>`}
    </div>
    <div class="ll-toc-parts">${html}</div>
    <div class="block ll-legend"><p class="ll-muted">${Object.entries(STAGE_ICON).map(([k, v]) => `<span class="ll-stage-${k}">${v}</span> ${STAGE_LABEL[k]}`).join(" · ")}${plan ? ` · 날짜 = 일정 · <span class="ll-late">밀림</span> = 일정 지남` : ""}</p></div>
    ${nextCh ? `<button type="button" class="ll-fab" id="btn-now">지금 장으로</button>` : ""}`;
  if (nextCh) $("#btn-now").onclick = () => {
    const row = $("#toc-now");
    const part = row.closest("details");
    if (part) part.open = true;
    row.scrollIntoView({ behavior: "smooth", block: "center" });
    row.querySelector("a").focus({ preventScroll: true });
  };
}

// ---------- 장: 항목 체크 + 장 테스트 ----------
async function viewChapter(root, id, chapterId) {
  const topic = await getTopic(id);
  const ch = findChapter(topic, chapterId);
  if (!ch) { root.innerHTML = `<div class="block">장이 없습니다.</div>`; return; }
  const state = loadState(id);
  setFrame({ title: `${ch.id} · ${topic.title}`, tab: "topics", topic, crumb: ch.id, back: `#/t/${enc(id)}` });
  const st = chapterStage(state, ch);
  const done = readCount(state, ch);
  const allRead = done === ch.items.length;
  const { fresh, due } = reviewQueue(topic, state, Date.now(), ch.id);
  const cardCount = (ch.cards || []).length;
  const idx = topic.chapters.indexOf(ch);
  const prev = topic.chapters[idx - 1];
  const next = topic.chapters[idx + 1];
  const items = ch.items.map((it) => `<li class="ll-toc-row">
      <label class="item-checkbox item-content ll-check" title="읽음 체크">
        <input type="checkbox" data-read="${esc(it.id)}" ${state.read[it.id] ? "checked" : ""} aria-label="${esc(it.title)} 읽음"><i class="icon icon-checkbox"></i>
      </label>
      <a class="item-link item-content ll-toc-link" href="#/t/${enc(id)}/i/${enc(it.id)}"><div class="item-inner">
        <div class="item-title">${esc(it.title)}</div></div></a></li>`).join("");
  const toTest = fresh.length + due.length;
  // 테스트할 문제가 있으면 테스트가 채움 버튼, 없으면 상태 문장 + 다음 장이 채움 버튼(화면마다 채움 버튼 하나)
  const testState = !cardCount ? "이 장은 문제가 없어요."
    : !allRead ? `항목을 모두 읽으면 ${cardCount}문제로 테스트해요.`
    : toTest ? "" : "오늘 볼 문제 없어요.";
  const passed = (ch.cards || []).filter((c) => state.cards[c.id]?.box >= 1).length;
  const chDue = (ch.cards || []).map((c) => state.cards[c.id]).filter((cs) => cs?.box && cs.due > Date.now()).map((cs) => cs.due).sort((a, b) => a - b)[0];
  const testRows = cardCount && allRead ? `<div class="block-title">이 장 테스트</div>
    <div class="list list-strong inset list-dividers"><ul>
      <li class="item-content"><div class="item-inner"><div class="item-title">통과</div><div class="item-after">${cardCount}문제 중 ${passed}개</div></div></li>
      ${chDue ? `<li class="item-content"><div class="item-inner"><div class="item-title">다음 재점검</div><div class="item-after">${fmtDate(chDue)}</div></div></li>` : ""}
    </ul></div>` : "";
  root.innerHTML = `<div class="block">
      <p class="ll-muted">${esc(ch.part || "")}${ch.part ? " · " : ""}${idx + 1}/${topic.chapters.length}장</p>
      <div class="block-title-medium ll-chapter-title">${esc(ch.title)}</div>
      ${progressBar(ch.items.length ? done / ch.items.length : 0)}
      <p class="ll-muted"><span class="ll-stage-${st}">${STAGE_ICON[st]}</span> ${STAGE_LABEL[st]} · 읽음 ${done}/${ch.items.length}${cardCount ? ` · 문제 ${cardCount}` : ""}</p>
    </div>
    <div class="block-title">항목</div>
    <div class="list list-strong list-dividers inset ll-toc"><ul>${items}</ul></div>
    ${testRows}
    <div class="block grid grid-gap">
      ${testState ? `<p class="ll-state">${testState}</p>` : `<button class="button button-fill button-large" id="btn-test">이 장 테스트 ${toTest}문제</button>`}
      ${next ? `<a class="button button-large ${testState ? "button-fill" : "button-tonal"}" href="#/t/${enc(id)}/c/${enc(next.id)}">다음 장: ${esc(next.title)} ›</a>` : ""}
      ${prev ? `<a class="button" href="#/t/${enc(id)}/c/${enc(prev.id)}">‹ 이전 장</a>` : ""}
    </div>`;
  root.querySelectorAll("[data-read]").forEach((cb) => {
    cb.onchange = () => { toggleRead(id, cb.dataset.read, cb.checked); route(); };
  });
  if (!testState) $("#btn-test").onclick = () => runSession(root, id, [...due, ...fresh], `${ch.title} 테스트`, `#/t/${enc(id)}/c/${enc(ch.id)}`);
}

// ---------- 항목 읽기 ----------
async function viewItem(root, id, itemId) {
  const topic = await getTopic(id);
  const items = allItems(topic);
  const idx = items.findIndex((it) => it.id === itemId);
  if (idx < 0) { root.innerHTML = `<div class="block">항목이 없습니다.</div>`; return; }
  const it = items[idx];
  const ch = findChapter(topic, it.chapterId);
  const body = await getChapterBody(id, ch.id);
  const html = body.items.find((b) => b.id === it.id)?.html || "";
  const state = loadState(id);
  setFrame({ title: `${it.title} · ${topic.title}`, tab: "topics", topic, crumb: ch.id, crumbHref: `#/t/${enc(id)}/c/${enc(ch.id)}`, back: `#/t/${enc(id)}/c/${enc(ch.id)}` });
  const next = items[idx + 1];
  const prev = items[idx - 1];
  const read = !!state.read[it.id];
  const pos = ch.items.findIndex((x) => x.id === it.id) + 1;
  // 읽음 체크 → 같은 장 다음 항목, 장 마지막 항목이면 장 완료 화면(장 테스트 · 다음 장)
  const lastInChapter = !next || next.chapterId !== ch.id;
  const after = lastInChapter ? `#/t/${enc(id)}/done/${enc(ch.id)}` : `#/t/${enc(id)}/i/${enc(next.id)}`;
  const chRead = readCount(state, ch);
  // 위: 장 안 위치 「n / m」 + 장 읽음 막대 + 「항목 목록 ▾」(줄 전체가 버튼, 스크롤해도 머리줄 아래 고정)
  // 아래: 탭 바로 위 고정 바 「‹ 이전 · 읽음 ✓ · 다음 ›」 — 채움은 「다음」 하나
  root.innerHTML = `<button type="button" class="ll-itempos" id="btn-item-list" aria-haspopup="dialog" aria-label="${esc(ch.id)} 항목 ${ch.items.length}개 중 ${pos}번째, ${chRead}개 읽음 — 항목 목록 열기">
      <span class="ll-itempos-num" aria-hidden="true">${pos} / ${ch.items.length}</span>
      <span class="ll-itempos-bar" aria-hidden="true">${progressBar(ch.items.length ? chRead / ch.items.length : 0)}</span>
      <span class="ll-itempos-list" aria-hidden="true">항목 목록 ▾</span>
    </button>
    <div class="block ll-article">
      <p class="ll-muted"><a href="#/t/${enc(id)}/c/${enc(ch.id)}">${esc(ch.title)}</a></p>
      <h1>${esc(it.title)}</h1>
      ${html}
    </div>
    <nav class="ll-itembar" aria-label="항목 이동">
      ${prev
        ? `<a class="button button-large ll-itembar-btn" href="#/t/${enc(id)}/i/${enc(prev.id)}">‹ 이전</a>`
        : `<span class="button button-large ll-itembar-btn disabled" aria-disabled="true">‹ 이전</span>`}
      ${read
        ? `<button type="button" class="button button-large ll-itembar-btn ll-read-on" id="btn-read"><span>✓ 읽음</span><small>누르면 취소</small></button>`
        : `<button type="button" class="button button-large button-outline ll-itembar-btn" id="btn-read">읽음 ✓</button>`}
      <a class="button button-large button-fill ll-itembar-btn" href="${after}">${lastInChapter ? "장 마치기 ›" : "다음 ›"}</a>
    </nav>`;
  $("#page").classList.add("ll-has-itembar");
  $("#btn-item-list").onclick = () => openItemSheet(id, ch, it.id);
  $("#btn-read").onclick = () => {
    if (read) { toggleRead(id, it.id, false); route(); return; }
    toggleRead(id, it.id, true);
    location.hash = after;
  };
  $("#content").scrollTop = 0;
}

// ---------- 장 완료: 장 테스트 · 다음 장 읽기 ----------
async function viewDone(root, id, chapterId) {
  const topic = await getTopic(id);
  const ch = findChapter(topic, chapterId);
  if (!ch) { root.innerHTML = `<div class="block">장이 없습니다.</div>`; return; }
  const state = loadState(id);
  setFrame({ title: `${ch.id} · ${topic.title}`, tab: "topics", topic, crumb: ch.id, crumbHref: `#/t/${enc(id)}/c/${enc(ch.id)}`, back: `#/t/${enc(id)}/c/${enc(ch.id)}` });
  const done = readCount(state, ch);
  const unread = ch.items.filter((it) => !state.read[it.id]);
  const { fresh, due } = reviewQueue(topic, state, Date.now(), ch.id);
  const cards = [...due, ...fresh];
  const next = topic.chapters[topic.chapters.indexOf(ch) + 1];
  const nextItem = next && (next.items.find((it) => !state.read[it.id]) || next.items[0]);
  const cardCount = (ch.cards || []).length;
  const fresh1 = fresh.length && !due.length;
  root.innerHTML = `<div class="block ll-done">
      <div class="ll-done-mark ${unread.length ? "ll-done-partial" : ""}">${unread.length ? STAGE_ICON.reading : "✓"}</div>
      <div class="ll-done-title">${unread.length ? `${unread.length}개 항목이 남았어요` : "다 읽었어요"}</div>
      <p>${esc(ch.title)}</p>
      <p class="ll-muted">항목 ${ch.items.length}개${cardCount ? ` · 테스트 ${cardCount}문제` : ""} · 읽음 ${done}/${ch.items.length}</p>
      ${cards.length && fresh1 ? `<p class="ll-muted">지금 풀면 1일 뒤 첫 재점검이 잡혀요.</p>` : ""}
    </div>
    ${unread.length ? `<div class="block-title">아직 안 읽은 항목</div><div class="list list-strong list-dividers inset"><ul>${unread.map((it) => `<li><a class="item-link item-content" href="#/t/${enc(id)}/i/${enc(it.id)}"><div class="item-inner"><div class="item-title">${esc(it.title)}</div></div></a></li>`).join("")}</ul></div>` : ""}
    <div class="block grid grid-gap">
      ${cards.length ? `<button class="button button-fill button-large" id="btn-test">테스트 시작 (${cards.length}문제)</button>` : `<p class="ll-state">${cardCount ? (unread.length ? "항목을 모두 읽으면 테스트해요." : "오늘 볼 문제 없어요.") : "이 장은 문제가 없어요."}</p>`}
      ${nextItem
        ? (cards.length
          ? `<a class="button" href="#/t/${enc(id)}/i/${enc(nextItem.id)}">나중에 하기 — 다음 장 읽기</a>`
          : `<a class="button button-fill button-large" href="#/t/${enc(id)}/i/${enc(nextItem.id)}">다음 장 읽기: ${esc(next.title)} ›</a>`)
        : `<a class="button ${cards.length ? "" : "button-fill button-large"}" href="#/t/${enc(id)}">목차로</a>`}
    </div>`;
  if (cards.length) $("#btn-test").onclick = () => runSession(root, id, cards, `${ch.id} 테스트`, `#/t/${enc(id)}/done/${enc(ch.id)}`);
  $("#content").scrollTop = 0;
}

// ---------- 복습: 주제 칩(대기 수) · 숫자 3줄 · 채움 버튼 하나 · 오늘 재점검 내역(장별) ----------
// #/review = 「전체」(모든 주제를 한 회차로), #/t/<주제>/review = 그 주제. 칩 숫자 = 오늘 재점검 대기 수(「복습」 탭 배지와 같은 기준)
async function viewReview(root, id) {
  const all = await loadAllTopics();
  const entries = all.filter((r) => !r.error);
  const sel = id ? entries.filter((r) => r.t.id === id) : entries;
  if (id) {
    const one = sel[0] || { topic: await getTopic(id) };
    setFrame({ title: `복습 · ${one.topic.title}`, tab: "review", topic: one.topic, crumb: "복습", back: "#/review" });
  } else setFrame({ title: "복습", tab: "review" });
  const parts = sel.map((r) => ({ r, ...reviewQueue(r.topic, r.state) }));
  const due = parts.flatMap((x) => x.due.length ? [{ id: x.r.t.id, cards: x.due }] : []);
  const fresh = parts.flatMap((x) => x.fresh.length ? [{ id: x.r.t.id, cards: x.fresh }] : []);
  const dueN = due.reduce((n, x) => n + x.cards.length, 0);
  const freshN = fresh.reduce((n, x) => n + x.cards.length, 0);
  const notReady = sel.reduce((n, r) => n + r.topic.chapters.filter((ch) => (ch.cards || []).length && readCount(r.state, ch) < ch.items.length).length, 0);
  const nextDue = sel.map((r) => r.p.nextDue).filter(Boolean).sort((a, b) => a - b)[0];
  const chip = (href, label, n, on) => `<a class="ll-chip${on ? " ll-chip-on" : ""}" href="${href}"${on ? ' aria-current="page"' : ""}><span class="ll-chip-name">${esc(label)}</span> <span class="ll-chip-n">${n}</span></a>`;
  const chips = `<nav class="ll-chip-row" aria-label="주제">${chip("#/review", "전체", entries.reduce((n, r) => n + r.p.due, 0), !id)}${entries.map((r) => chip(`#/t/${enc(r.t.id)}/review`, r.t.title, r.p.due, r.t.id === id)).join("")}</nav>`;
  // 오늘 재점검 내역: 장마다 대기 수(전체면 주제 이름도)
  const byChapter = parts.flatMap((x) => {
    const n = {};
    for (const c of x.due) n[c.chapterId] = (n[c.chapterId] || 0) + 1;
    return x.r.topic.chapters.filter((ch) => n[ch.id]).map((ch) => ({ r: x.r, ch, n: n[ch.id] }));
  });
  const dueList = byChapter.length ? `<div class="block-title">오늘 재점검 내역</div>
    <div class="list list-strong inset list-dividers ll-due-list"><ul>${byChapter.map(({ r, ch, n }) => `<li><a class="item-link item-content" href="#/t/${enc(r.t.id)}/c/${enc(ch.id)}"><div class="item-inner">
      <div class="item-title">${esc(chapterLabel(ch))}${id ? "" : `<div class="item-footer">${esc(r.t.title)}</div>`}</div><div class="item-after">${n}</div></div></a></li>`).join("")}</ul></div>` : "";
  // 채움 버튼은 하나만 — 재점검이 있으면 재점검, 없으면 새 문제
  const primary = dueN ? "due" : freshN ? "fresh" : null;
  const btn = (key, label, n) => `<button class="button ${primary === key ? "button-fill button-large" : "button-tonal button-large"}" id="btn-${key}" ${n ? "" : "disabled"}>${label} (${n})</button>`;
  root.innerHTML = `${chips}
    ${primary ? "" : `<div class="block ll-done">
      <div class="ll-done-mark">✓</div>
      <div class="ll-done-title">오늘 볼 문제 없어요</div>
      ${nextDue ? `<p class="ll-muted">다음 재점검 ${fmtDate(nextDue)}</p>` : ""}
    </div>`}
    <div class="list list-strong inset list-dividers"><ul>
      <li class="item-content"><div class="item-inner"><div class="item-title">오늘 재점검</div><div class="item-after">${dueN}</div></div></li>
      <li class="item-content"><div class="item-inner"><div class="item-title">새 문제 (1번 맞히면 통과)</div><div class="item-after">${freshN}</div></div></li>
      <li class="item-content"><div class="item-inner"><div class="item-title">아직 다 읽지 않은 장</div><div class="item-after">${notReady}</div></div></li>
    </ul></div>
    <div class="block grid grid-gap">
      ${primary ? `${btn("due", "재점검 시작", dueN)}${btn("fresh", "새 문제 테스트", freshN)}
      ${nextDue ? `<p class="ll-muted">다음 재점검 ${fmtDate(nextDue)}</p>` : ""}` : `<a class="button button-fill button-large" href="${id ? `#/t/${enc(id)}` : "#/topics"}">${id ? "목차에서 이어 읽기" : "주제에서 이어 읽기"}</a>`}
    </div>
    ${dueList}
    <div class="block"><p class="ll-muted">재점검은 테스트를 통과한 뒤 ${intervalText()}일 뒤에 하고, 틀리면 1일 뒤로 돌아가요.</p>
      <p class="ll-muted">항목을 모두 읽은 장의 문제만 나와요. 답을 고르고 확신을 고른 뒤 제출하면 정답이 열려요. 틀린 문제는 회차 끝에 한 번 더 나와요.</p></div>`;
  $(".ll-chip-on")?.scrollIntoView({ block: "nearest", inline: "center" });
  const back = id ? `#/t/${enc(id)}/review` : "#/review";
  if (!primary) return;
  if (dueN) $("#btn-due").onclick = () => runSessionParts(root, due, "재점검", back);
  if (freshN) $("#btn-fresh").onclick = () => runSessionParts(root, fresh, "새 문제 테스트", back);
}

function runSession(root, id, cards, label, backHref) {
  runSessionParts(root, [{ id, cards }], label, backHref);
}
// 여러 주제를 한 회차로(복습 「전체」): 주제마다 엔진 회차를 따로 만들어 topics.json 순서로 이어 낸다 — 상태는 주제마다 저장
function multiSession(parts) {
  const subs = parts.filter((p) => p.cards.length).map((p) => { const state = loadState(p.id); return { id: p.id, state, sess: createSession(state, p.cards) }; });
  const sum = (k) => subs.reduce((n, x) => n + x.sess[k], 0);
  const current = () => subs.find((x) => x.sess.next());
  return {
    subs,
    get total() { return sum("total"); },
    get passed() { return sum("passed"); },
    get answered() { return sum("answered"); },
    get steps() { return sum("steps"); },
    get failed() { return subs.flatMap((x) => x.sess.failed); },
    get unsure() { return subs.flatMap((x) => x.sess.unsure); },
    next() { return current()?.sess.next() || null; },
    // 채점한 카드의 주제 { id, state } 를 돌려준다 — 부른 쪽이 저장
    grade(...args) { const x = current(); x.sess.grade(...args); return x; },
  };
}
function runSessionParts(root, parts, label, backHref) {
  const sess = multiSession(parts);
  const cards = parts.flatMap((p) => p.cards);
  const id = sess.subs[0]?.id;
  inSession = true;
  setSessionFrame(backHref);
  const step = () => {
    const card = sess.next();
    if (!card) {
      inSession = false;
      // 회차가 끝나면 아래 탭·위 막대를 시작 전 화면 틀로 되돌리고 배지를 회차 결과로 다시 센다
      setFrame(lastFrame);
      updateReviewBadge().catch(() => {});
      const failed = sess.failed;
      const cardById = Object.fromEntries(cards.map((c) => [c.id, c]));
      // 틀린 문제의 내 답 = 이 회차 기록에서 그 카드의 마지막 답
      const myAnswer = (cid) => sess.subs.flatMap((x) => x.state.log).filter((l) => l.id === cid).pop()?.answer;
      const nextDue = sess.subs.flatMap((x) => Object.values(x.state.cards)).filter((cs) => cs && cs.box && cs.due > Date.now()).map((cs) => cs.due).sort((a, b) => a - b)[0];
      root.innerHTML = `<div class="block-title block-title-medium">${esc(label)} 끝</div>
        <div class="card ll-score"><div class="card-content card-content-padding">
          <div class="ll-score-num">${sess.total}문제 중 <b>${sess.passed}</b>개 통과</div>
          ${progressBar(sess.total ? sess.passed / sess.total : 0)}
          <p class="ll-muted">${nextDue ? `다음 재점검 ${fmtDate(nextDue)}` : "다음 재점검 없음"} · 답 ${sess.answered}번</p>
        </div></div>
        ${failed.length ? `<div class="block-title">틀린 문제 ${failed.length}개 — 다음 회차에 다시 나와요</div>
        <div class="list list-strong inset list-dividers ll-wrong"><ul>${failed.map((f) => `<li class="item-content"><div class="item-inner"><div class="item-title">${esc(f)} ${esc(cardById[f]?.q || "")}
          <div class="item-footer">내 답: ${esc(myAnswer(f) || "—")}</div><div class="item-footer ll-wrong-right">정답: ${esc(cardById[f]?.a || "")}</div></div></div></li>`).join("")}</ul></div>` : `<div class="block"><p class="ll-state">모두 통과했어요.</p></div>`}
        ${sess.unsure.length ? `<div class="block-title">확신 없이 맞힌 문제 ${sess.unsure.length}개 — 통과로 쳤어요, 정답을 한 번 더 보세요</div>
        <div class="list list-strong inset list-dividers ll-unsure"><ul>${sess.unsure.map((u) => `<li class="item-content"><div class="item-inner"><div class="item-title">${esc(u)} ${esc(cardById[u]?.q || "")}
          <div class="item-footer">정답: ${esc(cardById[u]?.a || "")}</div></div></div></li>`).join("")}</ul></div>` : ""}
        <div class="block grid grid-gap"><button class="button button-fill button-large" id="btn-back">돌아가기</button>
          <p class="ll-muted">결과는 <a href="${sess.subs.length === 1 ? `#/t/${enc(id)}/log` : "#/settings"}">설정</a>에서 「결과 보내기」로 리뷰 세션에 넘겨요.</p></div>`;
      // 회차는 주소를 바꾸지 않고 진행해 backHref 가 지금 주소와 같을 수 있다 — 같으면 hashchange 가 없으니 직접 다시 그린다
      $("#btn-back").onclick = () => { if (location.hash === backHref) route(); else location.hash = backHref; };
      return;
    }
    showCard(root, card, `${label} · ${sess.answered + 1}/${sess.steps} · 통과 ${sess.passed}`, sess.answered / sess.steps, (grade, conf, answer) => {
      const x = sess.grade(adjustGrade(grade, conf), conf, answer, grade === 2);
      saveState(x.id, x.state);
      step();
    });
  };
  step();
}

function showCard(root, card, label, ratio, onGrade) {
  let conf = null;
  let picked = null;
  // 선택지는 매번 순서를 섞는다(자리로 외우지 않게). value 는 원래 번호
  const order = card.choices ? shuffleInPlace(card.choices.map((_, i) => i)) : [];
  const choices = card.choices
    ? `<div class="list list-strong inset list-dividers ll-choices"><ul>${order.map((i) => `<li><label class="item-radio item-content"><input type="radio" name="ll-choice" value="${i}"><i class="icon icon-radio"></i><div class="item-inner"><div class="item-title">${esc(card.choices[i])}</div></div></label></li>`).join("")}</ul></div>`
    : `<div class="block"><textarea id="my-answer" class="ll-answer-input" placeholder="답을 먼저 적거나 소리 내어 말합니다"></textarea></div>`;
  root.innerHTML = `<div class="block"><p class="ll-muted">${esc(label)}</p>${progressBar(ratio)}</div>
    <div class="card ll-flashcard"><div class="card-header"><span class="chip"><span class="chip-label">${esc(card.id)}</span></span><span class="ll-muted">${esc(card.chapterTitle || "")}</span></div>
      <div class="card-content card-content-padding"><p class="ll-question">${esc(card.q)}</p>
      ${card.hint ? `<details class="ll-hint"><summary>단서 보기</summary><p>${esc(card.hint)}</p></details>` : ""}</div></div>
    ${choices}
    <div class="block-title">얼마나 확신하나요?</div>
    <p id="pick-first" class="block ll-muted hidden">먼저 답을 고르세요.</p>
    <div class="block"><div class="segmented segmented-strong" id="conf">
      <button class="button" data-conf="0">모름</button><button class="button" data-conf="1">애매함</button><button class="button" data-conf="2">확신</button>
    </div></div>
    <div class="block" id="submit-wrap"><button class="button button-fill button-large" id="btn-submit" disabled>제출</button></div>
    <div id="reveal" class="hidden">
      <div class="card ll-answer"><div class="card-header">정답</div><div class="card-content card-content-padding">
        <p class="ll-answer-text">${esc(card.a)}</p>
        ${card.why ? `<p class="ll-why">${esc(card.why)}</p>` : ""}
      </div></div>
      <p id="auto-grade" class="block ll-auto-grade"></p>
      <div class="block-title" id="grade-title">채점</div>
      <div class="block grid grid-cols-3 grid-gap">
        <button class="button button-fill button-large color-red" data-grade="0">틀림</button>
        <button class="button button-fill button-large color-orange" data-grade="1">부분</button>
        <button class="button button-fill button-large color-green" data-grade="2">맞음</button>
      </div>
    </div>`;
  // 보기 → 확신 → 제출 순서. 제출 전에는 보기·확신을 바꿀 수 있고, 제출해야 정답이 열린다
  let submitted = false;
  const canSubmit = () => conf !== null && (!card.choices || picked !== null);
  const syncSubmit = () => { $("#btn-submit").disabled = !canSubmit(); };
  root.querySelectorAll('input[name="ll-choice"]').forEach((r) => (r.onchange = () => { picked = Number(r.value); $("#pick-first").classList.add("hidden"); syncSubmit(); }));
  root.querySelectorAll("[data-conf]").forEach((b) => {
    b.onclick = () => {
      if (submitted) return;
      if (card.choices && picked === null) { $("#pick-first").classList.remove("hidden"); return; }
      conf = Number(b.dataset.conf);
      root.querySelectorAll("[data-conf]").forEach((x) => x.classList.toggle("button-active", x === b));
      syncSubmit();
    };
  });
  $("#btn-submit").onclick = () => {
    if (submitted || !canSubmit()) return;
    submitted = true;
    root.querySelectorAll("[data-conf]").forEach((x) => { x.disabled = !x.classList.contains("button-active"); });
    $("#submit-wrap").classList.add("hidden");
    $("#reveal").classList.remove("hidden");
    // 선택지 문제는 자동 채점 — 고른 답과 정답만 보여 주고 채점 버튼은 결과 하나만 남긴다
    if (card.choices && card.answerIndex !== undefined) {
      const right = picked === card.answerIndex;
      root.querySelectorAll('input[name="ll-choice"]').forEach((r) => { r.disabled = true; const li = r.closest("li"); li.classList.toggle("ll-choice-right", Number(r.value) === card.answerIndex); li.classList.toggle("ll-choice-wrong", !right && Number(r.value) === picked); });
      $("#auto-grade").textContent = right ? "맞혔습니다" : "틀렸습니다";
      root.querySelectorAll("[data-grade]").forEach((g) => {
        const keep = g.dataset.grade === (right ? "2" : "0");
        g.classList.toggle("hidden", !keep);
        if (keep) { g.textContent = `${right ? "맞음" : "틀림"} · 다음 문제 ›`; g.parentElement.classList.remove("grid-cols-3"); }
      });
      $("#grade-title").classList.add("hidden");
    }
    $("#reveal").scrollIntoView({ behavior: "smooth", block: "start" });
  };
  root.querySelectorAll("[data-grade]").forEach((b) => {
    b.onclick = () => {
      const answer = $("#my-answer")?.value?.trim() || (picked !== null ? card.choices[picked] : "");
      onGrade(Number(b.dataset.grade), conf, answer);
      $("#content").scrollTop = 0;
    };
  });
}

// ---------- 설정: GitHub 동기화(기기마다 한 번, 모든 주제에 적용) · 결과 보내기 · 요약 복사 · 백업(고른 주제) ----------
// 결과·백업 주제 = 주소의 주제(#/t/<주제>/log) → 마지막으로 연 주제 → 첫 주제
let settingsTopic = null;
async function syncAllTopics() {
  for (const t of await getTopics()) { pulled.add(t.id); await runSync(t.id, "모든 주제"); }
}
function resultsBlock(topics, id, cfg) {
  return `<div class="block-title">결과·백업</div>
    <div class="list list-strong inset list-dividers"><ul>
      <li class="item-content item-input"><div class="item-inner"><div class="item-title item-label">주제</div>
        <div class="item-input-wrap input-dropdown-wrap"><select id="res-topic" aria-label="결과·백업 주제">${topics.map((t) => `<option value="${esc(t.id)}"${t.id === id ? " selected" : ""}>${esc(t.title)}</option>`).join("")}</select></div></div></li>
      ${cfg ? `<li class="item-content"><div class="item-inner"><div class="item-title">이 주제 마지막 동기화</div><div class="item-after" id="topic-sync-status">${esc(lastSyncText(id))}</div></div></li>` : ""}
    </ul></div>
    <div class="block grid grid-gap">
      ${cfg ? `<button class="button button-fill button-large" id="btn-send">결과 보내기</button>
        <p id="send-out" class="ll-muted hidden"></p>` : `<p class="ll-muted">GitHub 동기화를 연결하면 「결과 보내기」로 리뷰 세션에 결과를 넘겨요.</p>`}
      <button class="button button-tonal" id="btn-summary">결과 요약 보기·복사</button>
      <pre id="summary-out" class="ll-summary hidden"></pre>
      <button class="button button-outline" id="btn-export">백업 내보내기</button>
      <label class="button button-outline">백업 가져오기<input type="file" id="file-import" accept="application/json" class="hidden"></label>
    </div>`;
}
function bindResults(id, cfg) {
  $("#res-topic").onchange = (e) => {
    settingsTopic = e.target.value;
    if (location.hash === "#/settings") route(true); else location.hash = "#/settings";
  };
  if (cfg) {
    $("#btn-send").onclick = async () => {
      const out = $("#send-out");
      out.classList.remove("hidden");
      out.textContent = "보내는 중…";
      try {
        const topic = await getTopic(id);
        await runSync(id, "결과 보내기");
        const path = await sendResult(id, feedbackSummary(topic, loadState(id)));
        out.textContent = `보냄: ${path} — 리뷰 세션에 「결과 보냈음」 이라고 말하면 읽습니다.`;
      } catch (e) { out.textContent = `보내지 못함: ${e.message}`; }
      $("#topic-sync-status").textContent = lastSyncText(id);
    };
  }
  $("#btn-summary").onclick = async () => {
    const text = feedbackSummary(await getTopic(id), loadState(id));
    const out = $("#summary-out");
    out.textContent = text;
    out.classList.remove("hidden");
    try { await navigator.clipboard.writeText(text); $("#btn-summary").textContent = "복사됨"; } catch { /* 복사 권한이 없으면 화면 글을 직접 복사 */ }
  };
  $("#btn-export").onclick = () => {
    const blob = new Blob([JSON.stringify({ topic: id, exportedAt: new Date().toISOString(), state: loadState(id) }, null, 2)], { type: "application/json" });
    const a = document.createElement("a");
    a.href = URL.createObjectURL(blob);
    a.download = `learning-onboarding-${id}-${new Date().toISOString().slice(0, 10)}.json`;
    a.click();
  };
  $("#file-import").onchange = async (e) => {
    const file = e.target.files[0];
    if (!file) return;
    try {
      const data = JSON.parse(await file.text());
      if (data.topic !== id || !data.state) throw new Error("이 주제의 백업이 아닙니다.");
      saveState(id, normalizeState(data.state));
      route();
    } catch (err) { alert(err.message); }
  };
}
async function viewSettings(root, topicId) {
  setFrame({ title: "설정", tab: "settings" });
  const cfg = syncConfig();
  const topics = await getTopics();
  const has = (x) => topics.some((t) => t.id === x);
  const id = has(topicId) ? topicId : has(settingsTopic) ? settingsTopic : topics[0]?.id;
  const titles = new Map(topics.map((t) => [t.id, t.title]));
  const logHtml = () => {
    const log = syncLog();
    return log.length
      ? `<ul>${log.map((e) => `<li class="item-content"><div class="item-inner"><div class="item-title ll-sync-log${e.result === "실패" ? " ll-sync-log-fail" : ""}">${esc(syncLogLine(e, titles.get(e.topic) || e.topic))}</div></div></li>`).join("")}</ul>`
      : `<ul><li class="item-content"><div class="item-inner"><div class="item-title ll-muted">아직 없음</div></div></li></ul>`;
  };
  const lastAll = () => (syncLog()[0] ? syncLogLine(syncLog()[0], titles.get(syncLog()[0].topic)) : "아직 안 함");
  const note = `<div class="block"><details class="ll-hint"><summary>다시 넣어야 하는 때</summary><p>저장소와 토큰은 이 기기 브라우저에 한 번 저장되고 모든 주제에 적용돼요. 다른 기기·다른 브라우저, 홈 화면에 추가한 앱으로 열 때(브라우저와 저장 공간이 따로임), 브라우저 데이터를 지웠을 때, 토큰 만료일이 지났을 때 다시 넣어요.</p></details></div>`;
  const results = id ? resultsBlock(topics, id, cfg) : "";
  // 채움 버튼은 하나 — 연결됨이면 「결과 보내기」, 연결 전이면 「확인하고 저장」
  root.innerHTML = cfg
    ? `<div class="block-title block-title-medium">GitHub 동기화</div>
      <div class="block ll-sync-state">
        <div class="ll-sync-state-head"><i class="ll-dot ll-dot-on"></i>연결됨</div>
        <p class="ll-muted">마지막 동기화: <span id="sync-status">${esc(lastAll())}</span></p>
        <p class="ll-muted">저장소: ${esc(cfg.repo)}</p>
      </div>
      <div class="block grid grid-gap">
        <button class="button button-tonal button-large" id="btn-sync-all">모든 주제 지금 동기화</button>
        <button class="button color-red" id="btn-sync-off">이 기기 연결 끊기</button>
      </div>
      ${results}
      <div class="block-title">동기화 내역 <span class="ll-muted">이 기기 최근 ${SYNC_LOG_MAX}건</span></div>
      <div class="list list-strong inset list-dividers" id="sync-log">${logHtml()}</div>${note}`
    : `<div class="block-title block-title-medium">GitHub 동기화 설정</div>
      <div class="block"><p class="ll-muted">비공개 저장소와 fine-grained 토큰(그 저장소 하나, Contents: Read and write)을 넣으면 진행 상태가 기기 사이에 이어지고 이 화면의 「결과 보내기」로 리뷰 세션에 결과를 넘깁니다.</p></div>
      <div class="list list-strong inset"><ul>
        <li class="item-content item-input"><div class="item-inner"><div class="item-title item-label">저장소 (owner/이름)</div><div class="item-input-wrap"><input type="text" id="sync-repo" value="${esc(SYNC_DEFAULT_REPO)}" autocapitalize="off" autocorrect="off" spellcheck="false"></div></div></li>
        <li class="item-content item-input"><div class="item-inner"><div class="item-title item-label">토큰</div><div class="item-input-wrap"><input type="password" id="sync-token" placeholder="github_pat_…" autocomplete="off"></div></div></li>
      </ul></div>
      <div class="block grid grid-gap">
        <button class="button button-fill button-large" id="btn-sync-save">확인하고 저장</button>
        <p id="sync-err" class="ll-muted hidden"></p>
      </div>${note}
      ${results}`;
  if (id) bindResults(id, cfg);
  if (cfg) {
    $("#btn-sync-all").onclick = async () => { $("#sync-status").textContent = "동기화 중…"; await syncAllTopics(); $("#sync-status").textContent = lastAll(); $("#sync-log").innerHTML = logHtml(); if (id) $("#topic-sync-status").textContent = lastSyncText(id); };
    $("#btn-sync-off").onclick = () => { if (confirm("이 기기에서 토큰을 지웁니다. 저장소의 기록은 그대로 남습니다.")) { saveSyncConfig(null); pulled.clear(); route(); } };
    return;
  }
  $("#btn-sync-save").onclick = async () => {
    const next = { repo: $("#sync-repo").value.trim(), token: $("#sync-token").value.trim() };
    const err = $("#sync-err");
    try {
      if (!/^[\w.-]+\/[\w.-]+$/.test(next.repo) || !next.token) throw new Error("저장소(owner/이름)와 토큰을 넣으세요.");
      err.classList.remove("hidden");
      err.textContent = "확인 중…";
      await checkSyncConfig(next);
      saveSyncConfig(next);
      pulled.clear();
      await syncAllTopics();
      route();
    } catch (e) { err.classList.remove("hidden"); err.textContent = e.message; }
  };
}

// ---------- 주소 해석 ----------
function parseRoute() {
  const parts = location.hash.replace(/^#\/?/, "").split("/").map(decodeURIComponent);
  if (parts[0] === "settings") return { view: "settings" };
  if (parts[0] === "topics") return { view: "topics" };
  if (parts[0] === "review") return { view: "reviewHub" };
  if (parts[0] !== "t" || !parts[1]) return { view: "home" };
  const topic = parts[1];
  if (parts[2] === "c" && parts[3]) return { view: "chapter", topic, chapter: parts[3] };
  if (parts[2] === "i" && parts[3]) return { view: "item", topic, item: parts.slice(3).join("/") };
  if (parts[2] === "done" && parts[3]) return { view: "done", topic, chapter: parts[3] };
  if (parts[2] === "review") return { view: "review", topic };
  if (parts[2] === "log") return { view: "log", topic };
  return { view: "toc", topic };
}
// soft = 같은 화면을 다시 그릴 때(동기화로 바뀜·당겨서 새로고침) — 스크롤 위치를 지키고 0.15초 흐리게 바꿔 깜빡임을 줄인다
const SOFT_FADE_MS = 150;
async function route(soft) {
  soft = soft === true;
  const r = parseRoute();
  const root = $("#content");
  const keepTop = soft ? root.scrollTop : 0;
  if (soft) { root.classList.add("ll-fading"); await new Promise((ok) => setTimeout(ok, SOFT_FADE_MS)); }
  closeSheet();
  inSession = false;
  if (r.topic) settingsTopic = r.topic;
  // 주제를 이 페이지에서 처음 열면 저장소 사본을 받아 합치고, 바뀌었으면 화면을 다시 그린다(회차 중이면 그리지 않음)
  if (r.topic && syncConfig() && !pulled.has(r.topic)) {
    pulled.add(r.topic);
    const hash = location.hash;
    runSync(r.topic, "주제 열기").then((changed) => { if (changed && !inSession && location.hash === hash) route(true); });
  }
  try {
    if (r.view === "home") await viewHome(root);
    else if (r.view === "topics") await viewTopics(root);
    else if (r.view === "reviewHub") await viewReview(root, null);
    else if (r.view === "toc") await viewToc(root, r.topic);
    else if (r.view === "chapter") await viewChapter(root, r.topic, r.chapter);
    else if (r.view === "item") await viewItem(root, r.topic, r.item);
    else if (r.view === "done") await viewDone(root, r.topic, r.chapter);
    else if (r.view === "review") await viewReview(root, r.topic);
    else if (r.view === "log") await viewSettings(root, r.topic);
    else if (r.view === "settings") await viewSettings(root);
    updateReviewBadge().catch(() => {});
  } catch (e) {
    root.innerHTML = `<div class="block">불러오지 못했습니다: ${esc(e.message)}</div>`;
  }
  if (soft) { root.scrollTop = keepTop; root.classList.remove("ll-fading"); }
}
// 당겨서 새로고침 — 스크롤이 문서가 아니라 #content 안에서 일어나 Safari 기본 동작이 걸리지 않는다.
// 맨 위에서 당기면 본문이 손가락을 절반 속도로 따라오고, PTR_PULL 넘게 내려왔다 놓으면 지금 주제를 동기화한 뒤 화면만 다시 그린다.
// 페이지를 다시 불러오지 않아 흰 화면이 없다. 사이트가 새로 배포됐으면(자산 ETag·Last-Modified 가 바뀜) 그때만 다시 불러온다.
// 「새로고침 중…」 은 PTR_MIN_MS 이상 보여 깜빡이지 않게 한다. 테스트 회차 중·시트(주제 바꾸기·항목 목록)가 열렸을 때는 끈다.
const PTR_PULL = 50;
const PTR_RESIST = 0.6;
const PTR_HOLD = 44;
const PTR_MIN_MS = 600;
const PTR_ANIM = "transform 0.25s ease, opacity 0.25s ease";
const SITE_FILES = ["index.html", "assets/app.js", "assets/engine.js", "assets/plan.js", "assets/sync.js", "assets/style.css"];
async function siteVersion() {
  try {
    const tags = await Promise.all(SITE_FILES.map(async (f) => {
      const res = await fetch(f, { method: "HEAD", cache: "no-store" });
      return res.headers.get("etag") || res.headers.get("last-modified") || "";
    }));
    return tags.every(Boolean) ? tags.join("|") : null;
  } catch { return null; }
}
const loadedVersion = siteVersion();
(function setupPullToRefresh() {
  const el = $("#content");
  const ind = document.createElement("div");
  ind.className = "ll-ptr";
  ind.id = "ptr";
  $("#page").appendChild(ind);
  let startY = null;
  let armed = false;
  let busy = false;
  const place = (pull, animate) => {
    const t = animate ? PTR_ANIM : "none";
    el.style.transition = t;
    ind.style.transition = t;
    el.style.transform = pull > 0 ? `translateY(${pull}px)` : "";
    ind.style.opacity = Math.min(1, pull / PTR_PULL);
    ind.style.transform = `translateY(${(Math.min(pull, PTR_HOLD) / PTR_HOLD - 1) * 100}%)`;
  };
  const reset = (animate) => { startY = null; armed = false; place(0, animate); };
  reset(false);
  el.addEventListener("touchstart", (e) => {
    if (busy || inSession || el.scrollTop > 0 || $(".ll-sheet-in") || e.touches.length !== 1) return;
    startY = e.touches[0].clientY;
  }, { passive: true });
  el.addEventListener("touchmove", (e) => {
    if (startY === null) return;
    const dy = e.touches[0].clientY - startY;
    if (dy <= 0 || el.scrollTop > 0) { reset(true); return; }
    const pull = dy * PTR_RESIST;
    armed = pull >= PTR_PULL;
    ind.textContent = armed ? "놓으면 새로고침" : "당겨서 새로고침";
    place(pull, false);
  }, { passive: true });
  el.addEventListener("touchend", async () => {
    if (!armed) { reset(true); return; }
    startY = null;
    armed = false;
    busy = true;
    ind.textContent = "새로고침 중…";
    place(PTR_HOLD, true);
    const started = Date.now();
    const r = parseRoute();
    const [before, now] = await Promise.all([loadedVersion, siteVersion()]);
    if (before && now && before !== now) { location.reload(); return; }
    if (r.topic && syncConfig()) await Promise.race([runSync(r.topic, "당겨서"), new Promise((ok) => setTimeout(ok, 5000))]);
    await new Promise((ok) => setTimeout(ok, Math.max(0, PTR_MIN_MS - (Date.now() - started))));
    await route(true);
    reset(true);
    busy = false;
  });
  el.addEventListener("touchcancel", () => { if (!busy) reset(true); });
})();
window.addEventListener("hashchange", route);
route();
