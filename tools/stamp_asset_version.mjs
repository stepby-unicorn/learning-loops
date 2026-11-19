// 코드 파일 버전 찍기: node tools/stamp_asset_version.mjs [--check]
// index.html 이 version.json 의 v 를 assets 주소 뒤(?v=)에 붙여 불러온다. Pages 는 파일마다 10분 캐시를 허용해,
// 주소가 같으면 push 직후에도 휴대폰이 옛 app.js 를 쓴다. v = assets 안 .js·.css 내용 해시라 코드가 바뀔 때만 바뀐다.
// --check 는 쓰지 않고 version.json 이 지금 assets 와 맞는지만 본다(틀리면 exit 1).
import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const repo = path.dirname(path.dirname(fileURLToPath(import.meta.url)));

export function assetVersion(dir = path.join(repo, "assets")) {
  const h = crypto.createHash("sha256");
  for (const f of fs.readdirSync(dir).filter((f) => /\.(js|css)$/.test(f)).sort()) {
    h.update(f + "\0");
    h.update(fs.readFileSync(path.join(dir, f)));
  }
  return h.digest("hex").slice(0, 12);
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  const file = path.join(repo, "version.json");
  const v = assetVersion();
  let now = null;
  try { now = JSON.parse(fs.readFileSync(file, "utf8")).v; } catch {}
  if (process.argv.includes("--check")) {
    if (now !== v) { console.error(`version.json(${now}) 이 assets(${v}) 와 다릅니다 — node tools/stamp_asset_version.mjs`); process.exit(1); }
    console.log(`version ok ${v}`);
  } else {
    fs.writeFileSync(file, JSON.stringify({ v }) + "\n");
    console.log(now === v ? `그대로 ${v}` : `${now} → ${v}`);
  }
}
