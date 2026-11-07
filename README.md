# SoraBot Manager

카카오톡 봇 방 관리자를 위한 정적 기능 설정 화면입니다. 저장소는 `notificationbot/sorabot-manager`이며 비공개입니다. 정적 화면은 Cloudflare Pages의 `https://sorabot-manager.pages.dev/`에 직접 업로드하여 배포합니다. 기존 도움말과 회사 도메인은 사용하거나 수정하지 않습니다.

## 사용

관리자가 카카오톡 방에서 `/기능`을 입력하고 발급된 링크를 엽니다. 서명 확인 후 비밀번호를 입력하고, 같은 관리자 계정으로 같은 방에서 화면의 `/기능 인증 CODE` 명령어를 입력하면 접속됩니다. 기능 스위치는 서버의 저장 성공 응답을 받은 후 갱신됩니다. 그룹 카드와 게임별 최대 배팅 한도를 제공하며, 한도는 별도 저장합니다.

기능 검색, 분류, 켜짐/꺼짐 필터를 제공합니다. 충돌이 발생하면 최신 설정을 불러오고 다시 변경하도록 안내합니다. 연결이 끊어져 저장 결과를 확인하지 못하면 새로고침으로 확인할 때까지 변경을 잠급니다. 만료되거나 권한을 확인하지 못하면 `/기능`을 통한 재접속을 안내합니다.

## 정적 배포

빌드 과정이나 Node.js 실행 환경이 필요하지 않습니다. Cloudflare Pages에 index.html과 assets/를 루트 구조 그대로 직접 업로드합니다. GitHub 자동 배포는 연결하지 않습니다. 웹 파일은 다음과 같습니다.

- `index.html`, `.nojekyll`, `.gitignore`
- `assets/app.js`, `assets/connection.js`, `assets/trust-key.json` (공개 키만), `assets/app.css`, `assets/iris.svg`
- `assets/daisyui.css`, `assets/daisyui-LICENSE.txt`
- `README.md`, `PRODUCT.md`, `DESIGN.md`

봇 소스, 운영 설정, 비밀번호 해시, 터널 인증 파일, 실제 접속 링크와 사용자 정보는 이 저장소에 포함하지 않습니다. 정적 화면만 배포해도 실제 API가 실행되고 있어야 관리할 수 있습니다. 로컬 확인은 이 디렉터리에서 `py -3 -m http.server 8088 --bind 127.0.0.1` 등 정적 HTTP 서버를 사용합니다. 테스트용 접속 정보는 격리된 서버에서 발급하며 이 저장소에는 데모 계정이나 인증 우회가 없습니다.

## 연결 규약

봇이 발급하는 fragment는 `#connect=<base64url JSON>&sig=<base64url signature>`입니다. 프론트엔드는 이를 즉시 주소에서 제거합니다. 같은 출처의 `assets/trust-key.json` 공개 JWK로 원본 payload 바이트의 ECDSA P-256/SHA-256 서명을 확인한 뒤에만 비밀번호 폼과 API 접속을 허용합니다. payload 키는 정확히 `{api,ticket,expires}`이며 만료는 현재부터 330초 이내입니다. 64바이트 raw 서명을 사용합니다. 기존 `api/ticket` 직접 전달 링크는 거부합니다.

허용 API는 HTTPS 단일 `*.trycloudflare.com` 호스트입니다. 페이지 자체가 `localhost` 또는 `127.0.0.1`일 때만 `http://127.0.0.1:8781`도 허용합니다. 자격 증명, 별도 경로, 쿼리 문자열이나 fragment가 포함된 API 주소는 거부합니다. 실행 중 외부 스크립트, 폰트, 이미지, 분석 도구는 요청하지 않습니다.

- `POST /api/login`: JSON `{ticket, password}` → HTTP 202 `{approval_required:true, request_token, approval_code, expires_in:180}`
- `POST /api/approval`: JSON `{request_token}` → HTTP 202 대기 또는 HTTP 200 `{token, expires_in, room, features, limits, revision}`. 2초마다 확인하며 만료/페이지 종료 시 중단합니다.
- `GET /api/features`: Bearer token → `{room, features, limits, revision}`
- `PATCH /api/features`: Bearer token + JSON `{key, enabled, revision}` → 현재 상태
- `PATCH /api/limits`: Bearer token + JSON `{key, max_bet, revision}` → 현재 상태. `limits`는 `{key,label,min_bet,max_bet,hard_max}` 배열이며 key는 `odd_even`, `slot`, `fishing`, `updown`, `minesweeper`입니다. `max_bet:0`도 게임 고정 상한을 넘길 수 없습니다.
- `POST /api/logout`: Bearer token + JSON `{}` → HTTP 204

`room`은 `{id, name}`, 각 기능은 `{key, label, enabled, category, description}`입니다. 방과 권한, 사용 가능한 기능은 모두 서버가 결정합니다. 프론트엔드는 쿠키를 사용하지 않으며 모든 요청에 `credentials: omit`을 적용합니다. 비밀번호, 티켓, 토큰을 로컬/세션 저장소 또는 로그에 기록하지 않습니다. 응답 오류의 원문은 사용자 화면과 콘솔에 표시하지 않습니다.

검증: `node --check assets/app.js`, `node --check assets/connection.js`, `node --test tests/connection.test.cjs`. 테스트는 별도 임시 키를 생성해 실제 WebCrypto로 변조, 다른 키, 만료, 추가 필드, 호스트 제한을 검증합니다.

## 외부 라이선스

`assets/daisyui.css`: daisyUI 5.7.50, MIT License. 배포 파일을 로컬에 포함하여 런타임 CDN 접속 없이 사용합니다. 출처: https://cdn.jsdelivr.net/npm/daisyui@5.7.50/daisyui.css
