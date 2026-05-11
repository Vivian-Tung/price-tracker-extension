# PriceWatch - Chrome Extension

Track prices across any online store and get browser notifications when they drop.

---

## Installation
1. Download code as zip file
2. Open Chrome and go to `chrome://extensions`
3. Enable **Developer mode** (toggle in top-right corner)
4. Click **"Load unpacked"**
5. Select the `price-tracker-extension` folder
6. The ✿ PriceWatch icon will appear in your toolbar

---

## How to Track a Product

1. Navigate to any product page (Amazon, Best Buy, eBay, Walmart, etc.)
2. Click the PriceWatch extension icon
3. If a price is detected, you'll see it highlighted in green
4. Click **Track** - done!

https://github.com/user-attachments/assets/4b4e6eed-8f11-4a87-849f-0e169d62bcf5


---

## How Price Checking Works

- Prices are checked **once a week** automatically (via Chrome alarms)
- You can also click the **↻** button in the popup to check right now
- When a price **drops** below what you originally tracked, you'll get a Chrome browser notification instantly (make sure you allow notifcations from Chrome)
<img width="359" height="464" alt="Screenshot 2026-05-11 at 1 22 59 PM" src="https://github.com/user-attachments/assets/c722b51c-5814-4fbf-a564-9038ad3f927a" />

---

## Supported Sites

PriceWatch uses multiple extraction strategies that work across most shopping sites:

- **JSON-LD structured data** (used by most major retailers)
- **Open Graph meta tags**
- **Microdata / itemprop attributes**
- **Site-specific selectors** for Amazon, Best Buy, Walmart, Target, eBay

If a price isn't detected on a page, the extension will show "No price found on this page."
<img width="2934" height="1706" alt="image" src="https://github.com/user-attachments/assets/76559e4d-aa51-43a7-a9d6-0f0e8c71e395" />

---

## Managing Tracked Items

- Hover over any tracked item to reveal the **✕ remove** button
- Items show current price, original price, % drop, and when they were last checked
<img width="362" height="472" alt="image" src="https://github.com/user-attachments/assets/76598418-fc2a-4fd5-8a36-c3225637d5c6" />

---

## Notes

- Some sites (especially Amazon) may block background fetches due to bot protection. Prices are most reliably captured when you're actively visiting the page.
- The extension stores all data locally in your browser — no data is sent anywhere.
- Chrome requires a minimum alarm interval of 1 minute; the weekly check is set to 10,080 minutes (7 days).
- Please wait for the page to fully load before clicking track otherwise it might not be able to retrive the price.

## Find a bug or have a feature idea? 
- If you find a bug? Please go to the `Issues` tab, click on `New issue` and report the bug. Appreciate it!
- If you have a new feature idea, please go to the `Issues` tab, click on `New issue` and click `Blank issue` and put in your ideas! 
