# Architecture — iiiahalab downloader

> 사람용 narrative 문서. AI/Claude는 `CLAUDE.md`를 먼저 본다. 동일한 결정사항을 산문으로 풀어 적은 것.

## 왜 이 앱을 만드는가

iiiahalab.com 은 SketchUp 익스텐션을 판매한다(현재 18개, 증가 중). 사용자가 새 익스텐션을 사거나 이미 산 것의 신버전이 나왔을 때, 지금은 다음 4단계를 거친다:

1. iiiahalab.com 접속 → 로그인.
2. 마이페이지에서 .rbz 다운로드.
3. SketchUp 실행 → Window → Extension Manager → Install Extension.
4. 기존 버전이 있으면 먼저 Uninstall.

이 4단계가 18개 익스텐션 × 사용자가 깔아둔 SU 버전 수(보통 2~3개)만큼 반복된다. 시간 낭비고, 누락도 잦다. 이 앱이 그 모든 걸 1클릭으로 줄인다.

## 핵심 통찰: 라이선스는 익스텐션 자체에 박혀 있다

각 익스텐션의 body 폴더에는 `license.rbe`(암호화된 Ruby)가 있고, SketchUp이 익스텐션을 켤 때 이 파일이 iiiahalab.com 과 통신해서 사용자 라이선스를 검증한다. 즉:

- .rbz 파일이 친구에게 공유되어도, 친구가 라이선스를 못 사면 익스텐션이 안 켜진다.
- 따라서 .rbz 다운로드를 인증으로 막을 필요가 없다.

이 통찰 덕분에 다운로더는 **인증 없이** 동작할 수 있다. 로그인 화면 / Supabase Auth / 토큰 저장 / refresh 로직이 전부 사라진다. 코드량이 30~40% 줄고, 첫 사용자 UX가 매끄러워진다(앱 켜자마자 바로 라이브러리 화면).

다운로더 .exe / .app 자체는 사이트 로그인 뒤에 있는 `/downloader` 페이지에서만 받을 수 있게 둔다. 앱이 손에 들어오는 순간 이미 신뢰할 만한 사용자라는 가정.

## 시스템 구성

```
┌────────────────────────────────────┐
│  iiiahalab Downloader (Tauri)      │
│                                    │
│  Frontend (WebView)                │
│   ├─ HTML/CSS/JS (Vanilla)         │
│   └─ Design Rules CSS (extensions) │
│                                    │
│  Rust Backend                      │
│   ├─ api.rs       (anonymous HTTP) │
│   ├─ sketchup.rs  (SU 감지)        │
│   ├─ installer.rs (.rbz 처리)      │
│   ├─ process.rs   (SU 실행 감지)   │
│   ├─ cache.rs     (.rbz 로컬 캐시) │
│   └─ updater.rs   (앱 자가 갱신)   │
└──────────┬─────────────────────────┘
           │ HTTPS (anonymous)
           ▼
┌────────────────────────────────────┐
│ iiiahalab.com (Next.js + Supabase) │
│                                    │
│ NEW: GET /api/products             │
│ NEW: GET /api/public/download/...  │
│ NEW: /downloader/latest.json       │
│                                    │
│ EXISTING (untouched): /api/version,│
│   /api/download (auth), Supabase   │
└────────────────────────────────────┘
```

## 기술 스택을 왜 Tauri로 골랐는가

- **포터블 단일 exe**: Tauri 빌드 산출물은 5–15MB. Electron(80–150MB)에 비해 압도적.
- **WebView**: 디자인 룰의 HTML/CSS를 그대로 재활용 가능. 현재 18개 익스텐션이 모두 HtmlDialog로 동일한 디자인 토큰을 쓰고 있어 일관성 유지에 유리.
- **Rust 백엔드**: 파일 시스템 조작(.rbz 풀기, AppData 스캔), 프로세스 감지, 자가 업데이트 모두 안정적인 Rust 생태계 활용.
- **자체 minisign 서명**: Tauri Updater가 OS 코드 서명과 별도로 자체 서명 체계를 갖춰서, EV cert 없이도 안전한 자가 업데이트 가능.

대안(Electron, Wails, PyInstaller)도 고려했지만 용량/일관성/유지보수성 면에서 Tauri가 우세.

## 사이트 측 변경

3개의 신규 파일만 추가한다:

### 1. `src/app/api/products/route.ts`

활성 익스텐션 목록을 한 번에 반환. Supabase의 `products` 테이블을 `type='extension' AND is_active=true`로 필터링, `sort_order`로 정렬. 60초 CDN 캐시를 둬서 부담을 0에 수렴시킨다.

다운로더는 앱 시작 시 1회 호출하고, 사용자가 "Refresh" 버튼을 누를 때 추가 호출.

### 2. `src/app/api/public/download/[slug]/route.ts`

기존 `/api/download/[slug]`의 인증 없는 버전. 로그인/구매확인/`last_downloaded_version` 갱신을 모두 제거하고, Supabase Storage에서 .rbz를 그대로 스트림. 다운로더는 이 엔드포인트만 사용한다.

기존 `/api/download/[slug]`는 사이트 마이페이지에서 그대로 쓴다. 두 엔드포인트가 공존.

### 3. `public/downloader/latest.json`

Tauri Updater 표준 매니페스트. 릴리스 자동화 스크립트가 갱신.

## 다운로더 측 핵심 모듈

### sketchup.rs — 가장 중요한 모듈

- AppData 안에서 `SketchUp 20\d\d` 형태 폴더를 모두 enumerate. **버전 번호 하드코딩 절대 금지.** 사용자가 SU 2026, 2027을 깔든, 다운로더가 자동 인식해야 한다.
- 각 SU 버전의 Plugins 폴더에서 `iiiaha_*.rb` 글롭, 첫 30줄에서 `PLUGIN_VERSION = '...'` 정규식 파싱.
- 결과: `Vec<{ su_version: String, plugins_dir: PathBuf, installed: HashMap<slug, version> }>`.

### installer.rs — 가장 위험한 모듈

- uninstall은 정확히 두 경로만 삭제: `{plugins_dir}/iiiaha_{slug}.rb` 파일과 `{plugins_dir}/iiiaha_{slug}/` 폴더. 그 이상 어떤 경로도 절대 건드리지 않는다(사용자가 직접 깐 비-iiiaha 플러그인 보호).
- install은 `.rbz`(=`.zip`)을 `plugins_dir`로 그대로 풀어 쓰기. .rbz의 root 레벨에 `iiiaha_{slug}.rb` + `iiiaha_{slug}/` 구조가 들어 있다고 가정. 풀고 나서 두 경로가 모두 존재하는지 검증.

### cache.rs — 단순한 .rbz 로컬 캐시

- `~/AppData/Local/iiiahalab-downloader/cache/{slug}-v{version}.rbz` 패턴.
- 모든 유저가 받는 .rbz가 동일하므로 slug+version이 키.
- 설정 화면에서 "Clear cache" 버튼으로 비우기 가능.

### process.rs — SU 실행 감지

- `sysinfo` crate로 프로세스 목록 enumerate, `SketchUp.exe`(Win) / `SketchUp`(Mac) 매치.
- install/update 직전에만 호출. 폴더 잠금 문제 회피용.

### updater.rs — 자가 업데이트

- `tauri-plugin-updater`의 얇은 래퍼.
- 앱 시작 후 비차단으로 `https://iiiahalab.com/downloader/latest.json` 조회.
- 새 버전 있으면 우측 하단 비침습 토스트, "Update now" 클릭 시 자동 교체.

## UI 디자인 원칙

`C:\Users\LEE\Desktop\extensions\DESIGN_RULES.md`의 토큰을 그대로 가져온다. 18개 익스텐션의 HtmlDialog와 시각적 일관성 유지가 목적.

핵심 토큰:
- Primary: `#3498db`, hover `#2980b9`
- 배경: `#f0f0f0`, 카드: `#ffffff`
- 폰트: Arial 11px, flat
- 외곽 4px 패딩, 카드 border 1px + radius 2px
- 그림자/blur/큰 라운드/scale transform 모두 금지

다운로더가 윈도우 자체이므로, dialog 헤더 패턴(`H3` + 우측 `iiiaha.lab` 크레딧 링크)은 메인 화면 상단 바에 그대로 적용. 윈도우 기본 크기 720×480, resizable.

## 보안/신뢰 모델

- **anonymous 다운로드** = 누구나 .rbz 받을 수 있다. 위협:
  - (a) 트래픽 어뷰즈: Vercel/Supabase Storage의 fair-use 한도 안에서 충분. 필요시 IP 기반 rate-limit 추후 추가.
  - (b) 무단 재배포: 익스텐션 본체의 license.rbe가 막는다. 다운로더 단계에서 막을 필요 없음.
- **미구매자가 .rbz 설치 시도**: 다운로더는 라이선스 보유 여부를 모르므로 모든 18개를 "Install" 가능 상태로 표시. 미구매자가 깔아도 SketchUp에서 켤 때 익스텐션의 라이선스 다이얼로그가 "Purchase required" 안내 → 사이트로 자연스러운 유입.
- **자가 업데이트 신뢰**: 매니페스트와 바이너리 모두 minisign으로 서명. 공개키는 앱 빌드에 임베드. 비밀키 유출 안 되는 한 위·변조 불가.
- **iiiaha_* 외 파일 보호**: 다운로더는 `iiiaha_*` prefix 매치되는 경로만 건드린다. 사용자가 깐 비-iiiaha 플러그인은 절대 영향 없음.

## 마일스톤 (현재 진행 = M0)

- M0a ✅ — `CLAUDE.md` / `ARCHITECTURE.md` 작성
- M0b ⬜ — Tauri 2 + Vite 부트스트랩, hello world
- M1a ⬜ — 사이트에 `GET /api/products` 추가
- M1b ⬜ — 사이트에 `GET /api/public/download/[slug]` 추가
- M2 ⬜ — `api.rs` 구현, 18개 항목 콘솔 dump
- M3 ⬜ — `sketchup.rs` Win 구현, 설치 감지
- M4 ⬜ — 라이브러리 UI 렌더, 상태 컬럼
- M5 ⬜ — `installer.rs` + `cache.rs` + `process.rs`, 1건 update 성공
- M6 ⬜ — 다중 SU 버전 일괄 적용, "Update all"
- M7 ⬜ — 설정 화면, 에러 처리, 캐시 비우기
- M8 ⬜ — 자가 업데이트 (Tauri Updater)
- M9 ⬜ — macOS 포팅
- M10 ⬜ — 사이트 `/downloader` 페이지, 릴리스 자동화 (GitHub Actions)

각 마일스톤 완료 시 `CLAUDE.md`의 체크리스트도 동시에 갱신.

## v0.1에 의도적으로 포함하지 않은 것

| 제외 항목 | 이유 |
|---|---|
| 코스 다운로드 / 오프라인 시청 | Cloudflare Stream 기반이라 다운로드 불가가 원칙 |
| i18n 인프라 | v0.1은 영어 고정. 인터페이스 텍스트가 적어 번역 부담도 거의 없음 |
| 결제/구매 흐름 | 사이트로 이동 (license 다이얼로그가 자연스럽게 유도) |
| Linux 빌드 | SketchUp이 Linux를 공식 지원하지 않음 |
| 텔레메트리 | 첫 출시 단계 단순화 |
| OS 코드 서명 | Win EV / Apple Developer ID 비용 + 자동화 부담. v0.2에 도입 |
| `last_downloaded_version` 추적 | anonymous 다운로드라 불가. 다운로더가 로컬에서 정확한 버전을 알므로 분석 가치 낮음 |

## 향후 (v0.2+)

- OS 코드 서명 도입 (SmartScreen 경고 제거, Mac Gatekeeper 정상 동작)
- macOS Apple Developer ID + 공증 자동화
- 다국어 지원 (한국어 우선)
- 텔레메트리 (사용자 동의 기반)
- 코스 메타데이터 표시 (다운로드는 여전히 불가, 시청 링크만)

## 결정사항이 바뀐다면

이 문서가 source of truth다. 결정 변경 시:
1. 이 문서(`ARCHITECTURE.md`)와 `CLAUDE.md`를 먼저 동시 수정.
2. 그 다음 코드 수정.

플랜 파일(`C:\Users\LEE\.claude\plans\noble-nibbling-brook.md`)은 초기 의사결정 기록일 뿐, 이후 변경의 source는 아니다.
