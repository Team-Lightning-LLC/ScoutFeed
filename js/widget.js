// widget.js — Portfolio Pulse (section-based cards, newest “digest”, PDF/MD aware)

class PulseWidgetController {
  constructor() {
    this.currentTab = 'news';
    this.digest = null;      // { title, cards: [{title, bullets[], sources[], category, tag}] }
    this.isGenerating = false;
    this.init();
  }

  /* ===================== LIFECYCLE ===================== */
  init() {
    this.setupEventListeners();
    this.loadLatestDigest();
    // auto-refresh every 30s
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

      // newest first by updated_at, then created_at
      objects.sort((a, b) => new Date(b.updated_at || b.created_at || 0) - new Date(a.updated_at || a.created_at || 0));

      // === Digest discovery ===
      // "If it has 'digest', it's in" — search name OR properties.title (case-insensitive)
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

      if (!parsed.cards?.length) {
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
    // Prefer API helper if available
    let urlData = null;
    if (typeof vertesiaAPI.getDownloadUrl === 'function') {
      urlData = await vertesiaAPI.getDownloadUrl(fileRef, 'original');
    } else {
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
    const text  = this._normalizeText(raw);
    const lines = text.split('\n');

    // --- find section headers (no ticker dependency) ---
    const headerIdx = [];
    for (let i = 0; i < lines.length; i++) {
      const L = lines[i].trim();
      if (!L) continue;
      const plain = L.replace(/\*/g, '').trim();
      if (/^sources?\s*:?\s*$/i.test(plain)) continue;          // never treat Sources as header
      if (/^#{1,3}\s+/.test(L)) { headerIdx.push(i); continue; } // markdown headers
      if (this._isBulletLine(L)) continue;

      // headline followed by bullets
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

    // --- carve sections ---
    const sections = [];
    for (let h = 0; h < headerIdx.length; h++) {
      const start = headerIdx[h];
      const end   = (h + 1 < headerIdx.length ? headerIdx[h + 1] : lines.length);

      // title = header line (strip markdown ### and optional TOPIC: prefix)
      let title = lines[start].replace(/^#{1,3}\s+/, '').trim();
      const m = title.match(/^([^:]{2,80}):\s*(.+)$/);
      if (m) title = `${m[1].trim()}: ${m[2].trim()}`;

      const body = lines.slice(start + 1, end).join('\n').trim();
      sections.push({ title, body });
    }

    // --- split portfolio meta-section into multiple cards ---
    const cards = [];
    sections.forEach(sec => {
      if (/portfolio\s+(opportunities|&|and)\s+considerations/i.test(sec.title)) {
        this._extractPortfolioEntries(sec.body).forEach(entry => {
          cards.push({
            title: entry.title,
            bullets: entry.points,
            sources: [],
            category: 'considerations',
            tag: 'PORTFOLIO'
          });
        });
        return;
      }

      // normal section → build a card
      const bullets = this._extractBullets(sec.body);
      const sources = this._extractSources(sec.body);

      // if no bullets, fall back to paragraphs (split on blank lines)
      const fallbackParas = !bullets.length
        ? sec.body.split(/\n{2,}/).map(s => s.trim()).filter(Boolean)
        : [];

      cards.push({
        title: sec.title,
        bullets: bullets.length ? bullets : fallbackParas,
        sources,
        category: this._categorize(sec.title),
        tag: this._inferTicker(sec.title, sec.body) || 'GENERAL'
      });
    });

    const docTitle =
      (text.match(/^\s*(?:Scout Pulse|Portfolio Digest|Digest)\s*:\s*([^\n]+)$/mi)?.[1] ||
       text.match(/^\s*Title\s*:\s*([^\n]+)$/mi)?.[1] || 'Portfolio Digest').trim();

    return { title: docTitle, cards };
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

  _isBulletLine(line) { return /^[•\-*]|^\d+\./.test(line); }

  // Bullets: join wrapped lines and stop at Sources
  _extractBullets(body) {
    const out = [];
    const arr = (body || '').split('\n');

    const isBullet = (s) => /^([•\-*]|\d+\.)\s+/.test(s.trim());
    const isSources = (s) => /^sources?\s*:?\s*$/i.test(s.replace(/\*/g,'').trim());

    for (let i = 0; i < arr.length; i++) {
      let line = arr[i].trim();
      if (!isBullet(line)) continue;

      // strip marker
      let cur = line.replace(/^([•\-*]|\d+\.)\s+/, '').trim();

      // consume continuation lines until next bullet, blank, or Sources
      while (
        i + 1 < arr.length &&
        arr[i + 1].trim() &&
        !isBullet(arr[i + 1]) &&
        !isSources(arr[i + 1])
      ) {
        cur += ' ' + arr[i + 1].trim();
        i++;
      }
      out.push(cur);
    }
    return out;
  }

  // Sources: tolerant until next header-like line
  _extractSources(body) {
    const out = [];
    const lines = (body || '').split('\n');

    // find the first 'Sources:' line
    let idx = lines.findIndex(l => /^(\*\*)?\s*Sources?\s*:/.test(l.trim()));
    if (idx === -1) idx = lines.findIndex(l => /^Sources?\s*:/.test(l.trim()));
    if (idx === -1) return out;

    for (let i = idx + 1; i < lines.length; i++) {
      const raw = lines[i].trim();
      if (!raw) break;
      if (/^#{1,3}\s+/.test(raw)) break;                 // markdown header
      if (/^[A-Z][^:]{2,80}:\s*$/.test(raw)) break;      // obvious header-like
      const url = (raw.match(/(https?:\/\/\S+)/) || [])[1];
      if (!url) continue;
      const title = raw.replace(url, '').trim().replace(/^[\-–—:\s"]+|["\s]+$/g, '') || 'Source';
      out.push({ title, url });
    }
    return out;
  }

  // Portfolio-wide narrative → entries
  _extractPortfolioEntries(body) {
    const lines = (body || '').replace(/\r/g, '').split('\n');

    const isSubhead = (s) => {
      const t = s.trim().replace(/\*+/g, '');
      if (!t) return false;
      if (/^sources?\s*:$/i.test(t)) return false;
      if (/^([•\-*]|\d+\.)\s+/.test(t)) return false;
      return /^[A-Z][A-Za-z0-9\s,&\-’'():]+$/.test(t) && t.length <= 80;
    };

    const entries = [];
    for (let i = 0; i < lines.length; i++) {
      if (!isSubhead(lines[i])) continue;
      const title = lines[i].trim().replace(/\*+/g, '');
      const paras = [];
      let cur = [];
      for (let j = i + 1; j < lines.length; j++) {
        const L = lines[j];
        if (!L.trim()) { if (cur.length) { paras.push(cur.join(' ')); cur = []; } continue; }
        if (isSubhead(L)) break;
        if (/^([•\-*]|\d+\.)\s+/.test(L.trim())) break;
        cur.push(L.trim());
        i = j;
      }
      if (cur.length) paras.push(cur.join(' '));
      const points = paras.filter(Boolean);
      if (points.length) entries.push({ title, points });
    }
    return entries;
  }

  // Optional tag inference (kept for metadata)
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

    const news = [], cons = [], opps = [];
    const sourceGroups = new Map(); // articleTitle -> [{title,url}]

    const addSources = (articleTitle, links=[]) => {
      if (!links?.length) return;
      if (!sourceGroups.has(articleTitle)) sourceGroups.set(articleTitle, []);
      const arr = sourceGroups.get(articleTitle);
      links.forEach(l => { if (!arr.find(x => x.url === l.url)) arr.push(l); });
    };

    this.digest.cards.forEach(card => {
      const entry = { title: card.title, bullets: card.bullets || [] };
      if (card.category === 'considerations') cons.push(entry);
      else if (card.category === 'opportunities') opps.push(entry);
      else news.push(entry);
      addSources(card.title, card.sources);
    });

    this._renderHeadlines('newsList', news);
    this._renderHeadlines('considerationsList', cons);
    this._renderHeadlines('opportunitiesList', opps);

    const sources = [...sourceGroups.entries()].map(([articleTitle, links]) => ({ articleTitle, links }));
    this._renderSources('sourcesList', sources);
  }

  _renderHeadlines(containerId, list) {
    const el = document.getElementById(containerId);
    if (!el) return;
    if (!list.length) { el.innerHTML = '<div class="empty-state">No items in this category</div>'; return; }

    el.innerHTML = list.map((item, i) => `
      <div class="headline-item" data-index="${i}">
        <div class="headline-header">
          <div class="headline-text">${item.title}</div>
          <div class="headline-toggle">▼</div>
        </div>
        <div class="headline-details">
          ${item.bullets?.length ? `
            <ul class="headline-bullets">
              ${item.bullets.slice(0, 8).map(b => `<li>${b}</li>`).join('')}
            </ul>` : ''
          }
        </div>
      </div>
    `).join('');
  }

  _renderSources(containerId, groups) {
    const el = document.getElementById(containerId);
    if (!el) return;

    if (!groups.length) {
      el.innerHTML = '<div class="empty-state">No sources available</div>';
      return;
    }

    el.innerHTML = groups.map(g => `
      <div class="source-group">
        <div class="source-ticker">${g.articleTitle}</div>
        ${g.links.slice(0, 12).map(link => `
          <a href="${link.url}" target="_blank" rel="noopener noreferrer"
             class="source-link" title="${link.title}">
            ${link.title || link.url}
          </a>
        `).join('')}
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
