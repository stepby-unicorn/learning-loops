# learning-loops

학습 피드백 루프(학습 → 테스트 → 피드백 → 복습 → 재테스트 → 날짜를 두고 재점검)를 휴대폰 브라우저에서 돌리는 정적 사이트다. 서버·빌드 없이 GitHub Pages 에 그대로 올린다.

## 구조

| 경로 | 내용 |
|---|---|
| `index.html` | 주제 목록 — 주제마다 오늘 점검·새 카드·통과 카드 수 |
| `process.html` | 학습 피드백 루프 프로세스 문서 |
| `topic.html?t=<주제 id>` | 주제 화면 — 회차 테스트, 재점검, 결과 요약·백업 |
| `topics/topics.json` | 주제 목록 |
| `topics/<주제 id>/cards.json` | 주제의 회차(units)·카드(cards) |
| `topics/_template/cards.json` | 새 주제를 만들 때 복사할 틀 |
| `assets/app.js` | 카드 점검 엔진 — 재점검 일정(`SCHEDULE`)·채점 규칙 |
| `tests/schedule.test.js` | 재점검 일정 규칙 시험(`node tests/schedule.test.js`) |

## 주제 더하기

1. `topics/_template` 를 `topics/<주제 id>` 로 복사하고 `cards.json` 의 `id`·`title`·`units`·`cards` 를 채운다. 카드 `id` 는 주제 안에서 바꾸지 않는다(진행 상태가 카드 id 로 저장됨).
2. `topics/topics.json` 의 `topics` 에 `{ "id", "title", "summary" }` 를 더한다.
3. `python3 -m http.server` 로 띄워 확인한 뒤 push 한다.

## 공개 범위

저장소와 사이트는 공개다. 카드에는 공개 자료로 확인할 수 있는 내용만 넣고, 회사·개인 정보는 넣지 않는다. 학습 진행 상태는 서버로 보내지 않고 각 기기 브라우저 `localStorage` 에만 저장된다.

## 재점검 일정을 바꿀 때

`assets/app.js` 의 `SCHEDULE` 과 `process.html` 「재점검 일정」 표를 같이 고치고 시험을 다시 돌린다.
