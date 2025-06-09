"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
const express_1 = __importDefault(require("express"));
const puppeteer_1 = __importDefault(require("puppeteer"));
const fs_extra_1 = __importDefault(require("fs-extra"));
const path_1 = __importDefault(require("path"));
const dotenv_1 = __importDefault(require("dotenv"));
dotenv_1.default.config();
const app = (0, express_1.default)();
const PORT = 3000;
const BASE_URL = process.env.BASE_URL;
const LOGIN_URL = `${BASE_URL}/login`;
const LIST_PAGE = `${BASE_URL}/list`;
const SETTINGS_API = `${BASE_URL}/settings`;
async function closePasswordWarningModal(page) {
    try {
        await page.waitForSelector('div[role="dialog"] button', { timeout: 3000 });
        const modalText = await page.evaluate(() => {
            const dialog = document.querySelector('div[role="dialog"]');
            return dialog ? dialog.innerText : "";
        });
        if (modalText.includes("The password you just used was found in a data breach")) {
            console.log("⚠️ Detected password warning modal. Closing...");
            await page.click('div[role="dialog"] button');
            await page.waitForTimeout(1000);
        }
    }
    catch (e) {
        // Modal not found; ignoring
    }
}
async function loginIfNeeded(page) {
    await page.goto(LOGIN_URL, { waitUntil: "networkidle2" });
    const isLoggedIn = await page.evaluate(() => {
        return !!document.querySelector("nav .MuiAvatar-root");
    });
    if (isLoggedIn)
        return;
    await page.waitForSelector('input[name="username"]');
    await page.type('input[name="username"]', process.env.EMAIL || "");
    await page.type('input[name="password"]', process.env.PASSWORD || "");
    await page.click('button[type="submit"]');
    await page.waitForNavigation({ waitUntil: "networkidle2" });
}
async function scrapeUsersFromListPage(page) {
    await page.goto(LIST_PAGE, { waitUntil: "networkidle2" });
    await closePasswordWarningModal(page);
    const users = await page.evaluate(() => {
        const userCards = document.querySelectorAll("#userList > div");
        const data = [];
        userCards.forEach((card) => {
            const name = (card.querySelector("h3")?.textContent || "").trim();
            const email = (card.querySelector("p.text-gray-600")?.textContent || "").trim();
            const idText = (card.querySelector("p.text-sm")?.textContent || "").trim();
            const id = idText.replace("ID: ", "").trim();
            data.push({ name, email, id });
        });
        return data;
    });
    return users;
}
async function scrapeCurrentUserFromSettingsPage(page) {
    await page.goto(SETTINGS_API, { waitUntil: "networkidle2" });
    await closePasswordWarningModal(page);
    const currentUser = await page.evaluate(() => {
        const getValue = (labelText) => {
            const label = Array.from(document.querySelectorAll("label")).find((el) => el.textContent?.trim() === labelText);
            if (!label)
                return "";
            const input = label.nextElementSibling;
            return input?.value || "";
        };
        return {
            id: getValue("User ID"),
            firstName: getValue("First Name"),
            lastName: getValue("Last Name"),
            email: getValue("Email"),
        };
    });
    return currentUser;
}
app.get("/scrape-users", async (req, res) => {
    const browser = await puppeteer_1.default.launch({ headless: true });
    const page = await browser.newPage();
    try {
        await loginIfNeeded(page);
        const users = await scrapeUsersFromListPage(page);
        const currentUser = await scrapeCurrentUserFromSettingsPage(page);
        const result = { users, currentUser };
        const filePath = path_1.default.resolve(__dirname, "users.json");
        await fs_extra_1.default.writeJson(filePath, result, { spaces: 2 });
        res.json(result);
    }
    catch (error) {
        console.error("Error scraping:", error);
        res.status(500).json({ error: "Something went wrong" });
    }
    finally {
        await browser.close();
    }
});
app.listen(PORT, () => {
    console.log(`Server is running at http://localhost:${PORT}`);
});
