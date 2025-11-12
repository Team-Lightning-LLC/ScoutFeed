// stable for the night widget.js — Portfolio Pulse (Stable Viewer + Scheduler Integration)

class PulseWidget {
  constructor() {
    this.digest = null;
    this.isGenerating = false;
    this.init();
  }

  /* ===== Lifecycle ===== */
  init() {
    this.bindUI();
    this.loadLatestDigest(); // load once on startup
    this.scheduleDigestAt("09:30"); // auto run each morning
    // Optional: this.scheduleDigestAt("15:45");
  }

  bindUI() {
    // Manual trigger
    const btn = document.getElementById('generateBtn');
    if (btn) btn.addEventListener('click', () => this.generateDigest());

    // Expand/collapse article cards
    document.addEventListener('click', e => {
      const header = e.target.closest('.headline-header');
      if (!header) return;
      header.closest('.headline-item')?.classList.toggle('expanded');
    });
  }

  /* ===== Scheduler ===== */
  scheduleDigestAt(timeStr) {
    const [h, m] = timeStr.split(':').map(Number);
    const now = new Date();
    const next = new Date(now);
    next.setHours(h, m, 0, 0);
    if (next <= now) next.setDate(next.getDate() + 1);

    const delay = next - now;
    console.log(`[Pulse] Next digest scheduled at ${timeStr} (${(delay / 60000).toFixed(1)} min from now)`);

    setTimeout(async () => {
      console.log(`[Pulse] Running scheduled digest generation...`);
      await this.generateDigest();
      this.scheduleDigestAt(timeStr); // re-schedule for next day
    }, delay);
  }

  /* ===== Manual + Auto Generation ===== */
  async generateDigest() {
    if (this.isGenerating) return;
    this.isGenerating = true;

    const btn = document.getElementById('generateBtn');
    if (btn) {
      btn.disabled = true;
      btn.textContent = 'Generating...';
    }
    this.updateStatus('Generating...', false);

    try {
      await vertesiaAPI.executeAsync({ task: 'begin' });
      // Wait 5 min for async completion
      await new Promise(r => setTimeout(r, 5 * 60 * 1000));
      await this.loadLatestDigest();
    } catch (err) {
      console.error('[Pulse] Generation failed:', err);
      this.showEmpty('Error generating digest');
    } finally {
      this.isGenerating = false;
      if (btn) {
        btn.disabled = false;
        btn.textContent = 'Generate Digest';
      }
      this.updateStatus('Active', true);
    }
  }

  /* ===== Load Digest ===== */
  async loadLatestDigest() {
    this.updateStatus('Loading...', false);

    try {
const { objects = [] } = await vertesiaAPI.loadAllObjects(1000);
if (!objects.length) throw new Error('No documents found');

// filter only digest-like docs then pick newest
const candidates = objects.filter(o => {
  const hay = `${o.name || ''} ${o.properties?.title || ''}`.toLowerCase();
  return hay.includes('digest');
});
if (!candidates.length) throw new Error('No digest found');

candidates.sort((a, b) =>
  new Date(b.updated_at || b.created_at || 0) -
  new Date(a.updated_at || a.created_at || 0)
);
const digestObj = candidates[0];
console.log('[Pulse] Using digest:', digestObj?.name, digestObj?.id, digestObj?.updated_at || digestObj?.created_at);


      // ✅ critical: fetch full object (includes content.source)
      const object = await vertesiaAPI.getObject(digestObj.id);
      const src = object?.content?.source;
      if (!src) throw new Error('No content source');

      let text;
      if (typeof src === 'string') {
        text = src.startsWith('gs://') || src.startsWith('s3://')
          ? await this.downloadAsText(src)
          : src;
      } else if (typeof src === 'object') {
        const fileRef = src.file || src.store || src.path || src.key;
        text = await this.downloadAsText(fileRef);
      }

      if (!text || text.trim().length < 20) throw new Error('Empty digest text');
console.log('[Pulse] Digest text preview:', (text || '').slice(0, 500));

      this.digest = this.parseDigest(text);
      this.digest.created_at = object.created_at || object.updated_at || new Date().toISOString();
      this.renderDigest();
      this.updateStatus('Active', true);
    } catch (err) {
      console.error('[Pulse] Load failed:', err);
      this.updateStatus('Error', false);
      this.showEmpty('Error loading digest');
    }
  }

async downloadAsText(fileRef) {
  const { url } = await vertesiaAPI.getDownloadUrl(fileRef, 'original');
  const res = await fetch(url);
  const ctype = (res.headers.get('content-type') || '').toLowerCase();

  // Text-like
  if (ctype.includes('text') || ctype.includes('json') || ctype.includes('markdown')) {
    return await res.text();
  }

  // Binary → check for PDF
  const buf = await res.arrayBuffer();
  const head = new Uint8Array(buf.slice(0, 5));
  const isPDF = [...head].map(b => String.fromCharCode(b)).join('') === '%PDF';

  if (ctype.includes('pdf') || isPDF) {
    // lazy-load pdf.js once
    if (!window.pdfjsLib) {
      await new Promise((resolve, reject) => {
        const s = document.createElement('script');
        s.src = 'https://cdnjs.cloudflare.com/ajax/libs/pdf.js/3.11.174/pdf.min.js';
        s.onload = resolve; s.onerror = reject; document.head.appendChild(s);
      });
      window.pdfjsLib.GlobalWorkerOptions.workerSrc =
        'https://cdnjs.cloudflare.com/ajax/libs/pdf.js/3.11.174/pdf.worker.min.js';
    }
    const doc = await window.pdfjsLib.getDocument({ data: buf }).promise;
    let out = '';
    for (let i = 1; i <= doc.numPages; i++) {
      const page = await doc.getPage(i);
      const txt = await page.getTextContent();
      out += txt.items.map(t => t.str).join(' ') + '\n';
    }
    return out.trim();
  }

  // Generic binary fallback (best effort)
  return new TextDecoder('utf-8').decode(buf);
}


  /* ===== Parse ===== */
parseDigest(raw) {
  const text = raw.replace(/\r/g, '').replace(/\u00AD/g, '').trim();

  // Support both formats: "Article 1" and "## 1"
  const blocks = text
    .split(/(?=^(?:Article\s+\d+|##\s*\d+))/gim)
    .map(b => b.trim())
    .filter(Boolean);

  const cards = [];

  for (const block of blocks) {
    const lines = block.split('\n').map(l => l.trim()).filter(Boolean);
    if (lines.length < 2) continue;
    if (/^#?\s*Scout Pulse/i.test(lines[0])) continue;

    // Remove section header line like "Article 1" or "## 1"
    if (/^(Article\s+\d+|##\s*\d+)/i.test(lines[0])) lines.shift();

    // Extract title
    let title = 'Untitled Article';
    const titleMatch = lines.find(l => /^#+\s*/.test(l) || /\*\*(.+)\*\*/.test(l));
    if (titleMatch) title = titleMatch.replace(/^#+\s*/, '').replace(/\*\*/g, '').trim();

    // Extract content up to citations
    let endIdx = lines.findIndex(l => /^(\*\*)?\s*(Citations|Sources|References)\s*:?\s*/i.test(l));
    if (endIdx === -1) endIdx = lines.length;

    const bullets = lines
      .slice(0, endIdx)
      .filter(l => /^[•\-*]\s/.test(l))
      .map(l => l.replace(/^[•\-*]\s*/, '').trim());

    // Extract citations
    const sources = [];
    const citeBlock = block.match(/\*\*Citations:\*\*([\s\S]*)$/i);
    if (citeBlock) {
      citeBlock[1]
        .split('\n')
        .map(l => l.trim())
        .filter(l => l.startsWith('-') || l.startsWith('•'))
        .forEach(l => {
          const url = (l.match(/https?:\/\/\S+/) || [])[0];
          if (!url) return;
          const t = l.replace(/[-•]\s*/, '').replace(url, '').trim();
          sources.push({ title: t || 'Source', url });
        });
    }

    cards.push({ title, bullets, sources });
  }

  const docTitle =
    text.match(/^#?\s*Scout Pulse.*$/m)?.[0]?.replace(/^#\s*/, '').trim() ||
    text.match(/^#?\s*Portfolio Digest.*$/m)?.[0]?.replace(/^#\s*/, '').trim() ||
    'Portfolio Digest';

  return { title: docTitle, cards };
}


  /* ===== Render ===== */
  renderDigest() {
    if (!this.digest) return;

    const newsList = document.getElementById('newsList');
    const dateHeader = document.querySelector('.date-display');
    const footerDate = document.querySelector('.last-updated');
    const createdAt = new Date(this.digest.created_at);

    if (dateHeader)
      dateHeader.textContent = createdAt.toLocaleDateString('en-US', {
        month: 'short', day: 'numeric', year: 'numeric'
      });
    if (footerDate)
      footerDate.textContent = `Last Update: ${createdAt.toLocaleString()}`;

    newsList.innerHTML = this.digest.cards.map((a, i) => `
      <div class="headline-item" data-i="${i}">
        <div class="headline-header">
          <div class="headline-text">${this.formatMarkdown(a.title)}</div>
          <div class="headline-toggle">▼</div>
        </div>
        <div class="headline-details">
          ${a.bullets.length ? `<ul class="headline-bullets">${a.bullets.map(b => `<li>${this.formatMarkdown(b)}</li>`).join('')}</ul>` : ''}
          ${a.sources.length ? `
            <div class="headline-sources">
              <strong>Sources:</strong>
              <ul class="source-list">
                ${a.sources.map(s => `<li><a href="${s.url}" target="_blank">${this.formatMarkdown(s.title)}</a></li>`).join('')}
              </ul>
            </div>` : ''}
        </div>
      </div>`).join('');
  }

  /* ===== Helpers ===== */
  formatMarkdown(text) {
    if (!text) return '';
    return text
      .replace(/\*\*(.*?)\*\*/g, '<strong>$1</strong>')
      .replace(/\*(.*?)\*/g, '<em>$1</em>');
  }

  updateStatus(text, active) {
    const dot = document.querySelector('.status-dot');
    const txt = document.querySelector('.status-text');
    if (txt) txt.textContent = text;
    if (dot) dot.style.background = active ? 'var(--success)' : '#9ca3af';
  }

  showEmpty(msg) {
    const el = document.getElementById('newsList');
    if (el) el.innerHTML = `<div class="empty-state">${msg}</div>`;
  }
}

document.addEventListener('DOMContentLoaded', () => {
  window.pulseWidget = new PulseWidget();
});
