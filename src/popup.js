// popup.js — PriceWatch UI Logic

let detectedProduct = null;

// ── Init ─────────────────────────────────────────────────────────────────────

document.addEventListener("DOMContentLoaded", async () => {
  await renderProductList();
  await detectCurrentPage();
  updateLastChecked();

  document.getElementById("trackBtn").addEventListener("click", handleTrack);
  document.getElementById("checkNowBtn").addEventListener("click", handleCheckNow);

  // Event delegation — one listener on the list handles all remove buttons,
  // even after innerHTML is replaced by re-renders
  document.getElementById("productList").addEventListener("click", async (e) => {
    const btn = e.target.closest(".btn-remove");
    if (!btn) return;
    const url = btn.dataset.url;
    await chrome.runtime.sendMessage({ type: "REMOVE_PRODUCT", url });
    await renderProductList();
    showStatus("Removed");
  });
});

// ── Page Detection ────────────────────────────────────────────────────────────

async function detectCurrentPage() {
  try {
    const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
    if (!tab?.id || !tab.url?.startsWith("http")) return;

    const results = await chrome.scripting.executeScript({
      target: { tabId: tab.id },
      files: ["content.js"],
    }).catch(() => null);

    const response = await chrome.tabs.sendMessage(tab.id, {
      type: "EXTRACT_PRODUCT",
    }).catch(() => null);

    if (response?.price) {
      detectedProduct = response;
      showDetected(response);
    } else {
      showNotDetected();
    }
  } catch (e) {
    showNotDetected();
  }
}

function showDetected(product) {
  const status = document.getElementById("detectStatus");
  const text = document.getElementById("detectText");
  const detectedEl = document.getElementById("detectedProduct");
  const nameEl = document.getElementById("detectedName");
  const priceEl = document.getElementById("detectedPrice");
  const trackBtn = document.getElementById("trackBtn");

  status.className = "detect-status found";
  text.textContent = "Product detected!";
  detectedEl.classList.remove("hidden");
  nameEl.textContent = product.name;
  priceEl.textContent = `${product.currency || "$"}${product.price.toFixed(2)}`;
  trackBtn.disabled = false;
}

function showNotDetected() {
  const status = document.getElementById("detectStatus");
  const text = document.getElementById("detectText");
  status.className = "detect-status not-found";
  text.textContent = "No price found on this page";
  document.getElementById("trackBtn").disabled = true;
}

// ── Track ─────────────────────────────────────────────────────────────────────

async function handleTrack() {
  if (!detectedProduct) return;

  const btn = document.getElementById("trackBtn");
  btn.textContent = "Adding…";
  btn.disabled = true;

  const result = await chrome.runtime.sendMessage({
    type: "ADD_PRODUCT",
    product: detectedProduct,
  });

  if (result.success) {
    showStatus("✓ Now tracking!");
    document.getElementById("detectedProduct").classList.add("hidden");
    document.getElementById("detectStatus").className = "detect-status idle";
    document.getElementById("detectText").textContent = "Visit a product page to track it";
    detectedProduct = null;
    await renderProductList();
  } else {
    showStatus(result.message || "Already tracked");
  }

  btn.textContent = "Track";
  btn.disabled = !detectedProduct;
}

// ── Check Now ─────────────────────────────────────────────────────────────────

async function handleCheckNow() {
  const btn = document.getElementById("checkNowBtn");
  btn.classList.add("spinning");
  showStatus("Checking…");

  await chrome.runtime.sendMessage({ type: "CHECK_NOW" });

  btn.classList.remove("spinning");
  showStatus("✓ Done!");
  await renderProductList();
  updateLastChecked();
}

// ── Product List ──────────────────────────────────────────────────────────────

async function renderProductList() {
  const { products } = await chrome.runtime.sendMessage({ type: "GET_PRODUCTS" });
  const list = document.getElementById("productList");

  if (!products || products.length === 0) {
    list.innerHTML = `
      <div class="empty-state">
        <div class="empty-icon">🛍</div>
        <div>No items tracked yet</div>
        <div class="empty-sub">Visit any product page and click Track</div>
      </div>`;
    return;
  }

  list.innerHTML = products
    .sort((a, b) => b.addedAt - a.addedAt)
    .map((p) => productCard(p))
    .join("");
}

function productCard(p) {
  const currency = p.currency || "$";
  const current = p.currentPrice;
  const original = p.originalPrice;
  const hasDrop = current < original;
  const dropPct = hasDrop
    ? (((original - current) / original) * 100).toFixed(0)
    : 0;
  const lastCheckedStr = timeAgo(p.lastChecked);

  const priceHtml = hasDrop
    ? `<span class="price-current">${currency}${current.toFixed(2)}</span>
       <span class="price-original">${currency}${original.toFixed(2)}</span>
       <span class="price-drop-badge">↓${dropPct}%</span>`
    : `<span class="price-current">${currency}${current.toFixed(2)}</span>
       <span class="price-no-drop">no change</span>`;

  return `
    <div class="product-card">
      <div class="product-card-info">
        <div class="product-card-name">
          <a href="${escHtml(p.url)}" target="_blank" title="${escHtml(p.name)}">${escHtml(truncate(p.name, 42))}</a>
        </div>
        <div class="product-card-prices">${priceHtml}</div>
        <div class="product-card-meta">checked ${lastCheckedStr}</div>
      </div>
      <div class="product-card-actions">
        <button class="btn-remove" data-url="${escHtml(p.url)}" title="Remove">✕</button>
      </div>
    </div>`;
}

// ── Helpers ───────────────────────────────────────────────────────────────────

function updateLastChecked() {
  const el = document.getElementById("lastChecked");
  el.textContent = "Checks run weekly · Next: " + nextWeek();
}

function nextWeek() {
  const d = new Date(Date.now() + 7 * 24 * 60 * 60 * 1000);
  return d.toLocaleDateString("en-US", { month: "short", day: "numeric" });
}

function timeAgo(ts) {
  if (!ts) return "never";
  const diff = Date.now() - ts;
  const mins = Math.floor(diff / 60000);
  if (mins < 1) return "just now";
  if (mins < 60) return `${mins}m ago`;
  const hrs = Math.floor(mins / 60);
  if (hrs < 24) return `${hrs}h ago`;
  return `${Math.floor(hrs / 24)}d ago`;
}

function showStatus(msg) {
  const el = document.getElementById("statusMsg");
  el.textContent = msg;
  el.classList.add("show");
  setTimeout(() => el.classList.remove("show"), 2500);
}

function escHtml(str) {
  return String(str)
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

function truncate(str, n) {
  return str.length > n ? str.slice(0, n - 1) + "…" : str;
}