// background.js — PriceWatch Service Worker

const CHECK_INTERVAL_MINUTES = 60 * 24 * 7; // weekly (Chrome minimum is 1 min)

// Set up weekly alarm on install
chrome.runtime.onInstalled.addListener(() => {
  chrome.alarms.create("weeklyPriceCheck", {
    periodInMinutes: CHECK_INTERVAL_MINUTES,
    delayInMinutes: 1, // first check after 1 min so user can verify it works
  });
  console.log("[PriceWatch] Installed. Weekly price check scheduled.");
});

// Listen for the alarm
chrome.alarms.onAlarm.addListener((alarm) => {
  if (alarm.name === "weeklyPriceCheck") {
    checkAllPrices();
  }
});

// Listen for messages from popup or content script
chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  if (message.type === "GET_PAGE_PRICE") {
    // Content script detected a price on a page — return it
    sendResponse({ success: true });
  }

  if (message.type === "CHECK_NOW") {
    checkAllPrices().then(() => sendResponse({ success: true }));
    return true; // keep channel open for async
  }

  if (message.type === "ADD_PRODUCT") {
    addProduct(message.product).then((result) => sendResponse(result));
    return true;
  }

  if (message.type === "REMOVE_PRODUCT") {
    removeProduct(message.url).then(() => sendResponse({ success: true }));
    return true;
  }

  if (message.type === "GET_PRODUCTS") {
    getProducts().then((products) => sendResponse({ products }));
    return true;
  }
});

// ── Storage helpers ──────────────────────────────────────────────────────────

async function getProducts() {
  const data = await chrome.storage.local.get("products");
  return data.products || [];
}

async function saveProducts(products) {
  await chrome.storage.local.set({ products });
}

async function addProduct(product) {
  const products = await getProducts();
  const existing = products.find((p) => p.url === product.url);
  if (existing) {
    return { success: false, message: "Already tracking this product." };
  }
  products.push({
    url: product.url,
    name: product.name,
    currentPrice: product.price,
    originalPrice: product.price,
    lowestPrice: product.price,
    currency: product.currency || "$",
    addedAt: Date.now(),
    lastChecked: Date.now(),
    history: [{ price: product.price, timestamp: Date.now() }],
  });
  await saveProducts(products);
  return { success: true };
}

async function removeProduct(url) {
  const products = await getProducts();
  await saveProducts(products.filter((p) => p.url !== url));
}

// ── Price checking ───────────────────────────────────────────────────────────

async function checkAllPrices() {
  const products = await getProducts();
  if (products.length === 0) return;

  console.log(`[PriceWatch] Checking ${products.length} products...`);

  for (const product of products) {
    try {
      const newPrice = await fetchPrice(product.url, product.currentPrice);
      if (newPrice === null) continue;

      const oldPrice = product.currentPrice;
      product.lastChecked = Date.now();
      product.history.push({ price: newPrice, timestamp: Date.now() });

      if (newPrice < product.lowestPrice) {
        product.lowestPrice = newPrice;
      }

      if (newPrice < oldPrice) {
        const drop = (((oldPrice - newPrice) / oldPrice) * 100).toFixed(1);
        notifyPriceDrop(product, oldPrice, newPrice, drop);
      }

      product.currentPrice = newPrice;
    } catch (err) {
      console.warn(`[PriceWatch] Failed to check ${product.url}:`, err);
    }
  }

  await saveProducts(products);
}

async function fetchPrice(url, knownPrice = null) {
  try {
    const response = await fetch(url, {
      headers: {
        "User-Agent":
          "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36",
        Accept: "text/html,application/xhtml+xml",
        "Accept-Language": "en-US,en;q=0.9",
      },
    });
    const html = await response.text();
    return extractPriceFromHTML(html, url, knownPrice);
  } catch (e) {
    console.warn("[PriceWatch] Fetch error:", e);
    return null;
  }
}

function extractPriceFromHTML(html, url, knownPrice = null) {
  // Site-specific selectors (text patterns from raw HTML)
  const patterns = [
    // JSON-LD structured data (most reliable, used by many sites)
    /"price"\s*:\s*"?([\d,]+\.?\d*)"?/i,
    /"lowPrice"\s*:\s*"?([\d,]+\.?\d*)"?/i,
    /"highPrice"\s*:\s*"?([\d,]+\.?\d*)"?/i,
    // Open Graph price
    /property="og:price:amount"\s+content="([\d,]+\.?\d*)"/i,
    /content="([\d,]+\.?\d*)"\s+property="og:price:amount"/i,
    // Meta itemprop
    /itemprop="price"\s+content="([\d,]+\.?\d*)"/i,
    /content="([\d,]+\.?\d*)"\s+itemprop="price"/i,
    // Amazon-specific
    /id="priceblock_ourprice"[^>]*>\s*\$?([\d,]+\.?\d*)/i,
    /id="priceblock_dealprice"[^>]*>\s*\$?([\d,]+\.?\d*)/i,
    /"priceAmount"\s*:\s*([\d.]+)/i,
    // Common class patterns
    /class="[^"]*price[^"]*"[^>]*>\s*[^<$€£]*[$€£]?\s*([\d,]+\.?\d*)/i,
    // data-price attribute
    /data-price="([\d.]+)"/i,
    /data-saleprice="([\d.]+)"/i,
  ];

  const candidates = [];

  for (const pattern of patterns) {
    const match = html.match(pattern);
    if (match) {
      const raw = match[1].replace(/,/g, "");
      const price = parseFloat(raw);
      if (!isNaN(price) && price > 0 && price < 1_000_000) {
        candidates.push(price);
      }
    }
  }

  if (candidates.length === 0) return null;

  // If we have a known price, pick the candidate closest to it.
  // This guards against sites that return prices in cents (e.g. 9800 instead of 98.00)
  // or other outlier values scraped from unrelated parts of the page.
  if (knownPrice !== null && knownPrice > 0) {
    // Also consider the cents-divided version of each candidate
    const expanded = [];
    for (const c of candidates) {
      expanded.push(c);
      // If candidate looks like it might be in cents (integer, >50x known price),
      // add /100 version — but only if that result is actually close to knownPrice
      if (Number.isInteger(c) && c > knownPrice * 50) {
        const asCents = c / 100;
        if (asCents >= knownPrice * 0.5 && asCents <= knownPrice * 2) {
          expanded.push(asCents);
        }
      }
    }

    // Pick whichever is closest to the known price, but cap at 10x to
    // avoid accepting a totally wrong value if the page structure changed
    const reasonable = expanded.filter(
      (p) => p >= knownPrice * 0.05 && p <= knownPrice * 10
    );

    if (reasonable.length > 0) {
      return reasonable.reduce((best, p) =>
        Math.abs(p - knownPrice) < Math.abs(best - knownPrice) ? p : best
      );
    }

    // Nothing in a sane range — skip this check rather than save a bad price
    console.warn(
      `[PriceWatch] All candidates out of sane range vs known $${knownPrice}:`,
      expanded
    );
    return null;
  }

  // No known price yet (first-time fetch) — just return the first match
  return candidates[0];
}

// ── Notifications ────────────────────────────────────────────────────────────

function notifyPriceDrop(product, oldPrice, newPrice, dropPercent) {
  const currency = product.currency || "$";
  chrome.notifications.create(`drop-${Date.now()}`, {
    type: "basic",
    iconUrl: chrome.runtime.getURL("icons/icon128.png"),
    title: `📉 Price Drop: ${product.name}`,
    message: `${currency}${oldPrice.toFixed(2)} → ${currency}${newPrice.toFixed(2)} (${dropPercent}% off!)`,
    priority: 2,
    buttons: [{ title: "View Product" }],
  });
}

chrome.notifications.onButtonClicked.addListener(
  async (notificationId, buttonIndex) => {
    if (buttonIndex === 0) {
      // "View Product" — try to find URL from recent products
      const products = await getProducts();
      if (products.length > 0) {
        chrome.tabs.create({ url: products[0].url });
      }
    }
  }
);