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

    // Settings
    const settingsBtn = document.getElementById('settingsBtn');
    const settingsModal = document.getElementById('settingsModal');
    const cancelBtn = document.getElementById('cancelSettings');
    const saveBtn = document.getElementById('saveSettings');
    const generateBtn = document.getElementById('generateBtn');

    settingsBtn?.addEventListener('click', () => {
      settingsModal.style.display = 'flex';
    });

    cancelBtn?.addEventListener('click', () => {
      settingsModal.style.display = 'none';
    });

    saveBtn?.addEventListener('click', () => {
      settingsModal.style.display = 'none';
      this.updateStatus('Settings saved', true);
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

  async generateDigest() {
    if (this.isGenerating) return;

    this.isGenerating = true;
    const generateBtn = document.getElementById('generateBtn');
    generateBtn.disabled = true;
    generateBtn.textContent = 'Generating...';
    this.updateStatus('Generating...', false);

    try {
      await vertesiaAPI.generateDigest();
      
      console.log('Pulse generation started. Waiting 5 minutes...');
      
      // Wait 5 minutes
      await new Promise(resolve => setTimeout(resolve, 5 * 60 * 1000));
      
      // Load latest
      await this.loadLatestDigest();
      
    } catch (error) {
      console.error('Failed to generate digest:', error);
      alert(`Failed to generate digest: ${error.message}`);
      this.updateStatus('Error', false);
    } finally {
      this.isGenerating = false;
      generateBtn.disabled = false;
      generateBtn.textContent = 'Generate Digest';
    }
  }

  async loadLatestDigest() {
    this.updateStatus('Loading...', false);
    
    try {
      console.log('=== Starting digest load ===');
      
      const latestDigest = await vertesiaAPI.getLatestDigest();
      
      if (!latestDigest) {
        console.warn('No digest found');
        this.updateStatus('No digests yet', false);
        this.showEmptyState('No digests found. Click "Generate Digest" to create one.');
        return;
      }
      
      console.log('Loading digest:', latestDigest.name);
      
      const content = await vertesiaAPI.getDocumentContent(latestDigest.id);
      
      console.log('Content loaded, length:', content.length);
      console.log('First 500 chars:', content.substring(0, 500));
      
      // Parse Scout's format
      const parsed = this.parseScoutDigest(content);
      
      console.log('Parsed digest:', parsed);
      
      if (!parsed.items || parsed.items.length === 0) {
        console.warn('No items parsed from digest');
        this.showEmptyState('Digest loaded but no items found. Check console for details.');
        this.updateStatus('No items', false);
        return;
      }
      
      // Store
      this.digest = parsed;
      
      // Render
      this.renderDigest();
      this.updateStatus('Active', true);
      
      // Update footer timestamp
      const date = new Date(latestDigest.createdAt);
      const footer = document.querySelector('.widget-footer');
      let timestamp = footer.querySelector('.last-updated');
      if (!timestamp) {
        timestamp = document.createElement('div');
        timestamp.className = 'last-updated';
        timestamp.style.fontSize = '11px';
        timestamp.style.color = 'var(--text-muted)';
        footer.appendChild(timestamp);
      }
      timestamp.textContent = `Updated ${this.getRelativeTime(date)}`;
      
      console.log('=== Digest loaded successfully ===');
      
    } catch (error) {
      console.error('Failed to load digest:', error);
      this.updateStatus('Error loading', false);
      this.showEmptyState(`Error: ${error.message}`);
    }
  }

  showEmptyState(message) {
    const containers = ['newsList', 'considerationsList', 'opportunitiesList', 'sourcesList'];
    containers.forEach(id => {
      const container = document.getElementById(id);
      if (container) {
        container.innerHTML = `<div class="empty-state">${message}</div>`;
      }
    });
  }

  parseScoutDigest(content) {
    console.log('=== Starting parse ===');
    
    const items = [];
    
    // Ticker mapping
    const tickerMap = {
      'nvidia': 'NVDA',
      'nvda': 'NVDA',
      'ionq': 'IONQ',
      'rigetti': 'RGTI',
      'rgti': 'RGTI',
      'quantum computing': 'QUANTUM',
      'palantir': 'PLTR',
      'pltr': 'PLTR',
      'oklo': 'OKLO',
      'ge vernova': 'GEV',
      'gev': 'GEV',
      'nuclear': 'NUCLEAR',
      'vti': 'VTI',
      'vong': 'VONG'
    };
    
    // Match sections: "TOPIC: Headline" followed by content
    const sectionRegex = /^([A-Z][^\n:]+):\s*([^\n]+)\n([\s\S]*?)(?=^[A-Z][^\n:]+:|$)/gm;
    
    let match;
    let sectionCount = 0;
    
    while ((match = sectionRegex.exec(content)) !== null) {
      sectionCount++;
      const [, topic, headline, sectionContent] = match;
      
      console.log(`Section ${sectionCount}: "${topic}" - "${headline}"`);
      
      // Extract ticker
      const topicLower = topic.toLowerCase();
      let ticker = null;
      for (const [key, value] of Object.entries(tickerMap)) {
        if (topicLower.includes(key)) {
          ticker = value;
          break;
        }
      }
      
      // Try Market Context
      if (!ticker) {
        const contextMatch = sectionContent.match(/Market Context:.*?([A-Z]{2,5})/);
        if (contextMatch) ticker = contextMatch[1];
      }
      
      console.log(`  Ticker: ${ticker}`);
      
      // Skip non-stock sections
      if (!ticker || ticker === 'QUANTUM' || ticker === 'NUCLEAR') {
        console.log(`  Skipping (not a stock section)`);
        continue;
      }
      
      // Extract exposure
      const exposureMatch = sectionContent.match(/([\d.]+)%\s+(?:portfolio|of portfolio|exposure)/i);
      const exposure = exposureMatch ? parseFloat(exposureMatch[1]) : 0;
      
      // Extract bullets
      const bullets = sectionContent
        .split('\n')
        .filter(line => line.trim().startsWith('•'))
        .map(line => line.trim().substring(1).trim());
      
      console.log(`  Bullets found: ${bullets.length}`);
      
      // Categorize
      const category = this.categorizeHeadline(headline);
      console.log(`  Category: ${category}`);
      
      // Extract sources
      const sources = this.extractSources(sectionContent);
      console.log(`  Sources found: ${sources.length}`);
      
      // Find or create ticker item
      let tickerItem = items.find(item => item.ticker === ticker);
      if (!tickerItem) {
        tickerItem = {
          ticker,
          name: topic.split(':')[0].trim(),
          exposure,
          news: [],
          considerations: [],
          opportunities: [],
          sources: []
        };
        items.push(tickerItem);
      }
      
      // Add to category
      const entry = { headline, bullets };
      if (category === 'considerations') {
        tickerItem.considerations.push(entry);
      } else if (category === 'opportunities') {
        tickerItem.opportunities.push(entry);
      } else {
        tickerItem.news.push(entry);
      }
      
      // Add sources
      tickerItem.sources.push(...sources);
    }
    
    console.log(`=== Parse complete: ${items.length} tickers, ${sectionCount} sections ===`);
    
    return {
      title: content.match(/Scout Pulse:\s*(.+)/)?.[1] || 'Portfolio Digest',
      items
    };
  }

  categorizeHeadline(headline) {
    const lower = headline.toLowerCase();
    
    // Considerations
    if (lower.match(/concern|risk|unsustainable|warning|faces|challenge|collides|volatile|extreme|bubble|caution/)) {
      return 'considerations';
    }
    
    // Opportunities  
    if (lower.match(/opportunity|power|dominance|renaissance|lead|momentum|strategic|explosive|record|growth/)) {
      return 'opportunities';
    }
    
    return 'news';
  }

  extractSources(content) {
    const sources = [];
    const citationsMatch = content.match(/Citations?:\s*([\s\S]*?)(?=^[A-Z][^\n:]+:|$)/m);
    
    if (!citationsMatch) return sources;
    
    const lines = citationsMatch[1].split('\n').filter(l => l.trim());
    
    lines.forEach(line => {
      const urlMatch = line.match(/(https?:\/\/[^\s]+)/);
      if (urlMatch) {
        const title = line.split(urlMatch[0])[0].trim().replace(/^["\s]+|["\s]+$/g, '');
        sources.push({ 
          title: title || 'Source', 
          url: urlMatch[1] 
        });
      }
    });
    
    return sources;
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

    console.log('=== Rendering digest ===');

    // Flatten entries
    const news = [];
    const considerations = [];
    const opportunities = [];
    const sources = [];
    
    this.digest.items.forEach(item => {
      item.news.forEach(entry => {
        news.push({
          ticker: item.ticker,
          headline: entry.headline,
          bullets: entry.bullets,
          exposure: item.exposure
        });
      });
      
      item.considerations.forEach(entry => {
        considerations.push({
          ticker: item.ticker,
          headline: entry.headline,
          bullets: entry.bullets,
          exposure: item.exposure
        });
      });
      
      item.opportunities.forEach(entry => {
        opportunities.push({
          ticker: item.ticker,
          headline: entry.headline,
          bullets: entry.bullets,
          exposure: item.exposure
        });
      });
      
      if (item.sources.length > 0) {
        sources.push({
          ticker: item.ticker,
          links: item.sources
        });
      }
    });

    console.log(`Rendering: ${news.length} news, ${considerations.length} considerations, ${opportunities.length} opportunities, ${sources.length} sources`);

    this.renderHeadlines('newsList', news);
    this.renderHeadlines('considerationsList', considerations);
    this.renderHeadlines('opportunitiesList', opportunities);
    this.renderSources('sourcesList', sources);
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
          <div class="headline-text">${item.ticker}: ${item.headline}</div>
          <div class="headline-toggle">▼</div>
        </div>
        <div class="headline-details">
          <div class="headline-ticker">${item.ticker} • ${item.exposure.toFixed(1)}% exposure</div>
          ${item.bullets && item.bullets.length > 0 ? `
            <ul class="headline-bullets">
              ${item.bullets.slice(0, 5).map(bullet => `<li>${bullet}</li>`).join('')}
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
        ${group.links.slice(0, 5).map(link => `
          <a href="${link.url}" target="_blank" rel="noopener noreferrer" class="source-link" title="${link.title}">
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

document.addEventListener('DOMContentLoaded', () => {
  window.pulseWidget = new PulseWidgetController();
  
  // Auto-refresh every 30 seconds
  setInterval(() => {
    window.pulseWidget.loadLatestDigest();
  }, 30000);
});
