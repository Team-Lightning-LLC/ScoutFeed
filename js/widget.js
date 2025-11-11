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

    for (let i = 0; i < lines.length; i++) {/* ===================== PARSING ===================== */
parseDigest(raw) {
  const text = this._normalizeText(raw);

  // --- Simple chunk detection ---
  const regex = /(Article\s+\d+|Portfolio Opportunities|Portfolio Considerations)[\s\S]*?(?=(Article\s+\d+|Portfolio Opportunities|Portfolio Considerations|$))/gi;
  const matches = [...text.matchAll(regex)];

  const cards = matches.map((m, i) => {
    const block = m[0].trim();
    const [titleLine, ...rest] = block.split('\n').filter(Boolean);
    const title = titleLine.replace(/\*/g, '').trim();
    const body = rest.join('\n').trim();

    // bullets: lines starting with a dash or bullet
    const bullets = (body.match(/^[•\-*]\s.*$/gm) || [])
      .map(l => l.replace(/^[•\-*]\s*/, '').trim())
      .filter(Boolean);

    // sources: Citations block
    const citations = [];
    const citationMatch = body.match(/\*\*Citations:\*\*([\s\S]*)$/i);
    if (citationMatch) {
      citations.push(...citationMatch[1]
        .split('\n')
        .map(l => {
          const url = (l.match(/https?:\/\/\S+/) || [])[0];
          if (!url) return null;
          const title = l.replace(/[-•]\s*/, '').replace(url, '').trim();
          return { title: title || 'Source', url };
        })
        .filter(Boolean));
    }

    return {
      title: title || `Article ${i + 1}`,
      bullets,
      sources: citations,
      category: 'news',
      tag: 'DIGEST'
    };
  });

  const docTitle = text.match(/^Digest\s*:\s*(.+)$/im)?.[1]?.trim() || 'Portfolio Digest';
  return { title: docTitle, cards };
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
