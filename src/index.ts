import express, { Request, Response } from "express";
import puppeteer, { Page } from "puppeteer";
import fs from "fs-extra";
import path from "path";
import dotenv from "dotenv";

dotenv.config();

const app = express();
const PORT = 3000;

const BASE_URL = process.env.BASE_URL;
const LOGIN_URL = `${BASE_URL}/login`;
const LIST_PAGE = `${BASE_URL}/list`;
const SETTINGS_API = `${BASE_URL}/settings`;
const delay = (ms: number) => new Promise((res) => setTimeout(res, ms));

async function closePasswordWarningModal(page: Page): Promise<void> {
  try {
    await page.waitForSelector('div[role="dialog"] button', { timeout: 3000 });

    const modalText = await page.evaluate(() => {
      const dialog = document.querySelector('div[role="dialog"]') as HTMLElement | null;
      return dialog ? dialog.innerText : "";
    });

    if (modalText.includes("The password you just used was found in a data breach")) {
      console.log("Detected password warning modal. Closing...");
      await page.click('div[role="dialog"] button');
      await delay(1000);
    }
  } catch (e) {
    // Modal not found
  }
}

async function loginIfNeeded(page: Page): Promise<void> {
  await page.goto(LOGIN_URL, { waitUntil: "networkidle2" });

  const isLoggedIn = await page.evaluate(() => {
    return !!document.querySelector("nav .MuiAvatar-root");
  });

  if (isLoggedIn) return;

  await page.waitForSelector('input[name="username"]');
  await page.type('input[name="username"]', process.env.EMAIL || "");
  await page.type('input[name="password"]', process.env.PASSWORD || "");
  await page.click('button[type="submit"]');

  await page.waitForNavigation({ waitUntil: "networkidle2" });
}

interface UserData {
  name: string;
  email: string;
  id: string;
}

async function scrapeUsersFromListPage(page: Page): Promise<UserData[]> {
  await page.goto(LIST_PAGE, { waitUntil: "networkidle2" });

  await closePasswordWarningModal(page);

  const users = await page.evaluate(() => {
    const userCards = document.querySelectorAll("#userList > div");
    const data: { name: string; email: string; id: string }[] = [];

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

interface CurrentUser {
  id: string;
  firstName: string;
  lastName: string;
  email: string;
}

async function scrapeCurrentUserFromSettingsPage(page: Page): Promise<CurrentUser> {
  await page.goto(SETTINGS_API, { waitUntil: "networkidle2" });

  await closePasswordWarningModal(page);

  const currentUser = await page.evaluate(() => {
    const getValue = (labelText: string): string => {
      const label = Array.from(document.querySelectorAll("label")).find(
        (el) => el.textContent?.trim() === labelText
      );
      if (!label) return "";
      const input = label.nextElementSibling as HTMLInputElement | null;
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

app.get("/scrape-users", async (req: Request, res: Response) => {
  const browser = await puppeteer.launch({ headless: true });
  const page = await browser.newPage();

  try {
    await loginIfNeeded(page);

    const users = await scrapeUsersFromListPage(page);
    const currentUser = await scrapeCurrentUserFromSettingsPage(page);
    const result = { users, currentUser };

    const filePath = path.resolve(__dirname, "users.json");
    await fs.writeJson(filePath, result, { spaces: 2 });

    res.json(result);
  } catch (error) {
    console.error("Error scraping:", error);
    res.status(500).json({ error: "Something went wrong" });
  } finally {
    await browser.close();
  }
});

app.listen(PORT, () => {
  console.log(`Server is running at http://localhost:${PORT}`);
});
