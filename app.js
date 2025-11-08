// Main Application Logic
class PortfolioPulseApp {
  constructor() {
    this.init();
  }

  async init() {
    console.log('Portfolio Pulse initializing...');
    
    // Setup event listeners
    this.setupEventListeners();
    
    // Render initial state
    this.renderInitialState();
    
    // Start timer if it was previously enabled
    if (digestEngine.isTimerEnabled()) {
      digestEngine.startTimer();
      this.updateTimerUI(true);
    }
    
    console.log('Portfolio Pulse initialized');
  }

  setupEventListeners() {
    // Save Portfolio button
    const saveBtn = document.getElementById('savePortfolio');
    saveBtn?.addEventListener('click', () => this.handleSavePortfolio());

    // Generate Now button
    const generateBtn = document.getElementById('generateNow');
    generateBtn?.addEventListener('click', () => this.handleGenerateNow());

    // Toggle Timer button
    const toggleBtn = document.getElementById('toggleTimer');
    toggleBtn?.addEventListener('click', () => this.handleToggleTimer());
  }

  renderInitialState() {
    // Render portfolio if exists
    timelineUI.renderPortfolio();
    
    // Enable/disable generate button based on portfolio
    const generateBtn = document.getElementById('generateNow');
    if (generateBtn) {
      generateBtn.disabled = !portfolioManager.hasPortfolio();
    }
    
    // Render any existing digests
    timelineUI.renderDigests();
    
    // Update timer display
    this.updateTimerUI(digestEngine.isTimerEnabled());
  }

  async handleSavePortfolio() {
    const input = document.getElementById('portfolioInput');
    if (!input) return;
    
    const text = input.value.trim();
    if (!text) {
      alert('Please enter at least one holding in format: TICKER QUANTITY');
      return;
    }
    
    try {
      const saveBtn = document.getElementById('savePortfolio');
      if (saveBtn) {
        saveBtn.disabled = true;
        saveBtn.textContent = 'Saving...';
      }
      
      await portfolioManager.saveFromManualInput(text);
      
      // Update UI
      timelineUI.renderPortfolio();
      
      // Enable generate button
      const generateBtn = document.getElementById('generateNow');
      if (generateBtn) {
        generateBtn.disabled = false;
      }
      
      console.log('Portfolio saved successfully');
      alert('Portfolio saved successfully!');
      
    } catch (error) {
      console.error('Failed to save portfolio:', error);
      alert(`Failed to save portfolio: ${error.message}`);
      
    } finally {
      const saveBtn = document.getElementById('savePortfolio');
      if (saveBtn) {
        saveBtn.disabled = false;
        saveBtn.textContent = 'Save Portfolio';
      }
    }
  }

  async handleGenerateNow() {
    if (!portfolioManager.hasPortfolio()) {
      alert('Please save a portfolio first.');
      return;
    }
    
    console.log('Manual digest generation triggered');
    await digestEngine.generateDigest();
  }

  handleToggleTimer() {
    if (!portfolioManager.hasPortfolio()) {
      alert('Please save a portfolio before enabling auto-updates.');
      return;
    }
    
    const enabled = digestEngine.toggleTimer();
    this.updateTimerUI(enabled);
    
    console.log(`Timer ${enabled ? 'enabled' : 'disabled'}`);
  }

  updateTimerUI(enabled) {
    const statusEl = document.getElementById('timerStatus');
    const toggleBtn = document.getElementById('toggleTimer');
    const timerDisplay = document.getElementById('timerDisplay');
    
    if (statusEl) {
      statusEl.textContent = `Auto-updates: ${enabled ? 'ON' : 'OFF'}`;
    }
    
    if (toggleBtn) {
      toggleBtn.classList.toggle('active', enabled);
    }
    
    if (timerDisplay) {
      timerDisplay.style.opacity = enabled ? '1' : '0.5';
    }
    
    // Start countdown if enabled
    if (enabled) {
      digestEngine.startCountdown();
    }
  }
}

// Initialize app when DOM is ready
document.addEventListener('DOMContentLoaded', () => {
  window.app = new PortfolioPulseApp();
});
