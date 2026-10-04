# 배포와 운영

이 구성은 한 매장용 ERP를 하나의 Node 서버와 SQLite 파일로 운영합니다. 도메인·호스팅·카드 단말기 계약을 자동으로 생성하지 않습니다. 모든 결제·환불은 외부 단말기에서 처리한 결과를 기록합니다.

## 준비

- Node.js 24 이상. Docker 배포 서버에는 Docker Engine과 Compose 플러그인.
- 사용할 도메인의 DNS A/AAAA 레코드와 서버의 공인 주소.
- 서버 방화벽에서 외부 TCP 80·443 허용. UDP 443은 HTTP/3용 선택 사항. API 3001은 외부에 직접 공개하지 않습니다.
- 서버와 별도로 보관할 백업 위치와 복구 담당자.
- 실제 운영 전 테스트 계정으로 매장 예약 → 시술 → 단말기 결과 수납 → 부분 환불 → 일별 정산 → 재고 → 급여명세 → 백업 복구 흐름 확인.

## Docker Compose로 HTTPS 배포

서버에 저장소를 받은 후 실행합니다. 아래는 서버의 Bash 명령입니다.

```sh
cp .env.example .env
node -e "console.log(require('node:crypto').randomBytes(32).toString('base64url'))"
```

생성한 임의 문자열을 `.env`의 `BOOTSTRAP_TOKEN`에 넣고, `DOMAIN`, `ACME_EMAIL`을 실제 값으로 수정합니다. 토큰은 최소 24자이며 첫 원장 등록 화면에서 필요합니다. 비밀번호와 다르게 지정하세요. `.env`의 읽기 권한은 서버 운영자에게만 부여합니다.

```sh
chmod 600 .env
docker compose config --quiet
docker compose up -d --build
docker compose ps
docker compose logs --tail=80 app caddy
```

Caddy가 도메인 인증서를 발급·갱신하고 HTTPS로 접속을 전달합니다. 도메인이 이 서버로 연결되어 있어야 하며 80·443 포트 접근이 가능해야 합니다. `https://설정한도메인`에 접속해 매장과 첫 원장 계정을 등록합니다. 설치 토큰, 매장명, 원장 이메일, 새 비밀번호를 입력합니다. 첫 등록 이후 공개 회원가입은 없습니다.

직원은 직원 관리에서 계정을 발급받습니다. 기본 관리자 비밀번호는 없습니다. 서버의 프로덕션 설정은 HTTPS `APP_ORIGIN`을 요구하고 로그인 쿠키는 `Secure`, `HttpOnly`, `SameSite=Strict`로 발급합니다.

### 구성

| 서비스/볼륨 | 역할 |
| --- | --- |
| app | Node 24, 비루트 사용자, 내부 포트 3001, 읽기 전용 컨테이너 파일시스템 |
| caddy | 외부 80·443, TLS 인증서와 역방향 프록시 |
| salon_data | `/app/data/salon.sqlite`와 SQLite 관련 파일, 재시작·이미지 교체 후 유지 |
| caddy_data / caddy_config | 인증서와 Caddy 상태 보관 |

Compose가 `DOMAIN`에서 `APP_ORIGIN=https://...`을 만들고 데이터 경로를 `/app/data/salon.sqlite`로 지정합니다. `.env` 안의 직접 Node 실행용 `APP_ORIGIN`, `DB_PATH`, `HOST`, `PORT`는 Compose 값으로 덮어씁니다. 새 데이터 볼륨은 이미지에 설정된 Node 사용자 권한을 상속합니다. 외부 디렉터리를 별도 bind mount하면 해당 디렉터리의 UID/GID를 컨테이너 사용자 1000에 맞춰야 합니다.

`docker compose down`은 기본적으로 데이터를 보존합니다. **`docker compose down -v`는 데이터와 인증서 볼륨을 지우므로 사용하지 마세요.** 같은 볼륨을 여러 앱 인스턴스가 동시에 공유하는 확장은 지원하지 않습니다.

## Docker 없이 실행

빌드와 서버 실행은 다음과 같습니다. `.env`를 실제 환경에 맞게 수정하고 앞단에 HTTPS 역방향 프록시를 별도로 설정해야 합니다.

```sh
npm ci
npm run build
node --env-file=.env server/index.cjs
```

`NODE_ENV=production`, 실제 HTTPS 주소의 `APP_ORIGIN`, 충분히 긴 `BOOTSTRAP_TOKEN`, 영구 로컬 디스크의 `DB_PATH`를 지정합니다. `APP_ORIGIN`에는 경로를 붙이지 않습니다. 예: `https://erp.my-salon.co.kr`. 서비스 매니저로 자동 재시작과 부팅 시 실행을 설정하고 HTTPS 프록시와 같은 호스트에서 `HOST=127.0.0.1`을 유지합니다. `npm run dev`는 개발용입니다.

Windows `.env` 복사는 아래처럼 합니다.

```powershell
Copy-Item .env.example .env
```

SQLite 파일은 서버 로컬 디스크에 두세요. OneDrive·Dropbox 동기화 폴더나 네트워크 드라이브에서 실행 중인 SQLite 파일을 공유하지 않습니다. 백업을 만들어 별도 위치로 복사합니다.

## 백업

원장 계정은 매장 설정에서 DB 백업을 다운로드할 수 있습니다. CLI도 실행 중인 SQLite에서 일관된 스냅샷을 생성합니다. 원본·대상 경로를 다르게 지정하고 항상 새 파일명을 사용하세요. 같은 이름의 파일은 덮어쓰지 않습니다.

로컬 기본 `data/salon.sqlite`를 백업합니다.

```sh
npm run backup -- backups/salon-2026-10-05.sqlite
```

`.env`에 별도 데이터 경로를 설정한 직접 Node 서버의 백업입니다.

```sh
node --env-file=.env scripts/backup.cjs backups/salon-2026-10-05.sqlite
```

Docker 서버의 Bash 예시입니다. 먼저 볼륨에 스냅샷을 생성하고 호스트로 복사합니다.

```sh
mkdir -p backups
docker compose exec app node scripts/backup.cjs /app/data/backups/salon-2026-10-05.sqlite
docker compose cp app:/app/data/backups/salon-2026-10-05.sqlite ./backups/salon-2026-10-05.sqlite
chmod 600 backups/salon-2026-10-05.sqlite
```

원본과 같은 서버·같은 볼륨에만 보관하면 서버 장애에서 복구할 수 없습니다. 호스트로 복사한 백업을 접근이 제한된 별도 저장소에 암호화해 보관하세요. 백업에는 고객 정보·연락처·급여·비밀번호 검증값 등이 포함되어 있습니다. 공개 링크나 Git 저장소로 올리지 마세요.

매장 마감 후 매일 백업하고 업데이트 전에도 추가 백업을 권장합니다. 예를 들어 일별 14개·주별 8개를 별도 보관하고, 실제 매장의 보존 정책에 맞춰 조정합니다. CLI 자체가 예약 실행·자동 삭제·외부 업로드를 수행하지는 않습니다. 서버 스케줄러에 날짜가 다른 파일명을 설정하고 실패 알림을 연결하세요. 주기적으로 복사본으로 복구 연습을 하고 결과를 기록합니다.

실행 중인 `salon.sqlite` 파일 하나만 파일 복사로 백업하지 마세요. 아직 WAL에 남은 거래를 놓칠 수 있으므로 제공한 SQLite 백업 API를 사용합니다.

## 백업 복구

복구하면 백업 시점 이후의 업무 기록은 현재 DB에서 교체됩니다. 복구할 매장과 시각을 확인하고, 현재 DB도 가능한 한 먼저 백업하세요. 복구 도구는 기존 DB·WAL·SHM 파일을 `before-restore-*` 폴더에 옮겨 보존하고, 백업 무결성·스키마를 검사한 뒤 교체합니다. 모든 세션을 삭제하므로 직원이 다시 로그인해야 합니다.

**반드시 ERP 서버를 완전히 종료한 뒤** 실행합니다. `--confirm-stopped`는 서버를 종료했다는 운영자의 확인이며, 도구가 다른 프로세스의 종료를 대신 수행하거나 보장하지 않습니다.

### 로컬/직접 Node 서버

실행한 터미널에서 `Ctrl+C`를 누르거나 서비스 매니저에서 중지합니다. 기본 데이터 경로를 사용하는 예시입니다.

```sh
node scripts/restore.cjs backups/salon-2026-10-05.sqlite --confirm-stopped
npm start
```

직접 Node 운영 서버의 `.env` 데이터 경로를 사용하는 경우입니다.

```sh
node --env-file=.env scripts/restore.cjs backups/salon-2026-10-05.sqlite --confirm-stopped
node --env-file=.env server/index.cjs
```

실행 후 고객 수·최근 수납·재고·급여명세를 확인합니다. 기존 기록 사본 `data/before-restore-*`는 복구 검증과 보존 정책에 따라 별도로 관리합니다.

### Docker 서버

아래는 서버 Bash용 명령입니다. `./backups`에 복구할 파일이 있어야 합니다.

```sh
docker compose down
docker compose run --rm --no-deps -v "$(pwd)/backups:/restore:ro" --entrypoint node app scripts/restore.cjs /restore/salon-2026-10-05.sqlite --confirm-stopped
docker compose up -d
docker compose ps
```

복구 명령이 실패하면 오류를 해결한 다음 진행하세요. 백업 파일을 앱의 실행 중 데이터 파일 위에 수동 덮어쓰지 마세요. 이전 버전의 코드로 돌아갈 때는 그 버전과 호환되는 백업도 함께 복원해야 합니다.

## 원장 로그인 복구

일반 직원 비밀번호는 다른 원장·매니저가 직원 관리에서 임시 비밀번호로 재설정합니다. 원장 비밀번호를 모두 잊었으면 **데이터베이스 접근 권한이 있는 서버 운영자**가 아래 도구를 사용합니다. 기존 원장 계정만 복구하며 일반 직원을 승격하거나 새 계정을 만들지 않습니다.

로컬 기본 데이터 경로:

```sh
npm run reset-owner
```

직접 Node 운영 환경:

```sh
node --env-file=.env scripts/reset-owner.cjs
```

Docker:

```sh
docker compose exec app node scripts/reset-owner.cjs
```

도구에서 원장 이메일, 새 비밀번호 두 번, `RESET` 확인을 입력합니다. 비밀번호는 터미널에 표시되지 않으며 명령행 인자로 받지 않습니다. 비밀번호를 셸 명령에 붙여 기록하지 마세요. 대상 원장 계정·직원 정보를 활성화하고 해당 원장의 모든 기존 로그인을 종료하며 복구 이력을 남깁니다.

## 업데이트와 상태 확인

업데이트 전 백업을 만들고 매장에 잠깐의 재시작 시간을 안내합니다. 테스트한 커밋을 배포하며, 현재 운영 커밋 번호도 기록합니다.

```sh
git rev-parse HEAD
git pull
docker compose up -d --build
docker compose ps
docker compose logs --tail=80 app
```

`GET /api/health`는 DB 연결을 확인해 `{ "status": "ok" }`를 반환합니다. HTTPS 주소의 이 경로를 외부 모니터링에 등록할 수 있습니다. 호스트 디스크 용량, 최근 백업 시각, 인증서 갱신, 로그인 실패 증가도 확인하세요. 초기 설정 완료 후 설치 토큰을 외부에 공개하거나 직원용 로그인 비밀번호로 사용하지 않습니다.

오류가 있으면 새 수납·환불의 실제 단말기 결과와 ERP 기록을 먼저 대조하세요. 네트워크 오류로 저장 결과가 불분명한 경우 같은 내용을 무조건 새 거래로 다시 입력하지 말고 최근 기록을 확인합니다. 동일 요청 재시도는 서버에서 중복 반영을 막습니다.

## 운영 범위

지원하는 범위는 단일 매장 내부 운영, 수동 입고, 외부 단말기 결과 기록, 수동 항목 기반 급여명세입니다. 온라인 고객 예약, 문자·카카오 발송, 카드 PG·단말기 API, 현금영수증·세무 신고, 자동 발주, 출퇴근 기록 수집, 세금·4대보험 자동 계산, 은행 급여 이체는 연동되어 있지 않습니다. 필요한 외부 서비스가 정해지면 별도 연동과 운영 검증이 필요합니다.

고객 메모에 업무상 필요한 정보만 입력하고 계정을 공유하지 마세요. 실제 운영 시작 전 매장의 개인정보 처리 안내·보유 기간·퇴사 계정 정리·백업 접근 담당자를 정하고 업무 계약·급여 기준과 화면 계산을 확인하세요. 이 저장소의 자동 테스트는 실제 단말기 정산이나 세무 신고 검증을 대체하지 않습니다.
