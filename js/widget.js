// widget.js — Portfolio Pulse (single-tab, strict micro-article parsing, capped results)

class PulseWidgetController {
  constructor() {
    this.isGenerating = false;
    this.maxItems = 12; // show at most N cards on load
    this.init();
  }

  /* =============== LIFECYCLE =============== */
  init() {
    this.setupEventListeners();
    this.hideOtherTabs();          // ensure News-only UX even if HTML still has extra tabs
    this.loadLatestDigest();
    setInterval(() => this.loadLatestDigest(), 30_000);
  }

  hideOtherTabs() {
    // Hide non-News tabs/panels if they exist in the HTML
    ['considerations','opportunities','sources'].forEach(id => {
      const btn   = document.querySelector(`.tab-btn[data-tab="${id}"]`);
      const panel = document.getElementById(id);
      if (btn)   btn.style.display   = 'none';
      if (panel) panel.style.display = 'none';
    });
    // Force News active
    document.querySelectorAll('.tab-btn').forEach(b => {
      b.classList.toggle('active', b.dataset.tab === 'news');
    });
    document.querySelectorAll('.tab-panel').forEach(p => {
      p.classList.toggle('active', p.id === 'news');
    });
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

    // Expand / collapse
    document.addEventListener('click', (e) => {
      const header = e.target.closest('.headline-header');
      if (!header) return;
      header.closest('.headline-item')?.classList.toggle('expanded');
    });
  }

  /* =============== ACTIONS =============== */
  async generateDigest() {
    if (this.isGenerating) return;
    this.isGenerating = true;

    const btn = document.getElementById('generateBtn');
    if (btn) { btn.disabled = true; btn.textContent = 'Generating...'; }
    this.updateStatus('Generating...', false);

    try {
      await vertesiaAPI.executeAsync({ Task: 'begin' });
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

  /* =============== DATA LOAD =============== */
  async loadLatestDigest() {
    this.updateStatus('Loading...', false);

    try {
      const { objects = [] } = await vertesiaAPI.loadAllObjects(1000);

      // newest first
      objects.sort((a, b) => new Date(b.updated_at || b.created_at || 0) - new Date(a.updated_at || a.created_at || 0));

      // pick latest object with "digest" in name or title
      const latest = objects.find(o => (`${o.name || ''} ${o.properties?.title || ''}`).toLowerCase().includes('digest'));
      if (!latest) {
        this.updateStatus('No digests', false);
        this.showEmptyState('No digests found.');
        return;
      }

      const digestObject = await vertesiaAPI.getObject(latest.id);

      // content extraction (inline string or download file; PDF-aware)
      const src = digestObject?.content?.source;
      if (!src) throw new Error('No content found in digest object');

      let content;
      if (typeof src === 'string' && !src.startsWith('gs://') && !src.startsWith('s3://')) {
        content = src;
      } else {
        const fileRef = typeof src === 'string' ? src : (src.file || src.store || src.path || src.key);
        content = await this._downloadTextSmart(fileRef);
      }

      if (!content || content.trim().length < 20) {
        throw new Error('Digest content is empty or unreadable');
      }

      const microArticles = this.parseMicroArticles(content); // [{title, bullets, body}]
      if (!microArticles.length) {
        this.showEmptyState('Digest loaded but no items found. Check formatting.');
        this.updateStatus('No items', false);
        return;
      }

      // limit items for a sane viewport
      const limited = microArticles.slice(0, this.maxItems);
      this.renderNews(limited);
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

  // download text; supports PDFs via pdf.js
  async _downloadTextSmart(fileRef) {
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
    if (ctype.includes('text/') || ctype.includes('json') || ctype.includes('markdown') || ctype.includes('csv')) {
      return await res.text();
    }

    const buf = await res.arrayBuffer();
    if (this._looksLikePdf(buf, ctype)) return await this._pdfArrayBufferToText(buf);

    try {
      return new TextDecoder('utf-8', { fatal: false }).decode(new Uint8Array(buf));
    } catch {
      throw new Error('Unsupported digest content format');
    }
  }

  _looksLikePdf(buf, ctype) {
    if (ctype.includes('pdf')) return true;
    const b = new Uint8Array(buf.slice(0, 5));
    return b[0] === 0x25 && b[1] === 0x50 && b[2] === 0x44 && b[3] === 0x46 && b[4] === 0x2d; // %PDF-
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
      .replace(/\u00AD/g, '')
      .replace(/-\s+\n/g, '')
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

  /* =============== STRICT MICRO-ARTICLE PARSER =============== */
  parseMicroArticles(raw) {
    const text = this._normalizeText(raw);
    const lines = text.split('\n');

    // A line is a header iff it matches one of these:
    const isHeader = (L) =>
      /^#{1,3}\s+.+/.test(L) ||           // Markdown: #, ##, ###
      /^\*\*.+\*\*$/.test(L) ||           // Bold: **Headline**
      /^[A-Z][^:]{2,80}:\s+.+$/.test(L);  // Title: Subtitle

    // Collect header indices
    const idx = [];
    for (let i = 0; i < lines.length; i++) {
      const L = lines[i].trim();
      if (isHeader(L)) idx.push(i);
    }

    // If no clear headers, bail with zero (avoid “every line” behavior)
    if (!idx.length) return [];

    // Build sections
    const sections = [];
    for (let h = 0; h < idx.length; h++) {
      const start = idx[h];
      const end = h + 1 < idx.length ? idx[h + 1] : lines.length;
      let title = lines[start].trim();
      title = title.replace(/^#{1,3}\s+/, '').replace(/^\*\*|\*\*$/g, '').trim();
      sections.push({
        title,
        body: lines.slice(start + 1, end).join('\n').trim()
      });
    }

    // Convert to renderable items
    return sections.map(sec => {
      const bullets = this._extractBullets(sec.body);
      return {
        title: sec.title,
        bullets: bullets.length ? bullets : this._fallbackParagraphs(sec.body),
        body: sec.body
      };
    }).filter(x => x.title && x.bullets.length);
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

  _extractBullets(body) {
    return (body || '').split('\n')
      .map(l => l.trim())
      .filter(l => /^([•\-*]|\d+\.)\s+/.test(l))
      .map(l => l.replace(/^([•\-*]|\d+\.)\s+/, '').trim());
  }

  _fallbackParagraphs(body) {
    const paras = (body || '').split(/\n{2,}/).map(s => s.trim()).filter(Boolean);
    // Take first paragraph as a single “summary” bullet to avoid flooding UI
    return paras.length ? [paras[0]] : [];
  }

  /* =============== RENDER (NEWS ONLY) =============== */
  showEmptyState(message) {
    const el = document.getElementById('newsList');
    if (el) el.innerHTML = `<div class="empty-state">${message}</div>`;
  }

  renderNews(items) {
    const el = document.getElementById('newsList');
    if (!el) return;

    el.innerHTML = items.map((item, i) => `
      <div class="headline-item" data-index="${i}">
        <div class="headline-header">
          <div class="headline-text">${this._escape(item.title)}</div>
          <div class="headline-toggle">▼</div>
        </div>
        <div class="headline-details">
          ${
            item.bullets?.length
              ? `<ul class="headline-bullets">
                   ${item.bullets.slice(0, 6).map(b => `<li>${this._escape(b)}</li>`).join('')}
                 </ul>`
              : '<div style="font-size:13px;color:var(--text);line-height:1.5;">(No details)</div>'
          }
        </div>
      </div>
    `).join('');
  }

  /* =============== UTIL =============== */
  _escape(s) {
    return String(s || '').replace(/[&<>"']/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
  }

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
