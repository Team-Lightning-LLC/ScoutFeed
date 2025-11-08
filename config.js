// Portfolio Pulse Configuration
const CONFIG = {
  // Vertesia API Configuration
  VERTESIA_API_BASE: 'https://api.vertesia.io/api/v1',
  VERTESIA_API_KEY: 'sk-2538a58567e4ebb6654c0a17ceab228c',
  ENVIRONMENT_ID: '681915c6a01fb262a410c161',
  MODEL: 'publishers/anthropic/models/claude-3-7-sonnet',
  
  // Portfolio Pulse Interaction
  INTERACTION_NAME: 'PortfolioPulse',  // We'll need to create this interaction on Vertesia backend
  
  // Scheduling Configuration
  SCHEDULE: {
    TIMES: [8, 14, 20],  // 8am, 2pm, 8pm (24-hour format)
    DAYS: [1, 2, 3, 4, 5],  // Monday-Friday (0=Sunday, 6=Saturday)
    CHECK_INTERVAL_MS: 60000  // Check every 60 seconds
  },
  
  // News Configuration
  NEWS: {
    LOOKBACK_DAYS: 7,  // How many days back to search for news
    MIN_EXPOSURE_FOR_PRIORITY: 10  // Positions >10% get priority coverage
  },
  
  // Storage Keys
  STORAGE: {
    PORTFOLIO: 'pulse_portfolio',
    DIGESTS: 'pulse_digests',
    TIMER_STATE: 'pulse_timer_enabled',
    LAST_RUN: 'pulse_last_run'
  }
};

// Export for use in other modules
if (typeof module !== 'undefined' && module.exports) {
  module.exports = CONFIG;
}
