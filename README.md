# learning-loops

학습 노트를 휴대폰 브라우저에서 읽고, 장마다 읽음 체크 → 그 장 문제로 테스트 → 날짜를 두고 재점검 → 숙달까지 관리하는 정적 사이트다. 서버·빌드 없이 GitHub Pages 에 그대로 올린다. 디자인 시스템은 [Framework7](https://github.com/framework7io/framework7) 9.3.0(MIT)의 CSS 만 쓴다.

## 화면

| 주소 | 화면 |
|---|---|
| `#/` | 주제 목록 — 주제마다 항목 읽음·장 테스트 통과·숙달 수 |
| `#/t/<주제>` | 목차 — 부별 장 목록과 장 단계(읽기 전 → 읽는 중 → 읽음 → 테스트 통과 → 숙달) |
| `#/t/<주제>/c/<장>` | 장 — 항목(`## ` 절) 읽음 체크, 항목을 모두 읽으면 그 장 테스트 |
| `#/t/<주제>/i/<항목>` | 항목 읽기 |
| `#/t/<주제>/review` | 복습·테스트 — 오늘 재점검·새 문제 |
| `#/t/<주제>/log` | 기록 — 결과 요약 복사(문항 ID 별 틀림), 백업 내보내기·가져오기 |

왼쪽 위 메뉴(서랍)는 주제가 최상위이고, 주제를 펼치면 장 목록이 단계 아이콘과 함께 나온다.

## 구조

| 경로 | 내용 |
|---|---|
| `index.html` · `assets/app.js` · `assets/style.css` | 화면 |
| `assets/engine.js` | 규칙 — 읽음·장 단계·재점검 일정(`SCHEDULE`)·채점·결과 요약 |
| `tools/build_topic_from_obsidian_notes.mjs` | 옵시디언 학습 노트 → 사이트 데이터 변환기 |
| `tools/markdown_to_html.mjs` | 변환기가 쓰는 Markdown → HTML |
| `topics/topics.json` | 주제 목록(변환기가 갱신) |
| `topics/<주제>/index.json` | 장·항목·문항 구조 |
| `topics/<주제>/<장>.json` | 장 본문(장을 열 때 불러옴) |
| `examples/learning-science/` | 변환기 입력 예시(입구 노트 + 장 노트) |
| `tests/` | `node tests/engine.test.js` · `node tests/schedule.test.js` · `node tests/build.test.mjs` |

## 주제 더하기

원본은 옵시디언 노트이고 `topics/` 는 변환 결과다. `topics/` 의 JSON 은 손으로 고치지 않는다.

```bash
node tools/build_topic_from_obsidian_notes.mjs "<입구 노트>.md" [--deny-file <금지어 파일>]
```

- 입구 노트 앞머리 `learning_key`(대문자 3글자)·`learning_slug`(영문 kebab, 주소), 선택 `learning_summary`·`pages_exclude`(빼고 올릴 절 이름)·`pages_rename`(`옛 절=보일 제목`, 화면 제목만 바뀌고 항목 ID 는 그대로). 앞머리가 없으면 같은 이름의 옵션(`--key`·`--slug`·`--exclude`·`--rename`)으로 준다.
- 본문의 볼트 세션·결정 번호(`S294`·`S1000043-D1` 꼴)는 걷어 내거나 "내부 결정"·"내부 기록" 으로 바꾼다. 해시 방식 이름 `S256`·`S384`·`S512` 는 그대로 둔다.
- 입구 `## 목차` 의 `[[<KEY>## …]]` 목록 줄 순서가 장 순서, 그 위 `### ` 머리가 부다.
- 장 노트 `## ` 절이 읽음 항목(ID `<장>#<절 제목>`)이다. `검수`·`출처`·`이해 확인 질문` 절은 항목이 아니다.
- 문항은 `## 이해 확인 질문` 안 `> [!question]- <장>-Q01 질문` callout 이고, 답은 정답 → `이유:` → `단서:` 순서다.
- 출력에 비밀값 꼴(개인 키·AWS access key·토큰·IP·AWS 계정 번호·내부 URL)이나 금지어 파일(줄마다 한 단어)의 말이 나오면 쓰지 않고 exit 1 로 끝난다. 명세 절 번호(`§3.1.1.2`)·문서용 예시 IP 대역·`localhost` 는 걸리지 않는다.

지금 올린 주제를 다시 만드는 명령(원본 노트가 있는 기기에서 — 노트는 비공개 저장소로 기기 사이에 옮겨진다):

| 주제 | 명령 |
|---|---|
| `learning-science` | `node tools/build_topic_from_obsidian_notes.mjs "examples/learning-science/학습 과학 기초.md"` |
| `account-auth` | `node tools/build_topic_from_obsidian_notes.mjs "<노트 폴더>/계정·인증 학습·구현/계정·인증 학습·구현.md" --key AUT --slug account-auth --rename "LP 포털·어드민 적용=적용 사례 — B2B 포털·어드민"` |

절 제목이나 문항 ID 를 바꾸면 그 항목·문항의 진행 상태가 처음으로 돌아간다(상태가 ID 로 저장됨).

## 공개 범위

저장소와 사이트는 공개다. 실제 적용 사례를 "이런 방식은 이런 경우에 맞다" 수준으로 담는 것은 괜찮지만, 비밀값·키·토큰·IP·AWS 계정 번호·내부 URL 은 올리지 않는다(변환기가 막음). 학습 진행 상태는 서버로 보내지 않고 각 기기 브라우저 `localStorage`(`ll2:<주제>`)에만 저장된다.

## 재점검 일정

새 문항은 회차 안에서 3번 맞혀야 상자 1로 가고, 그 뒤 1·3·7·21·60·180일 뒤 다시 점검한다(상자 4 = 숙달, 마지막 상자 뒤로는 180일마다). 틀리면 상자 1로 돌아간다. 바꿀 때는 `assets/engine.js` 의 `SCHEDULE` 과 `tests/schedule.test.js` 를 같이 고친다.
