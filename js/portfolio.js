class PortfolioManager {
  constructor() {
    this.portfolio = null;
    this.loadPortfolio();
  }

  parseManualInput(text) {
    const lines = text.trim().split('\n').filter(line => line.trim());
    const holdings = [];
    
    for (const line of lines) {
      const parts = line.trim().split(/\s+/);
      if (parts.length >= 3) {
        const ticker = parts[0].toUpperCase();
        const quantity = parseFloat(parts[1]);
        const dollarValue = parseFloat(parts[2].replace(/[$,]/g, ''));
        
        if (ticker && !isNaN(quantity) && !isNaN(dollarValue) && quantity > 0 && dollarValue > 0) {
          holdings.push({
            ticker,
            quantity,
            dollarValue
          });
        }
      }
    }
    
    return holdings;
  }

  calculateExposures(holdings) {
    const totalValue = holdings.reduce((sum, h) => sum + h.dollarValue, 0);
    
    return holdings.map(h => ({
      ...h,
      exposure: totalValue > 0 ? (h.dollarValue / totalValue) * 100 : 0
    }));
  }

  async saveFromManualInput(text) {
    const parsedHoldings = this.parseManualInput(text);
    
    if (parsedHoldings.length === 0) {
      throw new Error('No valid holdings found. Use format: TICKER QUANTITY DOLLAR_VALUE');
    }

    const holdingsWithExposures = this.calculateExposures(parsedHoldings);
    const totalValue = holdingsWithExposures.reduce((sum, h) => sum + h.dollarValue, 0);
    
    this.portfolio = {
      holdings: holdingsWithExposures,
      totalValue,
      lastUpdated: new Date().toISOString(),
      inputMethod: 'manual'
    };
    
    this.savePortfolio();
    return this.portfolio;
  }

  savePortfolio() {
    localStorage.setItem('pulse_portfolio', JSON.stringify(this.portfolio));
  }

  loadPortfolio() {
    const stored = localStorage.getItem('pulse_portfolio');
    if (stored) {
      this.portfolio = JSON.parse(stored);
    }
  }

  hasPortfolio() {
    return this.portfolio !== null && this.portfolio.holdings && this.portfolio.holdings.length > 0;
  }

  getPortfolio() {
    return this.portfolio;
  }
}

const portfolioManager = new PortfolioManager();
