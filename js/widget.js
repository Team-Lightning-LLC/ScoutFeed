// widget.js — Portfolio Pulse (numbered-article parser, NEWS-only rendering)

class PulseWidgetController {
  constructor() {
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

    // Expand/collapse
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
      // allow time for back end to produce the doc
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

      // newest object whose name or title contains "digest"
      const candidates = objects.filter(o => {
        const hay = `${o.name || ''} ${o.properties?.title || ''}`.toLowerCase();
        return hay.includes('digest');
      });

      if (!candidates.length) {
        console.warn('[Pulse] No digest-like objects found.', objects.map(o => o.name));
        this.showEmptyState('No digests found.');
        this.updateStatus('No digests yet', false);
        return;
      }

      const latest = candidates[0];
      const digestObject = await vertesiaAPI.getObject(latest.id);

      // content extraction (handles inline text, gs://, s3://, pdf)
      const src = digestObject?.content?.source;
      if (!src) throw new Error('No content found in digest object');

      let content;
      if (typeof src === 'string' && !src.startsWith('gs://') && !src.startsWith('s3://')) {
        content = src; // inline text
      } else {
        const fileRef = typeof src === 'string' ? src : (src.file || src.store || src.path || src.key);
        if (!fileRef) throw new Error('Unknown file reference shape in content.source');
        content = await this._downloadTextSmart(fileRef);
      }

      if (!content || content.trim().length < 20) {
        throw new Error('Digest content is empty or unreadable');
      }

      const parsed = this.parseNumberedArticles(content);
      if (!parsed.items?.length) {
        this.showEmptyState('Digest loaded but no items found. Check numbering.');
        this.updateStatus('No items', false);
        return;
      }

      this.digest = parsed;
      this.renderNewsOnly();
      this.updateStatus('Active', true);

      // timestamp
      const footer = document.querySelector('.widget-footer');
      let ts = footer?.querySelector('.last-updated');
      if (!ts && footer) {
        ts = document.createElement('div');
        ts.className = 'last-updated';
        ts.style.fontSize = '11px';
        ts.style.color = 'var(--text-muted)';
        footer.appendChild(ts);
      }
      if (ts) ts.textContent = `Updated ${this.getRelativeTime(new Date(latest.updated_at || latest.created_at))}`;
    } catch (err) {
      console.error('Load error:', err);
      this.updateStatus('Error loading', false);
      this.showEmptyState(`Error: ${err.message}`);
    }
  }

  // Download text from storage ref; auto-detect PDFs and extract text
  async _downloadTextSmart(fileRef) {
    let urlData;
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

    if (ctype.includes('text/') || ctype.includes('json') || ctype.includes('markdown') || ctype.includes('csv')) {
      return await res.text();
    }

    const buf = await res.arrayBuffer();
    if (this._looksLikePdf(buf, ctype)) {
      return await this._pdfArrayBufferToText(buf);
    }

    // fallback
    return new TextDecoder('utf-8', { fatal: false }).decode(new Uint8Array(buf));
  }

  _looksLikePdf(buf, ctype) {
    if (ctype.includes('pdf')) return true;
    const b = new Uint8Array(buf.slice(0, 5)); // %PDF-
    return b[0] === 0x25 && b[1] === 0x50 && b[2] === 0x44 && b[3] === 0x46 && b[4] === 0x2d;
  }

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
      .replace(/\u00AD/g, '')   // soft hyphen
      .replace(/-\s+\n/g, '')   // hyphen line wraps
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
      core.onload = () => {
        try { window.pdfjsLib.GlobalWorkerOptions.workerSrc = workerSrc; resolve(); }
        catch (e) { reject(e); }
      };
      core.onerror = reject;
      document.head.appendChild(core);
    });
  }

  /* ===================== PARSING (NUMBERED HEADERS ONLY) ===================== */
  // Only numbered headers define articles:  "1. Headline", "2) Headline", etc.
  // Everything after a header belongs to that article until the next numbered header.
  parseNumberedArticles(raw) {
    const text = this._normalizeText(raw);

    const title = (
      text.match(/^\s*(?:Scout Pulse|Portfolio Digest|Digest)\s*:\s*([^\n]+)$/mi)?.[1] ||
      text.match(/^\s*Title\s*:\s*([^\n]+)$/mi)?.[1] ||
      'Portfolio Digest'
    ).trim();

    const lines = text.split(/\n/);
    const headerRe = /^\s*(\d{1,3})[.)]\s+(.{3,160})$/;

    const heads = [];
    for (let i = 0; i < lines.length; i++) {
      const m = headerRe.exec(lines[i].trim());
      if (m) heads.push({ i, title: m[2].trim() });
    }

    if (!heads.length) return { title, items: [] };

    const sections = [];
    for (let h = 0; h < heads.length; h++) {
      const start = heads[h].i;
      const end   = h + 1 < heads.length ? heads[h + 1].i : lines.length;
      const body  = lines.slice(start + 1, end).join('\n').trim();
      sections.push({ title: heads[h].title, body });
    }

    // Build items strictly from bullets (• or -). If none, fall back to the first paragraph.
    const items = sections.map(sec => {
      const bullets = this._extractBulletsStrict(sec.body);
      const fallback = bullets.length ? [] : this._firstParagraphAsBullet(sec.body);
      return { headline: sec.title, bullets: bullets.length ? bullets : fallback };
    }).filter(x => x.headline && x.bullets.length);

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

  // Only treat • or - as bullets (NOT numbers), so paragraphs aren’t split accidentally
  _extractBulletsStrict(body) {
    return (body || '')
      .split('\n')
      .map(l => l.trim())
      .filter(l => /^[•-]\s+/.test(l))
      .map(l => l.replace(/^[•-]\s+/, '').trim());
  }

  _firstParagraphAsBullet(body) {
    const paras = (body || '').split(/\n{2,}/).map(s => s.trim()).filter(Boolean);
    const p = paras[0] || '';
    return p ? [p] : [];
  }

  /* ===================== UI ===================== */
  showEmptyState(message) {
    const el = document.getElementById('newsList');
    if (el) el.innerHTML = `<div class="empty-state">${message}</div>`;
  }

  renderNewsOnly() {
    if (!this.digest) return;
    const el = document.getElementById('newsList');
    if (!el) return;

    const list = this.digest.items;
    if (!list.length) {
      el.innerHTML = '<div class="empty-state">No items</div>';
      return;
    }

    el.innerHTML = list.map((item, idx) => `
      <div class="headline-item" data-index="${idx}">
        <div class="headline-header">
          <div class="headline-text">${item.headline}</div>
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
