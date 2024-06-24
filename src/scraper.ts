import puppeteer from 'puppeteer-extra';
import { Page } from 'puppeteer';
import StealthPlugin from 'puppeteer-extra-plugin-stealth';
import fs from 'fs';
import path from 'path';

puppeteer.use(StealthPlugin());

interface ScrapeResult {
    tableData?: Object[];
    message?: string;
    screenshots?: string[];
}

interface Cache {
    [key: string]: {
        status: number;
        headers: Record<string, string>;
        body: string; // Buffer converted to a base64 string for JSON compatibility
    };
}

const cacheFilePath = path.resolve(__dirname, 'cache.json');
let cache: Cache = {};

function loadCache() {
    if (fs.existsSync(cacheFilePath)) {
        const cacheData = fs.readFileSync(cacheFilePath, 'utf-8');
        cache = JSON.parse(cacheData);
    }
}

function saveCache() {
    fs.writeFileSync(cacheFilePath, JSON.stringify(cache, null, 2));
}

loadCache();

async function hoverAndClick(page: Page, hoverSelector: string, clickSelector: string) {
    await new Promise(resolve => setTimeout(resolve, 1000));
    await page.hover(hoverSelector);
    await new Promise(resolve => setTimeout(resolve, 1000));
    await page.click(clickSelector);
    await page.waitForSelector('.page-content');
    await new Promise(resolve => setTimeout(resolve, 500));
}

async function waitForSelectorWithRetry(page: Page, selector: string, retries: number = 3, timeout: number = 30000) {
    for (let i = 0; i < retries; i++) {
        try {
            await page.waitForSelector(selector, { timeout });
            return;
        } catch (error) {
            if (i === retries - 1) throw error;
            await new Promise(resolve => setTimeout(resolve, 1000));
        }
    }
}

async function scrapeCompanyData(companyNameOrNumber: string): Promise<ScrapeResult> {
    const browser = await puppeteer.launch({
        headless: false,
        args: ['--start-maximized']
    });

    const context = await browser.createBrowserContext();
    const page = await context.newPage();

    await page.setViewport({
        width: 1920,
        height: 1000,
        deviceScaleFactor: 1,
    });

    await page.setUserAgent('Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/91.0.4472.124 Safari/537.36');

    await page.setRequestInterception(true);
    page.on('request', (request) => {
        const url = request.url();
        if (cache[url]) {
            request.respond({
                status: cache[url].status,
                headers: cache[url].headers,
                body: Buffer.from(cache[url].body, 'base64')
            });
        } else {
            request.continue();
        }
    });

    page.on('response', async (response) => {
        const request = response.request();
        const url = request.url();
        const resourceType = request.resourceType();
        if (['stylesheet', 'image', 'script'].includes(resourceType)) {
            const buffer = await response.buffer();
            cache[url] = {
                status: response.status(),
                headers: response.headers(),
                body: buffer.toString('base64')
            };
            saveCache();
        }
    });

    try {
        await page.goto('https://datawarehouse.dbd.go.th/index', { waitUntil: 'networkidle2' });
        await new Promise(resolve => setTimeout(resolve, 2000));
        await page.screenshot({path: 'warning.jpg'});
        await page.click('#btnWarning');
        await page.click('.cwc-accept-button');
        await page.waitForSelector('#key-word');
        await page.type('#key-word', companyNameOrNumber);
        await new Promise(resolve => setTimeout(resolve, 500));
        await page.keyboard.press('Enter');
        await page.waitForNavigation({ waitUntil: 'networkidle2' });
        const currentURL = page.url();
        let result: ScrapeResult = {};

        if (currentURL.includes('profile')) {
            const screenshots: string[] = [];
            await hoverAndClick(page, '#menu2', 'a[href="#tab21"]');
            const summaryPageElement = await page.$('.page-content');
            const summaryInfo: string = await summaryPageElement?.screenshot({ encoding: 'base64' }) || "";
            await page.evaluate(() => {
                window.scrollTo(0, 0);
            });
            summaryPageElement?.click();
            screenshots.push(summaryInfo);

            await hoverAndClick(page, '#menu2', 'a[href="#tab22"]');
            const statementPageElement = await page.$('.page-content');
            const statementInfo: string = await statementPageElement?.screenshot({ encoding: 'base64' }) || "";
            await page.evaluate(() => {
                window.scrollTo(0, 0);
            });
            statementPageElement?.click();
            screenshots.push(statementInfo);

            await hoverAndClick(page, '#menu2', 'a[href="#tab23"]');
            const historyPageElement = await page.$('.page-content');
            const historyInfo: string = await historyPageElement?.screenshot({ encoding: 'base64' }) || "";
            screenshots.push(historyInfo);

            result = {
                screenshots
            };
        } else {
            const tableData: Object[] = [];
            let foundData = false;

            while (true) {
                try {
                    await waitForSelectorWithRetry(page, '#fixTable tr td', 3, 60000);
                } catch (error) {
                    break;
                }

                const data = await page.$$eval('#fixTable tr:not(:first-child)', rows => {
                    return Array.from(rows, row => {
                        const cells = row.querySelectorAll('td');
                        const dataArray = Array.from(cells, cell => cell.innerText.trim());
                        const dataObject = {
                            ID: dataArray[1],
                            Number: dataArray[2],
                            Name: dataArray[3],
                            Type: dataArray[4],
                            Status: dataArray[5],
                            TSIC: dataArray[6],
                            Industry: dataArray[7],
                            Province: dataArray[8],
                            Capital: dataArray[9],
                            TotalRevenue: dataArray[10],
                            NetProfit: dataArray[11],
                            TotalAssets: dataArray[12],
                            ShareholderEquity: dataArray[13]
                        };
                        return dataObject;
                    });
                });

                if (data.length > 0) {
                    tableData.push(...data);
                    foundData = true;
                }

                const nextPageButton = await page.$('#next');
                const isNextPageButtonHidden = nextPageButton && await page.evaluate(button => {
                    return button.classList.contains('hide');
                }, nextPageButton);

                if (!nextPageButton || isNextPageButtonHidden) {
                    break;
                }

                await Promise.all([
                    nextPageButton.click(),
                    new Promise(resolve => setTimeout(resolve, 2000)),
                    waitForSelectorWithRetry(page, '#fixTable tr td', 3, 60000)
                ]);
            }

            if (!foundData) {
                result.message = "Not Found data";
            } else {
                result.tableData = tableData;
            }
        }

        await browser.close();
        return result;
    } catch (error) {
        console.log(error);
        await browser.close();
        throw error;
    }
}

export { scrapeCompanyData };
