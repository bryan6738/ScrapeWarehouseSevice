import express from 'express';
import puppeteer from 'puppeteer-extra';
import { Browser } from 'puppeteer';
import StealthPlugin from 'puppeteer-extra-plugin-stealth';
import { scrapeCompanyData, initializeBrowser } from './scraper';

const app = express();
const PORT = process.env.PORT || 3000;

puppeteer.use(StealthPlugin());

let browser: Browser;

const startServer = async () => {
  browser = await initializeBrowser();
  app.listen(PORT, () => {
    console.log(`Server is running on port ${PORT}`);
  });
};

app.use(express.json());

app.get('/api/search', async (req, res) => {
    const { from } = req.query;
    if (!from) {
      return res.status(400).json({ error: 'Company name or number is required' });
    }
  
    try {
      const result = await scrapeCompanyData(from as string, browser);
      return res.json(result);
    } catch (error) {
      if (error instanceof Error) {
        return res.status(500).json({ error: error.message });
      }
      return res.status(500).json({ error: 'An unknown error occurred' });
    }
});

startServer();
