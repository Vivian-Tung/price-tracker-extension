// content.js — Runs on every page, extracts price info when popup requests it

chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  if (message.type === "EXTRACT_PRODUCT") {
    const product = extractProduct();
    sendResponse(product);
  }
});

function extractProduct() {
  const url = window.location.href;
  const name = extractName();
  const { price, currency } = extractPrice();

  return { url, name, price, currency };
}

function extractName() {
  // Try structured data first
  const jsonLd = document.querySelector('script[type="application/ld+json"]');
  if (jsonLd) {
    try {
      const data = JSON.parse(jsonLd.textContent);
      const items = Array.isArray(data) ? data : [data];
      for (const item of items) {
        if (item.name) return cleanText(item.name);
        if (item["@graph"]) {
          const product = item["@graph"].find(
            (n) => n["@type"] === "Product" || n["@type"] === "ItemPage"
          );
          if (product?.name) return cleanText(product.name);
        }
      }
    } catch (_) {}
  }

  // Open Graph
  const og = document.querySelector('meta[property="og:title"]');
  if (og?.content) return cleanText(og.content);

  // Common product heading patterns
  const selectors = [
    "[itemprop='name']",
    "h1.product-title",
    "h1.product_title",
    "h1.pdp-title",
    "#productTitle",
    ".product-name h1",
    ".pdp-product-name",
    "h1",
  ];

  for (const sel of selectors) {
    const el = document.querySelector(sel);
    if (el?.textContent?.trim()) return cleanText(el.textContent);
  }

  // Fallback to page title, strip common suffixes
  return document.title
    .replace(/\s*[-|–]\s*.+$/, "")
    .replace(/\s*(Buy|Shop|Order)\s+/i, "")
    .trim();
}

function extractPrice() {
  let currency = "$";

  // 1. JSON-LD
  const jsonLd = document.querySelector('script[type="application/ld+json"]');
  if (jsonLd) {
    try {
      const data = JSON.parse(jsonLd.textContent);
      const items = Array.isArray(data) ? data : [data];
      for (const item of items) {
        const offer =
          item.offers ||
          (item["@graph"] || []).find((n) => n["@type"] === "Offer");
        if (offer) {
          const price = parseFloat(
            (offer.price || offer.lowPrice || "").toString().replace(/,/g, "")
          );
          if (!isNaN(price) && price > 0) {
            if (offer.priceCurrency) currency = currencySymbol(offer.priceCurrency);
            return { price, currency };
          }
        }
      }
    } catch (_) {}
  }

  // 2. Meta tags
  const metaPrice = document.querySelector(
    'meta[property="og:price:amount"], meta[itemprop="price"]'
  );
  if (metaPrice?.content) {
    const price = parseFloat(metaPrice.content.replace(/,/g, ""));
    if (!isNaN(price) && price > 0) {
      const metaCurrency = document.querySelector(
        'meta[property="og:price:currency"]'
      );
      if (metaCurrency?.content) currency = currencySymbol(metaCurrency.content);
      return { price, currency };
    }
  }

  // 3. DOM selectors (ordered by specificity)
  const priceSelectors = [
    // Amazon
    "#priceblock_ourprice",
    "#priceblock_dealprice",
    ".a-price .a-offscreen",
    "#price_inside_buybox",
    // Best Buy
    ".priceView-customer-price span",
    // Walmart
    '[itemprop="price"]',
    // Target
    "[data-test='product-price']",
    // eBay
    ".x-price-primary span",
    // Generic
    ".sale-price",
    ".price--sale",
    ".product-price",
    ".price",
    "[class*='price']",
    "[id*='price']",
  ];

  for (const sel of priceSelectors) {
    const el = document.querySelector(sel);
    if (!el) continue;
    const text =
      el.getAttribute("content") || el.textContent || el.getAttribute("data-price") || "";
    const { price: p, currency: c } = parsePrice(text);
    if (p !== null) return { price: p, currency: c || currency };
  }

  return { price: null, currency };
}

function parsePrice(text) {
  if (!text) return { price: null, currency: "$" };
  const cleaned = text.trim();

  let currency = "$";
  if (cleaned.includes("€")) currency = "€";
  else if (cleaned.includes("£")) currency = "£";
  else if (cleaned.includes("¥")) currency = "¥";
  else if (cleaned.includes("CAD") || cleaned.includes("C$")) currency = "C$";

  const match = cleaned.match(/([\d,]+\.?\d*)/);
  if (match) {
    const price = parseFloat(match[1].replace(/,/g, ""));
    if (!isNaN(price) && price > 0 && price < 1_000_000) {
      return { price, currency };
    }
  }
  return { price: null, currency };
}

function currencySymbol(code) {
  const map = { USD: "$", EUR: "€", GBP: "£", JPY: "¥", CAD: "C$", AUD: "A$" };
  return map[code] || code;
}

function cleanText(str) {
  return str.replace(/\s+/g, " ").trim().slice(0, 100);
}
