// widget.js — Portfolio Pulse (clean rebuild)
// Loads the latest "Digest" file, parses micro-articles, and displays them neatly.

class PulseWidget {
  constructor() {
    this.isGenerating = false;
    this.digest = null;
    this.init();
  }

  /* ===== Lifecycle ===== */
  init() {
    this.bindUI();
    this.loadLatestDigest();
    setInterval(() => this.loadLatestDigest(), 30000);
  }

  bindUI() {
    // tab switching
    document.querySelectorAll('.tab-btn').forEach(btn => {
      btn.addEventListener('click', () => this.switchTab(btn.dataset.tab));
    });

    // generate button
    const btn = document.getElementById('generateBtn');
    if (btn) btn.addEventListener('click', () => this.generateDigest());

    // expand/collapse
    document.addEventListener('click', e => {
      const header = e.target.closest('.headline-header');
      if (!header) return;
      header.closest('.headline-item')?.classList.toggle('expanded');
    });
  }

  switchTab(tab) {
    document.querySelectorAll('.tab-btn').forEach(b =>
      b.classList.toggle('active', b.dataset.tab === tab)
    );
    document.querySelectorAll('.tab-panel').forEach(p =>
      p.classList.toggle('active', p.id === tab)
    );
  }

  /* ===== Generation ===== */
  async generateDigest() {
    if (this.isGenerating) return;
    this.isGenerating = true;

    const btn = document.getElementById('generateBtn');
    btn.disabled = true;
    btn.textContent = 'Generating...';
    this.updateStatus('Generating...', false);

    try {
      await vertesiaAPI.executeAsync({ Task: 'begin' });
      await new Promise(r => setTimeout(r, 5 * 60 * 1000));
      await this.loadLatestDigest();
    } catch (err) {
      console.error(err);
      alert('Failed to generate digest');
    } finally {
      this.isGenerating = false;
      btn.disabled = false;
      btn.textContent = 'Generate Digest';
    }
  }

  /* ===== Load ===== */
  async loadLatestDigest() {
    this.updateStatus('Loading...', false);

    try {
      const { objects = [] } = await vertesiaAPI.loadAllObjects(1000);
      if (!objects.length) throw new Error('No documents found');

      // sort newest
      objects.sort((a, b) => new Date(b.updated_at || b.created_at) - new Date(a.updated_at || a.created_at));

      // pick first "digest"
      const digestObj = objects.find(o =>
        `${o.name || ''} ${o.properties?.title || ''}`.toLowerCase().includes('digest')
      );
      if (!digestObj) throw new Error('No digest found');

      const object = await vertesiaAPI.getObject(digestObj.id);
const src = object?.content?.source;
if (!src) throw new Error('No content source');

let text;

// Handles all storage URIs and inline text
if (typeof src === 'string') {
  if (src.startsWith('gs://') || src.startsWith('s3://')) {
    console.log('[Pulse] Detected remote source:', src);
    text = await this.downloadAsText(src);
  } else {
    text = src;
  }
} else if (typeof src === 'object') {
  const fileRef = src.file || src.store || src.path || src.key;
  console.log('[Pulse] Downloading from structured source:', fileRef);
  text = await this.downloadAsText(fileRef);
}

if (!text || text.trim().length < 20) {
  throw new Error('Digest text empty after retrieval');
}


      if (!text || text.trim().length < 20) throw new Error('Empty digest text');
      this.digest = this.parseDigest(text);
      this.renderDigest();

      this.updateStatus('Active', true);
    } catch (err) {
      console.error(err);
      this.updateStatus('Error', false);
      this.showEmpty('Error loading digest');
    }
  }

  async downloadAsText(fileRef) {
    const urlData = await vertesiaAPI.getDownloadUrl(fileRef, 'original');
    const res = await fetch(urlData.url);
    const ctype = (res.headers.get('content-type') || '').toLowerCase();

    if (ctype.includes('text') || ctype.includes('json')) return await res.text();

    const buf = await res.arrayBuffer();
    if (ctype.includes('pdf') || new TextDecoder().decode(buf.slice(0, 5)).startsWith('%PDF')) {
      await this.ensurePdfJs();
      const pdf = await window.pdfjsLib.getDocument({ data: buf }).promise;
      let out = '';
      for (let i = 1; i <= pdf.numPages; i++) {
        const page = await pdf.getPage(i);
        const text = await page.getTextContent();
        out += text.items.map(t => t.str).join(' ') + '\n';
      }
      return out;
    }
    return new TextDecoder('utf-8').decode(buf);
  }

  async ensurePdfJs() {
    if (window.pdfjsLib) return;
    const s = document.createElement('script');
    s.src = 'https://cdnjs.cloudflare.com/ajax/libs/pdf.js/3.11.174/pdf.min.js';
    document.head.appendChild(s);
    await new Promise(r => (s.onload = r));
    window.pdfjsLib.GlobalWorkerOptions.workerSrc =
      'https://cdnjs.cloudflare.com/ajax/libs/pdf.js/3.11.174/pdf.worker.min.js';
  }

  /* ===== Parse ===== */
  parseDigest(raw) {
    const text = raw.replace(/\r/g, '').replace(/\u00AD/g, '').trim();
    const parts = text.split(/(?=Article\s+\d+|Portfolio\s+Opportunities|Portfolio\s+Considerations)/gi);
    const cards = parts
      .map(block => {
        const lines = block.split('\n').map(l => l.trim()).filter(Boolean);
        const title = lines.shift()?.replace(/\*/g, '').trim() || 'Untitled';
        const body = lines.join('\n');

        // bullets
        const bullets = (body.match(/^[•\-*]\s.*$/gm) || []).map(b => b.replace(/^[•\-*]\s*/, '').trim());

        // citations
        const citations = [];
        const m = body.match(/\*\*Citations:\*\*([\s\S]*)$/i);
        if (m) {
          m[1]
            .split('\n')
            .map(l => l.trim())
            .filter(l => l.startsWith('-') || l.startsWith('•'))
            .forEach(l => {
              const url = (l.match(/https?:\/\/\S+/) || [])[0];
              if (!url) return;
              const t = l.replace(/[-•]\s*/, '').replace(url, '').trim();
              citations.push({ title: t || 'Source', url });
            });
        }

        let category = 'news';
        if (/consideration/i.test(title)) category = 'considerations';
        if (/opportunit/i.test(title)) category = 'opportunities';

        return { title, bullets, sources: citations, category };
      })
      .filter(c => c.title.length > 3);

    return { title: 'Portfolio Digest', cards };
  }

  /* ===== Render ===== */
  renderDigest() {
    if (!this.digest) return;

    const group = { news: [], opportunities: [], considerations: [] };
    this.digest.cards.forEach(c => group[c.category].push(c));

    this.renderGroup('newsList', group.news);
    this.renderGroup('opportunitiesList', group.opportunities);
    this.renderGroup('considerationsList', group.considerations);
  }

  renderGroup(id, items) {
    const el = document.getElementById(id);
    if (!el) return;
    if (!items.length) return (el.innerHTML = '<div class="empty-state">No content</div>');

    el.innerHTML = items
      .map(
        (a, i) => `
      <div class="headline-item" data-i="${i}">
        <div class="headline-header">
          <div class="headline-text">${a.title}</div>
          <div class="headline-toggle">▼</div>
        </div>
        <div class="headline-details">
          ${
            a.bullets.length
              ? `<ul class="headline-bullets">${a.bullets.map(b => `<li>${b}</li>`).join('')}</ul>`
              : `<p>${a.body || ''}</p>`
          }
          ${
            a.sources.length
              ? `<div class="citations">${a.sources
                  .map(s => `<a href="${s.url}" target="_blank">${s.title}</a>`)
                  .join('<br>')}</div>`
              : ''
          }
        </div>
      </div>`
      )
      .join('');
  }

  /* ===== UI Helpers ===== */
  updateStatus(text, active) {
    const dot = document.querySelector('.status-dot');
    const txt = document.querySelector('.status-text');
    if (txt) txt.textContent = text;
    if (dot) dot.style.background = active ? 'var(--success)' : '#9ca3af';
  }

  showEmpty(msg) {
    ['newsList', 'considerationsList', 'opportunitiesList'].forEach(id => {
      const el = document.getElementById(id);
      if (el) el.innerHTML = `<div class="empty-state">${msg}</div>`;
    });
  }
}

/* bootstrap */
document.addEventListener('DOMContentLoaded', () => {
  window.pulseWidget = new PulseWidget();
});
