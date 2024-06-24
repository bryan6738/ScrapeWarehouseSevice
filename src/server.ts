import express from 'express';
import { scrapeCompanyData, initializeBrowser } from './scraper';

const app = express();
const PORT = process.env.PORT || 3000;

app.use(express.json());

const browserPromise = initializeBrowser();

app.get('/api/search', async (req, res) => {
  const { from } = req.query;
  if (!from) {
    return res.status(400).json({ error: 'Company name or number is required' });
  }

  try {
    const browser = await browserPromise;
    const result = await scrapeCompanyData(browser, from as string);
    return res.json(result);
  } catch (error) {
    if (error instanceof Error) {
      return res.status(500).json({ error: error.message });
    }
    return res.status(500).json({ error: 'An unknown error occurred' });
  }
});

app.listen(PORT, () => {
  console.log(`Server is running on port ${PORT}`);
});