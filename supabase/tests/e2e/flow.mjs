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

// Add food opens on favorites and the last 7 days: one tap re-adds the
// eggs, and the page stays put to add more. Then remove the second entry.
await page.click("text=+ Add food");
await page.waitForSelector("#recent-heading");
if (await page.$("a:has-text('Recent · 7 days')")) throw new Error("Recent is no longer a separate tab");
const firstRecent = await page.$$eval("#recent-heading + ul [class*=resultName]", (els) => els.map((e) => e.textContent));
step("add food opens on recent: " + firstRecent.join(" | "));
if (!firstRecent.length) throw new Error("the eggs should be in Recent");
await page.click("#recent-heading + ul button[aria-label^='Add'] >> nth=0");
await page.waitForSelector("p[role=status]:has-text('Added')");
step("re-added: " + (await page.textContent("p[role=status]")));
await page.goto(BASE + "/");
await page.waitForFunction(() => document.querySelectorAll('[class*="itemName"]').length === 2);
if (await page.$('button[class*="chip"]')) throw new Error("Today no longer has recent chips");
await page.click('button[aria-label^="Remove"] >> nth=0');
await page.waitForFunction(() => document.querySelectorAll('[class*="itemName"]').length === 1);
step("after remove: 1 item");
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

// Ranking: products with every word, brand included, come first. Paging:
// more than a page of matches gets a "More packaged foods" link.
await page.goto(BASE + "/log?meal=lunch&q=" + encodeURIComponent("Fairlife Chocolate Protein Shake"));
await page.waitForSelector("#packaged-heading");
const shakes = await page.$$eval("section[aria-labelledby=packaged-heading] li", (els) => els.map((e) => e.textContent));
step(`fairlife search: ${shakes.length} result(s), first: ${shakes[0]}`);
if (!/fa[i!]rlife/i.test(shakes[0] ?? "")) throw new Error("a Fairlife shake should come first");
// Core Power's details record is unusable; the page falls back to its search entry.
await page.click("section[aria-labelledby=packaged-heading] li a:has-text('Milk Shake')");
await page.waitForSelector("#qty");
const cpOptions = await page.$$eval("#unit option", (o) => o.map((x) => x.textContent));
step("core power portions: " + cpOptions.join(" | ") + ", " + (await page.textContent("dl div:first-child dd")) + " kcal");
if (cpOptions[0] !== "1 bottle (414 g)") throw new Error("portion label: " + cpOptions[0]);
await page.click("button[type=submit]");
await page.waitForFunction(() => [...document.querySelectorAll('[class*="itemName"]')].some((e) => e.textContent.includes("Milk Shake")));
step("core power logged");
await page.goto(BASE + "/log?meal=lunch&q=" + encodeURIComponent("chocolate protein shake"));
await page.waitForSelector("#packaged-heading");
const page1 = await page.$$eval("section[aria-labelledby=packaged-heading] li", (els) => els.length);
await page.click("text=More packaged foods");
await page.waitForFunction(() => document.querySelector("#packaged-heading")?.textContent.includes("page 2"));
const page2 = await page.$$eval("section[aria-labelledby=packaged-heading] li", (els) => els.length);
step(`paging: ${page1} on page 1, ${page2} on page 2`);
// 32 matches; Core Power, logged above, shows as a saved food instead.
if (page1 !== 24 || page2 !== 7) throw new Error("expected 24 + 7 packaged results");
if (!(await page.$("text=Previous"))) throw new Error("page 2 should link back");
// First-run setup: the banner on Today, suggested targets, saving them.
await page.goto(BASE + "/");
await page.click("text=Set your targets");
await page.waitForSelector("#height_ft");
await page.fill("#height_ft", "5");
await page.fill("#height_in", "10");
await page.fill("#weight", "220");
await page.fill("#goal_weight", "185");
await page.fill("#birth_date", "1981-01-15");
await page.click("[aria-label=Sex] button:has-text('Male')");
await page.click("[aria-label='Planned rest days'] button[aria-label=Wednesday]");
await page.click("[aria-label='Planned rest days'] button[aria-label=Sunday]");
const kcalShown = await page.textContent("section[aria-labelledby=suggest-heading] span[class*=kcalValue]");
const macrosShown = await page.$$eval("section[aria-labelledby=suggest-heading] dd", (els) => els.map((e) => e.textContent));
step(`setup suggestion: ${kcalShown} kcal, ${macrosShown.join(" / ")}`);
if (kcalShown !== "2,430" || macrosShown.join("|") !== "148 g|277 g|81 g|100 oz") throw new Error("the mockup's example should suggest 2,430 kcal, 148/277/81 g, 100 oz");
if (!(await page.textContent("section[aria-labelledby=suggest-heading] [role=note]")).includes("not medical advice")) throw new Error("setup needs the disclaimer");
await page.screenshot({ path: `${out}/9-setup.png`, fullPage: true });
await page.click("button:has-text('Use these targets')");
await page.waitForSelector("section[aria-label=Character]");
if (await page.$("text=Set your targets")) throw new Error("the setup banner should be gone once targets are saved");
step("targets saved, banner gone");

// Settings: shows what setup saved; edit to Charles's own numbers.
await page.click("a:has-text('Settings')");
await page.waitForSelector("#calorie_target");
const shown = await Promise.all(["#calorie_target", "#protein_g", "#carbs_g", "#fat_g", "#water"].map((s) => page.inputValue(s)));
const restShown = await page.$$eval("[aria-label='Planned rest days'] button[aria-pressed=true]", (b) => b.map((x) => x.getAttribute("aria-label")));
step(`settings: ${shown.join(" / ")}, rest ${restShown.join(" + ")}`);
if (shown.join("|") !== "2430|148|277|81|100" || restShown.join() !== "Wednesday,Sunday") throw new Error("settings should show the saved targets");
await page.fill("#calorie_target", "2000");
await page.fill("#protein_g", "180");
await page.fill("#carbs_g", "170");
await page.fill("#fat_g", "67");
const styleNow = await page.textContent("[aria-label='Eating style'] button[aria-pressed=true]");
const sumLine = await page.textContent("span[class*=good], span[class*=warn]");
step(`edited macros: style now ${styleNow}; ${sumLine}`);
if (styleNow !== "Custom" || !sumLine.includes("matches")) throw new Error("editing macros should switch to Custom and match 2,000 kcal");
if (!(await page.textContent("[role=note]")).includes("not medical advice")) throw new Error("settings needs the disclaimer");
await page.screenshot({ path: `${out}/10-settings.png`, fullPage: true });
await page.fill("#fiber_g", "35");
await page.click("button:has-text('Save changes')");
await page.waitForSelector("p[role=status]");
step("settings: " + (await page.textContent("p[role=status]")) + " calories now " + (await page.inputValue("#calorie_target")));
if ((await page.inputValue("#calorie_target")) !== "2000") throw new Error("saved calories should be 2000");

// The web app manifest loads without a session (phones fetch it that way).
const manifest = await (await fetch(BASE + "/manifest.webmanifest")).json();
step(`manifest: ${manifest.name}, ${manifest.display}, ${manifest.icons.length} icons`);
if (manifest.display !== "standalone") throw new Error("manifest should open full screen");
// Settings: add a supplement to the daily stack.
await page.goto(BASE + "/settings");
await page.fill("#stack-name", "Multivitamin");
await page.fill("#stack-serving", "1 tablet");
await page.click("button:has-text('+ Add to stack')");
await page.waitForSelector("button[aria-label='Remove Multivitamin']");
await page.fill("#stack-name", "Fiber supplement");
await page.fill("#stack-serving", "1 scoop");
await page.fill("#stack-fiber", "6");
await page.click("button:has-text('+ Add to stack')");
await page.waitForSelector("button[aria-label='Remove Fiber supplement']");
step("stack: Multivitamin and Fiber supplement (6 g fiber) added");

// The dashboard.
await page.goto(BASE + "/");
await page.waitForSelector("#hp-heading");
const hpText = await page.textContent("section[aria-labelledby=hp-heading]");
step("hit points: " + hpText.replace(/\s+/g, " ").slice(0, 120));
const questNames = await page.$$eval("section[aria-labelledby=quests-heading] li", (els) => els.map((e) => e.textContent));
step("quests: " + questNames.length + ", boss: " + (await page.textContent("[class*=bossName]")));
if (!questNames.some((q) => q.includes("Take the daily stack") && q.includes("(open)"))) throw new Error("stack quest should be open");
if (!questNames.some((q) => q.includes("Hit fiber"))) throw new Error("the fiber quest should show");

await page.click("button:has-text('Take stack')");
await page.waitForSelector("text=Taken at");
await page.waitForFunction(() => [...document.querySelectorAll("section[aria-labelledby=quests-heading] li")].some((e) => e.textContent.includes("Take the daily stack") && e.textContent.includes("(done)")));
step("stack taken, quest done");
const fiberRow = await page.$$eval("section[aria-labelledby=hp-heading] [class*=macro]", (els) =>
  els.map((e) => e.textContent).find((t) => t.startsWith("Fiber")) ?? "");
step("fiber: " + fiberRow);
if (!/^Fiber\d+ \/ 35 g/.test(fiberRow) || !fiberRow.includes("+ 6 g from supplements")) throw new Error("fiber should count the stack against a 35 g goal");

const waterValue = () => page.textContent("section[aria-labelledby=water-heading] [class*=bigValue]");
await page.click("button:has-text('+16 oz')");
await page.waitForFunction(() => document.querySelector("section[aria-labelledby=water-heading] [class*=bigValue]")?.textContent === "16");
await page.click("button:has-text('+32 oz')");
await page.waitForFunction(() => document.querySelector("section[aria-labelledby=water-heading] [class*=bigValue]")?.textContent === "48");
await page.click("button[aria-label='Undo the last water']");
await page.waitForFunction(() => document.querySelector("section[aria-labelledby=water-heading] [class*=bigValue]")?.textContent === "16");
step("water: +16, +32, undo -> " + (await waterValue()) + " oz");

const training = (await page.textContent("section[aria-labelledby=training-heading]")).replace(/\s+/g, " ");
step("training: " + training.slice(0, 160));
if (!training.includes("Squat · T1 · 4×3 @ 275 lb") || !training.includes("New estimated 1RM: Squat 302 lb")) throw new Error("training card should show today's squats and the PR");
if (!training.includes("Leg Press · T2 · 2×10 @ 220 lb")) throw new Error("training card should show leg press");

await page.click("section[aria-labelledby=quick-heading] button:has-text('Date night')");
await page.waitForSelector("section[aria-labelledby=quick-heading] button[aria-label^='Date night, logged']");
await page.click("summary:has-text('Weigh-in')");
await page.fill("#weigh-weight", "219");
await page.click("button:has-text('Log weight')");
await page.waitForSelector("summary:has-text('Today: 219 lb')").catch(async (e) => {
  await page.screenshot({ path: `${out}/11-weigh-fail.png`, fullPage: true });
  console.log("summary now:", await page.textContent("summary"), "errors:", errors);
  throw e;
});
step("quick log: date night logged, weigh-in 219 lb");
await page.screenshot({ path: `${out}/11-dashboard.png`, fullPage: true });

// Liftosaur: a rejected key, then a good one, then disconnect.
await page.goto(BASE + "/settings");
await page.click("a:has-text('Connect')");
await page.waitForSelector("#api_key");
await page.fill("#api_key", "not-a-key");
await page.click("button:has-text('Check and connect')");
await page.waitForSelector("p[role=alert]:has-text('lftsk_')");
await page.fill("#api_key", "lftsk_wrong123");
await page.click("button:has-text('Check and connect')");
await page.waitForSelector("p[role=alert]:has-text('accept that key')");
step("liftosaur: bad format and rejected key both refused");
await page.fill("#api_key", "lftsk_good123");
await page.click("button:has-text('Check and connect')");
await page.waitForSelector("p[role=status]:has-text('Connected')");
const liftStatus = (await page.textContent("section[aria-labelledby=status-heading]")).replace(/\s+/g, " ");
step("liftosaur: " + liftStatus);
if (!liftStatus.includes("Connected") || !liftStatus.includes("Workouts imported11")) throw new Error("should be connected with 11 workouts");
await page.screenshot({ path: `${out}/12-liftosaur.png`, fullPage: true });
await page.goto(BASE + "/settings");
const liftRow = await page.textContent("section[aria-labelledby=liftosaur-heading]");
if (!liftRow.includes("Connected · 11 workouts")) throw new Error("settings should show the connection: " + liftRow);
await page.click("a:has-text('Manage')");
await page.click("button:has-text('Disconnect Liftosaur')");
await page.waitForSelector("p[role=status]:has-text('Disconnected')");
step("liftosaur: disconnected -> " + (await page.textContent("section[aria-labelledby=status-heading] [class*=hint]")));

// Barcodes: typed in on the scan page (no camera in headless Chromium).
await page.goto(BASE + "/log?meal=snack");
await page.click("a:has-text('Scan a barcode')");
await page.waitForSelector("#barcode");
await page.fill("#barcode", "99999999");
await page.click("button:has-text('Look up')");
await page.waitForSelector("p[role=alert]:has-text('Open Food Facts doesn')");
step("unknown barcode: not found message");
await page.goto(BASE + "/log/scan?meal=snack");
await page.fill("#barcode", "850000000123"); // UPC-A form of the OFF product's EAN-13
await page.click("button:has-text('Look up')");
await page.waitForSelector("#qty");
const barName = await page.textContent("h1");
const barOptions = await page.$$eval("#unit option", (o) => o.map((x) => x.textContent));
step(`scanned: ${barName} · ${barOptions[0]} · ${await page.textContent("dl div:first-child dd")} kcal`);
if (barOptions[0] !== "1 bar (55 g)" || !(await page.textContent("main")).includes("Open Food Facts")) throw new Error("OFF product page");
await page.click("button[type=submit]");
await page.waitForFunction(() => [...document.querySelectorAll('[class*="itemName"]')].some((e) => e.textContent.includes("Protein Bar")));
step("bar logged to snacks");
// Scanning it again opens the saved food; so does a USDA product's barcode.
await page.goto(BASE + "/log/barcode/0850000000123?meal=snack");
await page.waitForURL(/\/log\/food\/\d+/);
step("rescan -> saved food: " + (await page.textContent("main p")));
await page.goto(BASE + "/log/barcode/818290014108?meal=snack");
await page.waitForURL(/\/log\/food\/\d+/);
step("Chobani barcode -> saved USDA food: " + (await page.textContent("h1")));

// Editing a logged food: 3 eggs become 2, moved to snacks; then remove
// the protein bar from its edit page.
await page.goto(BASE + "/");
await page.click("a[aria-label^='Edit Eggs']");
await page.waitForSelector("#qty");
const editStart = [await page.inputValue("#qty"), await page.$eval("#unit", (s) => s.selectedOptions[0].textContent), await page.inputValue("#meal")];
step("edit opens with: " + editStart.join(" · "));
if (editStart.slice(0, 2).join("|") !== "3|1 large (50 g)") throw new Error("edit should start from the logged amount");
// The eggs went to the meal that fits the time the test runs; move them to snacks.
if (editStart[2] === "snack") throw new Error("eggs shouldn't start in snacks");
await page.fill("#qty", "2");
await page.selectOption("#meal", "snack");
await page.click("button:has-text('Save changes')");
await page.waitForSelector("section[aria-label=Character]");
const snackText = await page.$$eval("h3", (hs) => hs.find((h) => h.textContent === "Snack")?.parentElement?.parentElement?.textContent ?? "");
step("snacks now: " + snackText.replace(/\s+/g, " ").slice(0, 140));
if (!snackText.includes("Eggs") || !snackText.includes("2 × 1 large")) throw new Error("the eggs should be 2 in snacks");
await page.click("a[aria-label*='Protein Bar']");
await page.click("button:has-text('Remove this entry')");
await page.waitForSelector("section[aria-label=Character]");
if (await page.$("a[aria-label*='Protein Bar']")) throw new Error("the bar should be removed");
step("bar removed from its edit page");

// Favorites: star a recent food with its amount, then add it in one tap.
await page.goto(BASE + "/log?meal=dinner");
await page.waitForSelector("#favorites-heading");
await page.click("#recent-heading + ul button[aria-label^='Save Greek Yogurt']");
await page.waitForSelector("#favorites-heading + ul button[aria-label^='Add Greek Yogurt']");
const favNames = await page.$$eval("#favorites-heading + ul [class*=resultName]", (els) => els.map((e) => e.textContent));
step("favorites: " + favNames.join(" | "));
await page.click("#favorites-heading + ul button[aria-label^='Add Greek Yogurt']");
await page.waitForSelector("p[role=status]:has-text('Added Greek Yogurt')");
step("favorite add: " + (await page.textContent("p[role=status]")));
await page.screenshot({ path: `${out}/13-favorites-recent.png`, fullPage: true });
if (!page.url().includes("/log?meal=dinner")) throw new Error("adding a favorite should stay on Add food");
// Searching swaps the lists for results.
await page.fill("#food-search", "egg");
await page.click("button:has-text('Search')");
await page.waitForSelector("text=Favorites and recent foods");
if (await page.$("#favorites-heading")) throw new Error("search results replace favorites");
// Un-star from the food page.
await page.goto(BASE + "/log?meal=dinner");
await page.click("#favorites-heading + ul a >> nth=0");
await page.click("button:has-text('★ Favorite')");
await page.waitForSelector("button:has-text('☆ Save as a favorite')");
step("un-starred from the food page");

// Recipes: ingredients, cooked weight and servings; log a serving by
// weight; the recipe comes first in search; editing it later leaves the
// logged serving alone.
await page.goto(BASE + "/recipes");
await page.fill("input[name=name]", "Parko High Protein Pasta");
await page.click("button:has-text('Create and add ingredients')");
await page.waitForSelector("text=Add ingredients to see the totals.");
const recipeUrl = page.url();
await page.click("text=+ Add ingredient");
await page.fill("#ingredient-search", "egg");
await page.click("button:has-text('Search')");
await page.click("ul li a >> nth=0");
await page.selectOption("#unit", "g");
await page.fill("#qty", "200");
await page.click("button:has-text('Add to recipe')");
await page.waitForSelector("text=Log a serving");
await page.click("text=+ Add ingredient");
await page.click("#recent-heading + ul a:has-text('Greek Yogurt')");
await page.selectOption("#unit", "g");
await page.fill("#qty", "300");
await page.click("button:has-text('Add to recipe')");
await page.waitForSelector("text=Ingredients · 500 g");
await page.fill("input[name=cooked_grams]", "400");
await page.fill("input[name=servings]", "2");
await page.click("button:has-text('Save details')");
await page.waitForSelector("p[role=status]:has-text('Saved')");
const totalsText = (await page.textContent("[aria-label='Recipe totals']")).replace(/\s+/g, " ");
step("recipe totals: " + totalsText);
if (!totalsText.includes("Whole · 400 g") || !totalsText.includes("Serving · 200 g")) throw new Error("recipe totals");
await page.screenshot({ path: `${out}/15-recipe.png`, fullPage: true });
await page.click("text=Log a serving");
await page.waitForSelector("#qty");
const recipeOptions = await page.$$eval("#unit option", (o) => o.map((x) => x.textContent));
step("recipe portions: " + recipeOptions.join(" | "));
if (recipeOptions[0] !== "1 serving (200 g)") throw new Error("a serving should be half the cooked weight");
const servingKcal = await page.textContent("dl div:first-child dd");
await page.click("button[type=submit]");
await page.waitForSelector("a[aria-label*='Parko High Protein Pasta']");
step(`logged a serving: ${servingKcal} kcal`);
await page.goto(BASE + "/log?meal=dinner&q=" + encodeURIComponent("Parko High Protein Pasta"));
await page.waitForSelector("ul li a");
const firstHit = (await page.textContent("ul li a >> nth=0")).replace(/\s+/g, " ");
step("search first result: " + firstHit);
if (!firstHit.includes("Parko High Protein Pasta") || !firstHit.includes("Recipe")) throw new Error("the recipe should come first");
await page.goto(recipeUrl);
await page.fill("input[name=grams] >> nth=0", "400");
await page.click("button:has-text('Update') >> nth=0");
await page.waitForSelector("text=Ingredients · 700 g");
await page.goto(BASE + "/");
const pastaRow = await page.textContent("a[aria-label*='Parko High Protein Pasta'] + span");
step(`logged serving after the recipe changed: ${pastaRow} kcal`);
if (pastaRow !== servingKcal) throw new Error("editing the recipe must not change what was logged");
await page.goto(recipeUrl);
await page.click("text=Delete recipe");
await page.click("button:has-text('Delete')");
await page.waitForURL(/\/recipes$/);
await page.goto(BASE + "/log?meal=dinner&q=" + encodeURIComponent("Parko High Protein Pasta"));
await page.waitForSelector("#packaged-heading");
if ((await page.$$eval("ul [class*=badge]", (b) => b.map((x) => x.textContent))).includes("Recipe")) throw new Error("a deleted recipe leaves search");
step("recipe deleted, gone from search");

// Ability scores show progress to the next point (rules v2).
await page.goto(BASE + "/");
const scoreCard = (await page.textContent("section[aria-labelledby=scores-heading]")).replace(/\s+/g, " ");
await (await page.$("section[aria-labelledby=scores-heading]")).screenshot({ path: `${out}/14-scores.png` });
step("scores: " + scoreCard.slice(0, 160));
if (!/good days? to 11/.test(scoreCard)) throw new Error("scores should show good days to the next point");

console.log("page errors:", errors.length ? errors : "none");
await browser.close();
if (errors.length) process.exit(1);
console.log("e2e flow passed");
