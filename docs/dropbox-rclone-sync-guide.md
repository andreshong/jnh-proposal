# Dropbox 데스크톱 앱 없이 rclone(API 기반)으로 동기화하기

사내 클라우드 서버(또는 로컬 폴더)의 파일 변경 사항을 Dropbox 데스크톱 앱 없이,
rclone을 이용해 Dropbox API 기반으로 동기화하는 방법을 검증한 결과입니다.
아래 절차를 그대로 따라 하면 본인 PC 또는 사내 서버에서도 재현할 수 있습니다.

> **이 문서의 실행 로그는 격리된 검증(샌드박스) 환경에서 캡처했습니다.**
> 해당 환경은 보안상 `dropbox.com` / `dropboxapi.com`으로 나가는 네트워크가
> 차단되어 있어, 실제 Dropbox OAuth 인증까지는 재현하지 못했습니다.
> 대신 rclone의 `local` 타입 remote를 Dropbox remote의 자리에 대입해
> **설정 절차와 동기화 명령/동작(복사·수정 반영·삭제 전파)** 이 동일하게
> 작동함을 검증했습니다. 실제 Dropbox 계정 연동(3~4단계 중 OAuth 부분)은
> 인터넷이 열려 있는 본인 PC 또는 사내 서버에서 진행해야 합니다.

---

## 1. OS 확인 및 rclone 설치

### 1-1. OS 확인

```bash
# Linux / Mac
uname -a

# Windows (PowerShell)
$PSVersionTable.OS
```

이번 검증은 `Ubuntu 24.04 LTS (Linux, x86_64)` 환경에서 진행했습니다.

### 1-2. rclone 설치 여부 확인

```bash
which rclone && rclone version || echo "rclone 미설치"
```

### 1-3. 설치 방법 (관리자 권한 불필요한 방식 우선)

**공통 (Linux/Mac) — 관리자 권한 불필요, 사용자 홈 디렉터리에 설치**

```bash
curl -O https://downloads.rclone.org/rclone-current-linux-amd64.zip   # Mac은 osx-amd64/osx-arm64
unzip rclone-current-linux-amd64.zip
cd rclone-*-linux-amd64
mkdir -p ~/.local/bin
cp rclone ~/.local/bin/
chmod +x ~/.local/bin/rclone
export PATH="$HOME/.local/bin:$PATH"   # ~/.bashrc 또는 ~/.zshrc 에 추가해 영구 반영
rclone version
```

**Mac (Homebrew, 이미 brew가 있다면 가장 간단)**

```bash
brew install rclone
```

**Windows (관리자 권한 불필요)**

- [rclone 공식 다운로드 페이지](https://rclone.org/downloads/)에서 `Windows` zip을 받아
  원하는 폴더(예: `C:\Users\<사용자>\rclone`)에 압축 해제 후, 그 폴더를 사용자 PATH
  환경변수에 추가하면 관리자 권한 없이 사용 가능합니다.
- 관리자 권한이 있다면 `winget install Rclone.Rclone` 또는
  `choco install rclone` 도 가능합니다.

**관리자 권한이 있는 Linux 서버라면 패키지 매니저가 더 간단합니다**

```bash
sudo apt-get update && sudo apt-get install -y rclone   # Debian/Ubuntu
```

이번 검증 환경(컨테이너 root 계정)에서는 `apt-get install -y rclone`로
`rclone v1.60.1`이 정상 설치되었습니다.

```
$ rclone version
rclone v1.60.1-DEV
- os/version: ubuntu 24.04 (64 bit)
- os/type: linux
- os/arch: amd64
```

---

## 2. Dropbox rclone remote 설정 절차

### 2-1. 왜 Dropbox API 앱 등록이 필요한가

rclone은 Dropbox 데스크톱 앱처럼 아이디/비밀번호로 로그인하지 않고,
**Dropbox API(OAuth2)** 를 통해 접근합니다. OAuth2는 "어떤 애플리케이션이
내 Dropbox에 접근을 요청하는지"를 식별하기 위해 **App(Client) ID/Secret** 이
필요합니다.

- rclone은 자체 기본 앱 키를 내장하고 있어 `client_id`/`client_secret`을
  비워두면 rclone 공용 앱으로 인증할 수 있습니다(개인 테스트 용도로는 충분).
- 다만 회사 업무용으로 지속적으로 쓸 경우, 공용 앱은 다른 rclone 사용자들과
  API 호출 한도(rate limit)를 공유하기 때문에, **본인/회사 명의의 Dropbox
  API 앱을 별도로 등록**하는 것을 권장합니다. 또한 "App folder"가 아닌
  "Full Dropbox" 접근 범위가 필요하면 앱 등록 시 명시적으로 선택해야 합니다.

> **이번 배포 대상 확인:** 동기화 목적지가 Dropbox 최상위(루트)에 이미 존재하는
> `JNH Press` 폴더(`https://www.dropbox.com/home/JNH%20Press`)이므로, 아래
> 4단계에서 **반드시 `Full Dropbox`를 선택**해야 합니다. `App folder`를 선택하면
> rclone이 `Apps/<앱이름>/` 안의 새 폴더에만 접근할 수 있어 기존 `JNH Press`
> 폴더에는 접근이 불가능합니다.

**등록 절차**

1. https://www.dropbox.com/developers/apps 접속 (Dropbox 계정 로그인 필요)
2. **Create app** 클릭
3. **Scoped access** 선택
4. 접근 범위 선택
   - `App folder`: `Apps/<앱이름>` 폴더만 접근 (최소 권한 원칙이지만, 이번처럼
     기존 폴더에 동기화해야 하면 사용 불가)
   - `Full Dropbox`: 전체 Dropbox 접근 — **이번 `JNH Press` 폴더 동기화에는 이걸 선택**
5. 앱 이름 입력 후 생성
6. **Permissions** 탭에서 필요한 스코프 체크 후 **Submit**
   - `files.metadata.read`, `files.metadata.write`
   - `files.content.read`, `files.content.write`
7. **Settings** 탭에서 `App key`(=client_id), `App secret`(=client_secret) 확인
8. (rclone 로컬 브라우저 인증을 쓸 경우) **OAuth2 > Redirect URIs**에
   `http://localhost:53682/` 를 추가 — rclone이 인증 완료 후 콜백을 받는 주소입니다.

### 2-2. `rclone config`로 Dropbox remote 추가하기 (단계별)

```bash
rclone config
```

대화형 프롬프트는 아래 순서로 진행됩니다.

```
No remotes found, make a new one?
n) New remote
n/s/q> n

name> dropbox                     # remote 이름 (원하는 이름 지정 가능)

Type of storage to configure.
Storage> dropbox                  # 목록에서 "Dropbox" 검색 후 선택 (번호 입력)

OAuth Client Id
client_id>                        # 2-1에서 만든 App key. 비워두면 rclone 공용 앱 사용
OAuth Client Secret
client_secret>                    # App secret. client_id를 비웠다면 이것도 비움

Edit advanced config?
y/n> n

Use auto config?
y) Yes (default)   # 브라우저가 있는 로컬 PC
n) No              # 브라우저 없는 원격/헤드리스 서버
y/n> y  (또는 n)
```

`Use auto config?`에서 **Y**를 선택하면 로컬 브라우저가 자동으로 열리며
Dropbox 로그인 → 권한 승인 화면이 뜨고, 승인 즉시 rclone이 토큰을 받아 옵니다.

설정이 끝나면 마지막에 확인 화면이 나옵니다.

```
Configuration complete.
Keep this "dropbox" remote?
y/e/d> y
```

이후 아래 명령으로 정상 연결됐는지 확인합니다.

```bash
rclone lsd dropbox:          # remote 최상위 폴더 목록
rclone about dropbox:        # 용량/계정 정보
```

### 2-3. OAuth 인증 방식: 브라우저 팝업 vs Headless(원격 서버)

| 구분 | 브라우저 팝업 방식 (`Use auto config? y`) | Headless 방식 (`Use auto config? n`) |
|---|---|---|
| 대상 | GUI/브라우저가 있는 로컬 PC(Windows/Mac/데스크톱 Linux) | GUI가 없는 사내 서버, 클라우드 VM, SSH 접속 환경 |
| 동작 | rclone이 `http://127.0.0.1:53682`에 임시 로컬 웹서버를 띄우고 기본 브라우저를 자동으로 엶 | 브라우저를 열 수 없으므로 인증 URL 텍스트만 출력 |
| 사용자 작업 | 뜬 브라우저 창에서 Dropbox 로그인 → 권한 승인 클릭만 하면 끝 | 아래 둘 중 하나로 진행 |
| 방법 A | - | 출력된 URL을 **다른(브라우저가 있는) 기기**에서 열어 로그인/승인 후, 리다이렉트된 코드를 서버 터미널에 붙여넣기 |
| 방법 B (권장) | - | 브라우저가 있는 로컬 PC에서 **동일 버전의 rclone**으로 `rclone authorize dropbox <client_id> <client_secret>` 실행 → 브라우저 인증 완료 후 터미널에 출력되는 토큰 블록을 복사 → 헤드리스 서버의 `config_token>` 프롬프트에 붙여넣기 |
| 비고 | 가장 간단, 방화벽 이슈 없음 | 사내 서버가 아웃바운드 443 포트로 `dropboxapi.com` 접근 가능해야 함 |

사내 클라우드 서버처럼 SSH로만 접속하는 headless 환경이라면 **방법 B**
(`rclone authorize`)를 쓰는 것이 가장 안전하고 흔한 패턴입니다. 서버에는
Dropbox 로그인 자격 증명이 전혀 입력되지 않고, 토큰만 전달되기 때문입니다.

---

## 3. 테스트용 로컬 폴더 생성

```bash
mkdir -p test-sync-source
echo "hello from file1" > test-sync-source/note1.txt
echo "hello from file2" > test-sync-source/note2.txt
mkdir -p test-sync-source/subfolder
echo "nested file" > test-sync-source/subfolder/note3.txt
```

재현 가능한 스크립트: [`scripts/test-dropbox-rclone-sync.sh`](../scripts/test-dropbox-rclone-sync.sh)

---

## 4. 단방향 동기화 테스트

실제 Dropbox 대신 로컬 remote(`localtest:`)를 대상으로 아래 순서를 검증했습니다.
**Dropbox remote를 쓸 때는 `localtest:<경로>` 자리에 `dropbox:<경로>`를 넣으면
명령어와 동작은 100% 동일합니다.**

### 4-1. dry-run으로 변경사항 미리보기 (실제 반영 안 됨)

```bash
rclone sync ./test-sync-source dropbox:test-sync-source --dry-run -v
```

```
NOTICE: note1.txt: Skipped copy as --dry-run is set (size 40)
NOTICE: note2.txt: Skipped copy as --dry-run is set (size 17)
NOTICE: subfolder/note3.txt: Skipped copy as --dry-run is set (size 12)
Transferred:            3 / 3, 100%
```

### 4-2. 실제 동기화 실행

```bash
rclone sync ./test-sync-source dropbox:test-sync-source -v
```

```
INFO  : note2.txt: Copied (new)
INFO  : note1.txt: Copied (new)
INFO  : subfolder/note3.txt: Copied (new)
Transferred:            3 / 3, 100%
```

### 4-3. 체크섬/크기 비교로 검증

```bash
rclone check ./test-sync-source dropbox:test-sync-source
```

```
NOTICE: 0 differences found
NOTICE: 3 matching files
```

### 4-4. 증분 변경(수정/추가/삭제) 반영 확인

소스에서 파일을 수정(`note1.txt`), 추가(`note4.txt`), 삭제(`note2.txt`)한 뒤
다시 `rclone sync`를 실행하면:

```
INFO  : note4.txt: Copied (new)
INFO  : note1.txt: Copied (replaced existing)
INFO  : note2.txt: Deleted
Deleted:                1 (files), 0 (dirs)
Transferred:            2 / 2, 100%
```

→ 변경된 파일만 다시 전송되고(수정분만 재업로드), 대상 쪽에서도 소스에서
삭제된 파일이 함께 삭제됩니다.

> **주의 (중요):** `rclone sync`는 **단방향 미러링**입니다. 대상(destination)에만
> 있고 소스(source)에는 없는 파일은 **자동 삭제**됩니다. 처음 몇 번은 항상
> `--dry-run`으로 먼저 확인하세요. 대상에서 파일이 지워지는 걸 원치 않는다면
> `rclone sync` 대신 `rclone copy`(삭제 없이 복사/갱신만 수행)를 사용하세요.

### 4-5. 반복 동기화 자동화 (선택)

일정 주기로 자동 동기화하려면 cron 또는 `rclone`의 내장 감시 옵션을 사용할 수 있습니다.

```bash
# 5분마다 동기화 (cron)
*/5 * * * * /usr/bin/rclone sync /path/to/source dropbox:backup-folder --log-file=/var/log/rclone-sync.log

# 파일 변경을 실시간 감지해 동기화 (로컬 폴더가 대상일 때 유용)
rclone bisync ./local-folder dropbox:remote-folder --resync   # 양방향이 필요할 때만
```

---

## 5. 사내 서버(Windows) 적용 예시: `Y:` 드라이브 → Dropbox

사내 서버가 Windows이고, 동기화할 파일들이 네트워크 드라이브 `Y:`에 있는
실제 배포 시나리오 기준 예시입니다. 명령어와 동작 원리는 위 2~4절과 동일하며,
아래는 Windows 환경에 맞춘 구체적인 실행 방법입니다.

### 5-1. 기본 동기화 명령 (PowerShell)

실제 동기화 목적지는 Dropbox 루트의 `JNH Press` 폴더
(`https://www.dropbox.com/home/JNH%20Press`)입니다. 폴더명에 공백이 있으므로
`"dropbox:JNH Press"`처럼 **전체를 따옴표로 묶어야** 합니다.

```powershell
# 처음엔 반드시 dry-run으로 먼저 확인
rclone sync "Y:\" "dropbox:JNH Press" --dry-run -v --log-file=C:\rclone\logs\sync.log

# 이상 없으면 실제 실행
rclone sync "Y:\" "dropbox:JNH Press" -v --log-file=C:\rclone\logs\sync.log
```

- `Y:\` 전체가 아니라 특정 하위 폴더만 동기화하려면 `"Y:\공유폴더\프로젝트"`처럼
  경로를 좁혀서 지정하세요. `rclone sync`는 대상에만 있고 소스(`Y:`)에는 없는
  파일을 **삭제**하므로, 처음에는 범위를 좁게 잡고 검증 후 넓히는 걸 권장합니다.
- `JNH Press`는 Dropbox 루트에 이미 존재하는 폴더이므로, 2-1에서 설명한 대로
  앱 등록 시 **Full Dropbox** 범위를 선택했어야 이 경로에 접근할 수 있습니다.

### 5-2. Windows 작업 스케줄러(Task Scheduler)로 주기 동기화 자동화

`schtasks` 명령으로 5분마다 동기화하는 예시:

```powershell
schtasks /create /tn "DropboxRcloneSync" `
  /tr "C:\rclone\rclone.exe sync Y:\ \"dropbox:JNH Press\" -v --log-file=C:\rclone\logs\sync.log" `
  /sc minute /mo 5 `
  /ru "<서비스 계정>" /rp "<암호>"
```

**주의할 점**

- `Y:` 같은 매핑 드라이브는 **해당 계정이 로그인한 세션에서만 보이는 경우**가
  많습니다. 작업 스케줄러가 "사용자가 로그온하지 않아도 실행" 옵션으로
  동작하면 `Y:`가 인식되지 않을 수 있습니다. 이 경우
  - 작업 속성에서 "사용자가 로그온했는지 여부에 관계없이 실행"을 끄고
    "사용자가 로그온한 경우에만 실행"으로 설정하거나,
  - `Y:\` 대신 UNC 경로(예: `\\fileserver\share\`)를 직접 사용하는 것이
    더 안전합니다(로그온 세션에 의존하지 않음).
- rclone remote 설정(`rclone config`로 만든 토큰)은 **서비스 계정의 사용자
  프로필**(`%APPDATA%\rclone\rclone.conf`) 아래 저장됩니다. 작업 스케줄러가
  다른 계정으로 실행되면 그 계정으로 다시 `rclone config`를 해줘야 합니다.
- 실수로 대량 삭제가 전파되는 걸 막고 싶다면 `--max-delete N` 옵션으로 한
  번에 삭제 가능한 파일 수를 제한하거나, `--backup-dir`로 삭제/덮어쓰기 전
  파일을 별도 폴더에 보관하도록 설정할 수 있습니다.

```powershell
rclone sync "Y:\" "dropbox:JNH Press" -v `
  --log-file=C:\rclone\logs\sync.log `
  --max-delete 20 `
  --backup-dir "dropbox:JNH Press-backups/$(Get-Date -Format yyyyMMdd)"
```

### 5-3. 검증 순서 (권장)

1. `Y:` 하위의 테스트용 서브폴더(예: `Y:\_rclone-test`)만 대상으로 5-1의
   dry-run/실제 동기화를 먼저 실행해 명령이 의도대로 동작하는지 확인
2. 파일 수정·추가·삭제 후 재동기화하여 4-4와 동일하게 반영되는지 확인
3. 문제 없으면 범위를 실제 대상 폴더로 넓히고, 5-2의 작업 스케줄러 등록
4. 로그 파일(`C:\rclone\logs\sync.log`)을 주기적으로 확인해 인증 만료나
   권한 오류가 없는지 모니터링

---

## 6. 보안 고려사항 (사내 보안팀과 사전 협의 권장)

이 방식은 사내 서버에서 외부(Dropbox) 클라우드로 파일을 지속적으로 업로드하는
구조이므로, 실 서버에 적용하기 전에 아래 항목들을 사내 보안팀과 확인하는 것을
권장합니다.

1. **방화벽/프록시 아웃바운드 허용**
   - rclone은 `api.dropboxapi.com`, `content.dropboxapi.com`,
     `notify.dropboxapi.com` (그리고 인증 시 `www.dropbox.com`)로 나가는
     HTTPS(443) 트래픽이 필요합니다. 사내 프록시가 화이트리스트 방식이면
     이 도메인들을 명시적으로 허용해야 합니다(Dropbox 데스크톱 앱을 쓸 때와
     동일한 요건).

2. **DLP(정보유출방지) / CASB 탐지**
   - 많은 기업 보안 솔루션이 "승인되지 않은 클라우드 스토리지로의 업로드"를
     탐지·차단합니다. rclone은 Dropbox 공식 데스크톱 앱과 다른 트래픽
     패턴(프로세스명, TLS 핑거프린트 등)을 가지므로, 이미 Dropbox 앱은
     허용되어 있어도 rclone 트래픽은 별도로 "미승인 도구의 유출 시도"로
     탐지/차단될 수 있습니다. 사전에 보안팀에 목적(사내→Dropbox 백업/동기화)과
     사용 도구(rclone)를 알리고 예외 처리를 요청하는 것이 안전합니다.

3. **OAuth 토큰 보관**
   - `rclone config`로 발급받은 토큰은 실행 계정의 `rclone.conf`
     (Windows: `%APPDATA%\rclone\rclone.conf`)에 저장됩니다. 이번처럼
     **Full Dropbox** 권한으로 발급하면, 이 파일이 유출될 경우 회사 Dropbox
     전체에 접근 가능한 자격 증명이 유출되는 것과 같습니다.
     - `rclone config` 시 `Set configuration password`로 config 파일을
       암호화하거나,
     - 해당 파일의 NTFS 권한을 서비스 계정만 읽을 수 있도록 제한하고,
     - 가능하면 회사 명의의 별도 Dropbox 계정(개인 관리자 계정이 아닌)으로
       앱을 등록해 감사(audit)와 권한 회수가 쉽도록 하는 것을 권장합니다.

4. **의도치 않은 대량 삭제**
   - `rclone sync`는 소스에 없는 파일을 대상에서 자동 삭제합니다. 소스 경로를
     잘못 지정하거나 `Y:` 드라이브 연결이 일시적으로 끊긴 상태로 동기화가
     돌면, Dropbox의 `JNH Press` 폴더 파일이 대량으로 삭제될 수 있습니다.
     5-2에서 언급한 `--max-delete`, `--backup-dir` 옵션 사용을 권장하며,
     Dropbox 자체의 "30일 파일 복구" 기능도 안전망으로 활용할 수 있습니다.

5. **사내 소프트웨어 승인/EDR**
   - 일부 기업은 서버에 설치되는 실행 파일에 대해 화이트리스트 정책(EDR,
     애플리케이션 제어)을 운영합니다. `rclone.exe` 설치 전에 IT 자산관리팀
     승인 절차가 필요한지 확인하세요.

6. **데이터 분류 확인**
   - 동기화 대상 폴더에 개인정보, 도면/설계 데이터 등 외부 반출이 제한된
     자료가 포함되어 있지 않은지 사전에 확인하고, 필요하면 동기화 대상
     경로를 좁혀서 지정하세요(5-1 참고).

위 항목은 "이 방식을 쓰면 안 된다"는 뜻이 아니라, Dropbox 데스크톱 앱을 쓸 때도
동일하게 검토되어야 했을 사항들이 API 기반 방식에서는 트래픽 패턴이 달라
별도로 재확인이 필요하다는 의미입니다.

---

## 7. 결론 및 다음 단계

- rclone 설치, remote 설정 절차, `sync`/`check` 명령의 동작(신규 복사·수정 반영·
  삭제 전파)까지 로컬 환경(local remote 대체)에서 검증 완료했습니다.
- 실제 Dropbox 계정 연동은 다음 두 가지 중 하나로 진행하면 됩니다.
  1. 인터넷이 열려 있는 로컬 PC: `rclone config` → `Use auto config? y` (브라우저 팝업)
  2. 사내 서버(headless): 로컬 PC에서 `rclone authorize dropbox <id> <secret>`로
     토큰 발급 → 서버의 `rclone config`에 붙여넣기
- 이후 `dropbox:` remote 이름만 넣으면 위 3~4단계 명령이 그대로 동작합니다.
- Windows 사내 서버(`Y:` 드라이브) 적용 시 구체적인 명령과 작업 스케줄러
  설정은 5절을 참고하세요.
- 실 서버 배포 전, **6절의 보안 고려사항을 사내 보안팀과 먼저 협의**하는
  것을 권장합니다(방화벽 허용, DLP 예외, 토큰 보관, 소프트웨어 승인 등).
