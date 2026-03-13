import pw from "playwright";
import { PlaywrightExtra } from "playwright-extra";
import StealthPlugin from "puppeteer-extra-plugin-stealth";

const chromium = new PlaywrightExtra(pw.chromium);
chromium.use(StealthPlugin());

export { chromium };
export type { Page } from "playwright";
