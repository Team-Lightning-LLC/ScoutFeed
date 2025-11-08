// Portfolio Management System
class PortfolioManager {
  constructor() {
    this.portfolio = null;
    this.loadPortfolio();
  }

  // Parse manual text input (TICKER QUANTITY format)
  parseManualInput(text) {
    const lines = text.trim().split('\n').filter(line => line.trim());
    const holdings = [];
    
    for (const line of lines) {
      const parts = line.trim().split(/\s+/);
      if (parts.length >= 2) {
        const ticker = parts[0].toUpperCase();
        const quantity = parseFloat(parts[1]);
        
        if (ticker && !isNaN(quantity) && quantity > 0) {
          holdings.push({
            ticker,
            quantity,
            currentPrice: null,  // Will be populated by price lookup if available
            currentValue: null
          });
        }
      }
    }
    
    return holdings;
  }

  // Fetch current prices for holdings (mock for now)
  async fetchCurrentPrices(holdings) {
    // In production, this would call a real-time price API
    // For MVP, we'll use mock prices or skip this step
    
    // Mock prices for testing (you can replace with real API later)
    const mockPrices = {
      'NVDA': 188.32,
      'IONQ': 82.09,
      'OKLO': 171.01,
      'PLTR': 177.21,
      'BCTI': 54.91,
      'VONG': 120.58,
      'VTI': 326.91,
      'GEV': 648.25
    };
    
    return holdings.map(h => ({
      ...h,
      currentPrice: mockPrices[h.ticker] || 100,  // Default to $100 if not found
      currentValue: (mockPrices[h.ticker] || 100) * h.quantity
    }));
  }

  // Calculate exposure percentages
  calculateExposures(holdings) {
    const totalValue = holdings.reduce((sum, h) => sum + (h.currentValue || 0), 0);
    
    return holdings.map(h => ({
      ...h,
      exposure: totalValue > 0 ? (h.currentValue / totalValue) * 100 : 0
    }));
  }

  // Save portfolio from manual input
  async saveFromManualInput(text) {
    const parsedHoldings = this.parseManualInput(text);
    
    if (parsedHoldings.length === 0) {
      throw new Error('No valid holdings found. Use format: TICKER QUANTITY');
    }

    // Fetch prices
    const holdingsWithPrices = await this.fetchCurrentPrices(parsedHoldings);
    
    // Calculate exposures
    const holdingsWithExposures = this.calculateExposures(holdingsWithPrices);
    
    const totalValue = holdingsWithExposures.reduce((sum, h) => sum + h.currentValue, 0);
    
    this.portfolio = {
      holdings: holdingsWithExposures,
      totalValue,
      lastUpdated: new Date().toISOString(),
      inputMethod: 'manual'
    };
    
    this.savePortfolio();
    return this.portfolio;
  }

  // Save to localStorage
  savePortfolio() {
    if (this.portfolio) {
      localStorage.setItem(CONFIG.STORAGE.PORTFOLIO, JSON.stringify(this.portfolio));
      console.log('Portfolio saved:', this.portfolio);
    }
  }

  // Load from localStorage
  loadPortfolio() {
    const stored = localStorage.getItem(CONFIG.STORAGE.PORTFOLIO);
    if (stored) {
      this.portfolio = JSON.parse(stored);
      console.log('Portfolio loaded:', this.portfolio);
    }
  }

  // Get current portfolio
  getPortfolio() {
    return this.portfolio;
  }

  // Check if portfolio exists
  hasPortfolio() {
    return this.portfolio !== null && this.portfolio.holdings.length > 0;
  }

  // Clear portfolio
  clearPortfolio() {
    this.portfolio = null;
    localStorage.removeItem(CONFIG.STORAGE.PORTFOLIO);
  }

  // Get portfolio summary for display
  getSummary() {
    if (!this.portfolio) return null;
    
    return {
      totalValue: this.portfolio.totalValue,
      holdingCount: this.portfolio.holdings.length,
      topHoldings: this.portfolio.holdings
        .sort((a, b) => b.exposure - a.exposure)
        .slice(0, 5),
      lastUpdated: new Date(this.portfolio.lastUpdated).toLocaleString()
    };
  }
}

// Create global instance
const portfolioManager = new PortfolioManager();
