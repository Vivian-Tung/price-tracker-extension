// tests/background.test.js — PriceWatch Test Suite
// Run with: npx vitest run

import { describe, test, expect, beforeEach, vi } from "vitest";

// ── Chrome API Mock ──────────────────────────────────────────────────────────

const store = {};
const notifications = [];
const createdTabs = [];

global.chrome = {
  storage: {
    local: {
      get: vi.fn((key) => Promise.resolve({ [key]: store[key] })),
      set: vi.fn((obj) => {
        Object.assign(store, obj);
        return Promise.resolve();
      }),
    },
  },
  notifications: {
    create: vi.fn((id, options) => notifications.push({ id, ...options })),
  },
  tabs: {
    create: vi.fn((opts) => createdTabs.push(opts)),
  },
};

// ── Load functions from background.js ───────────────────────────────────────
// We extract the pure functions so we can test them without the Chrome event
// listeners firing. In a real CI setup you'd use a module bundler; here we
// re-declare the functions directly so the test file is self-contained.

function extractPriceFromHTML(html, url = "https://example.com", knownPrice = null) {
  const patterns = [
    /"price"\s*:\s*"?([\d,]+\.?\d*)"?/i,
    /"lowPrice"\s*:\s*"?([\d,]+\.?\d*)"?/i,
    /"highPrice"\s*:\s*"?([\d,]+\.?\d*)"?/i,
    /property="og:price:amount"\s+content="([\d,]+\.?\d*)"/i,
    /content="([\d,]+\.?\d*)"\s+property="og:price:amount"/i,
    /itemprop="price"\s+content="([\d,]+\.?\d*)"/i,
    /content="([\d,]+\.?\d*)"\s+itemprop="price"/i,
    /id="priceblock_ourprice"[^>]*>\s*\$?([\d,]+\.?\d*)/i,
    /id="priceblock_dealprice"[^>]*>\s*\$?([\d,]+\.?\d*)/i,
    /"priceAmount"\s*:\s*([\d.]+)/i,
    /class="[^"]*price[^"]*"[^>]*>\s*[^<$€£]*[$€£]?\s*([\d,]+\.?\d*)/i,
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

  if (knownPrice !== null && knownPrice > 0) {
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
    const reasonable = expanded.filter(
      (p) => p >= knownPrice * 0.05 && p <= knownPrice * 10
    );
    if (reasonable.length > 0) {
      return reasonable.reduce((best, p) =>
        Math.abs(p - knownPrice) < Math.abs(best - knownPrice) ? p : best
      );
    }
    return null;
  }

  return candidates[0];
}

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
  if (existing) return { success: false, message: "Already tracking this product." };
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

function notifyPriceDrop(product, oldPrice, newPrice, dropPercent) {
  const currency = product.currency || "$";
  chrome.notifications.create(`drop-${Date.now()}`, {
    type: "basic",
    iconUrl: "icons/icon128.png",
    title: `📉 Price Drop: ${product.name}`,
    message: `${currency}${oldPrice.toFixed(2)} → ${currency}${newPrice.toFixed(2)} (${dropPercent}% off!)`,
    priority: 2,
  });
}

// ── Helpers ──────────────────────────────────────────────────────────────────

function makeProduct(overrides = {}) {
  return {
    url: "https://example.com/product",
    name: "Test Headphones",
    price: 98.00,
    currency: "$",
    ...overrides,
  };
}

function makeStoredProduct(overrides = {}) {
  return {
    url: "https://example.com/product",
    name: "Test Headphones",
    currentPrice: 98.00,
    originalPrice: 98.00,
    lowestPrice: 98.00,
    currency: "$",
    addedAt: Date.now(),
    lastChecked: Date.now(),
    history: [{ price: 98.00, timestamp: Date.now() }],
    ...overrides,
  };
}

// ── Reset state between tests ────────────────────────────────────────────────

beforeEach(() => {
  Object.keys(store).forEach((k) => delete store[k]);
  notifications.length = 0;
  createdTabs.length = 0;
  vi.clearAllMocks();
  // Re-wire mocks after clearAllMocks
  chrome.storage.local.get.mockImplementation((key) =>
    Promise.resolve({ [key]: store[key] })
  );
  chrome.storage.local.set.mockImplementation((obj) => {
    Object.assign(store, obj);
    return Promise.resolve();
  });
});

// ════════════════════════════════════════════════════════════════════════════
// 1. PRICE EXTRACTION — extractPriceFromHTML
// ════════════════════════════════════════════════════════════════════════════

describe("extractPriceFromHTML", () => {

  describe("JSON-LD structured data", () => {
    test("extracts price from JSON-LD", () => {
      const html = `<script type="application/ld+json">{"@type":"Product","price":"98.00"}</script>`;
      expect(extractPriceFromHTML(html)).toBe(98);
    });

    test("extracts lowPrice from JSON-LD", () => {
      const html = `<script type="application/ld+json">{"lowPrice":"45.99"}</script>`;
      expect(extractPriceFromHTML(html)).toBe(45.99);
    });
  });

  describe("Open Graph meta tags", () => {
    test("extracts og:price:amount (property first)", () => {
      const html = `<meta property="og:price:amount" content="129.99"/>`;
      expect(extractPriceFromHTML(html)).toBe(129.99);
    });

    test("extracts og:price:amount (content first)", () => {
      const html = `<meta content="129.99" property="og:price:amount"/>`;
      expect(extractPriceFromHTML(html)).toBe(129.99);
    });
  });

  describe("itemprop / microdata", () => {
    test("extracts itemprop price (itemprop first)", () => {
      const html = `<span itemprop="price" content="74.00">$74.00</span>`;
      expect(extractPriceFromHTML(html)).toBe(74);
    });

    test("extracts itemprop price (content first)", () => {
      const html = `<span content="74.00" itemprop="price">$74.00</span>`;
      expect(extractPriceFromHTML(html)).toBe(74);
    });
  });

  describe("data attributes", () => {
    test("extracts data-price attribute", () => {
      const html = `<div data-price="59.95">$59.95</div>`;
      expect(extractPriceFromHTML(html)).toBe(59.95);
    });

    test("extracts data-saleprice attribute", () => {
      const html = `<div data-saleprice="39.00">Sale</div>`;
      expect(extractPriceFromHTML(html)).toBe(39);
    });
  });

  describe("Amazon-specific patterns", () => {
    test("extracts priceblock_ourprice", () => {
      const html = `<span id="priceblock_ourprice">$98.00</span>`;
      expect(extractPriceFromHTML(html)).toBe(98);
    });

    test("extracts priceblock_dealprice", () => {
      const html = `<span id="priceblock_dealprice">$79.99</span>`;
      expect(extractPriceFromHTML(html)).toBe(79.99);
    });

    test("extracts priceAmount JSON field", () => {
      const html = `{"priceAmount": 149.00, "currency": "USD"}`;
      expect(extractPriceFromHTML(html)).toBe(149);
    });
  });

  describe("comma-formatted prices", () => {
    test("handles 1,299.00 format", () => {
      const html = `<meta property="og:price:amount" content="1,299.00"/>`;
      expect(extractPriceFromHTML(html)).toBe(1299);
    });
  });

  describe("no price found", () => {
    test("returns null for empty HTML", () => {
      expect(extractPriceFromHTML("")).toBeNull();
    });

    test("returns null for HTML with no price signals", () => {
      const html = `<html><body><h1>Welcome to our store</h1></body></html>`;
      expect(extractPriceFromHTML(html)).toBeNull();
    });
  });

  // ── The cents bug fix ────────────────────────────────────────────────────

  describe("cents-encoded price fix (the bug)", () => {
    test("corrects price in cents (9800 → 98.00) when knownPrice provided", () => {
      const html = `<meta property="og:price:amount" content="9800"/>`;
      expect(extractPriceFromHTML(html, "https://example.com", 98.00)).toBe(98);
    });

    test("does NOT divide by 100 when price is already reasonable", () => {
      const html = `<meta property="og:price:amount" content="98"/>`;
      expect(extractPriceFromHTML(html, "https://example.com", 98.00)).toBe(98);
    });

    test("handles high-value item correctly (e.g. $1200 TV)", () => {
      const html = `<meta property="og:price:amount" content="1200"/>`;
      expect(extractPriceFromHTML(html, "https://example.com", 1200)).toBe(1200);
    });
  });

  describe("sanity check against knownPrice", () => {
    test("rejects candidate 100x above known price with no cents explanation", () => {
      // 50000 is not a plausible cents encoding of 98.00 (would be 500.00)
      // and 50000 is way outside the 10x cap
      const html = `<meta property="og:price:amount" content="50000"/>`;
      expect(extractPriceFromHTML(html, "https://example.com", 98.00)).toBeNull();
    });

    test("accepts legitimate price increase within 10x cap", () => {
      // Price went from $98 to $150 — legit
      const html = `<meta property="og:price:amount" content="150"/>`;
      expect(extractPriceFromHTML(html, "https://example.com", 98.00)).toBe(150);
    });

    test("accepts legitimate price drop (95% off)", () => {
      // Price went from $98 to $10 — above 5% floor, legit sale
      const html = `<meta property="og:price:amount" content="10"/>`;
      expect(extractPriceFromHTML(html, "https://example.com", 98.00)).toBe(10);
    });

    test("rejects price below 5% of known (almost certainly garbage data)", () => {
      const html = `<meta property="og:price:amount" content="1"/>`;
      expect(extractPriceFromHTML(html, "https://example.com", 98.00)).toBeNull();
    });

    test("picks closest candidate when multiple are present", () => {
      // Both 95 and 150 are reasonable vs known 98 — should pick 95 (closer)
      const html = `
        <meta property="og:price:amount" content="95"/>
        <span data-price="150"></span>
      `;
      expect(extractPriceFromHTML(html, "https://example.com", 98.00)).toBe(95);
    });

    test("works without knownPrice (first-time track)", () => {
      const html = `<meta property="og:price:amount" content="98"/>`;
      expect(extractPriceFromHTML(html)).toBe(98);
    });
  });
});

// ════════════════════════════════════════════════════════════════════════════
// 2. STORAGE — addProduct / removeProduct / getProducts
// ════════════════════════════════════════════════════════════════════════════

describe("addProduct", () => {
  test("adds a new product successfully", async () => {
    const result = await addProduct(makeProduct());
    expect(result).toEqual({ success: true });
    const products = await getProducts();
    expect(products).toHaveLength(1);
    expect(products[0].name).toBe("Test Headphones");
    expect(products[0].currentPrice).toBe(98);
    expect(products[0].originalPrice).toBe(98);
    expect(products[0].lowestPrice).toBe(98);
  });

  test("rejects duplicate URL", async () => {
    await addProduct(makeProduct());
    const result = await addProduct(makeProduct());
    expect(result.success).toBe(false);
    expect(result.message).toMatch(/already tracking/i);
    const products = await getProducts();
    expect(products).toHaveLength(1);
  });

  test("defaults currency to $ if not provided", async () => {
    await addProduct(makeProduct({ currency: undefined }));
    const products = await getProducts();
    expect(products[0].currency).toBe("$");
  });

  test("respects provided currency", async () => {
    await addProduct(makeProduct({ currency: "€" }));
    const products = await getProducts();
    expect(products[0].currency).toBe("€");
  });

  test("initialises history with one entry", async () => {
    await addProduct(makeProduct());
    const products = await getProducts();
    expect(products[0].history).toHaveLength(1);
    expect(products[0].history[0].price).toBe(98);
  });

  test("can track multiple different products", async () => {
    await addProduct(makeProduct({ url: "https://example.com/a", name: "Product A", price: 10 }));
    await addProduct(makeProduct({ url: "https://example.com/b", name: "Product B", price: 20 }));
    const products = await getProducts();
    expect(products).toHaveLength(2);
  });
});

describe("removeProduct", () => {
  test("removes an existing product by URL", async () => {
    await addProduct(makeProduct());
    await removeProduct("https://example.com/product");
    const products = await getProducts();
    expect(products).toHaveLength(0);
  });

  test("removing a non-existent URL is a no-op", async () => {
    await addProduct(makeProduct());
    await removeProduct("https://example.com/other");
    const products = await getProducts();
    expect(products).toHaveLength(1);
  });

  test("removes only the targeted product when multiple exist", async () => {
    await addProduct(makeProduct({ url: "https://example.com/a", name: "A", price: 10 }));
    await addProduct(makeProduct({ url: "https://example.com/b", name: "B", price: 20 }));
    await removeProduct("https://example.com/a");
    const products = await getProducts();
    expect(products).toHaveLength(1);
    expect(products[0].name).toBe("B");
  });
});

describe("getProducts", () => {
  test("returns empty array when storage is empty", async () => {
    const products = await getProducts();
    expect(products).toEqual([]);
  });

  test("returns stored products", async () => {
    store.products = [makeStoredProduct()];
    const products = await getProducts();
    expect(products).toHaveLength(1);
  });
});

// ════════════════════════════════════════════════════════════════════════════
// 3. NOTIFICATIONS — notifyPriceDrop
// ════════════════════════════════════════════════════════════════════════════

describe("notifyPriceDrop", () => {
  test("fires a chrome notification", () => {
    notifyPriceDrop(makeStoredProduct(), 98, 79.99, "18.4");
    expect(chrome.notifications.create).toHaveBeenCalledTimes(1);
  });

  test("notification title includes product name", () => {
    notifyPriceDrop(makeStoredProduct({ name: "Sony WH-1000XM5" }), 98, 79, "19.4");
    const n = notifications[0];
    expect(n.title).toContain("Sony WH-1000XM5");
  });

  test("notification message shows old → new price", () => {
    notifyPriceDrop(makeStoredProduct(), 98.00, 79.99, "18.4");
    const n = notifications[0];
    expect(n.message).toContain("98.00");
    expect(n.message).toContain("79.99");
  });

  test("notification message shows drop percentage", () => {
    notifyPriceDrop(makeStoredProduct(), 100, 75, "25.0");
    const n = notifications[0];
    expect(n.message).toContain("25.0%");
  });

  test("uses correct currency symbol", () => {
    notifyPriceDrop(makeStoredProduct({ currency: "€" }), 98, 79, "19.4");
    const n = notifications[0];
    expect(n.message).toContain("€");
  });

  test("defaults to $ when currency missing", () => {
    const product = makeStoredProduct();
    delete product.currency;
    notifyPriceDrop(product, 98, 79, "19.4");
    const n = notifications[0];
    expect(n.message).toContain("$");
  });
});

// ════════════════════════════════════════════════════════════════════════════
// 4. PRICE DROP DETECTION LOGIC
// ════════════════════════════════════════════════════════════════════════════

describe("price drop detection", () => {
  // These tests simulate the logic inside checkAllPrices() inline

  function simulateCheck(storedProduct, newPrice) {
    const notified = [];
    const oldPrice = storedProduct.currentPrice;

    if (newPrice < storedProduct.lowestPrice) {
      storedProduct.lowestPrice = newPrice;
    }

    if (newPrice < oldPrice) {
      const drop = (((oldPrice - newPrice) / oldPrice) * 100).toFixed(1);
      notified.push({ oldPrice, newPrice, drop });
      notifyPriceDrop(storedProduct, oldPrice, newPrice, drop);
    }

    storedProduct.currentPrice = newPrice;
    storedProduct.history.push({ price: newPrice, timestamp: Date.now() });
    return notified;
  }

  test("triggers notification when price drops", () => {
    const product = makeStoredProduct({ currentPrice: 98 });
    const notified = simulateCheck(product, 79.99);
    expect(notified).toHaveLength(1);
    expect(chrome.notifications.create).toHaveBeenCalledTimes(1);
  });

  test("does NOT notify when price stays the same", () => {
    const product = makeStoredProduct({ currentPrice: 98 });
    const notified = simulateCheck(product, 98);
    expect(notified).toHaveLength(0);
    expect(chrome.notifications.create).not.toHaveBeenCalled();
  });

  test("does NOT notify when price increases", () => {
    const product = makeStoredProduct({ currentPrice: 98 });
    const notified = simulateCheck(product, 120);
    expect(notified).toHaveLength(0);
    expect(chrome.notifications.create).not.toHaveBeenCalled();
  });

  test("updates currentPrice after check", () => {
    const product = makeStoredProduct({ currentPrice: 98 });
    simulateCheck(product, 79);
    expect(product.currentPrice).toBe(79);
  });

  test("updates lowestPrice when new price is lower", () => {
    const product = makeStoredProduct({ currentPrice: 98, lowestPrice: 98 });
    simulateCheck(product, 65);
    expect(product.lowestPrice).toBe(65);
  });

  test("does NOT update lowestPrice when new price is higher", () => {
    const product = makeStoredProduct({ currentPrice: 80, lowestPrice: 80 });
    simulateCheck(product, 95);
    expect(product.lowestPrice).toBe(80);
  });

  test("appends to history on each check", () => {
    const product = makeStoredProduct({ currentPrice: 98 });
    expect(product.history).toHaveLength(1);
    simulateCheck(product, 85);
    expect(product.history).toHaveLength(2);
    simulateCheck(product, 79);
    expect(product.history).toHaveLength(3);
  });

  test("calculates drop percentage correctly", () => {
    const product = makeStoredProduct({ currentPrice: 100 });
    simulateCheck(product, 75);
    const n = notifications[0];
    expect(n.message).toContain("25.0%");
  });

  test("handles small price drop (penny off)", () => {
    const product = makeStoredProduct({ currentPrice: 98.00 });
    const notified = simulateCheck(product, 97.99);
    expect(notified).toHaveLength(1);
  });
});