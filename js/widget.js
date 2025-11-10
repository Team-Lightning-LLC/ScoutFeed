// Portfolio Pulse Widget Controller
class PulseWidgetController {
  constructor() {
    this.currentTab = 'news';
    this.digest = null;
    this.settings = {
      frequency: '3x',
      lookback: 7
    };
    
    this.init();
  }

  init() {
    this.loadSettings();
    this.setupEventListeners();
    this.loadLatestDigest();
    console.log('Portfolio Pulse Widget initialized');
  }

  // ===== EVENT LISTENERS =====

  setupEventListeners() {
    // Tab switching
    const tabBtns = document.querySelectorAll('.tab-btn');
    tabBtns.forEach(btn => {
      btn.addEventListener('click', () => {
        this.switchTab(btn.dataset.tab);
      });
    });

    // Settings modal
    const settingsBtn = document.getElementById('settingsBtn');
    const settingsModal = document.getElementById('settingsModal');
    const cancelBtn = document.getElementById('cancelSettings');
    const saveBtn = document.getElementById('saveSettings');

    settingsBtn?.addEventListener('click', () => {
      settingsModal.style.display = 'flex';
    });

    cancelBtn?.addEventListener('click', () => {
      settingsModal.style.display = 'none';
    });

    saveBtn?.addEventListener('click', () => {
      this.saveSettings();
      settingsModal.style.display = 'none';
    });

    // Click outside modal to close
    settingsModal?.addEventListener('click', (e) => {
      if (e.target === settingsModal) {
        settingsModal.style.display = 'none';
      }
    });

    // Headline expansion (event delegation)
    document.addEventListener('click', (e) => {
      const header = e.target.closest('.headline-header');
      if (header) {
        const item = header.closest('.headline-item');
        if (item) {
          item.classList.toggle('expanded');
        }
      }
    });
  }

  // ===== TAB SWITCHING =====

  switchTab(tabName) {
    this.currentTab = tabName;

    // Update buttons
    document.querySelectorAll('.tab-btn').forEach(btn => {
      btn.classList.toggle('active', btn.dataset.tab === tabName);
    });

    // Update panels
    document.querySelectorAll('.tab-panel').forEach(panel => {
      panel.classList.toggle('active', panel.id === tabName);
    });
  }

  // ===== SETTINGS =====

  loadSettings() {
    const stored = localStorage.getItem('pulse_widget_settings');
    if (stored) {
      this.settings = JSON.parse(stored);
      
      // Apply to UI
      const frequencySelect = document.getElementById('frequency');
      const lookbackSelect = document.getElementById('lookback');
      
      if (frequencySelect) frequencySelect.value = this.settings.frequency;
      if (lookbackSelect) lookbackSelect.value = this.settings.lookback;
    }
  }

  saveSettings() {
    const frequencySelect = document.getElementById('frequency');
    const lookbackSelect = document.getElementById('lookback');
    
    this.settings = {
      frequency: frequencySelect?.value || '3x',
      lookback: parseInt(lookbackSelect?.value || '7')
    };
    
    localStorage.setItem('pulse_widget_settings', JSON.stringify(this.settings));
    console.log('Settings saved:', this.settings);
  }

  // ===== DIGEST LOADING & PARSING =====

  loadLatestDigest() {
    // Check if portfolio exists
    if (!portfolioManager || !portfolioManager.hasPortfolio()) {
      this.updateStatus('No portfolio', false);
      return;
    }

    // Load from localStorage (from main app)
    const stored = localStorage.getItem('pulse_digests');
    if (!stored) {
      this.updateStatus('No digests yet', false);
      return;
    }

    const digests = JSON.parse(stored);
    if (digests.length === 0) {
      this.updateStatus('No digests yet', false);
      return;
    }

    // Get most recent digest
    const latest = digests[0];
    this.digest = this.parseDigest(latest);
    
    this.renderDigest();
    this.updateStatus('Active', true);
    
    // Update last updated time
    const lastUpdated = new Date(latest.generatedAt);
    document.getElementById('lastUpdated').textContent = 
      `Updated ${this.getRelativeTime(lastUpdated)}`;
  }

  // Parse digest into widget format (News, Considerations, Opportunities, Sources)
  parseDigest(digest) {
    const parsed = {
      news: [],
      considerations: [],
      opportunities: [],
      sources: []
    };

    // If digest has items (tickers), categorize them
    if (digest.items && digest.items.length > 0) {
      digest.items.forEach(item => {
        // Extract headlines from subsections
        if (item.subsections) {
          item.subsections.forEach(sub => {
            // Categorize based on subsection header
            const header = sub.header.toLowerCase();
            
            if (header.includes('price') || header.includes('earnings') || 
                header.includes('performance') || header.includes('development')) {
              // News
              parsed.news.push({
                ticker: item.ticker,
                headline: `${item.ticker}: ${sub.header}`,
                bullets: sub.bullets || [],
                sources: item.sources || []
              });
            } else if (header.includes('risk') || header.includes('concern') || 
                       header.includes('assessment') || header.includes('analysis')) {
              // Considerations
              parsed.considerations.push({
                ticker: item.ticker,
                headline: `${item.ticker}: ${sub.header}`,
                bullets: sub.bullets || [],
                sources: item.sources || []
              });
            } else if (header.includes('opportunity') || header.includes('strategic') || 
                       header.includes('growth') || header.includes('acquisition')) {
              // Opportunities
              parsed.opportunities.push({
                ticker: item.ticker,
                headline: `${item.ticker}: ${sub.header}`,
                bullets: sub.bullets || [],
                sources: item.sources || []
              });
            } else {
              // Default to news
              parsed.news.push({
                ticker: item.ticker,
                headline: `${item.ticker}: ${sub.header}`,
                bullets: sub.bullets || [],
                sources: item.sources || []
              });
            }
          });
        }

        // Add sources
        if (item.sources && item.sources.length > 0) {
          parsed.sources.push({
            ticker: item.ticker,
            links: item.sources
          });
        }
      });
    }

    // Add Risk Assessment to considerations
    if (digest.riskAssessment && digest.riskAssessment.subsections) {
      digest.riskAssessment.subsections.forEach(sub => {
        parsed.considerations.push({
          ticker: 'Portfolio',
          headline: sub.header,
          bullets: sub.bullets || [],
          sources: []
        });
      });
    }

    return parsed;
  }

  // Render digest into tabs
  renderDigest() {
    if (!this.digest) return;

    // Render News
    this.renderHeadlines('newsList', this.digest.news);
    
    // Render Considerations
    this.renderHeadlines('considerationsList', this.digest.considerations);
    
    // Render Opportunities
    this.renderHeadlines('opportunitiesList', this.digest.opportunities);
    
    // Render Sources
    this.renderSources('sourcesList', this.digest.sources);
  }

  renderHeadlines(containerId, headlines) {
    const container = document.getElementById(containerId);
    if (!container) return;

    if (headlines.length === 0) {
      container.innerHTML = '<div class="empty-state">No items in this category</div>';
      return;
    }

    container.innerHTML = headlines.map((item, index) => `
      <div class="headline-item" data-index="${index}">
        <div class="headline-header">
          <div class="headline-text">${item.headline}</div>
          <div class="headline-toggle">▼</div>
        </div>
        <div class="headline-details">
          ${item.ticker ? `<div class="headline-ticker">${item.ticker}</div>` : ''}
          ${item.bullets && item.bullets.length > 0 ? `
            <ul class="headline-bullets">
              ${item.bullets.map(bullet => `<li>${bullet}</li>`).join('')}
            </ul>
          ` : ''}
        </div>
      </div>
    `).join('');
  }

  renderSources(containerId, sourcesData) {
    const container = document.getElementById(containerId);
    if (!container) return;

    if (sourcesData.length === 0) {
      container.innerHTML = '<div class="empty-state">No sources available</div>';
      return;
    }

    container.innerHTML = sourcesData.map(group => `
      <div class="source-group">
        <div class="source-ticker">${group.ticker}</div>
        ${group.links.map(link => `
          <a href="${link.url}" target="_blank" rel="noopener noreferrer" class="source-link">
            ${link.title}
          </a>
        `).join('')}
      </div>
    `).join('');
  }

  // ===== UTILITIES =====

  updateStatus(text, isActive) {
    const statusDot = document.querySelector('.status-dot');
    const statusText = document.querySelector('.status-text');
    
    if (statusText) statusText.textContent = text;
    
    if (statusDot) {
      statusDot.style.background = isActive ? 'var(--success)' : '#9ca3af';
    }
  }

  getRelativeTime(date) {
    const now = new Date();
    const diff = now - date;
    const minutes = Math.floor(diff / 60000);
    const hours = Math.floor(minutes / 60);
    const days = Math.floor(hours / 24);

    if (minutes < 60) return `${minutes}m ago`;
    if (hours < 24) return `${hours}h ago`;
    return `${days}d ago`;
  }
}

// Initialize widget when DOM is ready
document.addEventListener('DOMContentLoaded', () => {
  window.pulseWidget = new PulseWidgetController();
  
  // Refresh every 30 seconds if main app updates
  setInterval(() => {
    window.pulseWidget.loadLatestDigest();
  }, 30000);
});
