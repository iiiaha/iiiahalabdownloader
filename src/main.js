import { invoke } from "@tauri-apps/api/core";
import { getVersion } from "@tauri-apps/api/app";
import { getCurrentWindow, LogicalSize } from "@tauri-apps/api/window";
import { open as openExternal } from "@tauri-apps/plugin-shell";

const SITE_BASE = "https://iiiahalab.com";
const main = document.getElementById("main");

const STATE = {
  view: "library", // "library" | "settings"
  products: [],
  installs: [], // SketchUp 호스트별 설치 (Vec<SketchUpInstall>)
  autocad: { installed: {}, installed_unknown: [] }, // AutoCadInstall (단일)
  loading: true,
  error: null,
  busySlugs: new Set(),
  appVersion: "1.0.0",
  // disabled SU labels (e.g. "SketchUp 2024") — persisted in localStorage
  disabledSu: loadDisabledSu(),
};

function loadDisabledSu() {
  try {
    const raw = localStorage.getItem("disabledSu");
    if (!raw) return new Set();
    return new Set(JSON.parse(raw));
  } catch {
    return new Set();
  }
}

function saveDisabledSu() {
  localStorage.setItem(
    "disabledSu",
    JSON.stringify([...STATE.disabledSu])
  );
}

function activeInstalls() {
  return STATE.installs.filter((i) => !STATE.disabledSu.has(i.label));
}

function el(tag, props = {}, children = []) {
  const e = document.createElement(tag);
  for (const [k, v] of Object.entries(props)) {
    if (k === "class") e.className = v;
    else if (k === "html") e.innerHTML = v;
    else if (k.startsWith("on") && typeof v === "function") {
      e.addEventListener(k.slice(2).toLowerCase(), v);
    } else if (v !== undefined && v !== null) {
      e.setAttribute(k, v);
    }
  }
  for (const c of [].concat(children)) {
    if (c == null) continue;
    e.appendChild(typeof c === "string" ? document.createTextNode(c) : c);
  }
  return e;
}

function computeRow(product, installs) {
  if (product.platform === "autocad") {
    return computeRowAutoCad(product);
  }
  return computeRowSketchUp(product, installs);
}

function computeRowSketchUp(product, installs) {
  const slug = product.slug;
  const latest = product.version || null;

  const perSu = installs.map((su) => ({
    label: su.label,
    year: su.year,
    plugins_dir: su.plugins_dir,
    installed: su.installed[slug] || null,
    isUnknown: su.installed_unknown.includes(slug),
  }));

  const installedVersions = perSu.map((s) => s.installed).filter(Boolean);
  const hasUnknown = perSu.some((s) => s.isUnknown);

  let status;
  let installedDisplay;
  if (installs.length === 0) {
    status = "no-su";
    installedDisplay = "—";
  } else if (hasUnknown) {
    status = "unknown";
    installedDisplay = "?";
  } else if (installedVersions.length === 0) {
    status = "not-installed";
    installedDisplay = "—";
  } else {
    const distinct = [...new Set(installedVersions)];
    installedDisplay = distinct.length === 1 ? distinct[0] : "mixed";
    if (
      latest &&
      distinct.length === 1 &&
      distinct[0] === latest &&
      installedVersions.length === installs.length
    ) {
      status = "up-to-date";
    } else {
      status = "update-available";
    }
  }

  return { product, perSu, installedDisplay, status, latest };
}

function computeRowAutoCad(product) {
  const slug = product.slug;
  const latest = product.version || null;
  const installed = STATE.autocad.installed[slug] || null;
  const isUnknown = STATE.autocad.installed_unknown.includes(slug);

  let status;
  let installedDisplay;
  if (isUnknown) {
    status = "unknown";
    installedDisplay = "?";
  } else if (!installed) {
    status = "not-installed";
    installedDisplay = "—";
  } else if (latest && installed === latest) {
    status = "up-to-date";
    installedDisplay = installed;
  } else {
    status = "update-available";
    installedDisplay = installed;
  }

  return { product, perSu: [], installedDisplay, status, latest };
}

/**
 * Install 버튼 클릭 시 라이선스 안내 모달.
 * 다운로더는 anonymous 라 사용자 라이선스 보유 여부 모름 — 따라서 사전에 명시적 동의 받음.
 * 사용자가 라이선스 없는 상태에서 무심코 설치하고 동작 안 한다고 당황하는 일을 방지.
 */
function showInstallWarningModal(product) {
  return new Promise((resolve) => {
    const overlay = el("div", { class: "modal-overlay" }, []);

    const close = (proceed) => {
      overlay.remove();
      resolve(proceed);
    };

    const cancelBtn = el("button", { onclick: () => close(false) }, ["Cancel"]);
    const proceedBtn = el(
      "button",
      { class: "success", onclick: () => close(true) },
      ["I have a license"]
    );

    const box = el("div", { class: "modal-box" }, [
      el("div", { class: "modal-title" }, [`Install ${product.name}?`]),
      el("div", { class: "modal-body" }, [
        "This extension requires a paid license to run. Without a valid license you'll see a 'Purchase required' notice when you launch it.",
      ]),
      el("div", { class: "modal-actions" }, [cancelBtn, proceedBtn]),
    ]);

    overlay.appendChild(box);
    document.body.appendChild(overlay);
  });
}

/**
 * 가운데 모달 — SketchUp 실행 중일 때 안내. Retry 시 재확인하여
 * 닫혔으면 true 로 resolve, 사용자가 Cancel 하면 false 로 resolve.
 */
function showSketchUpRunningModal() {
  return new Promise((resolve) => {
    const overlay = el("div", { class: "modal-overlay" }, []);
    const hint = el("div", { class: "modal-hint" }, []);

    const close = (proceed) => {
      overlay.remove();
      resolve(proceed);
    };

    const cancelBtn = el("button", { onclick: () => close(false) }, ["Cancel"]);
    const retryBtn = el(
      "button",
      {
        class: "primary",
        onclick: async () => {
          retryBtn.setAttribute("disabled", "");
          retryBtn.textContent = "Checking…";
          const stillRunning = await invoke("cmd_is_sketchup_running").catch(
            () => true
          );
          if (!stillRunning) {
            close(true);
            return;
          }
          hint.textContent =
            "Still running — please make sure every SketchUp window is fully closed.";
          retryBtn.removeAttribute("disabled");
          retryBtn.textContent = "Retry";
        },
      },
      ["Retry"]
    );

    const box = el("div", { class: "modal-box" }, [
      el("div", { class: "modal-title" }, ["SketchUp is running"]),
      el("div", { class: "modal-body" }, [
        "Please close all SketchUp windows before installing or updating extensions, then click Retry.",
      ]),
      hint,
      el("div", { class: "modal-actions" }, [cancelBtn, retryBtn]),
    ]);

    overlay.appendChild(box);
    document.body.appendChild(overlay);
  });
}

function showToast(text, kind = "info") {
  const existing = document.querySelector(".toast");
  if (existing) existing.remove();
  const t = el("div", { class: "toast" }, [
    el("span", {}, [text]),
    el("button", { onclick: () => t.remove() }, ["×"]),
  ]);
  if (kind === "error") t.style.borderColor = "var(--danger)";
  if (kind === "success") t.style.borderColor = "var(--success)";
  document.body.appendChild(t);
  if (kind !== "error") setTimeout(() => t.remove(), 3500);
}

async function performInstall(product) {
  if (!product.version) {
    showToast(`No version available for ${product.name}.`, "error");
    return;
  }

  if (product.platform === "autocad") {
    return performInstallAutoCad(product);
  }
  return performInstallSketchUp(product);
}

async function performInstallSketchUp(product) {
  const installs = activeInstalls();
  const plugins_dirs = installs.map((s) => s.plugins_dir);
  if (plugins_dirs.length === 0) {
    showToast(
      STATE.installs.length === 0
        ? "No SketchUp installation detected on this machine."
        : "All SketchUp installs are disabled in Settings.",
      "error"
    );
    return;
  }

  STATE.busySlugs.add(product.slug);
  render();

  try {
    const running = await invoke("cmd_is_sketchup_running");
    if (running) {
      const proceed = await showSketchUpRunningModal();
      if (!proceed) return;
    }

    showToast(`Installing ${product.name} v${product.version}…`);
    await invoke("cmd_install_extension", {
      slug: product.slug,
      version: product.version,
      pluginsDirs: plugins_dirs,
    });

    STATE.installs = await invoke("cmd_scan_installations");
    showToast(
      `Installed ${product.name} v${product.version} on ${plugins_dirs.length} SketchUp install${plugins_dirs.length === 1 ? "" : "s"}.`,
      "success"
    );
  } catch (err) {
    showToast("Install failed: " + err, "error");
  } finally {
    STATE.busySlugs.delete(product.slug);
    render();
  }
}

async function performInstallAutoCad(product) {
  STATE.busySlugs.add(product.slug);
  render();
  try {
    showToast(
      `Launching ${product.name} v${product.version} installer…`,
      "info"
    );
    await invoke("cmd_install_autocad", {
      slug: product.slug,
      version: product.version,
    });

    // 마법사 종료 후 재스캔. CAD 슬러그가 있으니 다시 호출.
    const cadSlugs = STATE.products
      .filter((p) => p.platform === "autocad")
      .map((p) => p.slug);
    STATE.autocad = await invoke("cmd_scan_autocad", { slugs: cadSlugs });
    showToast(`${product.name} installer finished.`, "success");
  } catch (err) {
    showToast("Install failed: " + err, "error");
  } finally {
    STATE.busySlugs.delete(product.slug);
    render();
  }
}

async function updateAll() {
  const targets = STATE.products
    .map((p) => computeRow(p, activeInstalls()))
    .filter((r) => r.status === "update-available")
    .map((r) => r.product);

  for (const product of targets) {
    await performInstall(product);
  }
}

function renderToolbar() {
  const updatableCount = STATE.products
    .map((p) => computeRow(p, activeInstalls()))
    .filter((r) => r.status === "update-available").length;
  const busy = STATE.busySlugs.size > 0;

  return el("div", { class: "toolbar" }, [
    el("span", { class: "label" }, [
      `${STATE.products.length} products`,
    ]),
    el("span", { class: "spacer" }),
    el(
      "button",
      {
        onclick: () => {
          STATE.view = "settings";
          render();
        },
        disabled: busy ? "" : null,
      },
      ["Settings"]
    ),
    el(
      "button",
      {
        class: "danger",
        disabled: updatableCount === 0 || busy ? "" : null,
        onclick: () => updateAll(),
      },
      [updatableCount > 0 ? `Update all (${updatableCount})` : "Update all"]
    ),
  ]);
}

function renderRow(row) {
  const { product, installedDisplay, status, latest } = row;
  const busy = STATE.busySlugs.has(product.slug);

  // 모든 상태를 동일 크기 버튼으로. 상태별 라벨/색상/활성화만 다름.
  let action;
  if (busy) {
    action = el("button", { disabled: "" }, ["Working…"]);
  } else if (status === "update-available") {
    action = el(
      "button",
      { class: "primary", onclick: () => performInstall(product) },
      ["Update"]
    );
  } else if (status === "not-installed") {
    action = el(
      "button",
      {
        class: "success",
        onclick: async () => {
          const ok = await showInstallWarningModal(product);
          if (!ok) return;
          performInstall(product);
        },
      },
      ["Install"]
    );
  } else if (status === "unknown") {
    action = el(
      "button",
      { onclick: () => performInstall(product) },
      ["Reinstall"]
    );
  } else if (status === "up-to-date") {
    action = el("button", { class: "ok", disabled: "" }, ["OK"]);
  } else {
    // no-su (스케치업 자체가 없음)
    action = el("button", { disabled: "" }, ["—"]);
  }

  return el("div", { class: "lib-row", title: product.subtitle || product.name }, [
    el("div", { class: "name" }, [product.name]),
    el("div", { class: "ver" }, [installedDisplay]),
    el("div", { class: "ver" }, [latest || "—"]),
    el("div", { class: "action-cell" }, [action]),
  ]);
}

function renderSettings() {
  const back = el(
    "button",
    {
      onclick: () => {
        STATE.view = "library";
        render();
      },
    },
    ["← Back"]
  );

  const suToggles = STATE.installs.length
    ? STATE.installs.map((su) => {
        const enabled = !STATE.disabledSu.has(su.label);
        return el(
          "label",
          {
            style:
              "display: flex; align-items: center; gap: 6px; padding: 4px 0; cursor: pointer;",
          },
          [
            el("input", {
              type: "checkbox",
              ...(enabled ? { checked: "" } : {}),
              onchange: (e) => {
                if (e.target.checked) STATE.disabledSu.delete(su.label);
                else STATE.disabledSu.add(su.label);
                saveDisabledSu();
                render();
              },
            }),
            el("span", { class: "name" }, [su.label]),
            el("span", { class: "label" }, [
              `(${Object.keys(su.installed).length} iiiaha extension${Object.keys(su.installed).length === 1 ? "" : "s"} installed)`,
            ]),
          ]
        );
      })
    : [el("div", { class: "label" }, ["No SketchUp installations detected."])];

  return [
    el("div", { class: "toolbar" }, [
      back,
      el("span", { class: "spacer" }),
      el("span", { class: "label" }, ["Settings"]),
    ]),
    el("div", { class: "section" }, [
      el("div", { class: "section-title" }, ["SketchUp installations"]),
      el(
        "div",
        { class: "label", style: "margin-bottom: 4px;" },
        [
          "Uncheck a version to skip it during install/update. Disabled versions stay untouched.",
        ]
      ),
      ...suToggles,
    ]),
    el("div", { class: "section" }, [
      el("div", { class: "section-title" }, ["About"]),
      el("div", {}, [`iiiahalab downloader v${STATE.appVersion}`]),
      el("div", { class: "label", style: "margin-top: 4px;" }, [
        "by iiiaha.lab — ",
        el("a", { href: SITE_BASE, target: "_blank", rel: "noopener" }, [
          SITE_BASE.replace("https://", ""),
        ]),
      ]),
    ]),
  ];
}

/**
 * 콘텐츠 높이에 맞춰 윈도우를 리사이즈한다 (extension의 fitDialog 와 동일 컨셉).
 * § 8-1 패턴: body.scrollHeight + (outerHeight - innerHeight = chrome offset).
 * 호출자가 다음 페인트 직후 부르도록 requestAnimationFrame 으로 감싼다.
 */
let __fitTimer = null;
function scheduleFit() {
  clearTimeout(__fitTimer);
  __fitTimer = setTimeout(() => {
    requestAnimationFrame(fitWindow);
  }, 30);
}
async function fitWindow() {
  try {
    const chrome = window.outerHeight - window.innerHeight;
    const targetH = document.body.scrollHeight + chrome;
    const win = getCurrentWindow();
    await win.setSize(new LogicalSize(window.outerWidth, targetH));
  } catch (err) {
    console.warn("fitWindow failed:", err);
  }
}

function render() {
  renderInner();
  scheduleFit(); // 모든 render path 후 윈도우 자동 fit
}

function renderInner() {
  main.innerHTML = "";

  if (STATE.error) {
    main.appendChild(
      el("div", { class: "section" }, [
        el("div", { class: "section-title" }, ["Error"]),
        el("div", {}, [STATE.error]),
        el("button", { onclick: () => loadAll() }, ["Retry"]),
      ])
    );
    return;
  }

  if (STATE.loading) {
    main.appendChild(
      el("div", { class: "section" }, [
        el("div", { class: "section-title" }, ["Status"]),
        el("div", {}, [
          "Loading products and scanning SketchUp installations…",
        ]),
      ])
    );
    return;
  }

  if (STATE.view === "settings") {
    renderSettings().forEach((node) => main.appendChild(node));
    return;
  }

  main.appendChild(renderToolbar());

  // platform 으로 그룹핑. 알 수 없는 platform 은 sketchup 으로 간주.
  const sketchupProducts = STATE.products.filter(
    (p) => p.platform !== "autocad"
  );
  const autocadProducts = STATE.products.filter(
    (p) => p.platform === "autocad"
  );

  if (sketchupProducts.length > 0) {
    main.appendChild(
      renderPlatformList("SKETCHUP", sketchupProducts, "sketchup")
    );
  }
  if (autocadProducts.length > 0) {
    main.appendChild(
      renderPlatformList("AUTOCAD", autocadProducts, "autocad")
    );
  }
}

function renderPlatformList(title, products, platformClass) {
  const headRow = el(
    "div",
    { class: `lib-row lib-head platform-${platformClass}` },
    [
      el("div", { class: "head-name" }, [title]),
      el("div", { class: "head-ver" }, ["Installed"]),
      el("div", { class: "head-ver" }, ["Latest"]),
      el("div", { class: "head-action" }, ["Action"]),
    ]
  );

  const body = el("div", { class: "lib-body" }, []);
  for (const product of products) {
    const row = computeRow(product, activeInstalls());
    body.appendChild(renderRow(row));
  }

  return el("div", { class: "lib-list" }, [headRow, body]);
}

async function loadAll() {
  STATE.loading = true;
  STATE.error = null;
  render();

  try {
    const [products, installs, version] = await Promise.all([
      invoke("cmd_fetch_products"),
      invoke("cmd_scan_installations"),
      getVersion().catch(() => "1.0.0"),
    ]);
    STATE.products = products;
    STATE.installs = installs;
    STATE.appVersion = version;

    // AutoCAD 슬러그가 하나라도 있으면 별도 스캔
    const cadSlugs = STATE.products
      .filter((p) => p.platform === "autocad")
      .map((p) => p.slug);
    if (cadSlugs.length > 0) {
      try {
        STATE.autocad = await invoke("cmd_scan_autocad", { slugs: cadSlugs });
      } catch (err) {
        console.warn("AutoCAD scan failed:", err);
        STATE.autocad = { installed: {}, installed_unknown: [] };
      }
    } else {
      STATE.autocad = { installed: {}, installed_unknown: [] };
    }
  } catch (err) {
    STATE.error = String(err);
  } finally {
    STATE.loading = false;
    render();
  }
}

/// 앱 시작 후 비차단으로 자가 업데이트 가능 여부 체크. 있으면 토스트로 안내.
async function checkSelfUpdate() {
  try {
    const info = await invoke("cmd_check_update");
    if (!info) return; // 새 버전 없음 / 매니페스트 미배포 — silent
    showSelfUpdateModal(info);
  } catch (err) {
    // 호출 자체가 실패해도 사용자 경험에 영향 없음. 콘솔에만 남김.
    console.warn("Self-update check failed:", err);
  }
}

/**
 * 새 버전이 감지됐을 때 가운데 모달로 안내. 자동 교체는 하지 않고
 * 사이트에서 새 빌드 받도록 유도 (포터블 .exe 와 in-place 자가 교체의 충돌 회피).
 */
function showSelfUpdateModal(info) {
  if (document.querySelector(".self-update-overlay")) return; // dedup

  const overlay = el("div", { class: "modal-overlay self-update-overlay" }, []);
  const close = () => overlay.remove();

  const laterBtn = el("button", { onclick: () => close() }, ["Later"]);
  const visitBtn = el(
    "button",
    {
      class: "primary",
      onclick: async () => {
        try {
          await openExternal("https://iiiahalab.com/mypage");
        } catch (err) {
          console.warn("openExternal failed:", err);
        }
        close();
      },
    },
    ["Visit iiiahalab.com"]
  );

  const box = el("div", { class: "modal-box" }, [
    el("div", { class: "modal-title" }, [
      `Downloader v${info.version} available`,
    ]),
    el("div", { class: "modal-body" }, [
      `You're running v${info.current_version}. Please re-download the latest version from iiiahalab.com.`,
    ]),
    el("div", { class: "modal-actions" }, [laterBtn, visitBtn]),
  ]);

  overlay.appendChild(box);
  document.body.appendChild(overlay);
}

loadAll();
checkSelfUpdate();
