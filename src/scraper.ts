import puppeteer from 'puppeteer-extra';
import { Page, HTTPRequest, HTTPResponse, WaitForOptions } from 'puppeteer';
import StealthPlugin from 'puppeteer-extra-plugin-stealth';
import fs from 'fs';
import path from 'path';

puppeteer.use(StealthPlugin());

interface ScrapeResult {
    tableData?: Object[];
    message?: string;
    screenshots?: string[];
}

const CACHE_DIR = path.resolve(__dirname, 'cache');

if (!fs.existsSync(CACHE_DIR)) {
    fs.mkdirSync(CACHE_DIR);
}

const EXCLUDED_DOMAINS = ['google.com', 'botnoi.ai'];

async function setupRequestInterception(page: Page) {
    await page.setRequestInterception(true);

    page.on('request', (request: HTTPRequest) => {
        const url = new URL(request.url());
        const filePath = path.resolve(CACHE_DIR, url.pathname.replace(/\//g, '_'));

        if (
            ['image'].includes(request.resourceType()) || 
            url.pathname.includes('background') || 
            EXCLUDED_DOMAINS.some(domain => url.hostname.includes(domain))
        ) {
            request.abort();
        } else if (fs.existsSync(filePath)) {
            const buffer = fs.readFileSync(filePath);
            request.respond({
                status: 200,
                body: buffer
            });
        } else {
            request.continue();
        }
    });

    page.on('response', async (response: HTTPResponse) => {
        const url = new URL(response.url());
        const filePath = path.resolve(CACHE_DIR, url.pathname.replace(/\//g, '_'));

        if (
            !fs.existsSync(filePath) && 
            ['document', 'script'].includes(response.request().resourceType()) &&
            !EXCLUDED_DOMAINS.some(domain => url.hostname.includes(domain))
        ) {
            try {
                const buffer = await response.buffer();
                if (buffer && buffer.length) {
                    fs.writeFileSync(filePath, buffer);
                }
            } catch (error) {
                console.error(`Failed to save response for ${response.url()}:`, error);
            }
        }
    });
}

async function hoverAndClick(page: Page, hoverSelector: string, clickSelector: string) {
    await page.hover(hoverSelector);
    await page.click(clickSelector);
    await page.waitForSelector('.page-content');
}

async function scrapeCompanyData(companyNameOrNumber: string): Promise<ScrapeResult> {
    const browser = await puppeteer.launch({
        headless: false,
        args: ['--start-maximized']
    });

    const page = await browser.newPage();
    await setupRequestInterception(page);

    await page.setViewport({
        width: 1920,
        height: 1000,
        deviceScaleFactor: 1,
    });

    await page.setUserAgent('Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/91.0.4472.124 Safari/537.36');

    try {
        debugger
        await retryGoto(page, 'https://datawarehouse.dbd.go.th/index', 3);
        
        // Remove unnecessary elements to speed up loading
        await page.evaluate(() => {
            document.querySelectorAll('img, .chat, #background, #logo, .icon').forEach(el => el.remove());
        });

        await page.click('#btnWarning');
        await page.click('.cwc-accept-button');
        await page.waitForSelector('#key-word');
        await page.type('#key-word', companyNameOrNumber);
        await page.keyboard.press('Enter');
        await retryWaitForNavigation(page, { waitUntil: 'networkidle2', timeout: 60000 });

        const currentURL = page.url();
        let result: ScrapeResult = {};

        if (currentURL.includes('profile')) {
            const screenshots: string[] = [];
            await hoverAndClick(page, '#menu2', 'a[href="#tab21"]');
            screenshots.push(await takeScreenshot(page));

            await hoverAndClick(page, '#menu2', 'a[href="#tab22"]');
            screenshots.push(await takeScreenshot(page));

            await hoverAndClick(page, '#menu2', 'a[href="#tab23"]');
            screenshots.push(await takeScreenshot(page));

            result = { screenshots };
        } else {
            const tableData: Object[] = [];
            while (true) {
                const data = await page.$$eval('#fixTable tr:not(:first-child)', rows => {
                    return Array.from(rows, row => {
                        const cells = row.querySelectorAll('td');
                        const dataArray = Array.from(cells, cell => cell.innerText.trim());
                        return {
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
                    });
                });

                tableData.push(...data);

                const nextPageButton = await page.$('#next');
                const isNextPageButtonHidden = nextPageButton && await page.evaluate(button => {
                    return button.classList.contains('hide');
                }, nextPageButton);

                if (!nextPageButton || isNextPageButtonHidden) {
                    break;
                }

                await Promise.all([
                    nextPageButton.click(),
                    retryWaitForNavigation(page, { waitUntil: 'networkidle2', timeout: 60000 })
                ]);
            }

            result.tableData = tableData;
        }

        await browser.close();
        return result;
    } catch (error) {
        console.error(error);
        await browser.close();
        throw error;
    }
}

async function retryGoto(page: Page, url: string, retries: number): Promise<void> {
    for (let attempt = 1; attempt <= retries; attempt++) {
        try {
            await page.goto(url, { waitUntil: 'networkidle2', timeout: 60000 });
            return;
        } catch (error) {
            if (attempt === retries) {
                throw error;
            }
            if (error instanceof Error) {
                console.warn(`Attempt ${attempt} failed: ${error.message}. Retrying...`);
            } else {
                console.warn(`Attempt ${attempt} failed: ${String(error)}. Retrying...`);
            }
        }
    }
}

async function retryWaitForNavigation(page: Page, options: WaitForOptions): Promise<void> {
    for (let attempt = 1; attempt <= 3; attempt++) {
        try {
            await page.waitForNavigation(options);
            return;
        } catch (error) {
            if (attempt === 3) {
                throw error;
            }
            if (error instanceof Error) {
                console.warn(`Navigation attempt ${attempt} failed: ${error.message}. Retrying...`);
            } else {
                console.warn(`Navigation attempt ${attempt} failed: ${String(error)}. Retrying...`);
            }
        }
    }
}

async function takeScreenshot(page: Page): Promise<string> {
    const pageContent = await page.$('.page-content');
    return await pageContent?.screenshot({ encoding: 'base64' }) || "";
}

export { scrapeCompanyData };
