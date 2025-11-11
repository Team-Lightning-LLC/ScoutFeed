// widget.js — Portfolio Pulse (drop-in replacement)

class PulseWidgetController {
  constructor() {
    this.currentTab = 'news';
    this.digest = null;
    this.isGenerating = false;
    this.init();
  }

  /* ---------------------- lifecycle ---------------------- */
  init() {
    this.setupEventListeners();
    this.loadLatestDigest();
    console.log('Portfolio Pulse Widget initialized');
  }

  setupEventListeners() {
    // Tabs
    document.querySelectorAll('.tab-btn').forEach(btn => {
      btn.addEventListener('click', () => this.switchTab(btn.dataset.tab));
    });

    // Settings + actions
    const settingsBtn  = document.getElementById('settingsBtn');
    const settingsModal= document.getElementById('settingsModal');
    const cancelBtn    = document.getElementById('cancelSettings');
    const saveBtn      = document.getElementById('saveSettings');
    const generateBtn  = document.getElementById('generateBtn');

    settingsBtn?.addEventListener('click', () => { settingsModal.style.display = 'flex'; });
    cancelBtn?.addEventListener('click', () => { settingsModal.style.display = 'none'; });
    saveBtn  ?.addEventListener('click', () => { settingsModal.style.display = 'none'; this.updateStatus('Settings saved', true); });
    generateBtn?.addEventListener('click', () => this.generateDigest());

    settingsModal?.addEventListener('click', (e) => {
      if (e.target === settingsModal) settingsModal.style.display = 'none';
    });

    // Expand/collapse headlines
    document.addEventListener('click', (e) => {
      const header = e.target.closest('.headline-header');
      if (!header) return;
      const item = header.closest('.headline-item');
      if (item) item.classList.toggle('expanded');
    });
  }

  /* ---------------------- actions ---------------------- */
  async generateDigest() {
    if (this.isGenerating) return;

    this.isGenerating = true;
    const btn = document.getElementById('generateBtn');
    if (btn) { btn.disabled = true; btn.textContent = 'Generating...'; }
    this.updateStatus('Generating...', false);

    try {
      await vertesiaAPI.executeAsync({ Task: 'begin' }); // background run
      console.log('Pulse generation started. Waiting 5 minutes...');
      await new Promise(res => setTimeout(res, 5 * 60 * 1000)); // 5 min
      await this.loadLatestDigest();
    } catch (err) {
      console.error('Failed to generate digest:', err);
      alert(`Failed to generate digest: ${err.message}`);
      this.updateStatus('Error', false);
    } finally {
      this.isGenerating = false;
      if (btn) { btn.disabled = false; btn.textContent = 'Generate Digest'; }
    }
  }

  /* ---------------------- data load ---------------------- */
  async loadLatestDigest() {
    this.updateStatus('Loading...', false);

    try {
      console.log('=== Loading all objects ===');
      const response = await vertesiaAPI.loadAllObjects(1000);
      const allDocuments = response.objects || [];

      // newest first
      allDocuments.sort((a, b) => new Date(b.created_at || 0) - new Date(a.created_at || 0));
      console.log('All document names:', allDocuments.map(d => d.name).slice(0, 20));

      // choose digests by name
      const digests = allDocuments.filter(doc => {
        const n = (doc.name || '').toLowerCase();
        return n.includes('digest:') || n.includes('scout pulse:');
      });

      console.log('Found digests:', digests.map(d => d.name));
      if (digests.length === 0) {
        this.updateStatus('No digests yet', false);
        this.showEmptyState('No digests found. Click "Generate Digest" to create one.');
        return;
      }

      const latestDigest = digests[0];
      console.log('Latest digest:', latestDigest.name, latestDigest.id);

      const digestObject = await vertesiaAPI.getObject(latestDigest.id);
      console.log('Digest object:', digestObject);

      // -------- robust content extraction --------
      let content;
      if (!digestObject.content || digestObject.content.source == null) {
        throw new Error('No content found in digest object');
      }
      const src = digestObject.content.source;

      if (typeof src === 'string') {
        // inline text content
        content = src;
      } else {
        // stored file: accept {file}|{store}|{path}|{key}
        console.log('Digest is a file, downloading...');
        const fileRef = src.file || src.store || src.path || src.key;
        if (!fileRef) throw new Error('Unknown file reference shape in content.source');
        content = await vertesiaAPI.getFileContent(fileRef);
      }
      // ------------------------------------------

      console.log('Content loaded, length:', content.length);
      console.log('First 500 chars:', content.substring(0, 500));

      const parsed = this.parseScoutDigest(content);
      console.log('Parsed digest:', parsed);

      if (!parsed.items || parsed.items.length === 0) {
        this.showEmptyState('Digest loaded but no items found. Check console for details.');
        this.updateStatus('No items', false);
        return;
      }

      this.digest = parsed;
      this.renderDigest();
      this.updateStatus('Active', true);

      // footer timestamp
      const date = new Date(latestDigest.created_at);
      const footer = document.querySelector('.widget-footer');
      let ts = footer?.querySelector('.last-updated');
      if (!ts && footer) {
        ts = document.createElement('div');
        ts.className = 'last-updated';
        ts.style.fontSize = '11px';
        ts.style.color = 'var(--text-muted)';
        footer.appendChild(ts);
      }
      if (ts) ts.textContent = `Updated ${this.getRelativeTime(date)}`;

      console.log('=== Digest loaded successfully ===');
    } catch (error) {
      console.error('Failed to load digest:', error);
      this.updateStatus('Error loading', false);
      this.showEmptyState(`Error: ${error.message}`);
    }
  }

  /* ---------------------- parse/render ---------------------- */
  showEmptyState(message) {
    ['newsList', 'considerationsList', 'opportunitiesList', 'sourcesList'].forEach(id => {
      const el = document.getElementById(id);
      if (el) el.innerHTML = `<div class="empty-state">${message}</div>`;
    });
  }

  parseScoutDigest(content) {
    console.log('=== Starting parse ===');
    const items = [];

    const tickerMap = {
      'nvidia': 'NVDA','nvda':'NVDA',
      'ionq':'IONQ',
      'rigetti':'RGTI','rgti':'RGTI',
      'quantum computing':'QUANTUM',
      'palantir':'PLTR','pltr':'PLTR',
      'oklo':'OKLO',
      'ge vernova':'GEV','gev':'GEV',
      'nuclear':'NUCLEAR',
      'vti':'VTI','vong':'VONG',
      'ai infrastructure':'AI',
      'market dynamics':'MARKET'
    };

    // "TOPIC: Headline" followed by section body (greedy until next TOPIC or end)
    const sectionRegex = /^([A-Z][^\n:]+):\s*([^\n]+)\n([\s\S]*?)(?=^[A-Z][^\n:]+:|$)/gm;

    let match, sectionCount = 0;
    while ((match = sectionRegex.exec(content)) !== null) {
      sectionCount++;
      const [, topic, headline, section] = match;
      const topicLower = topic.toLowerCase();

      // map to ticker
      let ticker = null;
      for (const [k, v] of Object.entries(tickerMap)) {
        if (topicLower.includes(k)) { ticker = v; break; }
      }
      if (!ticker) {
        const m = section.match(/Market Context:.*?([A-Z]{2,5})/);
        if (m) ticker = m[1];
      }
      console.log(`Section ${sectionCount}: "${topic}" — "${headline}" → ${ticker}`);

      // skip broad sections but keep AI/MARKET out
      if (!ticker || ['QUANTUM','NUCLEAR','AI','MARKET'].includes(ticker)) continue;

      // exposure
      const exposureMatch = section.match(/([\d.]+)%\s+(?:portfolio|of portfolio|exposure)/i);
      const exposure = exposureMatch ? parseFloat(exposureMatch[1]) : 0;

      // bullets (• lines)
      const bullets = section
        .split('\n')
        .filter(l => l.trim().startsWith('•'))
        .map(l => l.trim().slice(1).trim());

      // categorize
      const category = this.categorizeHeadline(headline);

      // sources
      const sources = this.extractSources(section);

      // upsert ticker item
      let item = items.find(i => i.ticker === ticker);
      if (!item) {
        item = { ticker, name: topic.split(':')[0].trim(), exposure, news: [], considerations: [], opportunities: [], sources: [] };
        items.push(item);
      }

      const entry = { headline, bullets };
      if (category === 'considerations') item.considerations.push(entry);
      else if (category === 'opportunities') item.opportunities.push(entry);
      else item.news.push(entry);

      // add sources (dedupe by URL)
      sources.forEach(s => { if (!item.sources.find(x => x.url === s.url)) item.sources.push(s); });
    }

    console.log(`=== Parse complete: ${items.length} tickers, ${sectionCount} sections ===`);
    return {
      title: content.match(/Scout Pulse:\s*(.+)/)?.[1] || 'Portfolio Digest',
      items
    };
  }

  categorizeHeadline(headline) {
    const lower = headline.toLowerCase();
    if (lower.match(/concern|risk|unsustainable|warning|faces|challenge|collides|volatile|extreme|bubble|caution|test/)) return 'considerations';
    if (lower.match(/opportunity|power|dominance|renaissance|lead|momentum|strategic|explosive|record|growth/)) return 'opportunities';
    return 'news';
  }

  extractSources(content) {
    const out = [];
    const block = content.match(/Citations?:\s*([\s\S]*?)(?=^[A-Z][^\n:]+:|$)/m);
    if (!block) return out;

    block[1].split('\n').filter(l => l.trim()).forEach(line => {
      const urlMatch = line.match(/(https?:\/\/[^\s]+)/);
      if (urlMatch) {
        const url = urlMatch[1];
        const title = line.split(url)[0].trim().replace(/^["\s]+|["\s]+$/g, '') || 'Source';
        out.push({ title, url });
      }
    });
    return out;
    }

  /* ---------------------- UI ---------------------- */
  switchTab(tabName) {
    this.currentTab = tabName;
    document.querySelectorAll('.tab-btn').forEach(btn =>
      btn.classList.toggle('active', btn.dataset.tab === tabName)
    );
    document.querySelectorAll('.tab-panel').forEach(panel =>
      panel.classList.toggle('active', panel.id === tabName)
    );
  }

  renderDigest() {
    if (!this.digest) return;
    console.log('=== Rendering digest ===');

    const news = [], considerations = [], opportunities = [], sources = [];

    this.digest.items.forEach(item => {
      item.news.forEach(e => news.push({ ticker: item.ticker, headline: e.headline, bullets: e.bullets, exposure: item.exposure }));
      item.considerations.forEach(e => considerations.push({ ticker: item.ticker, headline: e.headline, bullets: e.bullets, exposure: item.exposure }));
      item.opportunities.forEach(e => opportunities.push({ ticker: item.ticker, headline: e.headline, bullets: e.bullets, exposure: item.exposure }));
      if (item.sources.length) sources.push({ ticker: item.ticker, links: item.sources });
    });

    this.renderHeadlines('newsList', news);
    this.renderHeadlines('considerationsList', considerations);
    this.renderHeadlines('opportunitiesList', opportunities);
    this.renderSources('sourcesList', sources);
  }

  renderHeadlines(containerId, list) {
    const el = document.getElementById(containerId);
    if (!el) return;
    if (!list.length) { el.innerHTML = '<div class="empty-state">No items in this category</div>'; return; }

    el.innerHTML = list.map((item, idx) => `
      <div class="headline-item" data-index="${idx}">
        <div class="headline-header">
          <div class="headline-text">${item.ticker}: ${item.headline}</div>
          <div class="headline-toggle">▼</div>
        </div>
        <div class="headline-details">
          <div class="headline-ticker">${item.ticker} • ${item.exposure.toFixed(1)}% exposure</div>
          ${item.bullets?.length ? `
            <ul class="headline-bullets">
              ${item.bullets.slice(0, 5).map(b => `<li>${b}</li>`).join('')}
            </ul>` : ''
          }
        </div>
      </div>
    `).join('');
  }

  renderSources(containerId, groups) {
    const el = document.getElementById(containerId);
    if (!el) return;
    if (!groups.length) { el.innerHTML = '<div class="empty-state">No sources available</div>'; return; }

    el.innerHTML = groups.map(g => `
      <div class="source-group">
        <div class="source-ticker">${g.ticker}</div>
        ${g.links.slice(0, 5).map(link => `
          <a href="${link.url}" target="_blank" rel="noopener noreferrer" class="source-link" title="${link.title}">
            ${link.title}
          </a>`).join('')}
      </div>
    `).join('');
  }

  /* ---------------------- utils ---------------------- */
  updateStatus(text, isActive) {
    const dot = document.querySelector('.status-dot');
    const t = document.querySelector('.status-text');
    if (t) t.textContent = text;
    if (dot) dot.style.background = isActive ? 'var(--success)' : '#9ca3af';
  }

  getRelativeTime(date) {
    const now = new Date();
    const diff = now - date;
    const m = Math.floor(diff / 60000);
    const h = Math.floor(m / 60);
    const d = Math.floor(h / 24);
    if (m < 60) return `${m}m ago`;
    if (h < 24) return `${h}h ago`;
    return `${d}d ago`;
  }
}

/* bootstrap */
document.addEventListener('DOMContentLoaded', () => {
  window.pulseWidget = new PulseWidgetController();
  setInterval(() => window.pulseWidget.loadLatestDigest(), 30000); // auto-refresh
});
