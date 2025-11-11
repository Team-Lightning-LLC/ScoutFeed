// widget.js — Portfolio Pulse (robust, newest "digest" discovery, PDF/MD aware)

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
      objects.sort((a, b) => new Date(b.updated_at || b.created_at || 0) - new Date(a.updated_at || a.created_at || 0));

      // === Digest discovery (simple + strict) ===
      // If it has the word "digest" anywhere in name OR properties.title → it's a candidate
      const candidates = objects.filter(o => {
        const hay = `${o.name || ''} ${o.properties?.title || ''}`.toLowerCase();
        return hay.includes('digest');
      });

      if (candidates.length === 0) {
        console.warn('[Pulse] No digest-like objects found. Available names:', objects.map(o => o.name));
        this.updateStatus('No digests yet', false);
        this.showEmptyState('No digests found.');
        return;
      }

      const latestDigest = candidates[0]; // already sorted newest first
      console.log('[Pulse] Using digest:', latestDigest.name, latestDigest.id);

      const digestObject = await vertesiaAPI.getObject(latestDigest.id);

      // -------- robust content extraction (PDF or text) --------
      let content;
      const src = digestObject?.content?.source;
      if (!src) throw new Error('No content found in digest object');

      if (typeof src === 'string' && !src.startsWith('gs://') && !src.startsWith('s3://')) {
        // inline text
        content = src;
      } else {
        // stored file: normalize to a fileRef and download as text (PDF-aware)
        const fileRef = typeof src === 'string' ? src : (src.file || src.store || src.path || src.key);
        if (!fileRef) throw new Error('Unknown file reference shape in content.source');
        content = await this._downloadTextSmart(fileRef);
      }

      console.log('[Pulse] sample text →', content.slice(0, 800));

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
      if (ts) ts.textContent = `Updated ${this.getRelativeTime(new Date(latestDigest.updated_at || latestDigest.created_at))}`;
    } catch (err) {
      console.error('Load error:', err);
      this.updateStatus('Error loading', false);
      this.showEmptyState(`Error: ${err.message}`);
    }
  }

  // Download text from a storage ref, auto-detecting PDFs/markdown
  async _downloadTextSmart(fileRef) {
    // Try download-url endpoint first (preferred)
    let urlData = null;
    if (typeof vertesiaAPI.getDownloadUrl === 'function') {
      urlData = await vertesiaAPI.getDownloadUrl(fileRef, 'original');
    } else {
      // direct call if helper not present
      const resp = await fetch(`${CONFIG.VERTESIA_BASE_URL}/objects/download-url`, {
        method: 'POST',
        headers: {
          'Authorization': `Bearer ${CONFIG.VERTESIA_API_KEY}`,
          'Content-Type': 'application/json'
        },
        body: JSON.stringify({ file: fileRef, format: 'original' })
      });
      if (!resp.ok) throw new Error(`download-url failed: ${resp.status}`);
      urlData = await resp.json();
    }

    const res = await fetch(urlData.url);
    if (!res.ok) throw new Error(`Download failed: ${res.status} ${res.statusText}`);

    const ctype = (res.headers.get('content-type') || '').toLowerCase();

    // text-like → return as text
    if (ctype.includes('text/') || ctype.includes('json') || ctype.includes('markdown') || ctype.includes('csv')) {
      return await res.text();
    }

    const buf = await res.arrayBuffer();
    if (this._looksLikePdf(buf, ctype)) {
      return await this._pdfArrayBufferToText(buf);
    }

    // Fallback to UTF-8 text decode
    try {
      return new TextDecoder('utf-8', { fatal: false }).decode(new Uint8Array(buf));
    } catch {
      throw new Error('Unsupported digest content format');
    }
  }

  _looksLikePdf(buf, ctype) {
    if (ctype.includes('pdf')) return true;
    const bytes = new Uint8Array(buf.slice(0, 5));
    // “%PDF-”
    return bytes[0] === 0x25 && bytes[1] === 0x50 && bytes[2] === 0x44 && bytes[3] === 0x46 && bytes[4] === 0x2d;
  }

  // Use pdf.js to extract text from a PDF
  async _pdfArrayBufferToText(buf) {
    await this._ensurePdfJs();
    const loadingTask = window.pdfjsLib.getDocument({ data: buf });
    const pdf = await loadingTask.promise;

    let out = '';
    for (let p = 1; p <= pdf.numPages; p++) {
      const page = await pdf.getPage(p);
      const content = await page.getTextContent();
      const strings = content.items.map(it => ('str' in it ? it.str : (it?.text || '')));
      out += strings.join(' ') + '\n\n';
    }
    return out
      .replace(/\u00AD/g, '')      // soft hyphen
      .replace(/-\s+\n/g, '')      // hyphen line wraps
      .replace(/\s+\n/g, '\n')
      .trim();
  }

  async _ensurePdfJs() {
    if (window.pdfjsLib) return;
    const core = document.createElement('script');
    core.src = 'https://cdnjs.cloudflare.com/ajax/libs/pdf.js/3.11.174/pdf.min.js';
    core.defer = true;
    const workerSrc = 'https://cdnjs.cloudflare.com/ajax/libs/pdf.js/3.11.174/pdf.worker.min.js';
    await new Promise((resolve, reject) => {
      core.onload = () => { try { window.pdfjsLib.GlobalWorkerOptions.workerSrc = workerSrc; resolve(); } catch (e) { reject(e); } };
      core.onerror = reject;
      document.head.appendChild(core);
    });
  }

  /* ===================== PARSING ===================== */
  parseDigest(raw) {
    const text = this._normalizeText(raw);

    // Title (best-effort)
    const title =
      (text.match(/^\s*(?:Scout Pulse|Portfolio Digest|Digest)\s*:\s*([^\n]+)$/mi)?.[1] ||
       text.match(/^\s*Title\s*:\s*([^\n]+)$/mi)?.[1] || 'Portfolio Digest').trim();

    const lines = text.split('\n');

    // Find headers: markdown headers OR headline followed by bullets soon after
    const headerIdx = [];
    for (let i = 0; i < lines.length; i++) {
      const L = lines[i].trim();
      if (!L) continue;
      if (/^#{1,3}\s+/.test(L)) { headerIdx.push(i); continue; }
      if (this._isBulletLine(L) || /^sources?\s*:$/i.test(L)) continue;
      let bulletAhead = false, seen = 0;
      for (let k = 1; k <= 8 && i + k < lines.length; k++) {
        const t = lines[i + k].trim();
        if (!t) continue; seen++;
        if (this._isBulletLine(t)) { bulletAhead = true; break; }
        if (seen >= 5) break;
      }
      if (bulletAhead) headerIdx.push(i);
    }

    if (headerIdx.length === 0) {
      for (let i = 0; i < lines.length; i++) {
        if (/^[A-Z][^:]{2,80}:\s*[^\n]+$/.test(lines[i])) headerIdx.push(i);
      }
    }

    // Fallback: chunk by blank lines if still empty
    if (headerIdx.length === 0) {
      const chunks = text.split(/\n{2,}/).map(s => s.trim()).filter(Boolean);
      const items = [];
      for (const ch of chunks) {
        const firstLine = ch.split('\n')[0] || 'Update';
        const bullets = this._extractBullets(ch);
        const ticker = this._inferTicker(firstLine, ch) || this._inferTicker(ch, ch);
        if (!bullets.length || !ticker || ['QUANTUM','NUCLEAR','AI','MARKET'].includes(ticker)) continue;
        const exposure = this._extractExposure(ch);
        const category = this._categorize(firstLine);
        let t = items.find(i => i.ticker === ticker);
        if (!t) t = items[items.push({ ticker, name: firstLine, exposure, news: [], considerations: [], opportunities: [], sources: [] })-1];
        const entry = { headline: firstLine, bullets };
        if (category === 'considerations') t.considerations.push(entry); else if (category === 'opportunities') t.opportunities.push(entry); else t.news.push(entry);
      }
      return { title, items };
    }

    const sections = [];
    for (let h = 0; h < headerIdx.length; h++) {
      const start = headerIdx[h];
      const end = (h + 1 < headerIdx.length ? headerIdx[h + 1] : lines.length);
      let headline = lines[start].replace(/^#{1,3}\s+/, '').trim();
      let topic = headline;
      const m = headline.match(/^([^:]{2,80}):\s*(.+)$/);
      if (m) { topic = m[1].trim(); headline = m[2].trim(); }
      const body = lines.slice(start + 1, end).join('\n').trim();
      sections.push({ topic, headline, body });
    }

    const items = [];
    for (const sec of sections) {
      const ticker = this._inferTicker(sec.topic, sec.body) || this._inferTicker(sec.headline, sec.body);
      if (!ticker || ['QUANTUM','NUCLEAR','AI','MARKET'].includes(ticker)) continue;
      const exposure = this._extractExposure(sec.body);
      const bullets  = this._extractBullets(sec.body);
      const sources  = this._extractSources(sec.body);
      const category = this._categorize(sec.headline);
      if (!bullets.length) continue;
      let t = items.find(i => i.ticker === ticker);
      if (!t) { t = { ticker, name: sec.topic, exposure, news: [], considerations: [], opportunities: [], sources: [] }; items.push(t); }
      const entry = { headline: sec.headline, bullets };
      if (category === 'considerations') t.considerations.push(entry); else if (category === 'opportunities') t.opportunities.push(entry); else t.news.push(entry);
      sources.forEach(s => { if (!t.sources.find(x => x.url === s.url)) t.sources.push(s); });
    }

    return { title, items };
  }

  _normalizeText(s) {
    return s
      .replace(/\r/g, '')
      .replace(/-\n/g, '')
      .replace(/\u00AD/g, '')
      .replace(/[“”]/g, '"').replace(/[‘’]/g, "'")
      .replace(/[–—]/g, '-')
      .replace(/[•▪●·]/g, '•')
      .replace(/\t/g, '  ')
      .replace(/[ \u00A0]+$/gm, '')
      .replace(/\n{3,}/g, '\n\n');
  }

  _isBulletLine(line) { return /^[•\-*]\s+/.test(line) || /^\d+\.\s+/.test(line); }

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
    const t = (topic || '').toLowerCase();
    for (const [k,v] of Object.entries(map)) if (t.includes(k)) return v;
    const mc = (body || '').match(/Market Context.*?\b([A-Z]{2,5})\b/);
    if (mc) return mc[1];
    const paren = (body || '').match(/\(([A-Z]{2,5})\)/);
    if (paren) return paren[1];
    return null;
  }

  _extractExposure(body) {
    const m = (body || '').match(/([\d.]+)%\s+(?:portfolio|of portfolio|exposure)/i);
    return m ? parseFloat(m[1]) : 0;
  }

  _extractBullets(body) {
    return (body || '').split('\n')
      .map(l => l.trim())
      .filter(l => /^([•\-*]|\d+\.)\s+/.test(l))
      .map(l => l.replace(/^([•\-*]|\d+\.)\s+/, '').trim());
  }

  _extractSources(body) {
    const out = [];
    const m = (body || '').match(/^(?:Citations?|Sources?)\s*:\s*([\s\S]*?)$/mi);
    if (!m) return out;
    m[1].split('\n').map(l => l.trim()).filter(Boolean).forEach(line => {
      const url = (line.match(/(https?:\/\/[^\s]+)/) || [])[1];
      if (!url) return;
      const title = line.replace(url, '').trim().replace(/^[\-–—:\s"]+|["\s]+$/g, '') || 'Source';
      out.push({ title, url });
    });
    return out;
  }

  _categorize(headline) {
    const h = (headline || '').toLowerCase();
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
