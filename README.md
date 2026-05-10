# PriceWatch — Chrome Extension

Track prices across any online store and get browser notifications when they drop.

---

## Installation

1. Open Chrome and go to `chrome://extensions`
2. Enable **Developer mode** (toggle in top-right corner)
3. Click **"Load unpacked"**
4. Select the `price-tracker-extension` folder
5. The ◈ PriceWatch icon will appear in your toolbar

---

## How to Track a Product

1. Navigate to any product page (Amazon, Best Buy, eBay, Walmart, etc.)
2. Click the PriceWatch extension icon
3. If a price is detected, you'll see it highlighted in green
4. Click **Track** — done!

https://github.com/user-attachments/assets/d826ceb4-ebc2-40b0-82a9-47c40f905757


---

## How Price Checking Works

- Prices are checked **once a week** automatically (via Chrome alarms)
- You can also click the **↻** button in the popup to check right now
- When a price **drops** below what you originally tracked, you'll get a Chrome browser notification instantly

---

## Supported Sites

PriceWatch uses multiple extraction strategies that work across most shopping sites:

- **JSON-LD structured data** (used by most major retailers)
- **Open Graph meta tags**
- **Microdata / itemprop attributes**
- **Site-specific selectors** for Amazon, Best Buy, Walmart, Target, eBay

If a price isn't detected on a page, the extension will show "No price found on this page."

---

## Managing Tracked Items

- Hover over any tracked item to reveal the **✕ remove** button
- Items show current price, original price, % drop, and when they were last checked

---

## Notes

- Some sites (especially Amazon) may block background fetches due to bot protection. Prices are most reliably captured when you're actively visiting the page.
- The extension stores all data locally in your browser — no data is sent anywhere.
- Chrome requires a minimum alarm interval of 1 minute; the weekly check is set to 10,080 minutes (7 days).
