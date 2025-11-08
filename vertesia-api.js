// Vertesia API Wrapper for Portfolio Pulse
class VertesiaAPI {
  constructor() {
    this.baseURL = CONFIG.VERTESIA_API_BASE;
    this.apiKey = CONFIG.VERTESIA_API_KEY;
  }

  // Generic API call wrapper
  async call(endpoint, options = {}) {
    try {
      const url = `${this.baseURL}${endpoint}`;
      const response = await fetch(url, {
        headers: {
          'Authorization': `Bearer ${this.apiKey}`,
          'Content-Type': 'application/json',
          ...options.headers
        },
        ...options
      });

      if (!response.ok) {
        throw new Error(`API call failed: ${response.status} ${response.statusText}`);
      }

      const data = await response.json();
      return data;
    } catch (error) {
      console.error(`Vertesia API call failed for ${endpoint}:`, error);
      throw error;
    }
  }

  // Parse portfolio from uploaded file or text
  async parsePortfolio(fileOrText) {
    const prompt = `
Parse this portfolio statement and extract all holdings with their quantities.

For each holding, provide:
- ticker (stock symbol)
- quantity (number of shares)
- currentPrice (if available in the document)
- currentValue (if available)

Return as JSON array: [{ ticker, quantity, currentPrice, currentValue }, ...]

If you cannot extract price/value information, just provide ticker and quantity.

Statement data:
${typeof fileOrText === 'string' ? fileOrText : '[File content will be provided]'}
    `.trim();

    return await this.call('/execute/async', {
      method: 'POST',
      body: JSON.stringify({
        type: 'conversation',
        interaction: 'DocumentParser',  // Generic parser interaction
        data: {
          task: prompt
        },
        config: {
          environment: CONFIG.ENVIRONMENT_ID,
          model: CONFIG.MODEL
        }
      })
    });
  }

  // Generate portfolio news digest
  async generateDigest(portfolio) {
    const holdingsText = portfolio.holdings
      .sort((a, b) => b.exposure - a.exposure)  // Sort by exposure descending
      .map(h => `${h.ticker} (${h.exposure.toFixed(1)}% of portfolio, ${h.quantity} shares)`)
      .join('\n');
    
    const today = new Date();
    const timeLabel = this.getTimeLabel(today.getHours());
    
    const prompt = `
Generate a portfolio news digest for the following holdings:

${holdingsText}

Portfolio Total Value: $${portfolio.totalValue.toLocaleString()}

Research Parameters:
- Time window: Last ${CONFIG.NEWS.LOOKBACK_DAYS} days only (from ${today.toLocaleDateString()})
- Focus areas: Earnings, regulatory changes, product launches, M&A activity, analyst ratings, executive moves, material operational updates
- Tone: Professional, factual, investor-focused. No sensationalism, no emoji, no exaggeration
- Exposure weighting: Prioritize coverage depth based on portfolio exposure percentage (positions >${CONFIG.NEWS.MIN_EXPOSURE_FOR_PRIORITY}% deserve more detail)

For each ticker with relevant news in the last ${CONFIG.NEWS.LOOKBACK_DAYS} days:
1. Create one compelling headline (10-15 words, captures the key development)
2. Provide 2-4 concise bullet points with specific facts, dates, and numbers
3. Include source citations with article titles and URLs

Also provide:
- An overall digest title that captures the main themes across the portfolio (10-15 words, no date/time in title)
- Only include tickers that have material news in the ${CONFIG.NEWS.LOOKBACK_DAYS}-day window
- If a ticker has no material news, explicitly state "No significant developments"

Format your response as valid JSON with this structure:
{
  "digestTitle": "string",
  "items": [
    {
      "ticker": "string",
      "exposure": number,
      "headline": "string",
      "bullets": ["string", "string", ...],
      "sources": [
        { "title": "string", "url": "string" },
        ...
      ]
    },
    ...
  ]
}

Current time: ${today.toLocaleTimeString()} (${timeLabel})
Today's date: ${today.toLocaleDateString()}
    `.trim();

    console.log('Generating digest with prompt:', prompt);

    const response = await this.call('/execute/async', {
      method: 'POST',
      body: JSON.stringify({
        type: 'conversation',
        interaction: CONFIG.INTERACTION_NAME,
        data: {
          task: prompt
        },
        config: {
          environment: CONFIG.ENVIRONMENT_ID,
          model: CONFIG.MODEL
        }
      })
    });

    return response;
  }

  // Get time-of-day label
  getTimeLabel(hour) {
    if (hour >= 5 && hour < 12) return 'Morning';
    if (hour >= 12 && hour < 17) return 'Afternoon';
    if (hour >= 17 && hour < 21) return 'Evening';
    return 'Night';
  }

  // Poll for job completion
  async pollJobStatus(jobId, workflowId) {
    // For now, we'll use the same approach as the original app
    // Check for new documents in the object library
    // This is a simplified version - in production you'd poll the specific job
    
    return new Promise((resolve, reject) => {
      const checkInterval = setInterval(async () => {
        try {
          // In real implementation, check job status endpoint
          // For MVP, we'll assume success after delay
          clearInterval(checkInterval);
          resolve({ status: 'completed' });
        } catch (error) {
          clearInterval(checkInterval);
          reject(error);
        }
      }, 10000);  // Check every 10 seconds
    });
  }
}

// Create global instance
const vertesiaAPI = new VertesiaAPI();
