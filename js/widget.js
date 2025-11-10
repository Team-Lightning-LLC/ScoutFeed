class PulseWidgetController {
  constructor() {
    this.currentTab = 'news';
    this.digest = null;
    this.isGenerating = false;
    
    this.init();
  }

  init() {
    this.setupEventListeners();
    this.loadLatestDigest();
    console.log('Portfolio Pulse Widget initialized');
  }

  setupEventListeners() {
    // Tab switching
    document.querySelectorAll('.tab-btn').forEach(btn => {
      btn.addEventListener('click', () => {
        this.switchTab(btn.dataset.tab);
      });
    });

    // Settings modal
    const settingsBtn = document.getElementById('settingsBtn');
    const settingsModal = document.getElementById('settingsModal');
    const cancelBtn = document.getElementById('cancelSettings');
    const saveBtn = document.getElementById('saveSettings');
    const generateBtn = document.getElementById('generateBtn');

    settingsBtn?.addEventListener('click', () => {
      this.openSettings();
    });

    cancelBtn?.addEventListener('click', () => {
      settingsModal.style.display = 'none';
    });

    saveBtn?.addEventListener('click', () => {
      this.saveSettings();
    });

    generateBtn?.addEventListener('click', () => {
      this.generateDigest();
    });

    settingsModal?.addEventListener('click', (e) => {
      if (e.target === settingsModal) {
        settingsModal.style.display = 'none';
      }
    });

    // Headline expansion
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

  openSettings() {
    const modal = document.getElementById('settingsModal');
    const input = document.getElementById('portfolioInput');
    
    // Load current portfolio
    if (portfolioManager.hasPortfolio()) {
      const portfolio = portfolioManager.getPortfolio();
      const text = portfolio.holdings
        .map(h => `${h.ticker} ${h.quantity} ${h.dollarValue}`)
        .join('\n');
      input.value = text;
    }
    
    modal.style.display = 'flex';
  }

  async saveSettings() {
    const modal = document.getElementById('settingsModal');
    const input = document.getElementById('portfolioInput');
    
    try {
      await portfolioManager.saveFromManualInput(input.value);
      modal.style.display = 'none';
      this.updateStatus('Portfolio saved', true);
    } catch (error) {
      alert(error.message);
    }
  }

  async generateDigest() {
    if (!portfolioManager.hasPortfolio()) {
      alert('Please add your portfolio in Settings first');
      return;
    }

    if (this.isGenerating) {
      return;
    }

    this.isGenerating = true;
    const generateBtn = document.getElementById('generateBtn');
    generateBtn.disabled = true;
    generateBtn.textContent = 'Generating...';
    this.updateStatus('Generating...', false);

    try {
      const portfolio = portfolioManager.getPortfolio();
      const response = await vertesiaAPI.generateDigest(portfolio);
      
      console.log('Digest generation started:', response);
      
      // Wait 5 minutes for completion
      await new Promise(resolve => setTimeout(resolve, 5 * 60 * 1000));
      
      // Fetch latest document
      const documents = await vertesiaAPI.fetchRecentDocuments();
      if (documents.length === 0) {
        throw new Error('No document found');
      }
      
      const latestDoc = documents[0];
      const content = await vertesiaAPI.getDocumentContent(latestDoc.id);
      
      // Parse and store
      const digest = this.parseDigest(content);
      this.storeDigest(digest);
      
      // Display
      this.digest = this.categorizeDigest(digest);
      this.renderDigest();
      this.updateStatus('Active', true);
      
    } catch (error) {
      console.error('Failed to generate digest:', error);
      alert('Failed to generate digest. Check console for details.');
      this.updateStatus('Error', false);
    } finally {
      this.isGenerating = false;
      generateBtn.disabled = false;
      generateBtn.textContent = 'Generate Digest';
    }
  }

  parseDigest(content) {
    const titleMatch = content.match(/^#\s+(.+)$/m);
    const title = titleMatch ? titleMatch[1] : 'Portfolio News Update';
    
    const items = [];
    const tickerRegex = /##\s+(.+?)\s+\(([A-Z]+)\)\s+-\s+([\d.]+)%[^\n]*\n([\s\S]*?)(?=##|$)/g;
    
    let match;
    while ((match = tickerRegex.exec(content)) !== null) {
      const [, name, ticker, exposure, sectionContent] = match;
      
      const subsections = [];
      const headerRegex = /\*\*(.+?):\*\*\n([\s\S]*?)(?=\n\*\*|$)/g;
      
      let subMatch;
      while ((subMatch = headerRegex.exec(sectionContent)) !== null) {
        const [, header, body] = subMatch;
        const bullets = body.split('\n')
          .filter(line => {
            const trimmed = line.trim();
            return trimmed.startsWith('-') || trimmed.startsWith('•');
          })
          .map(line => line.trim().substring(1).trim());
        
        subsections.push({
          header: header.trim(),
          bullets
        });
      }
      
      const sources = [];
      const linkRegex = /\[(.+?)\]\((.+?)\)/g;
      let linkMatch;
      while ((linkMatch = linkRegex.exec(sectionContent)) !== null) {
        const [, title, url] = linkMatch;
        sources.push({ title, url });
      }
      
      items.push({
        ticker,
        name,
        exposure: parseFloat(exposure),
        subsections,
        sources
      });
    }
    
    return {
      id: Date.now().toString(),
      generatedAt: new Date().toISOString(),
      title,
      items
    };
  }

  categorizeDigest(digest) {
    const categorized = {
      news: [],
      considerations: [],
      opportunities: [],
      sources: []
    };

    if (digest.items) {
      digest.items.forEach(item => {
        if (item.subsections) {
          item.subsections.forEach(sub => {
            const header = sub.header.toLowerCase();
            
            if (header.includes('price') || header.includes('earnings') || 
                header.includes('performance') || header.includes('development')) {
              categorized.news.push({
                ticker: item.ticker,
                headline: `${item.ticker}: ${sub.header}`,
                bullets: sub.bullets || [],
                sources: item.sources || []
              });
            } else if (header.includes('risk') || header.includes('concern') || 
                       header.includes('assessment') || header.includes('analysis')) {
              categorized.considerations.push({
                ticker: item.ticker,
                headline: `${item.ticker}: ${sub.header}`,
                bullets: sub.bullets || [],
                sources: item.sources || []
              });
            } else if (header.includes('opportunity') || header.includes('strategic') || 
                       header.includes('growth') || header.includes('acquisition')) {
              categorized.opportunities.push({
                ticker: item.ticker,
                headline: `${item.ticker}: ${sub.header}`,
                bullets: sub.bullets || [],
                sources: item.sources || []
              });
            } else {
              categorized.news.push({
                ticker: item.ticker,
                headline: `${item.ticker}: ${sub.header}`,
                bullets: sub.bullets || [],
                sources: item.sources || []
              });
            }
          });
        }

        if (item.sources && item.sources.length > 0) {
          categorized.sources.push({
            ticker: item.ticker,
            links: item.sources
          });
        }
      });
    }

    return categorized;
  }

  storeDigest(digest) {
    const stored = localStorage.getItem('pulse_digests');
    const digests = stored ? JSON.parse(stored) : [];
    digests.unshift(digest);
    localStorage.setItem('pulse_digests', JSON.stringify(digests));
  }

  loadLatestDigest() {
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

    const latest = digests[0];
    this.digest = this.categorizeDigest(latest);
    this.renderDigest();
    this.updateStatus('Active', true);
  }

  switchTab(tabName) {
    this.currentTab = tabName;

    document.querySelectorAll('.tab-btn').forEach(btn => {
      btn.classList.toggle('active', btn.dataset.tab === tabName);
    });

    document.querySelectorAll('.tab-panel').forEach(panel => {
      panel.classList.toggle('active', panel.id === tabName);
    });
  }

  renderDigest() {
    if (!this.digest) return;

    this.renderHeadlines('newsList', this.digest.news);
    this.renderHeadlines('considerationsList', this.digest.considerations);
    this.renderHeadlines('opportunitiesList', this.digest.opportunities);
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

  updateStatus(text, isActive) {
    const statusDot = document.querySelector('.status-dot');
    const statusText = document.querySelector('.status-text');
    
    if (statusText) statusText.textContent = text;
    if (statusDot) {
      statusDot.style.background = isActive ? 'var(--success)' : '#9ca3af';
    }
  }
}

document.addEventListener('DOMContentLoaded', () => {
  window.pulseWidget = new PulseWidgetController();
});
