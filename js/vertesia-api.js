class VertesiaAPI {
  constructor() {
    this.baseURL = CONFIG.VERTESIA_BASE_URL;
    this.apiKey = CONFIG.VERTESIA_API_KEY;
  }

  async call(endpoint, options = {}) {
    const url = `${this.baseURL}${endpoint}`;
    
    const defaultOptions = {
      method: 'GET',
      headers: {
        'Authorization': `Bearer ${this.apiKey}`,
        'Content-Type': 'application/json'
      }
    };

    const response = await fetch(url, { ...defaultOptions, ...options });
    
    if (!response.ok) {
      throw new Error(`API call failed: ${response.statusText}`);
    }

    return await response.json();
  }

  async generateDigest(portfolio) {
    const portfolioDocId = await this.uploadPortfolioAsDocument(portfolio);
    
    const prompt = `take the stocks and give me a "news in the last 7 days compilation." Main key topics relevant to my portfolio and holdings and position that are highly pertinent for investors that like to feel like they know what is going on or are individual involved with the companies they choose, to give the feeling of agency and responsibility in their investments, as though they're doing their due diligence by looking at the bullet points that come up around the holdings in their portfolio related to the current state of the market. Remember that exposure percentage is important to understanding human perspective and interests. You'll be scouring the web but producing bullet points rather than complete write ups. Make sure you use the same diligence for deep research but concise it into hyper focused points. Each generation document will need a catchy or clean title that clearly expresses the research but also captures human curiosity. No emoji, no exaggeration, no sensationalism, no lies. Holdings: ${portfolioDocId}`;

    const response = await this.call('/execute/async', {
      method: 'POST',
      body: JSON.stringify({
        type: 'conversation',
        interaction: CONFIG.INTERACTION_NAME,
        data: {
          Task: prompt
        },
        config: {
          environment: CONFIG.ENVIRONMENT_ID,
          model: CONFIG.MODEL
        }
      })
    });

    return response;
  }

  async uploadPortfolioAsDocument(portfolio) {
    const holdingsText = portfolio.holdings
      .sort((a, b) => b.exposure - a.exposure)
      .map(h => `${h.ticker} — ${h.quantity} — $${h.dollarValue.toLocaleString()}`)
      .join('\n');
    
    const portfolioContent = `Portfolio Holdings (Total: $${portfolio.totalValue.toLocaleString()})

${holdingsText}

Exposure Breakdown:
${portfolio.holdings
  .sort((a, b) => b.exposure - a.exposure)
  .map(h => `${h.ticker}: ${h.exposure.toFixed(1)}%`)
  .join('\n')}
`;

    const response = await this.call('/objects', {
      method: 'POST',
      body: JSON.stringify({
        name: `Portfolio_${Date.now()}`,
        description: 'Portfolio holdings for news digest generation',
        content: {
          source: portfolioContent,
          type: 'text/plain',
          name: `Portfolio_${Date.now()}.txt`
        },
        properties: {
          document_type: 'portfolio',
          total_value: portfolio.totalValue,
          holding_count: portfolio.holdings.length,
          created_at: new Date().toISOString()
        }
      })
    });

    return response.id;
  }

  async fetchRecentDocuments(limit = 10) {
    const response = await this.call(`/objects?limit=${limit}&offset=0`);
    const documents = response.objects || [];
    
    documents.sort((a, b) => {
      const dateA = new Date(a.created_at || 0);
      const dateB = new Date(b.created_at || 0);
      return dateB - dateA;
    });
    
    return documents.map(doc => ({
      id: doc.id,
      name: doc.name,
      createdAt: doc.created_at,
      contentSource: doc.content?.source
    }));
  }

  async getDocumentContent(documentId) {
    const doc = await this.call(`/objects/${documentId}`);
    
    if (doc.content && doc.content.source) {
      if (typeof doc.content.source === 'object' && doc.content.source.file) {
        return await this.downloadFileContent(doc.content.source.file);
      }
      return doc.content.source;
    }
    
    throw new Error('No content found in document');
  }

  async downloadFileContent(fileRef) {
    const downloadData = await this.getDownloadUrl(fileRef);
    const response = await fetch(downloadData.url);
    
    if (!response.ok) {
      throw new Error(`Failed to download file: ${response.statusText}`);
    }
    
    return await response.text();
  }

  async getDownloadUrl(fileSource) {
    return await this.call('/objects/download-url', {
      method: 'POST',
      body: JSON.stringify({ 
        file: fileSource,
        format: 'original'
      })
    });
  }
}

const vertesiaAPI = new VertesiaAPI();
