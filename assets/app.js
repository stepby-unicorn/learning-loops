// 학습 온보딩 화면 — 주소(#/…)마다 화면을 그린다. 규칙은 assets/engine.js
//   #/                          주제 목록
//   #/t/<주제>                  목차(부별 장·진행)
//   #/t/<주제>/c/<장>           장 — 항목 읽음 체크 + 그 장 테스트
//   #/t/<주제>/i/<항목 id>      항목 읽기(항목 id = <장>#<절 이름>)
//   #/t/<주제>/done/<장>        장 완료 — 장 테스트 · 다음 장 읽기
//   #/t/<주제>/review           복습·테스트(항목을 모두 읽은 장의 문항)
//   #/t/<주제>/log              기록 — 결과 보내기(GitHub 동기화)·요약 복사·백업
// 데이터: topics/topics.json(주제 목록) · topics/<주제>/index.json(구조·문항) · topics/<주제>/<장>.json(장 본문, 열 때 불러옴)
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
let pushTimer = null;
let pushTopic = null;
let inSession = false;
let syncStatus = "";
function schedulePush(id) {
  if (!syncConfig()) return;
  clearTimeout(pushTimer);
  pushTopic = id;
  pushTimer = setTimeout(() => runSync(id), 2000);
}
async function runSync(id) {
  clearTimeout(pushTimer);
  pushTimer = null;
  const before = localStorage.getItem(STORE_PREFIX + id);
  try {
    const merged = await syncTopic(id, loadState(id));
    if (!merged) return false;
    // 받는 사이 이 기기에서 또 저장했으면 덮지 않고 다음 동기화에 맡긴다
    if (localStorage.getItem(STORE_PREFIX + id) !== before) { schedulePush(id); return false; }
    const text = JSON.stringify(merged);
    localStorage.setItem(STORE_PREFIX + id, text);
    syncStatus = `동기화 ${new Date().toTimeString().slice(0, 5)}`;
    return text !== before;
  } catch (e) {
    syncStatus = `동기화 실패: ${e.message}`;
    return false;
  }
}
document.addEventListener("visibilitychange", () => {
  if (document.visibilityState === "hidden" && pushTimer && pushTopic) runSync(pushTopic);
});
function toggleRead(id, itemId, on) {
  const s = loadState(id);
  if (on) s.read[itemId] = Date.now(); else delete s.read[itemId];
  saveState(id, s);
}
const findChapter = (topic, chapterId) => topic.chapters.find((c) => c.id === chapterId);
const chapterOfItem = (topic, itemId) => topic.chapters.find((c) => c.items.some((it) => it.id === itemId));
const readCount = (state, ch) => ch.items.filter((it) => state.read[it.id]).length;

// ---------- 서랍 메뉴: 최상위 = 주제, 펼치면 장 목록 ----------
function openMenu(open) {
  $("#menu").classList.toggle("panel-in", open);
  $("#backdrop").classList.toggle("panel-backdrop-in", open);
  document.documentElement.classList.toggle("with-panel-left-cover", open);
}
$("#btn-menu").onclick = (e) => { e.preventDefault(); openMenu(!$("#menu").classList.contains("panel-in")); };
$("#backdrop").onclick = () => openMenu(false);

async function renderMenu(route) {
  const topics = await getTopics();
  const parts = await Promise.all(topics.map(async (t) => {
    const opened = route.topic === t.id;
    let inner = "";
    if (opened) {
      const topic = await getTopic(t.id);
      const state = loadState(t.id);
      const current = route.chapter || (route.item && chapterOfItem(topic, route.item)?.id);
      let lastPart = null;
      const rows = topic.chapters.map((ch) => {
        const head = ch.part && ch.part !== lastPart ? `<li class="ll-menu-section">${esc(ch.part)}</li>` : "";
        lastPart = ch.part;
        const st = chapterStage(state, ch);
        return `${head}<li><a class="item-link item-content ${current === ch.id ? "ll-current" : ""}" href="#/t/${enc(t.id)}/c/${enc(ch.id)}">
          <div class="item-media ll-stage ll-stage-${st}" title="${STAGE_LABEL[st]}">${STAGE_ICON[st]}</div>
          <div class="item-inner"><div class="item-title">${esc(ch.title)}</div></div></a></li>`;
      }).join("");
      inner = `<div class="accordion-item-content"><div class="list list-dividers ll-menu-items"><ul>
        <li><a class="item-link item-content" href="#/t/${enc(t.id)}"><div class="item-inner"><div class="item-title">목차·진행</div></div></a></li>
        <li><a class="item-link item-content" href="#/t/${enc(t.id)}/review"><div class="item-inner"><div class="item-title">복습·테스트</div></div></a></li>
        ${rows}</ul></div></div>`;
    }
    return `<li class="accordion-item ${opened ? "accordion-item-opened" : ""}">
      <a class="item-link item-content" href="#/t/${enc(t.id)}"><div class="item-inner"><div class="item-title">${esc(t.title)}</div></div></a>${inner}</li>`;
  }));
  $("#menu-content").innerHTML = `<div class="list accordion-list list-strong ll-menu"><ul>
    <li><a class="item-link item-content" href="#/"><div class="item-inner"><div class="item-title">전체 주제</div></div></a></li>${parts.join("")}</ul></div>`;
  $("#menu-content .ll-current")?.scrollIntoView({ block: "center" });
}

// ---------- 공통 틀 ----------
function setFrame(title, tabs) {
  $("#page-title").textContent = title;
  document.title = `${title} · 학습 온보딩`;
  $("#tabbar").classList.toggle("hidden", !tabs);
  $("#page").classList.toggle("ll-has-tabbar", !!tabs);
  if (tabs) {
    $("#tabbar-inner").innerHTML = tabs.map((t) => `<a class="tab-link ${t.active ? "tab-link-active" : ""}" href="${t.href}"><span class="tabbar-label">${esc(t.label)}${t.badge ? ` <span class="badge color-red">${t.badge}</span>` : ""}</span></a>`).join("");
  }
}
function topicTabs(id, active, p) {
  return [
    { label: "목차", href: `#/t/${enc(id)}`, active: active === "toc" },
    { label: "복습·테스트", href: `#/t/${enc(id)}/review`, active: active === "review", badge: p ? p.due + p.fresh : 0 },
    { label: "기록", href: `#/t/${enc(id)}/log`, active: active === "log" },
  ];
}
function progressBar(ratio) {
  return `<span class="progressbar" aria-valuenow="${Math.round(ratio * 100)}"><span style="transform:translate3d(${-100 + ratio * 100}%,0,0)"></span></span>`;
}
function stageChips(p) {
  return `<div class="ll-chips">
    <span class="chip"><span class="chip-label">항목 읽음 ${p.readTotal}/${p.items}</span></span>
    <span class="chip"><span class="chip-label">${STAGE_ICON.tested} 장 테스트 통과 ${p.tested + p.mastered}/${p.chapters}</span></span>
    <span class="chip"><span class="chip-label">${STAGE_ICON.mastered} 숙달 ${p.mastered}</span></span>
    ${p.due ? `<span class="chip color-red"><span class="chip-label">오늘 재점검 ${p.due}</span></span>` : ""}</div>`;
}

// ---------- 주제 목록 ----------
async function viewHome(root) {
  setFrame("학습 온보딩", null);
  const topics = await getTopics();
  const cards = await Promise.all(topics.map(async (t) => {
    try {
      const topic = await getTopic(t.id);
      const p = topicProgress(topic, loadState(t.id));
      return `<a class="card card-outline ll-topic-card" href="#/t/${enc(t.id)}">
        <div class="card-header">${esc(t.title)}</div>
        <div class="card-content card-content-padding"><p class="ll-muted">${esc(t.summary || topic.summary || "")}</p>
        ${progressBar(p.items ? p.readTotal / p.items : 0)}${stageChips(p)}</div></a>`;
    } catch (e) {
      return `<div class="card"><div class="card-content card-content-padding">${esc(t.title)} — 읽지 못함: ${esc(e.message)}</div></div>`;
    }
  }));
  root.innerHTML = `<div class="block-title block-title-large">학습 주제</div>
    <div class="block"><p class="ll-muted">장의 항목을 읽고 체크하면 그 장 문제로 테스트하고, 정해진 날짜(1·3·7·21·60·180일 뒤)에 다시 점검합니다. 진행 상태는 이 기기 브라우저에만 저장됩니다.</p></div>
    ${cards.join("") || `<div class="block">주제가 없습니다.</div>`}`;
}

// ---------- 목차: 부별 장 목록 ----------
async function viewToc(root, id) {
  const topic = await getTopic(id);
  const state = loadState(id);
  const p = topicProgress(topic, state);
  setFrame(topic.title, topicTabs(id, "toc", p));
  const next = allItems(topic).find((it) => !state.read[it.id]);
  const groups = [];
  for (const ch of topic.chapters) {
    const last = groups[groups.length - 1];
    if (last && last.part === (ch.part || "")) last.chapters.push(ch);
    else groups.push({ part: ch.part || "", chapters: [ch] });
  }
  const html = groups.map((g) => `${g.part ? `<div class="block-title">${esc(g.part)}</div>` : ""}
    <div class="list list-strong list-dividers inset ll-toc"><ul>${g.chapters.map((ch) => {
      const st = chapterStage(state, ch);
      return `<li><a class="item-link item-content" href="#/t/${enc(id)}/c/${enc(ch.id)}">
        <div class="item-media ll-stage ll-stage-${st}" title="${STAGE_LABEL[st]}">${STAGE_ICON[st]}</div>
        <div class="item-inner"><div class="item-title">${esc(ch.title)}</div>
        <div class="item-after">${readCount(state, ch)}/${ch.items.length} · ${STAGE_LABEL[st]}</div></div></a></li>`;
    }).join("")}</ul></div>`).join("");
  root.innerHTML = `<div class="block">
      <p class="ll-muted">${esc(topic.summary || "")}</p>
      ${progressBar(p.items ? p.readTotal / p.items : 0)}${stageChips(p)}
      <div class="grid grid-cols-2 grid-gap ll-actions">
        ${next ? `<a class="button button-fill button-large" href="#/t/${enc(id)}/i/${enc(next.id)}">이어 읽기</a>` : `<span class="button button-large disabled">모두 읽음</span>`}
        <a class="button button-tonal button-large ${p.due + p.fresh ? "" : "disabled"}" href="#/t/${enc(id)}/review">복습·테스트 ${p.due + p.fresh}</a>
      </div>
      ${p.nextDue ? `<p class="ll-muted">다음 재점검 ${fmtDate(p.nextDue)}</p>` : ""}
    </div>${html}
    <div class="block"><p class="ll-muted">${Object.entries(STAGE_ICON).map(([k, v]) => `${v} ${STAGE_LABEL[k]}`).join(" · ")}</p></div>`;
}

// ---------- 장: 항목 체크 + 장 테스트 ----------
async function viewChapter(root, id, chapterId) {
  const topic = await getTopic(id);
  const ch = findChapter(topic, chapterId);
  if (!ch) { root.innerHTML = `<div class="block">장이 없습니다.</div>`; return; }
  const state = loadState(id);
  setFrame(topic.title, topicTabs(id, "toc", topicProgress(topic, state)));
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
  const testLabel = !cardCount ? "이 장은 문제가 없습니다"
    : !allRead ? `항목을 모두 읽으면 테스트 (${cardCount}문제)`
    : fresh.length + due.length ? `이 장 테스트 ${fresh.length + due.length}` : "오늘 볼 문제 없음";
  root.innerHTML = `<div class="block">
      <p class="ll-muted">${esc(ch.part || "")}${ch.part ? " · " : ""}${idx + 1}/${topic.chapters.length}장</p>
      <div class="block-title-medium ll-chapter-title">${esc(ch.title)}</div>
      ${progressBar(ch.items.length ? done / ch.items.length : 0)}
      <div class="ll-chips"><span class="chip"><span class="chip-label">${STAGE_ICON[st]} ${STAGE_LABEL[st]}</span></span>
        <span class="chip"><span class="chip-label">읽음 ${done}/${ch.items.length}</span></span>
        ${cardCount ? `<span class="chip"><span class="chip-label">문제 ${cardCount}</span></span>` : ""}</div>
    </div>
    <div class="block-title">항목</div>
    <div class="list list-strong list-dividers inset ll-toc"><ul>${items}</ul></div>
    <div class="block grid grid-gap">
      <button class="button button-fill button-large" id="btn-test" ${allRead && fresh.length + due.length ? "" : "disabled"}>${esc(testLabel)}</button>
      <div class="grid grid-cols-2 grid-gap">
        ${prev ? `<a class="button button-outline" href="#/t/${enc(id)}/c/${enc(prev.id)}">‹ 이전 장</a>` : "<span></span>"}
        ${next ? `<a class="button button-outline" href="#/t/${enc(id)}/c/${enc(next.id)}">다음 장 ›</a>` : "<span></span>"}
      </div>
    </div>`;
  root.querySelectorAll("[data-read]").forEach((cb) => {
    cb.onchange = () => { toggleRead(id, cb.dataset.read, cb.checked); route(); };
  });
  $("#btn-test").onclick = () => runSession(root, id, [...due, ...fresh], `${ch.title} 테스트`, `#/t/${enc(id)}/c/${enc(ch.id)}`);
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
  setFrame(topic.title, topicTabs(id, "toc", topicProgress(topic, state)));
  const next = items[idx + 1];
  const prev = items[idx - 1];
  const read = !!state.read[it.id];
  const pos = ch.items.findIndex((x) => x.id === it.id) + 1;
  // 읽음 체크 → 같은 장 다음 항목, 장 마지막 항목이면 장 완료 화면(장 테스트 · 다음 장)
  const lastInChapter = !next || next.chapterId !== ch.id;
  const after = lastInChapter ? `#/t/${enc(id)}/done/${enc(ch.id)}` : `#/t/${enc(id)}/i/${enc(next.id)}`;
  root.innerHTML = `<div class="block ll-article">
      <p class="ll-muted"><a href="#/t/${enc(id)}/c/${enc(ch.id)}">${esc(ch.title)}</a> · ${pos}/${ch.items.length}</p>
      <h1>${esc(it.title)}</h1>
      ${html}
    </div>
    <div class="block">
      <button class="button button-large ${read ? "button-tonal" : "button-fill"}" id="btn-read">${read ? "✓ 읽음 (누르면 취소)" : "읽음 체크"}</button>
      <div class="grid grid-cols-2 grid-gap ll-actions">
        ${prev ? `<a class="button button-outline" href="#/t/${enc(id)}/i/${enc(prev.id)}">‹ 이전</a>` : "<span></span>"}
        ${lastInChapter ? `<a class="button button-outline" href="${after}">장 마치기 ›</a>` : `<a class="button button-outline" href="${after}">다음 ›</a>`}
      </div>
    </div>`;
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
  setFrame(topic.title, topicTabs(id, "toc", topicProgress(topic, state)));
  const done = readCount(state, ch);
  const unread = ch.items.filter((it) => !state.read[it.id]);
  const { fresh, due } = reviewQueue(topic, state, Date.now(), ch.id);
  const cards = [...due, ...fresh];
  const next = topic.chapters[topic.chapters.indexOf(ch) + 1];
  const nextItem = next && (next.items.find((it) => !state.read[it.id]) || next.items[0]);
  root.innerHTML = `<div class="block ll-done">
      <div class="ll-done-mark">${unread.length ? STAGE_ICON.reading : "✓"}</div>
      <div class="block-title-medium ll-chapter-title">${esc(ch.id)} ${unread.length ? "읽는 중" : "장 완료"}</div>
      <p>${esc(ch.title)}</p>
      ${progressBar(ch.items.length ? done / ch.items.length : 0)}
      <p class="ll-muted">읽음 ${done}/${ch.items.length}${(ch.cards || []).length ? ` · 문제 ${(ch.cards || []).length}` : ""}</p>
    </div>
    ${unread.length ? `<div class="block-title">아직 안 읽은 항목</div><div class="list list-strong list-dividers inset"><ul>${unread.map((it) => `<li><a class="item-link item-content" href="#/t/${enc(id)}/i/${enc(it.id)}"><div class="item-inner"><div class="item-title">${esc(it.title)}</div></div></a></li>`).join("")}</ul></div>` : ""}
    <div class="block grid grid-gap">
      ${cards.length ? `<button class="button button-fill button-large" id="btn-test">장 테스트 (${cards.length}문제)</button>` : `<span class="button button-large disabled">${(ch.cards || []).length ? (unread.length ? "항목을 모두 읽으면 테스트" : "오늘 볼 문제 없음") : "이 장은 문제가 없습니다"}</span>`}
      ${nextItem ? `<a class="button ${cards.length ? "button-tonal" : "button-fill"} button-large" href="#/t/${enc(id)}/i/${enc(nextItem.id)}">다음 장 읽기 › ${esc(next.title)}</a>` : `<a class="button button-tonal button-large" href="#/t/${enc(id)}">목차로</a>`}
    </div>`;
  if (cards.length) $("#btn-test").onclick = () => runSession(root, id, cards, `${ch.id} 테스트`, `#/t/${enc(id)}/done/${enc(ch.id)}`);
  $("#content").scrollTop = 0;
}

// ---------- 복습·테스트 ----------
async function viewReview(root, id) {
  const topic = await getTopic(id);
  const state = loadState(id);
  const p = topicProgress(topic, state);
  setFrame(topic.title, topicTabs(id, "review", p));
  const { fresh, due } = reviewQueue(topic, state);
  const notReady = topic.chapters.filter((ch) => (ch.cards || []).length && readCount(state, ch) < ch.items.length).length;
  root.innerHTML = `<div class="block-title block-title-medium">복습·테스트</div>
    <div class="block"><p class="ll-muted">항목을 모두 읽은 장의 문제만 나옵니다. 답을 먼저 떠올리고(고르거나 적고) 확신을 고른 뒤 정답을 봅니다. 틀린 문제는 회차 끝에 한 번 더 나오고, 여러 날에 걸친 반복은 재점검 날짜가 맡습니다.</p></div>
    <div class="list list-strong inset list-dividers"><ul>
      <li class="item-content"><div class="item-inner"><div class="item-title">오늘 재점검</div><div class="item-after">${due.length}</div></div></li>
      <li class="item-content"><div class="item-inner"><div class="item-title">새 문제 (1번 맞히면 통과)</div><div class="item-after">${fresh.length}</div></div></li>
      <li class="item-content"><div class="item-inner"><div class="item-title">아직 다 읽지 않은 장</div><div class="item-after">${notReady}</div></div></li>
    </ul></div>
    <div class="block grid grid-gap">
      <button class="button button-fill button-large" id="btn-due" ${due.length ? "" : "disabled"}>재점검 시작 (${due.length})</button>
      <button class="button button-tonal button-large" id="btn-fresh" ${fresh.length ? "" : "disabled"}>새 문제 테스트 (${fresh.length})</button>
      ${p.nextDue ? `<p class="ll-muted">다음 재점검 ${fmtDate(p.nextDue)}</p>` : ""}
      ${!due.length && !fresh.length && notReady ? `<a class="button button-outline" href="#/t/${enc(id)}">읽을 장 보기</a>` : ""}
    </div>`;
  const back = `#/t/${enc(id)}/review`;
  $("#btn-due").onclick = () => runSession(root, id, due, "재점검", back);
  $("#btn-fresh").onclick = () => runSession(root, id, fresh, "새 문제 테스트", back);
}

function runSession(root, id, cards, label, backHref) {
  const state = loadState(id);
  const sess = createSession(state, cards);
  inSession = true;
  const step = () => {
    const card = sess.next();
    if (!card) {
      inSession = false;
      const failed = sess.failed;
      const cardById = Object.fromEntries(cards.map((c) => [c.id, c]));
      root.innerHTML = `<div class="block-title block-title-medium">${esc(label)} 끝</div>
        <div class="card"><div class="card-content card-content-padding">
          <p>${sess.total}문제 중 <b>${sess.passed}</b>문제 통과 · 답 ${sess.answered}번</p>
          ${failed.length ? `<p>두 번 틀린 문제 ${failed.length}개는 다음 회차에 다시 나옵니다.</p><ul>${failed.map((f) => `<li>${esc(f)} ${esc(cardById[f]?.q || "")}</li>`).join("")}</ul>` : "<p>모두 통과했습니다. 다음 재점검 날짜는 목차·복습 화면에 나옵니다.</p>"}
          <p class="ll-muted">결과는 <a href="#/t/${enc(id)}/log">기록</a>에서 「결과 보내기」로 리뷰 세션에 넘깁니다.</p>
        </div></div>
        <div class="block"><a class="button button-fill button-large" href="${backHref}">돌아가기</a></div>`;
      return;
    }
    showCard(root, card, `${label} · ${sess.answered + 1}/${sess.steps} · 통과 ${sess.passed}`, sess.answered / sess.steps, (grade, conf, answer) => {
      sess.grade(adjustGrade(grade, conf), conf, answer);
      saveState(id, state);
      step();
    });
  };
  step();
}

function showCard(root, card, label, ratio, onGrade) {
  let conf = null;
  let picked = null;
  // 선택지는 매번 순서를 섞는다(자리로 외우지 않게). value 는 원래 번호
  const order = card.choices ? card.choices.map((_, i) => i).sort(() => Math.random() - 0.5) : [];
  const choices = card.choices
    ? `<div class="list list-strong inset ll-choices"><ul>${order.map((i) => `<li><label class="item-radio item-content"><input type="radio" name="ll-choice" value="${i}"><i class="icon icon-radio"></i><div class="item-inner"><div class="item-title">${esc(card.choices[i])}</div></div></label></li>`).join("")}</ul></div>`
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
  root.querySelectorAll('input[name="ll-choice"]').forEach((r) => (r.onchange = () => (picked = Number(r.value))));
  root.querySelectorAll("[data-conf]").forEach((b) => {
    b.onclick = () => {
      if (conf !== null) return;
      if (card.choices && picked === null) { $("#pick-first").classList.remove("hidden"); return; }
      conf = Number(b.dataset.conf);
      root.querySelectorAll("[data-conf]").forEach((x) => { x.disabled = x !== b; x.classList.toggle("button-active", x === b); });
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
  });
  root.querySelectorAll("[data-grade]").forEach((b) => {
    b.onclick = () => {
      const answer = $("#my-answer")?.value?.trim() || (picked !== null ? card.choices[picked] : "");
      onGrade(Number(b.dataset.grade), conf, answer);
      $("#content").scrollTop = 0;
    };
  });
}

// ---------- 기록: 결과 보내기(GitHub 동기화) · 요약 복사 · 백업 ----------
async function viewLog(root, id) {
  const topic = await getTopic(id);
  const state = loadState(id);
  setFrame(topic.title, topicTabs(id, "log", topicProgress(topic, state)));
  const cfg = syncConfig();
  const syncBlock = cfg
    ? `<div class="block-title">GitHub 동기화</div>
      <div class="list list-strong inset list-dividers"><ul>
        <li class="item-content"><div class="item-inner"><div class="item-title">저장소</div><div class="item-after">${esc(cfg.repo)}</div></div></li>
        <li class="item-content"><div class="item-inner"><div class="item-title">상태</div><div class="item-after" id="sync-status">${esc(syncStatus || "아직 안 함")}</div></div></li>
      </ul></div>
      <div class="block grid grid-gap">
        <button class="button button-fill button-large" id="btn-send">결과 보내기</button>
        <p id="send-out" class="ll-muted hidden"></p>
        <div class="grid grid-cols-2 grid-gap">
          <button class="button button-tonal" id="btn-sync">지금 동기화</button>
          <button class="button button-outline color-red" id="btn-sync-off">이 기기 연결 끊기</button>
        </div>
      </div>`
    : `<div class="block-title">GitHub 동기화 설정</div>
      <div class="block"><p class="ll-muted">비공개 저장소와 fine-grained 토큰(그 저장소 하나, Contents: Read and write)을 넣으면 진행 상태가 기기 사이에 이어지고 「결과 보내기」로 리뷰 세션에 결과를 넘깁니다. 토큰은 이 기기 브라우저에만 저장됩니다.</p></div>
      <div class="list list-strong inset"><ul>
        <li class="item-content item-input"><div class="item-inner"><div class="item-title item-label">저장소 (owner/이름)</div><div class="item-input-wrap"><input type="text" id="sync-repo" value="${esc(SYNC_DEFAULT_REPO)}" autocapitalize="off" autocorrect="off" spellcheck="false"></div></div></li>
        <li class="item-content item-input"><div class="item-inner"><div class="item-title item-label">토큰</div><div class="item-input-wrap"><input type="password" id="sync-token" placeholder="github_pat_…" autocomplete="off"></div></div></li>
      </ul></div>
      <div class="block grid grid-gap">
        <button class="button button-fill button-large" id="btn-sync-save">확인하고 저장</button>
        <p id="sync-err" class="ll-muted hidden"></p>
      </div>`;
  root.innerHTML = `<div class="block-title block-title-medium">기록</div>
    ${syncBlock}
    <div class="block-title">직접 옮기기</div>
    <div class="block grid grid-gap">
      <button class="button button-tonal" id="btn-summary">결과 요약 보기·복사</button>
      <pre id="summary-out" class="ll-summary hidden"></pre>
      <button class="button button-outline" id="btn-export">백업 내보내기</button>
      <label class="button button-outline">백업 가져오기<input type="file" id="file-import" accept="application/json" class="hidden"></label>
    </div>`;
  if (cfg) {
    $("#btn-send").onclick = async () => {
      const out = $("#send-out");
      out.classList.remove("hidden");
      out.textContent = "보내는 중…";
      try {
        await runSync(id);
        const path = await sendResult(id, feedbackSummary(topic, loadState(id)));
        out.textContent = `보냄: ${path} — 리뷰 세션에 「결과 보냈음」 이라고 말하면 읽습니다.`;
      } catch (e) { out.textContent = `보내지 못함: ${e.message}`; }
      $("#sync-status").textContent = syncStatus;
    };
    $("#btn-sync").onclick = async () => { $("#sync-status").textContent = "동기화 중…"; await runSync(id); $("#sync-status").textContent = syncStatus; };
    $("#btn-sync-off").onclick = () => { if (confirm("이 기기에서 토큰을 지웁니다. 저장소의 기록은 그대로 남습니다.")) { saveSyncConfig(null); syncStatus = ""; route(); } };
  } else {
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
        await runSync(id);
        route();
      } catch (e) { err.classList.remove("hidden"); err.textContent = e.message; }
    };
  }
  $("#btn-summary").onclick = async () => {
    const text = feedbackSummary(topic, loadState(id));
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

// ---------- 주소 해석 ----------
function parseRoute() {
  const parts = location.hash.replace(/^#\/?/, "").split("/").map(decodeURIComponent);
  if (parts[0] !== "t" || !parts[1]) return { view: "home" };
  const topic = parts[1];
  if (parts[2] === "c" && parts[3]) return { view: "chapter", topic, chapter: parts[3] };
  if (parts[2] === "i" && parts[3]) return { view: "item", topic, item: parts.slice(3).join("/") };
  if (parts[2] === "done" && parts[3]) return { view: "done", topic, chapter: parts[3] };
  if (parts[2] === "review") return { view: "review", topic };
  if (parts[2] === "log") return { view: "log", topic };
  return { view: "toc", topic };
}
async function route() {
  const r = parseRoute();
  const root = $("#content");
  openMenu(false);
  inSession = false;
  // 주제를 이 페이지에서 처음 열면 저장소 사본을 받아 합치고, 바뀌었으면 화면을 다시 그린다(회차 중이면 그리지 않음)
  if (r.topic && syncConfig() && !pulled.has(r.topic)) {
    pulled.add(r.topic);
    const hash = location.hash;
    runSync(r.topic).then((changed) => { if (changed && !inSession && location.hash === hash) route(); });
  }
  try {
    if (r.view === "home") await viewHome(root);
    else if (r.view === "toc") await viewToc(root, r.topic);
    else if (r.view === "chapter") await viewChapter(root, r.topic, r.chapter);
    else if (r.view === "item") await viewItem(root, r.topic, r.item);
    else if (r.view === "done") await viewDone(root, r.topic, r.chapter);
    else if (r.view === "review") await viewReview(root, r.topic);
    else if (r.view === "log") await viewLog(root, r.topic);
    await renderMenu(r);
  } catch (e) {
    root.innerHTML = `<div class="block">불러오지 못했습니다: ${esc(e.message)}</div>`;
  }
}
window.addEventListener("hashchange", route);
route();
