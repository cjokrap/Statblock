// Browser flow for the app: sign in, search, log a food, re-log a recent,
// remove it. Run by run.sh. Screenshots go to the directory in argv[2].
import { chromium } from "playwright-core";
const BASE = process.env.E2E_BASE ?? "http://localhost:3457";
const out = process.argv[2];
const browser = await chromium.launch({ executablePath: process.env.CHROMIUM_PATH ?? "/opt/pw-browsers/chromium" });
const page = await browser.newPage({ viewport: { width: 390, height: 844 }, deviceScaleFactor: 2 });
const errors = [];
page.on("pageerror", (e) => errors.push(e.message));
const step = (m) => console.log("•", m);

await page.goto(BASE + "/");
step("redirected to " + new URL(page.url()).pathname);
await page.screenshot({ path: `${out}/1-login.png` });
await page.fill('input[name="email"]', "charles@example.com");
await page.fill('input[name="password"]', "wrong");
await page.click('button[type="submit"]');
await page.waitForSelector('p[role="alert"]');
step("wrong password -> " + (await page.textContent('p[role="alert"]')) + " | email kept: " + (await page.inputValue('input[name="email"]')));
await page.fill('input[name="password"]', "test-password");
await page.click('button[type="submit"]');
await page.waitForSelector("section[aria-label=Character]");
step("signed in, at " + new URL(page.url()).pathname);
step("sheet line: " + (await page.textContent("section[aria-label=Character] p")));
await page.screenshot({ path: `${out}/2-today.png`, fullPage: true });

await page.click("text=+ Add breakfast");
await page.fill("#food-search", "egg");
await page.click("button:has-text('Search')");
await page.waitForSelector("ul li a");
const names = await page.$$eval("ul li a span span:first-child", (els) => els.map((e) => e.textContent));
step("search 'egg': " + names.join(" | "));
await page.screenshot({ path: `${out}/3-search.png`, fullPage: true });

await page.click("ul li a >> nth=0");
await page.waitForSelector("#qty");
step("portions: " + (await page.$$eval("#unit option", (o) => o.map((x) => x.textContent)).then((a) => a.join(" | "))));
await page.fill("#qty", "3");
step("3 eggs preview kcal: " + (await page.textContent("dl div:first-child dd")) + ", button: " + (await page.textContent("button[type=submit]")));
await page.screenshot({ path: `${out}/4-amount.png`, fullPage: true });
await page.click("button[type=submit]");
await page.waitForSelector('[class*="itemName"]');
const items = await page.$$eval('[class*="itemName"]', (els) => els.map((e) => e.textContent));
step("food log now: " + items.join(" | "));
step("totals: " + (await page.textContent('[class*="totals"]')));
step("sheet after log: " + (await page.textContent("section[aria-label=Character]")).replace(/\s+/g, " ").slice(0, 120));
await page.screenshot({ path: `${out}/5-after-log.png`, fullPage: true });

// Quick re-add from recents, then remove it.
const chip = await page.$('button[class*="chip"]');
step("recent chip: " + (chip ? await chip.textContent() : "none"));
if (chip) {
  await chip.click();
  await page.waitForFunction(() => document.querySelectorAll('[class*="itemName"]').length === 2);
  step("after recent tap: " + (await page.$$eval('[class*="itemName"]', (e) => e.length)) + " items");
  await page.click('button[aria-label^="Remove"] >> nth=0');
  await page.waitForFunction(() => document.querySelectorAll('[class*="itemName"]').length === 1);
  step("after remove: 1 item");
}
// A packaged food from USDA FoodData Central (the fake one in fake_fdc.py):
// shown under "Packaged foods", saved on first log, then found locally.
await page.click("text=+ Add lunch");
await page.fill("#food-search", "chobani");
await page.click("button:has-text('Search')");
await page.waitForSelector("#packaged-heading");
const packagedNames = await page.$$eval("section[aria-labelledby=packaged-heading] li", (els) => els.map((e) => e.textContent));
step("packaged results: " + packagedNames.join(" | "));
await page.click("section[aria-labelledby=packaged-heading] li a >> nth=0");
await page.waitForSelector("#qty");
const yogurtOptions = await page.$$eval("#unit option", (o) => o.map((x) => x.textContent));
if (yogurtOptions[0] !== "1 container (150 g)") throw new Error("portion label: " + yogurtOptions[0]);
step("yogurt portions: " + (await page.$$eval("#unit option", (o) => o.map((x) => x.textContent)).then((a) => a.join(" | "))));
step("1 container: " + (await page.textContent("dl div:first-child dd")) + " kcal");
await page.click("button[type=submit]");
await page.waitForFunction(() => [...document.querySelectorAll('[class*="itemName"]')].some((e) => e.textContent.includes("Greek Yogurt")));
step("food log now: " + (await page.$$eval('[class*="itemName"]', (els) => els.map((e) => e.textContent))).join(" | "));
await page.goto(BASE + "/log?meal=lunch&q=chobani");
await page.waitForSelector("#packaged-heading");
const localHit = await page.$$eval("ul li a", (els) => els.map((e) => e.textContent).filter((t) => t.includes("Greek Yogurt")));
const packagedAfter = await page.$$eval("section[aria-labelledby=packaged-heading] li", (els) => els.length);
step(`search again: saved copy in main results (${localHit.length}), packaged duplicates: ${packagedAfter}`);
if (localHit.length !== 1 || packagedAfter !== 0) throw new Error("saved packaged food should replace the USDA result");

console.log("page errors:", errors.length ? errors : "none");
await browser.close();
if (errors.length) process.exit(1);
console.log("e2e flow passed");
