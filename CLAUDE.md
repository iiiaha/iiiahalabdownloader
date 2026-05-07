# CLAUDE.md — iiiahalab downloader

이 파일은 Claude Code가 세션 시작 시 자동으로 읽어들이는 프로젝트 룰 문서다. 다음 세션이 컨텍스트 0에서도 즉시 작업을 이어받을 수 있도록 핵심 결정사항만 압축해 담는다. 인간 가독용 narrative는 `ARCHITECTURE.md` 참고.

## 프로젝트 한 줄 요약

iiiahalab.com 에서 판매하는 18개(증가 중) SketchUp 익스텐션을 사용자 PC에 1클릭으로 설치/업데이트해주는 포터블 데스크탑 앱. Win + Mac.

## 절대 룰 (Hard Rules)

1. **SketchUp 버전 번호 하드코딩 금지.** AppData(Win) / `~/Library/Application Support/`(Mac) 안의 `SketchUp 20\d\d` 패턴 폴더를 동적으로 enumerate. 2026/2027/2030이든 자동 인식되어야 한다.
2. **익스텐션 슬러그 목록 하드코딩 금지.** `GET /api/products` 호출 결과를 single source of truth로 사용. 새 익스텐션 추가 시 다운로더 재배포 불필요.
3. **다운로더 자체에 인증 없음.** 로그인 화면 / Supabase Auth / keyring / refresh token 일체 없음. 익스텐션 본체의 `license.rbe`가 런타임에 라이선스 검증을 처리한다.
4. **`iiiaha_*` 패턴 외의 파일/폴더는 절대 건드리지 않는다.** Plugins 폴더에 사용자가 직접 설치한 비-iiiaha 플러그인이 있을 수 있음.
5. **uninstall 범위는 정확히 두 개**: `{plugins_dir}/iiiaha_{slug}.rb` 파일과 `{plugins_dir}/iiiaha_{slug}/` 폴더. 그 외 어떤 경로도 삭제 금지.
6. **UI 언어는 영어 고정.** i18n 인프라 v1.0에는 미포함.
7. **디자인 룰**: `C:\Users\LEE\Desktop\extensions\DESIGN_RULES.md` 의 토큰을 정확히 따른다. 그림자 / blur / 큰 라운드 / scale transform 금지.

## 기술 스택 (확정)

- **앱**: Tauri 2.x (Rust 백엔드 + WebView 프론트엔드)
- **프론트엔드**: Vite + Vanilla JS/HTML/CSS (프레임워크 없음)
- **Rust crates**: `reqwest` (HTTP), `zip` (.rbz 처리), `sysinfo` (프로세스 감지), `regex`, `serde` + `serde_json`, `tauri-plugin-updater`, `thiserror`
- **자가 업데이트**: Tauri Updater + minisign 서명. 매니페스트는 `https://iiiahalab.com/downloader/latest.json`.
- **OS 코드 서명**: v1.0 미포함. v0.2 이후 EV cert(Win) / Apple Developer ID(Mac) 검토.

## 폴더 구조

```
iiiahalabdownloader/                # 이 프로젝트 루트
├── CLAUDE.md                       # 이 파일
├── ARCHITECTURE.md                 # 사람용 narrative
├── README.md                       # 사용자 대상 (배포 후 작성)
├── package.json
├── vite.config.js
├── src/                            # 프론트엔드
│   ├── index.html
│   ├── main.js
│   ├── styles/
│   │   ├── tokens.css              # 디자인 룰 색상/타이포 변수
│   │   └── components.css
│   ├── views/
│   │   ├── library.html.js         # 메인 화면
│   │   ├── progress.html.js        # 진행 다이얼로그
│   │   └── settings.html.js        # SU 버전 선택, 캐시 정리, About
│   └── assets/
└── src-tauri/                      # Rust 백엔드
    ├── Cargo.toml
    ├── tauri.conf.json
    ├── icons/
    └── src/
        ├── main.rs                 # 부트스트랩, command 등록
        ├── api.rs                  # reqwest, anonymous
        ├── sketchup.rs             # SU 감지, PLUGIN_VERSION 파싱
        ├── installer.rs            # .rbz install/uninstall
        ├── process.rs              # SketchUp 실행 감지
        ├── cache.rs                # .rbz 로컬 캐시
        ├── updater.rs              # Tauri Updater 래퍼
        └── error.rs                # thiserror 통합 에러
```

## API 계약

다운로더가 호출하는 사이트 엔드포인트는 정확히 3개:

### 1. `GET https://iiiahalab.com/api/products` (신규, 공개)
응답:
```json
[
  {
    "slug": "alignplus",
    "name": "Align Plus",
    "type": "extension",
    "platform": "sketchup",
    "version": "1.0.0",
    "file_key": "rbz/alignplus.rbz",
    "thumbnail_url": "/thumbnails/alignplus.png",
    "sort_order": 1,
    "subtitle": "...",
    "description": "..."
  },
  ...
]
```
필터: `type='extension' AND is_active=true`. 60s CDN 캐시.

### 2. `GET https://iiiahalab.com/api/public/download/{slug}` (신규, 공개)
응답: `application/octet-stream`. Body는 .rbz 바이너리. `Content-Disposition: attachment; filename="iiiaha_{slug}_v{version}.rbz"`.
인증/구매 확인 없음. 모든 유저 동일 파일.

### 3. `GET https://iiiahalab.com/downloader/latest.json` (Tauri Updater 매니페스트)
포맷:
```json
{
  "version": "1.0.3",
  "notes": "...",
  "pub_date": "2026-05-08T12:00:00Z",
  "platforms": {
    "windows-x86_64": { "signature": "...", "url": "https://github.com/.../iiiahalab-downloader_1.0.3_x64.msi.zip" },
    "darwin-aarch64": { "signature": "...", "url": "https://github.com/.../...aarch64.app.tar.gz" },
    "darwin-x86_64":  { "signature": "...", "url": "https://github.com/.../...x64.app.tar.gz" }
  }
}
```

## SketchUp 설치 감지 알고리즘

```
1. OS별 SU 루트:
   - Win: %APPDATA%\SketchUp\
   - Mac: ~/Library/Application Support/
2. 자식 디렉토리 중 정규식 ^SketchUp 20\d\d$ 매치되는 것 모두 수집
3. 각각의 Plugins 경로 = {sub}/SketchUp/Plugins/
4. Plugins 폴더 안에서 iiiaha_*.rb 파일 글롭
5. 각 .rb 의 첫 30줄 내에서 정규식 /PLUGIN_VERSION\s*=\s*['"]([^'"]+)['"]/ 매치
6. 매치 실패 → 'unknown' 상태 (재설치 가이드)
```

## install/update 흐름

Install과 Update는 동일 코드. 차이는 uninstall 단계가 no-op냐 실제 삭제냐 뿐.

```
1. process::is_sketchup_running() 체크 → 실행 중이면 다이얼로그 → [Retry]
2. cache::get_or_download(slug, version):
   - 캐시 hit: ~/AppData/Local/iiiahalab-downloader/cache/{slug}-v{version}.rbz 사용
   - miss: GET /api/public/download/{slug} → 위 경로에 저장
3. 사용자가 선택한 SU 버전 모두 (기본 = 감지된 전부) 순회:
   plugins_dir = sketchup::plugins_dir(su_ver)
   installer::uninstall(plugins_dir, slug)  # iiiaha_{slug}.rb 와 iiiaha_{slug}/ 가 있으면 삭제
   installer::install(plugins_dir, rbz_path)  # zip 풀어 root 레벨로 복사
4. 라이브러리 행 갱신
```

## 디자인 토큰 (DESIGN_RULES.md 추출)

```css
:root {
  --primary: #3498db;
  --primary-hover: #2980b9;
  --danger: #e74c3c;
  --success: #27ae60;
  --bg: #f0f0f0;
  --surface: #ffffff;
  --border: #cccccc;
  --text-primary: #333333;
  --text-secondary: #888888;
  --text-label: #555555;
  --font: Arial, sans-serif;
  --size-base: 11px;
  --size-section-title: 10px;
  --size-label: 9px;
  --pad: 4px;
  --radius: 2px;
}
```

추가 규칙:
- 모든 외곽 4px 패딩
- 카드: `border: 1px solid #ccc; border-radius: 2px`
- 버튼 hover: `background: #e8e8e8`, transition 0.15s linear
- 헤더 우측에 `iiiaha.lab` 크레딧 (10px, #666)
- 데스크탑 윈도우 기본 크기 720×480, resizable

## 마일스톤 진행 상황 (체크리스트)

- [x] M0a — `CLAUDE.md` / `ARCHITECTURE.md` 작성 (이 파일들)
- [ ] M0b — Tauri 2 + Vite 부트스트랩, hello world
- [ ] M1a — 사이트에 `GET /api/products` 추가
- [ ] M1b — 사이트에 `GET /api/public/download/[slug]` 추가
- [ ] M2 — `api.rs` 구현, 18개 항목 콘솔 dump
- [ ] M3 — `sketchup.rs` Win 구현, 설치 감지
- [ ] M4 — 라이브러리 UI
- [ ] M5 — `installer.rs` + `cache.rs` + `process.rs`, 1건 update 성공
- [ ] M6 — 다중 SU 버전 일괄 적용, "Update all"
- [ ] M7 — 설정 화면, 에러 처리
- [ ] M8 — 자가 업데이트 (Tauri Updater)
- [ ] M9 — macOS 포팅
- [ ] M10 — `/downloader` 페이지, 릴리스 자동화

마일스톤 완료 시 이 체크리스트와 `ARCHITECTURE.md`의 동일 섹션을 동시에 갱신한다.

## v1.0 미포함 (명시)

- 코스(course) 다운로드 / 오프라인 시청 (Cloudflare Stream 기반이라 다운로드 불가가 원칙)
- i18n 인프라 (영어 고정)
- 결제/구매 흐름 (사이트로 이동)
- Linux 빌드
- 텔레메트리 / 사용량 분석
- OS 코드 서명 (Tauri Updater minisign 서명만 v1.0 포함)
- `last_downloaded_version` 추적 (인증 없는 익명 다운로드라 불가)

## 외부 경로 레퍼런스

- 사이트 리포: `C:\Users\LEE\Desktop\iiiahalab`
- 익스텐션 소스: `C:\Users\LEE\Desktop\extensions`
- 디자인 룰 원본: `C:\Users\LEE\Desktop\extensions\DESIGN_RULES.md`
- 사용자 PC의 실제 SU Plugins (테스트용): `C:\Users\LEE\AppData\Roaming\SketchUp\SketchUp 2025\SketchUp\Plugins\`
- 승인된 플랜 파일: `C:\Users\LEE\.claude\plans\noble-nibbling-brook.md`

## 시크릿 / 키

- **Tauri Updater minisign 비밀키**: `C:\Users\LEE\.tauri\iiiahalab-downloader.key` (비밀번호 없음, dev 단계). v0.2 이후 비밀번호 보호 + GitHub Secrets 이전 권장.
- **공개키**: `C:\Users\LEE\.tauri\iiiahalab-downloader.key.pub` — 동일 값이 `src-tauri/tauri.conf.json` 의 `plugins.updater.pubkey` 에 임베드됨.
- **릴리스 빌드 시 환경변수**: `TAURI_SIGNING_PRIVATE_KEY_PATH=C:\Users\LEE\.tauri\iiiahalab-downloader.key` (또는 키 내용을 `TAURI_SIGNING_PRIVATE_KEY` 에 직접). 비번 없으면 `TAURI_SIGNING_PRIVATE_KEY_PASSWORD` 빈 문자열.

## 변경 시 주의

- 본 문서는 source of truth다. 결정이 바뀌면 **여기를 먼저 수정**한 뒤 코드 수정.
- 사이트 리포(`C:\Users\LEE\Desktop\iiiahalab`)는 위 3개 신규 파일 외에는 절대 건드리지 않는다.
- 다운로더 코드의 어떤 부분도 사용자 PC의 비-iiiaha 파일을 건드려서는 안 된다.
