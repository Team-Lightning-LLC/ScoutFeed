// widget.js — Portfolio Pulse (single-tab, all articles → News)

class PulseWidgetController {
  constructor() {
    this.digest = null;
    this.isGenerating = false;
    this.init();
  }

  /* =============== LIFECYCLE =============== */
  init() {
    this.setupEventListeners();
    this.loadLatestDigest();
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

    // Expand / collapse cards
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

      // choose latest object with "digest" in name/title
      const candidates = objects.filter(o => {
        const hay = `${o.name || ''} ${o.properties?.title || ''}`.toLowerCase();
        return hay.includes('digest');
      });

      if (!candidates.length) {
        this.updateStatus('No digests', false);
        this.showEmptyState('No digests found.');
        return;
      }

      const latest = candidates[0];
      const digestObject = await vertesiaAPI.getObject(latest.id);

      // content extraction
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

      const parsed = this.parseDigest(content);            // returns { title, items[] }
      const newsCards = this.flattenAllToNews(parsed);     // → [{headline, bullets, label}]

      if (!newsCards.length) {
        this.showEmptyState('Digest loaded but no items found. Check formatting.');
        this.updateStatus('No items', false);
        return;
      }

      this.renderNews(newsCards);
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

  // Download text; supports PDFs via pdf.js
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

  /* =============== PARSING =============== */
  parseDigest(raw) {
    const text = this._normalizeText(raw);
    const lines = text.split('\n');

    // Header detection: markdown headers or a strong line before bullets
    const headerIdx = [];
    for (let i = 0; i < lines.length; i++) {
      const L = lines[i].trim();
      if (!L) continue;
      if (/^#{1,3}\s+/.test(L)) { headerIdx.push(i); continue; }
      // "bold-ish" lines (often **Headline**)
      if (/^\*\*.+\*\*$/.test(L)) { headerIdx.push(i); continue; }
      // catch headline followed by bullets
      let ahead = false, seen = 0;
      for (let k = 1; k <= 8 && i + k < lines.length; k++) {
        const t = lines[i + k].trim();
        if (!t) continue; seen++;
        if (this._isBulletLine(t)) { ahead = true; break; }
        if (seen >= 5) break;
      }
      if (ahead) headerIdx.push(i);
    }

    // If still nothing, chunk by blank lines
    if (!headerIdx.length) {
      const chunks = text.split(/\n{2,}/).map(s => s.trim()).filter(Boolean);
      return {
        title: 'Portfolio Digest',
        items: chunks.map(ch => ({
          topic: ch.split('\n')[0] || 'Update',
          headline: ch.split('\n')[0] || 'Update',
          body: ch
        }))
      };
    }

    const sections = [];
    for (let h = 0; h < headerIdx.length; h++) {
      const start = headerIdx[h];
      const end = (h + 1 < headerIdx.length ? headerIdx[h + 1] : lines.length);
      let headline = lines[start].replace(/^#{1,3}\s+/, '').replace(/^\*\*|\*\*$/g, '').trim();
      let topic = headline;
      const m = headline.match(/^([^:]{2,80}):\s*(.+)$/);
      if (m) { topic = m[1].trim(); headline = m[2].trim(); }
      const body = lines.slice(start + 1, end).join('\n').trim();
      sections.push({ topic, headline, body });
    }

    // Normalize to items structure used downstream
    const items = sections.map(sec => ({
      ticker: null,                 // ignored in single-tab mode
      name: sec.topic,
      exposure: 0,
      news: [{ headline: sec.headline, bullets: this._extractBullets(sec.body), body: sec.body }],
      considerations: [],
      opportunities: [],
      sources: []
    }));

    return { title: 'Portfolio Digest', items };
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

  _extractBullets(body) {
    const raw = (body || '').split('\n')
      .map(l => l.trim())
      .filter(l => /^([•\-*]|\d+\.)\s+/.test(l))
      .map(l => l.replace(/^([•\-*]|\d+\.)\s+/, '').trim());

    // if no explicit bullets, use paragraphs as a single “bullet-like” entry
    if (!raw.length) {
      const p = (body || '').split(/\n{2,}/).map(s => s.trim()).filter(Boolean);
      return p.length ? p : [];
    }
    return raw;
  }

  /* =============== RENDER (NEWS ONLY) =============== */
  showEmptyState(message) {
    const el = document.getElementById('newsList');
    if (el) el.innerHTML = `<div class="empty-state">${message}</div>`;
  }

  flattenAllToNews(parsed) {
    const out = [];
    (parsed.items || []).forEach(item => {
      (item.news || []).forEach(n => {
        out.push({
          headline: n.headline || item.name || 'Update',
          bullets: n.bullets || [],
          label: item.name || ''
        });
      });
      // include any “considerations/opportunities” as plain news lines too (flatten)
      (item.considerations || []).forEach(n => out.push({ headline: n.headline, bullets: n.bullets || [], label: item.name || '' }));
      (item.opportunities  || []).forEach(n => out.push({ headline: n.headline, bullets: n.bullets || [], label: item.name || '' }));
    });
    return out;
  }

  renderNews(list) {
    const el = document.getElementById('newsList');
    if (!el) return;
    if (!list.length) { this.showEmptyState('No items'); return; }

    el.innerHTML = list.map((item, i) => `
      <div class="headline-item" data-index="${i}">
        <div class="headline-header">
          <div class="headline-text">${this._escape(item.headline)}</div>
          <div class="headline-toggle">▼</div>
        </div>
        <div class="headline-details">
          ${item.label ? `<div class="headline-ticker" style="margin-bottom:8px;">${this._escape(item.label)}</div>` : ''}
          ${
            item.bullets?.length
              ? `<ul class="headline-bullets">${item.bullets.map(b => `<li>${this._escape(b)}</li>`).join('')}</ul>`
              : '<div style="font-size:13px;color:var(--text);line-height:1.5;">(No bullets)</div>'
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
