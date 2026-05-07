import { invoke } from "@tauri-apps/api/core";
import { getVersion } from "@tauri-apps/api/app";

const SITE_BASE = "https://iiiahalab.com";
const main = document.getElementById("main");

const STATE = {
  view: "library", // "library" | "settings"
  products: [],
  installs: [],
  loading: true,
  error: null,
  busySlugs: new Set(),
  appVersion: "0.1.0",
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
  if (!product.version) {
    showToast(`No version available for ${product.name}.`, "error");
    return;
  }

  STATE.busySlugs.add(product.slug);
  render();

  try {
    const running = await invoke("cmd_is_sketchup_running");
    if (running) {
      showToast(
        "SketchUp is running. Please close it and click again.",
        "error"
      );
      return;
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
  const active = activeInstalls();

  return el("div", { class: "toolbar" }, [
    el("span", { class: "label" }, [
      `${STATE.products.length} products · ${active.length} of ${STATE.installs.length} SketchUp install${STATE.installs.length === 1 ? "" : "s"} active`,
    ]),
    el("span", { class: "spacer" }),
    el(
      "button",
      { onclick: () => loadAll(), disabled: busy ? "" : null },
      ["Refresh"]
    ),
    el(
      "button",
      {
        class: "primary",
        disabled: updatableCount === 0 || busy ? "" : null,
        onclick: () => updateAll(),
      },
      [updatableCount > 0 ? `Update all (${updatableCount})` : "Update all"]
    ),
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
  ]);
}

function renderRow(row) {
  const { product, installedDisplay, status, latest } = row;
  const thumbUrl = product.thumbnail_url
    ? SITE_BASE + product.thumbnail_url
    : null;
  const busy = STATE.busySlugs.has(product.slug);

  let action;
  if (busy) {
    action = el("button", { disabled: "" }, ["Working…"]);
  } else if (status === "update-available" || status === "not-installed") {
    action = el(
      "button",
      { class: "primary", onclick: () => performInstall(product) },
      [status === "not-installed" ? "Install" : "Update"]
    );
  } else if (status === "unknown") {
    action = el("button", { onclick: () => performInstall(product) }, [
      "Reinstall",
    ]);
  } else if (status === "up-to-date") {
    action = el("span", { class: "status up-to-date" }, ["✓ OK"]);
  } else {
    action = el("span", { class: "label" }, ["—"]);
  }

  return el("div", { class: "lib-row", title: product.subtitle || "" }, [
    thumbUrl
      ? el("img", { class: "thumb", src: thumbUrl, alt: product.name })
      : el("div", { class: "thumb" }),
    el("div", {}, [
      el("div", { class: "name" }, [product.name]),
      product.subtitle
        ? el("div", { class: "label" }, [product.subtitle])
        : null,
    ]),
    el("div", { class: "ver" }, [installedDisplay]),
    el("div", { class: "ver" }, [latest || "—"]),
    el("div", {}, [action]),
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
    el("div", { class: "card" }, [
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
    el("div", { class: "card" }, [
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

function render() {
  main.innerHTML = "";

  if (STATE.error) {
    main.appendChild(
      el("div", { class: "card" }, [
        el("div", { class: "section-title" }, ["Error"]),
        el("div", {}, [STATE.error]),
        el("button", { onclick: () => loadAll() }, ["Retry"]),
      ])
    );
    return;
  }

  if (STATE.loading) {
    main.appendChild(
      el("div", { class: "card" }, [
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

  const list = el("div", { class: "lib-list" }, []);
  for (const product of STATE.products) {
    const row = computeRow(product, activeInstalls());
    list.appendChild(renderRow(row));
  }
  main.appendChild(list);
}

async function loadAll() {
  STATE.loading = true;
  STATE.error = null;
  render();

  try {
    const [products, installs, version] = await Promise.all([
      invoke("cmd_fetch_products"),
      invoke("cmd_scan_installations"),
      getVersion().catch(() => "0.1.0"),
    ]);
    STATE.products = products;
    STATE.installs = installs;
    STATE.appVersion = version;
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
    showSelfUpdateToast(info);
  } catch (err) {
    // 호출 자체가 실패해도 사용자 경험에 영향 없음. 콘솔에만 남김.
    console.warn("Self-update check failed:", err);
  }
}

function showSelfUpdateToast(info) {
  const existing = document.querySelector(".self-update-toast");
  if (existing) existing.remove();

  const toast = el(
    "div",
    { class: "toast self-update-toast", style: "border-color: var(--primary);" },
    [
      el("span", {}, [
        `Downloader v${info.version} available (you have v${info.current_version})`,
      ]),
      el(
        "button",
        {
          class: "primary",
          onclick: async () => {
            toast.remove();
            showToast("Updating downloader… app will restart.");
            try {
              await invoke("cmd_apply_update");
            } catch (err) {
              showToast("Self-update failed: " + err, "error");
            }
          },
        },
        ["Update now"]
      ),
      el("button", { onclick: () => toast.remove() }, ["Later"]),
    ]
  );

  document.body.appendChild(toast);
}

loadAll();
checkSelfUpdate();
