// widget.js — adds "Contents" tab with exact article parsing/rendering
class PulseWidgetController {
  constructor() {
    this.currentTab = 'news';
    this.digest = null;
    this.isGenerating = false;

    // NEW: parsed micro-articles
    this.articles = [];

    this.init();
  }

  init() {
    this.ensureContentsTab();      // NEW
    this.setupEventListeners();
    this.loadLatestDigest();
    console.log('Portfolio Pulse Widget initialized');
  }

  // ---------- UI scaffold: add "Contents" tab if missing ----------
  ensureContentsTab() {
    const tabsBar = document.querySelector('.tabs, .tab-bar') || document.querySelector('.widget-header');
    const panelsHost = document.querySelector('.tab-panels, .widget-body') || document.body;

    // Add button if not present
    if (!document.querySelector('.tab-btn[data-tab="contents"]') && tabsBar) {
      const btn = document.createElement('button');
      btn.className = 'tab-btn';
      btn.dataset.tab = 'contents';
      btn.textContent = 'Contents';
      tabsBar.appendChild(btn);
    }

    // Add panel if not present
    if (!document.getElementById('contents') && panelsHost) {
      const panel = document.createElement('div');
      panel.id = 'contents';
      panel.className = 'tab-panel';
      panel.style.display = 'none';
      panel.innerHTML = `
        <div class="contents-wrap" style="display:flex; gap:16px; align-items:stretch;">
          <div id="contentsList" style="flex:0 0 360px; max-height:60vh; overflow:auto; border-right:1px solid var(--border,#e5e7eb); padding-right:12px;"></div>
          <div id="contentsDetail" style="flex:1; max-height:60vh; overflow:auto; white-space:pre-wrap; font-family:ui-sans-serif,system-ui,Segoe UI,Roboto,Helvetica,Arial;">
            <div class="empty-state" style="color:var(--text-muted,#6b7280);">Select an article to view it.</div>
          </div>
        </div>`;
      panelsHost.appendChild(panel);
    }
  }

  setupEventListeners() {
    // Tab switching
    document.querySelectorAll('.tab-btn').forEach(btn => {
      btn.addEventListener('click', () => this.switchTab(btn.dataset.tab));
    });

    // Settings
    const settingsBtn = document.getElementById('settingsBtn');
    const settingsModal = document.getElementById('settingsModal');
    const cancelBtn = document.getElementById('cancelSettings');
    const saveBtn = document.getElementById('saveSettings');
    const generateBtn = document.getElementById('generateBtn');

    settingsBtn?.addEventListener('click', () => { settingsModal.style.display = 'flex'; });
    cancelBtn?.addEventListener('click', () => { settingsModal.style.display = 'none'; });
    saveBtn?.addEventListener('click', () => { settingsModal.style.display = 'none'; this.updateStatus('Settings saved', true); });
    generateBtn?.addEventListener('click', () => { this.generateDigest(); });
    settingsModal?.addEventListener('click', (e) => { if (e.target === settingsModal) settingsModal.style.display = 'none'; });

    // Headline expansion (existing behavior)
    document.addEventListener('click', (e) => {
      const header = e.target.closest('.headline-header');
      if (header) header.closest('.headline-item')?.classList.toggle('expanded');
    });
  }

  switchTab(tabName) {
    this.currentTab = tabName;

    document.querySelectorAll('.tab-btn').forEach(btn => {
      btn.classList.toggle('active', btn.dataset.tab === tabName);
    });
    document.querySelectorAll('.tab-panel').forEach(panel => {
      const active = panel.id === tabName;
      panel.classList.toggle('active', active);
      panel.style.display = active ? '' : 'none';
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
      await vertesiaAPI.executeAsync({ Task: 'begin' });
      console.log('Pulse generation started. Waiting 5 minutes...');
      await new Promise(r => setTimeout(r, 5 * 60 * 1000));
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

  // ---------- Exact-format Parser (1–20) ----------
  parseArticlesExact(content) {
    if (!content) return [];
    const text = content
      .replace(/\r\n?/g, '\n')
      .replace(/[“”]/g, '"')
      .replace(/[‘’]/g, "'")
      .trim();

    // Scope to MICRO-ARTICLES, stop at OPPORTUNITIES & CONSIDERATIONS
    const microStart = text.search(/^##\s*MICRO-ARTICLES\s*$/im);
    let scope = microStart >= 0 ? text.slice(microStart) : text;
    const ocIdx = scope.search(/^##\s*OPPORTUNITIES\s*&\s*CONSIDERATIONS\s*$/im);
    if (ocIdx >= 0) scope = scope.slice(0, ocIdx);

    const sectionRe = /^###\s*\d+[^\n]*\n\*\*(.+?)\*\*\n([\s\S]*?)(?=^---\s*$|^###\s*\d+|\Z)/gim;
    const articles = [];
    let m, idx = 0;

    while ((m = sectionRe.exec(scope)) !== null) {
      idx += 1;
      const headline = m[1].trim();
      let body = m[2].trim();

      // Optional Citations
      let citations = [];
      const citMatch = body.match(/\*\*Citations:\*\*([\s\S]*)$/i);
      if (citMatch) {
        const citBlock = citMatch[1].trim();
        body = body.slice(0, citMatch.index).trim();
        citations = citBlock
          .split('\n')
          .map(l => l.trim())
          .filter(l => l && /^[\-\u2022]/.test(l))
          .map(l => {
            const line = l.replace(/^[-\u2022]\s*/, '').trim();
            const url = (line.match(/https?:\/\/\S+/) || [null])[0];
            const title = (url ? line.replace(url, '') : line)
              .replace(/\s*[–—-]\s*$/, '')
              .replace(/\s*\.\s*$/, '')
              .trim()
              .replace(/^"+|"+$/g, '');
            return url ? { title: title || 'Source', url } : null;
          })
          .filter(Boolean);
        const seen = new Set();
        citations = citations.filter(c => {
          const key = c.url.toLowerCase();
          if (seen.has(key)) return false;
          seen.add(key);
          return true;
        });
      }

      articles.push({ index: idx, headline, body, citations });
    }

    return articles;
  }

  formatArticleExact(a) {
    const lines = [];
    lines.push(`### ${a.index}`);
    lines.push(`**${a.headline}**`);
    lines.push('');
    lines.push(a.body.trim());
    if (a.citations && a.citations.length) {
      lines.push('');
      lines.push('**Citations:**');
      a.citations.forEach(c => lines.push(`- ${c.title}. ${c.url}`));
    }
    return lines.join('\n');
  }

  // ---------- Digest load (keeps your existing flow) ----------
  async loadLatestDigest() {
    this.updateStatus('Loading...', false);

    try {
      console.log('=== Loading all objects ===');

      const response = await vertesiaAPI.loadAllObjects(1000);
      const allDocuments = response.objects || [];

      allDocuments.sort((a, b) => {
        const dateA = new Date(a.created_at || 0);
        const dateB = new Date(b.created_at || 0);
        return dateB - dateA;
      });

      console.log('All document names:', allDocuments.map(d => d.name).slice(0, 20));

      const digests = allDocuments.filter(doc => {
        const n = (doc.name || '').toLowerCase();
        return n.includes('digest:') || n.includes('scout pulse:');
      });

      console.log('Found digests:', digests.map(d => d.name));

      if (digests.length === 0) {
        console.warn('No digest documents found');
        this.updateStatus('No digests yet', false);
        this.showEmptyState('No digests found. Click "Generate Digest" to create one.');
        return;
      }

      const latestDigest = digests[0];
      console.log('Latest digest:', latestDigest.name, latestDigest.id);

      const digestObject = await vertesiaAPI.getObject(latestDigest.id);
      console.log('Digest object:', digestObject);

      // Robust content extraction (handles inline text or stored file)
      let content;
      if (digestObject.content && digestObject.content.source != null) {
        const src = digestObject.content.source;
        if (typeof src === 'string') {
          content = src;
        } else {
          console.log('Digest is a file, downloading...');
          const fileRef = src.file || src.store || src.path || src.key;
          if (!fileRef) throw new Error('Unknown file reference shape in content.source');
          content = await vertesiaAPI.getFileContent(fileRef);
        }
      } else {
        throw new Error('No content found in digest object');
      }

      console.log('Content loaded, length:', content.length);
      console.log('First 500 chars:', content.substring(0, 500));

      // Keep legacy parse for News/Considerations/Opportunities (if you still want it)
      const parsed = this.parseScoutDigest?.(content);
      if (parsed?.items?.length) {
        this.digest = parsed;
        this.renderDigest();
      }

      // NEW: Parse exact micro-articles and render the Contents tab
      this.articles = this.parseArticlesExact(content);
      this.renderContents();

      this.updateStatus('Active', true);

      // Footer timestamp
      const date = new Date(latestDigest.created_at);
      const footer = document.querySelector('.widget-footer');
      let timestamp = footer?.querySelector('.last-updated');
      if (footer && !timestamp) {
        timestamp = document.createElement('div');
        timestamp.className = 'last-updated';
        timestamp.style.fontSize = '11px';
        timestamp.style.color = 'var(--text-muted)';
        footer.appendChild(timestamp);
      }
      if (timestamp) timestamp.textContent = `Updated ${this.getRelativeTime(date)}`;

      console.log('=== Digest loaded successfully ===');
    } catch (error) {
      console.error('Failed to load digest:', error);
      this.updateStatus('Error loading', false);
      this.showEmptyState(`Error: ${error.message}`);
    }
  }

  // ---------- Contents rendering (new) ----------
  renderContents() {
    const list = document.getElementById('contentsList');
    const detail = document.getElementById('contentsDetail');
    if (!list || !detail) return;

    if (!this.articles || this.articles.length === 0) {
      list.innerHTML = '<div class="empty-state">No micro-articles found.</div>';
      detail.innerHTML = '<div class="empty-state">Select an article to view it.</div>';
      return;
    }

    // Limit to first 20, as requested
    const items = this.articles.slice(0, 20);

    list.innerHTML = items.map(a => `
      <div class="article-item"
           data-index="${a.index}"
           style="padding:8px 6px; cursor:pointer; border-radius:8px; margin-bottom:6px;">
        <div style="font-weight:700; color:var(--primary,#111827);">#${a.index}</div>
        <div style="font-size:13px; line-height:1.3;">${a.headline}</div>
      </div>
    `).join('');

    // interaction
    list.querySelectorAll('.article-item').forEach(el => {
      el.addEventListener('click', () => {
        const idx = Number(el.dataset.index);
        const a = items.find(x => x.index === idx);
        if (!a) return;
        const formatted = this.formatArticleExact(a);
        detail.textContent = ''; // clear
        const pre = document.createElement('pre');
        pre.style.margin = '0';
        pre.style.whiteSpace = 'pre-wrap';
        pre.textContent = formatted; // exact format as text
        detail.appendChild(pre);

        // simple highlight
        list.querySelectorAll('.article-item').forEach(i => i.style.background = '');
        el.style.background = 'rgba(59,130,246,0.08)';
      });
    });

    // Auto-select #11 if present; else select #1
    const defaultPick = items.find(x => x.index === 11) || items[0];
    const autoEl = list.querySelector(`.article-item[data-index="${defaultPick.index}"]`);
    autoEl?.click();
  }

  // ---------- Existing helpers ----------
  showEmptyState(message) {
    const containers = ['newsList', 'considerationsList', 'opportunitiesList', 'sourcesList'];
    containers.forEach(id => {
      const container = document.getElementById(id);
      if (container) container.innerHTML = `<div class="empty-state">${message}</div>`;
    });
  }

  categorizeHeadline(headline) {
    const lower = headline.toLowerCase();
    if (lower.match(/concern|risk|unsustainable|warning|faces|challenge|collides|volatile|extreme|bubble|caution|test|delay|setback|miss|downgrade|compression|overhang|execution|regulatory/)) {
      return 'considerations';
    }
    if (lower.match(/opportunity|power|dominance|renaissance|lead|momentum|strategic|explosive|record|growth|win|surges|milestone/)) {
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
        sources.push({ title: title || 'Source', url: urlMatch[1] });
      }
    });
    return sources;
  }

  renderDigest() {
    if (!this.digest) return;

    const news = [], considerations = [], opportunities = [], sources = [];
    this.digest.items.forEach(item => {
      item.news.forEach(entry => news.push({ ticker: item.ticker, headline: entry.headline, bullets: entry.bullets, exposure: item.exposure }));
      item.considerations.forEach(entry => considerations.push({ ticker: item.ticker, headline: entry.headline, bullets: entry.bullets, exposure: item.exposure }));
      item.opportunities.forEach(entry => opportunities.push({ ticker: item.ticker, headline: entry.headline, bullets: entry.bullets, exposure: item.exposure }));
      if (item.sources.length > 0) sources.push({ ticker: item.ticker, links: item.sources });
    });

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
          <div class="headline-text">${item.ticker ? (item.ticker + ': ') : ''}${item.headline}</div>
          <div class="headline-toggle">▼</div>
        </div>
        <div class="headline-details">
          ${typeof item.exposure === 'number' ? `<div class="headline-ticker">${item.ticker || ''} ${item.exposure.toFixed(1)}% exposure</div>` : ''}
          ${item.bullets && item.bullets.length ? `
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
    if (statusDot) statusDot.style.background = isActive ? 'var(--success)' : '#9ca3af';
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
