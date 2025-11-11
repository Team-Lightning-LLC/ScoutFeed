// widget.js — Portfolio Pulse (rewritten, robust, single-file controller)

class PulseWidgetController {
  constructor() {
    this.currentTab = 'news';
    this.digest = null;
    this.isGenerating = false;
    this.init();
  }

  /* ===================== LIFECYCLE ===================== */
  init() {
    this.setupEventListeners();
    this.loadLatestDigest();
    // auto-refresh
    setInterval(() => this.loadLatestDigest(), 30_000);
  }

  setupEventListeners() {
    // Tabs
    document.querySelectorAll('.tab-btn').forEach(btn => {
      btn.addEventListener('click', () => this.switchTab(btn.dataset.tab));
    });

    // Settings
    const settingsBtn   = document.getElementById('settingsBtn');
    const settingsModal = document.getElementById('settingsModal');
    const cancelBtn     = document.getElementById('cancelSettings');
    const saveBtn       = document.getElementById('saveSettings');
    const generateBtn   = document.getElementById('generateBtn');

    settingsBtn?.addEventListener('click', () => settingsModal.style.display = 'flex');
    cancelBtn ?.addEventListener('click', () => settingsModal.style.display = 'none');
    saveBtn   ?.addEventListener('click', () => {
      settingsModal.style.display = 'none';
      this.updateStatus('Settings saved', true);
    });
    generateBtn?.addEventListener('click', () => this.generateDigest());

    // Headline expand/collapse
    document.addEventListener('click', (e) => {
      const header = e.target.closest('.headline-header');
      if (!header) return;
      header.closest('.headline-item')?.classList.toggle('expanded');
    });
  }

  /* ===================== ACTIONS ===================== */
  async generateDigest() {
    if (this.isGenerating) return;
    this.isGenerating = true;

    const btn = document.getElementById('generateBtn');
    if (btn) { btn.disabled = true; btn.textContent = 'Generating...'; }
    this.updateStatus('Generating...', false);

    try {
      await vertesiaAPI.executeAsync({ Task: 'begin' });
      // give backend time to produce
      await new Promise(res => setTimeout(res, 5 * 60 * 1000));
      await this.loadLatestDigest();
    } catch (err) {
      console.error('Generate error:', err);
      alert(`Failed to generate digest: ${err.message}`);
      this.updateStatus('Error', false);
    } finally {
      this.isGenerating = false;
      if (btn) { btn.disabled = false; btn.textContent = 'Generate Digest'; }
    }
  }

  /* ===================== DATA LOAD ===================== */
  async loadLatestDigest() {
    this.updateStatus('Loading...', false);

    try {
      const { objects = [] } = await vertesiaAPI.loadAllObjects(1000);

      // newest first
      objects.sort((a, b) => new Date(b.created_at || 0) - new Date(a.created_at || 0));

      // pick digest objects by name
      const digests = objects.filter(o => {
        const n = (o.name || '').toLowerCase();
        return n.includes('digest:') || n.includes('scout pulse:');
      });

      if (digests.length === 0) {
        this.showEmptyState('No digests found. Click "Generate Digest" to create one.');
        this.updateStatus('No digests yet', false);
        return;
      }

      const latest = digests[0];
      const obj = await vertesiaAPI.getObject(latest.id);

      const content = await this._fetchContentFromSource(obj?.content?.source);
      if (!content || content.trim().length < 20) {
        throw new Error('Digest content is empty or unreadable');
      }

      const parsed = this.parseDigest(content);

      if (!parsed.items?.length) {
        this.showEmptyState('Digest loaded but no items found. Check formatting.');
        this.updateStatus('No items', false);
        return;
      }

      this.digest = parsed;
      this.renderDigest();
      this.updateStatus('Active', true);

      // footer timestamp
      const footer = document.querySelector('.widget-footer');
      let ts = footer?.querySelector('.last-updated');
      if (!ts && footer) {
        ts = document.createElement('div');
        ts.className = 'last-updated';
        ts.style.fontSize = '11px';
        ts.style.color = 'var(--text-muted)';
        footer.appendChild(ts);
      }
      if (ts) ts.textContent = `Updated ${this.getRelativeTime(new Date(latest.created_at))}`;
    } catch (err) {
      console.error('Load error:', err);
      this.updateStatus('Error loading', false);
      this.showEmptyState(`Error: ${err.message}`);
    }
  }

  // Robust content fetcher (inline text, storage URI strings, or object refs)
  async _fetchContentFromSource(src) {
    if (!src) return null;

    // inline text
    if (typeof src === 'string' && !src.startsWith('gs://') && !src.startsWith('s3://')) {
      return src;
    }

    // string storage URI
    if (typeof src === 'string') {
      return await vertesiaAPI.getFileContent(src);
    }

    // object ref: accept {file}|{store}|{path}|{key}
    const fileRef = src.file || src.store || src.path || src.key;
    if (!fileRef) throw new Error('Unknown file reference shape in content.source');
    return await vertesiaAPI.getFileContent(fileRef);
  }

  /* ===================== PARSING ===================== */
  // Opinionated but tolerant parser for your digest format
  parseDigest(raw) {
    const text = this._normalizeText(raw);

    // Title
    const title =
      (text.match(/^\s*(?:Scout Pulse|Portfolio Digest|Digest)\s*:\s*([^\n]+)$/mi)?.[1] ||
       text.match(/^\s*Title\s*:\s*([^\n]+)$/mi)?.[1] ||
       'Portfolio Digest').trim();

    // Split into sections of: TOPIC: Headline \n body
    const sectionRegex = /^\s*([A-Z][A-Za-z0-9 /&\-\u00C0-\u024F]+)\s*:\s*([^\n]+)\n([\s\S]*?)(?=^\s*[A-Z][A-Za-z0-9 /&\-\u00C0-\u024F]+\s*:\s*[^\n]+\n|$)/gm;

    const items = [];
    let m, index = 0;
    while ((m = sectionRegex.exec(text)) !== null) {
      index++;
      const topic    = m[1].trim();
      const headline = this._cleanLine(m[2]);
      const body     = m[3].trim();

      const ticker   = this._inferTicker(topic, body);
      if (!ticker || ['QUANTUM','NUCLEAR','AI','MARKET'].includes(ticker)) continue;

      const exposure = this._extractExposure(body);
      const bullets  = this._extractBullets(body);
      const sources  = this._extractSources(body);
      const category = this._categorize(headline);

      // upsert ticker bucket
      let t = items.find(i => i.ticker === ticker);
      if (!t) {
        t = { ticker, name: topic, exposure, news: [], considerations: [], opportunities: [], sources: [] };
        items.push(t);
      }
      const entry = { headline, bullets };
      if (category === 'considerations') t.considerations.push(entry);
      else if (category === 'opportunities') t.opportunities.push(entry);
      else t.news.push(entry);

      // merge sources (dedupe by url)
      for (const s of sources) if (!t.sources.find(x => x.url === s.url)) t.sources.push(s);
    }

    return { title, items };
  }

  _normalizeText(s) {
    return s
      // PDF quirks: remove hard hyphen line-breaks and normalize quotes/dashes/bullets
      .replace(/\r/g, '')
      .replace(/-\n/g, '')                       // dehyphenate line wraps
      .replace(/\u00AD/g, '')                    // soft hyphen
      .replace(/[“”]/g, '"').replace(/[‘’]/g, "'")
      .replace(/[–—]/g, '-')
      .replace(/[•▪●·]/g, '•')
      .replace(/\t/g, '  ')
      .replace(/[ \u00A0]+$/gm, '')
      .replace(/\n{3,}/g, '\n\n');
  }

  _cleanLine(s) {
    return s.replace(/\s+/g, ' ').trim();
  }

  _inferTicker(topic, body) {
    const map = {
      'nvidia':'NVDA','nvda':'NVDA',
      'ionq':'IONQ',
      'rigetti':'RGTI','rgti':'RGTI',
      'palantir':'PLTR','pltr':'PLTR',
      'oklo':'OKLO',
      'ge vernova':'GEV','gev':'GEV',
      'vti':'VTI','vong':'VONG',
      'quantum computing':'QUANTUM',
      'ai infrastructure':'AI',
      'market dynamics':'MARKET'
    };
    const t = topic.toLowerCase();
    for (const [k,v] of Object.entries(map)) if (t.includes(k)) return v;

    // fallback: find uppercase ticker in Market Context or parenthetical
    const mc = body.match(/Market Context.*?\b([A-Z]{2,5})\b/);
    if (mc) return mc[1];
    const paren = body.match(/\(([A-Z]{2,5})\)/);
    if (paren) return paren[1];
    return null;
  }

  _extractExposure(body) {
    const m = body.match(/([\d.]+)%\s+(?:portfolio|of portfolio|exposure)/i);
    return m ? parseFloat(m[1]) : 0;
  }

  _extractBullets(body) {
    // support bullets starting with "•", "-", "*"
    return body.split('\n')
      .map(l => l.trim())
      .filter(l => /^([•\-\*])\s+/.test(l))
      .map(l => l.replace(/^([•\-\*])\s+/, '').trim());
  }

  _extractSources(body) {
    // capture citations/sources block until next blank line or section marker
    const m = body.match(/^(?:Citations?|Sources?)\s*:\s*([\s\S]*?)$/mi);
    if (!m) return [];
    return m[1]
      .split('\n')
      .map(l => l.trim())
      .filter(Boolean)
      .map(line => {
        const url = (line.match(/(https?:\/\/[^\s]+)/) || [])[1];
        if (!url) return null;
        const title = line.replace(url, '').trim().replace(/^[-–—:\s"]+|["\s]+$/g, '') || 'Source';
        return { title, url };
      })
      .filter(Boolean);
  }

  _categorize(headline) {
    const h = headline.toLowerCase();
    if (/(concern|risk|unsustainable|warning|faces|challenge|collides|volatile|extreme|bubble|caution|test|headwind|regulatory)/.test(h)) return 'considerations';
    if (/(opportunit|power|dominance|renaissance|lead|momentum|strategic|explosive|record|growth|tailwind|beat|surge)/.test(h)) return 'opportunities';
    return 'news';
  }

  /* ===================== UI ===================== */
  showEmptyState(message) {
    ['newsList','considerationsList','opportunitiesList','sourcesList'].forEach(id => {
      const el = document.getElementById(id);
      if (el) el.innerHTML = `<div class="empty-state">${message}</div>`;
    });
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

    const news = [], cons = [], opps = [], sources = [];

    this.digest.items.forEach(item => {
      item.news.forEach(e => news.push({ ticker: item.ticker, headline: e.headline, bullets: e.bullets, exposure: item.exposure }));
      item.considerations.forEach(e => cons.push({ ticker: item.ticker, headline: e.headline, bullets: e.bullets, exposure: item.exposure }));
      item.opportunities.forEach(e => opps.push({ ticker: item.ticker, headline: e.headline, bullets: e.bullets, exposure: item.exposure }));
      if (item.sources.length) sources.push({ ticker: item.ticker, links: item.sources });
    });

    this._renderHeadlines('newsList', news);
    this._renderHeadlines('considerationsList', cons);
    this._renderHeadlines('opportunitiesList', opps);
    this._renderSources('sourcesList', sources);
  }

  _renderHeadlines(containerId, list) {
    const el = document.getElementById(containerId);
    if (!el) return;
    if (!list.length) { el.innerHTML = '<div class="empty-state">No items in this category</div>'; return; }

    el.innerHTML = list.map((item, i) => `
      <div class="headline-item" data-index="${i}">
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

  _renderSources(containerId, groups) {
    const el = document.getElementById(containerId);
    if (!el) return;
    if (!groups.length) { el.innerHTML = '<div class="empty-state">No sources available</div>'; return; }

    el.innerHTML = groups.map(g => `
      <div class="source-group">
        <div class="source-ticker">${g.ticker}</div>
        ${g.links.slice(0, 5).map(l => `
          <a href="${l.url}" target="_blank" rel="noopener noreferrer" class="source-link" title="${l.title}">
            ${l.title}
          </a>`).join('')}
      </div>
    `).join('');
  }

  /* ===================== UTIL ===================== */
  updateStatus(text, isActive) {
    const dot = document.querySelector('.status-dot');
    const t = document.querySelector('.status-text');
    if (t) t.textContent = text;
    if (dot) dot.style.background = isActive ? 'var(--success)' : '#9ca3af';
  }

  getRelativeTime(date) {
    const now = new Date();
    const diff = now - date;
    const m = Math.floor(diff / 60000), h = Math.floor(m / 60), d = Math.floor(h / 24);
    if (m < 60) return `${m}m ago`;
    if (h < 24) return `${h}h ago`;
    return `${d}d ago`;
  }
}

/* bootstrap */
document.addEventListener('DOMContentLoaded', () => {
  window.pulseWidget = new PulseWidgetController();
});
