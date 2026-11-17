// 학습 노트 본문용 작은 Markdown → HTML 변환기(외부 패키지 없음).
// 다루는 것: 문단·머리(###~)·목록(중첩은 들여쓰기 2칸 단위)·번호 목록·인용·콜아웃·코드 블록·표·굵게·기울임·코드·링크·위키 링크·이미지 링크 제거.
const esc = (s) => s.replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[c]));

let wikiResolver = () => null;
// 노트 이름 → 사이트 주소(없으면 null). 변환기가 주제마다 정한다
export function setWikiResolver(fn) {
  wikiResolver = fn || (() => null);
}

export function inline(text) {
  const codes = [];
  let s = text.replace(/`([^`]+)`/g, (_, c) => `\u0000${codes.push(c) - 1}\u0000`);
  s = esc(s);
  // 옵시디언 그림 첨부 ![[x.png]] 는 Pages 에 파일이 없으므로 이름만 남긴다
  s = s.replace(/!\[\[([^\]]+)\]\]/g, (_, n) => `<span class="ll-missing">[그림: ${n.split("|")[0]}]</span>`);
  // 위키 링크: 같은 주제의 장이면 사이트 주소로(setWikiResolver), 그 밖은 볼트 밖에서 열 수 없으니 글자만 — [[노트|별칭]] → 별칭
  s = s.replace(/\[\[([^\]|#]+)(?:#[^\]|]*)?(?:\|([^\]]+))?\]\]/g, (_, n, alias) => {
    const href = wikiResolver(n.trim());
    return href ? `<a class="ll-wikilink" href="${href}">${alias || n}</a>` : `<span class="ll-wikilink">${alias || n}</span>`;
  });
  s = s.replace(/!\[([^\]]*)\]\((https?:[^)\s]+)\)/g, '<img alt="$1" src="$2" loading="lazy">');
  s = s.replace(/\[([^\]]+)\]\((https?:[^)\s]+)\)/g, '<a href="$2" target="_blank" rel="noopener">$1</a>');
  s = s.replace(/\*\*([^*]+)\*\*/g, "<strong>$1</strong>");
  s = s.replace(/(^|[^*])\*([^*\s][^*]*)\*/g, "$1<em>$2</em>");
  s = s.replace(/==([^=]+)==/g, "<mark>$1</mark>");
  s = s.replace(/\u0000(\d+)\u0000/g, (_, i) => `<code>${esc(codes[Number(i)])}</code>`);
  return s;
}

const CALLOUT_LABEL = { note: "메모", tip: "팁", info: "정보", warning: "주의", summary: "요약", example: "예시", important: "중요", quote: "인용" };

export function markdownToHtml(md) {
  const lines = md.replace(/\r\n/g, "\n").split("\n");
  const out = [];
  let i = 0;
  while (i < lines.length) {
    const line = lines[i];
    if (!line.trim()) { i++; continue; }
    const fence = line.match(/^\s*(```|~~~)(\S*)/);
    if (fence) {
      const body = [];
      i++;
      while (i < lines.length && !lines[i].trim().startsWith(fence[1])) body.push(lines[i++]);
      i++;
      out.push(`<pre><code${fence[2] ? ` class="lang-${esc(fence[2])}"` : ""}>${esc(body.join("\n"))}</code></pre>`);
      continue;
    }
    const h = line.match(/^(#{3,6})\s+(.*)$/);
    if (h) { out.push(`<h${h[1].length}>${inline(h[2])}</h${h[1].length}>`); i++; continue; }
    if (/^\s*(---|\*\*\*)\s*$/.test(line)) { out.push("<hr>"); i++; continue; }
    if (line.startsWith(">")) {
      const block = [];
      while (i < lines.length && lines[i].startsWith(">")) block.push(lines[i++].replace(/^>\s?/, ""));
      const co = block[0].match(/^\[!(\w+)\][-+]?\s*(.*)$/);
      if (co) {
        const kind = co[1].toLowerCase();
        const title = co[2] || CALLOUT_LABEL[kind] || kind;
        out.push(`<aside class="ll-callout ll-callout-${esc(kind)}"><p class="ll-callout-title">${inline(title)}</p>${markdownToHtml(block.slice(1).join("\n"))}</aside>`);
      } else {
        out.push(`<blockquote>${markdownToHtml(block.join("\n"))}</blockquote>`);
      }
      continue;
    }
    if (/^\|.*\|\s*$/.test(line) && i + 1 < lines.length && /^\|[\s:|-]+\|\s*$/.test(lines[i + 1])) {
      const cells = (l) => l.trim().replace(/^\||\|$/g, "").split("|").map((c) => c.trim());
      const head = cells(line);
      i += 2;
      const rows = [];
      while (i < lines.length && /^\|.*\|\s*$/.test(lines[i])) rows.push(cells(lines[i++]));
      // 좁은 화면은 행마다 카드로 그린다 — 칸마다 머리 이름을 data-label 로 붙여 CSS 가 「머리: 값」 으로 보여 줌
      const labels = head.map((c) => inline(c).replace(/<[^>]+>/g, ""));
      out.push(`<div class="ll-table"><table><thead><tr>${head.map((c) => `<th>${inline(c)}</th>`).join("")}</tr></thead><tbody>${rows.map((r) => `<tr>${r.map((c, k) => `<td data-label="${labels[k] ?? ""}">${inline(c)}</td>`).join("")}</tr>`).join("")}</tbody></table></div>`);
      continue;
    }
    if (/^\s*([-*+]|\d+[.)])\s+/.test(line)) {
      const block = [];
      while (i < lines.length && (/^\s*([-*+]|\d+[.)])\s+/.test(lines[i]) || (/^\s{2,}\S/.test(lines[i]) && block.length))) block.push(lines[i++]);
      out.push(renderList(block));
      continue;
    }
    const para = [];
    while (i < lines.length && lines[i].trim() && !/^(#{3,6}\s|>|```|~~~|\s*([-*+]|\d+[.)])\s+|\|)/.test(lines[i])) para.push(lines[i++].trim());
    if (!para.length) { out.push(`<p>${inline(lines[i++].trim())}</p>`); continue; }
    out.push(`<p>${para.map(inline).join("<br>")}</p>`);
  }
  return out.join("\n");
}

function renderList(block) {
  const indent = (l) => l.match(/^\s*/)[0].length;
  const base = indent(block[0]);
  const ordered = /^\s*\d+[.)]/.test(block[0]);
  const items = [];
  for (const l of block) {
    if (indent(l) <= base && /^\s*([-*+]|\d+[.)])\s+/.test(l)) items.push({ text: l.replace(/^\s*([-*+]|\d+[.)])\s+/, ""), kids: [] });
    else if (items.length) items[items.length - 1].kids.push(l);
  }
  const li = items.map((it) => {
    const task = it.text.match(/^\[( |x)\]\s+(.*)$/i);
    const body = task ? `<span class="ll-task">${task[1].trim() ? "☑" : "☐"}</span> ${inline(task[2])}` : inline(it.text);
    // 목록 표시 없이 들여쓴 줄은 그 항목 글의 이어지는 줄, 그 뒤 목록 표시 줄부터 하위 목록
    const at = it.kids.findIndex((k) => /^\s*([-*+]|\d+[.)])\s+/.test(k));
    const cont = at < 0 ? it.kids : it.kids.slice(0, at);
    const sub = at < 0 ? [] : it.kids.slice(at);
    return `<li>${body}${cont.map((k) => `<br>${inline(k.trim())}`).join("")}${sub.length ? renderList(sub) : ""}</li>`;
  });
  return ordered ? `<ol>${li.join("")}</ol>` : `<ul>${li.join("")}</ul>`;
}
