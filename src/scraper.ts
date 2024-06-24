import puppeteer from 'puppeteer-extra';
import StealthPlugin from 'puppeteer-extra-plugin-stealth';
import { Page, Browser } from 'puppeteer';

puppeteer.use(StealthPlugin());
interface ScrapeResult {
    tableData?: object[];
    message?: string;
    screenshots?: string[];
}

async function initializeBrowser(): Promise<Browser> {
    const browser = await puppeteer.launch({
        headless: true,
        userDataDir: './tmp/user-data-dir',
        args: ['--start-maximized', '--no-sandbox'],
    });
    return browser;
}

const cache: Record<string, any> = {};

async function interceptRequests(page: Page) {
    await page.setRequestInterception(true);

    page.on('request', async (request) => {
        const url = request.url();
        if (cache[url] && cache[url].expires > Date.now()) {
            await request.respond(cache[url]);
            return;
        }
        request.continue();
    });

    page.on('response', async (response) => {
        const url = response.url();
        const headers = response.headers();
        const cacheControl = headers['cache-control'] || '';
        const maxAgeMatch = cacheControl.match(/max-age=(\d+)/);
        const maxAge = maxAgeMatch && maxAgeMatch.length > 1 ? parseInt(maxAgeMatch[1], 10) : 0;
        if (maxAge) {
            if (cache[url] && cache[url].expires > Date.now()) return;

            let buffer;
            try {
                buffer = await response.buffer();
            } catch (error) {
                return;
            }

            cache[url] = {
                status: response.status(),
                headers: response.headers(),
                body: buffer,
                expires: Date.now() + (maxAge * 1000),
            };
        }
    });
}

async function hoverAndClick(page: Page, hoverSelector: string, clickSelector: string) {
    await page.hover(hoverSelector);
    await new Promise(resolve => setTimeout(resolve, 1000));

    await page.evaluate((clickSelector: any) => {
        document.querySelector(clickSelector).click();
    }, clickSelector);

    await page.waitForSelector('.page-content');
    await new Promise(resolve => setTimeout(resolve, 500));
}


async function scrapeCompanyData(browser: Browser, companyNameOrNumber: string): Promise<ScrapeResult> {
    const context = await browser.createBrowserContext();
    const page = await context.newPage();

    await page.setViewport({
        width: 1920,
        height: 1000,
        deviceScaleFactor: 1,
    });

    await page.setUserAgent('Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/91.0.4472.124 Safari/537.36');

    try {
        await interceptRequests(page);
        await page.goto('https://datawarehouse.dbd.go.th/index', { waitUntil: 'networkidle2', timeout: 0 });
        await page.evaluate(() => {
            (document.querySelector('#btnWarning') as HTMLElement)?.click();
            (document.querySelector('.cwc-accept-button') as HTMLElement)?.click();
        });
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
            screenshots.push(summaryInfo);

            await hoverAndClick(page, '#menu2', 'a[href="#tab22"]');
            const statementPageElement = await page.$('.page-content');
            const statementInfo: string = await statementPageElement?.screenshot({ encoding: 'base64' }) || "";
            screenshots.push(statementInfo);

            await hoverAndClick(page, '#menu2', 'a[href="#tab23"]');
            const historyPageElement = await page.$('.page-content');
            const historyInfo: string = await historyPageElement?.screenshot({ encoding: 'base64' }) || "";
            screenshots.push(historyInfo);

            result = {
                screenshots
            };
        } else {
            const tableData: object[] = [];

            while (true) {
                const data = await page.$$eval('#fixTable tr:not(:first-child)', (rows: any) => {
                    return Array.from(rows, (row: any) => {
                        const cells = row.querySelectorAll('td');
                        const dataArray = Array.from(cells, (cell: any) => cell.innerText.trim());
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

                tableData.push(...data);

                const nextPageButton = await page.$('#next');
                const isNextPageButtonHidden = nextPageButton && await page.evaluate((button: any) => {
                    return button.classList.contains('hide');
                }, nextPageButton);

                if (!nextPageButton || isNextPageButtonHidden) {
                    break;
                }

                await Promise.all([
                    page.evaluate(() => {
                        (document.querySelector('#next') as HTMLElement)?.click();
                    }),
                    new Promise(resolve => setTimeout(resolve, 2000)),
                    page.waitForSelector('#fixTable tr td', { visible: true })
                ]);
            }

            result.tableData = tableData;
        }

        await context.close();
        return result;
    } catch (error) {
        console.error(error);
        await context.close();
        throw error;
    }
}

export { scrapeCompanyData, initializeBrowser };
