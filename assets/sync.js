// GitHub 동기화 — 진행 상태와 결과 요약을 사용자의 비공개 저장소에 JSON·Markdown 파일로 쓴다.
// 서버 없이 GitHub REST API(Contents)를 브라우저에서 바로 부른다. 토큰은 사용자가 설정 화면에 넣은 fine-grained PAT 이고
// 이 브라우저 localStorage(SYNC_KEY)에만 둔다 — 공개 저장소의 코드·데이터에는 넣지 않는다.
//   progress/<주제>.json                 기기들이 합쳐 쓰는 진행 상태(mergeStates)
//   results/<주제>/<YYYY-MM-DD-HHMM>.md  「결과 보내기」 한 번 = 파일 하나(리뷰 세션이 gh api·git pull 로 읽음)
const SYNC_KEY = "ll2-sync";
const SYNC_DEFAULT_REPO = "stepby-unicorn/learning-loops-data";

function syncConfig() {
  try { return JSON.parse(localStorage.getItem(SYNC_KEY)) || null; } catch { return null; }
}
function saveSyncConfig(cfg) {
  if (cfg) localStorage.setItem(SYNC_KEY, JSON.stringify(cfg)); else localStorage.removeItem(SYNC_KEY);
}

const b64encode = (text) => { const bytes = new TextEncoder().encode(text); let bin = ""; bytes.forEach((b) => (bin += String.fromCharCode(b))); return btoa(bin); };
const b64decode = (b64) => new TextDecoder().decode(Uint8Array.from(atob(b64.replace(/\s/g, "")), (c) => c.charCodeAt(0)));

function ghHeaders(cfg) {
  return { Accept: "application/vnd.github+json", Authorization: `Bearer ${cfg.token}`, "X-GitHub-Api-Version": "2022-11-28" };
}
async function ghError(res) {
  const j = await res.json().catch(() => ({}));
  return new Error(`GitHub ${res.status} ${j.message || ""}`.trim());
}
const contentsUrl = (cfg, path) => `https://api.github.com/repos/${cfg.repo}/contents/${path.split("/").map(encodeURIComponent).join("/")}`;

async function ghGet(cfg, path) {
  const res = await fetch(contentsUrl(cfg, path), { cache: "no-store", headers: ghHeaders(cfg) });
  if (res.status === 404) return { sha: null, text: null };
  if (!res.ok) throw await ghError(res);
  const j = await res.json();
  return { sha: j.sha, text: b64decode(j.content) };
}
// sha 가 원격과 다르면(다른 기기가 먼저 올림) GitHub 이 409 를 준다 → conflict
async function ghPut(cfg, path, text, sha, message) {
  const res = await fetch(contentsUrl(cfg, path), { method: "PUT", headers: ghHeaders(cfg), body: JSON.stringify({ message, content: b64encode(text), ...(sha ? { sha } : {}) }) });
  if (res.status === 409 || res.status === 422) return { conflict: true };
  if (!res.ok) throw await ghError(res);
  return { conflict: false };
}

// 원격 사본을 받아 이 기기 상태와 합치고, 원격에 없던 게 있으면 다시 올린다. 그 사이 다른 기기가 올렸으면 한 번 더 받아 합친다.
async function syncTopic(topicId, local) {
  const cfg = syncConfig();
  if (!cfg) return null;
  const path = `progress/${topicId}.json`;
  for (let attempt = 0; attempt < 2; attempt++) {
    const remote = await ghGet(cfg, path);
    const remoteState = remote.text ? mergeStates(JSON.parse(remote.text).state, emptyState()) : null;
    const merged = mergeStates(local, remoteState);
    if (remoteState && JSON.stringify(remoteState) === JSON.stringify(merged)) return merged;
    const body = JSON.stringify({ topic: topicId, updatedAt: new Date().toISOString(), state: merged });
    const put = await ghPut(cfg, path, body, remote.sha, `progress: ${topicId}`);
    if (!put.conflict) return merged;
  }
  throw new Error("다른 기기와 동시에 저장해 충돌했습니다. 잠시 뒤 다시 동기화하세요.");
}

async function sendResult(topicId, text) {
  const cfg = syncConfig();
  if (!cfg) throw new Error("동기화 설정이 없습니다.");
  const d = new Date();
  const p2 = (n) => String(n).padStart(2, "0");
  const stamp = `${d.getFullYear()}-${p2(d.getMonth() + 1)}-${p2(d.getDate())}-${p2(d.getHours())}${p2(d.getMinutes())}${p2(d.getSeconds())}`;
  const path = `results/${topicId}/${stamp}.md`;
  // sha 없이 만든다 — 같은 이름이 있으면 덮지 않고 충돌로 끝난다
  const put = await ghPut(cfg, path, text + "\n", undefined, `result: ${topicId} ${stamp}`);
  if (put.conflict) throw new Error("같은 초에 보낸 결과가 이미 있습니다. 잠시 뒤 다시 보내세요.");
  return path;
}

// 설정 확인 — 비공개 저장소인지, 토큰에 쓰기 권한이 있는지
async function checkSyncConfig(cfg) {
  const res = await fetch(`https://api.github.com/repos/${cfg.repo}`, { cache: "no-store", headers: ghHeaders(cfg) });
  if (!res.ok) throw new Error(`저장소를 읽지 못했습니다 (GitHub ${res.status}). 저장소 이름과 토큰의 저장소 접근 범위를 확인하세요.`);
  const j = await res.json();
  if (!j.private) throw new Error("공개 저장소입니다. 학습 기록이 공개되지 않게 비공개 저장소를 쓰세요.");
  if (j.permissions && !j.permissions.push) throw new Error("토큰에 쓰기 권한이 없습니다. Contents: Read and write 를 주세요.");
  return true;
}
