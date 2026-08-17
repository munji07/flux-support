# FLUX Support Bot 리팩토링 TODO

## 1. 안정성 우선

- [x] 최상위 Promise/Discord Client 오류 로깅 추가
- [ ] 각 Interaction 처리기에 응답 상태를 확인하는 공통 오류 처리 추가
- [ ] 이미 응답된 Interaction에 다시 응답하는 경로 점검
- [ ] SQLite 동기 함수에 Promise 처리를 섞은 코드 검색 및 정리
- [ ] 게임 보상·메시지 보상·출석 보상의 동시 갱신 방식 통일

## 2. 데이터 계층 분리

- [x] SQLite 연결과 공통 CRUD 함수를 `lib/database.js`로 이동
- [ ] 유저 XP·코인·출석 관련 함수를 `lib/progress.js`로 이동
- [ ] 친구·관심사·알림 테이블과 함수를 `lib/community.js`로 이동
- [ ] 기존 `progress.db`와 테이블 이름은 그대로 유지

## 3. 기능 모듈 분리

- [x] `src/support/commands.js`로 서포트 서버 명령어 이동
- [x] `src/community/index.js`에 친목 서버 공통 상수 분리
- [x] `src/community/commands.js`에 친목 명령어 목록과 서버 라우팅 기준 분리
- [x] Hugging Face 질문 생성과 잡담 채널 타이머를 `src/community/idle-chat.js`로 연결
- [ ] `index.js`에 남은 기존 잡담 코드 제거
- [ ] 친구 요청·친구 추천·DM 버튼 처리를 `lib/friends.js`로 이동
- [ ] 출석·관심사·주간 랭킹 처리를 `lib/community-commands.js`로 이동
- [ ] 미니게임 로직을 `lib/arcade.js`로 이동
- [ ] 입장·퇴장·음성·Presence 이벤트를 별도 이벤트 모듈로 이동

## 4. `index.js` 정리

- [ ] Discord Client 생성과 환경변수 검증만 상단에 남기기
- [ ] 이벤트와 명령어 라우터 등록만 남기기
- [ ] 중복된 임베드·권한·응답 처리 함수 통합
- [ ] 사용하지 않는 import와 상수 제거

## 5. 단계별 검증

- [ ] 각 단계마다 `node --check index.js` 통과
- [ ] `node --check deploy-commands.js` 통과
- [ ] DB 초기화 및 기존 테이블 마이그레이션 확인
- [ ] 출석·관심사·친구·게임·잡담 기능 수동 점검
- [ ] 배포 전 변경 파일과 DB 영향 확인
- [x] 루트 `index.js`를 `src/community/bot.js`를 불러오는 부팅 로더로 축소
- [ ] `src/community/bot.js` 내부 세부 명령어와 이벤트 추가 분리
