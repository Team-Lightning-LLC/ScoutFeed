// widget.js — Portfolio Pulse (final stable build)

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

    // Schedule automatic digest generation at market open (09:30)
    this.scheduleDigestAt("09:30");
    // Optional second daily trigger (uncomment + set time)
    // this.scheduleDigestAt("15:45");
  }

  bindUI() {
    const btn = document.getElementById('generateBtn');
    if (btn) btn.addEventListener('click', () => this.generateDigest());
  }

  /* ===== Generation ===== */
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
      await vertesiaAPI.executeAsync({ Task: 'begin' });
      await new Promise(r => setTimeout(r, 5 * 60 * 1000)); // 5 min delay
      await this.loadLatestDigest();
    } catch (err) {
      console.error(err);
      alert('Failed to generate digest');
    } finally {
      this.isGenerating = false;
      if (btn) {
        btn.disabled = false;
        btn.textContent = 'Generate Digest';
      }
    }
  }

  /* ===== Scheduling ===== */
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
      this.scheduleDigestAt(timeStr); // reschedule next day
    }, delay);
  }

  /* ===== Load ===== */
  async loadLatestDigest() {
    this.updateStatus('Loading...', false);
    try {
      const { objects = [] } = await vertesiaAPI.loadAllObjects(1000);
      if (!objects.length) throw new Error('No documents found');

      // newest first
      objects.sort((a, b) => new Date(b.updated_at || b.created_at) - new Date(a.updated_at || a.created_at));

      const digestObj = objects.find(o =>
        `${o.name || ''} ${o.properties?.title || ''}`.toLowerCase().includes('digest')
      );
      if (!digestObj) throw new Error('No digest found');

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

      this.digest = this.parseDigest(text);
      this.digest.created_at = object.created_at || object.updated_at || new Date().toISOString();
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
    const buf = await res.arrayBuffer();
    const ctype = (res.headers.get('content-type') || '').toLowerCase();

    if (ctype.includes('text') || ctype.includes('json')) return await res.text();

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
    const blocks = text.split(/(?=Article\s+\d+)/gi).map(b => b.trim()).filter(Boolean);
    const cards = [];

    for (const block of blocks) {
      const lines = block.split('\n').map(l => l.trim()).filter(Boolean);
      if (lines.length < 2) continue;
      if (/^#?\s*Scout Pulse/i.test(lines[0])) continue;

      lines.shift();
      let title = 'Untitled Article';
      const titleMatch = lines.find(l =>
        /^#+\s*/.test(l) || /\*\*(.+)\*\*/.test(l) || /^[A-Z][A-Za-z0-9\s,:’'()\-&]+$/.test(l)
      );
      if (titleMatch) {
        title = titleMatch.replace(/^#+\s*/, '').replace(/\*\*/g, '').trim();
      }

      let endIdx = lines.findIndex(l => /^(\*\*)?\s*(Citations|Sources|References)\s*:?\s*/i.test(l));
      if (endIdx === -1) endIdx = lines.length;

      const bullets = lines.slice(0, endIdx)
        .filter(l => /^[•\-*]\s/.test(l))
        .map(l => l.replace(/^[•\-*]\s*/, '').trim());

      const sources = [];
      const citeBlock = block.match(/\*\*Citations:\*\*([\s\S]*)$/i);
      if (citeBlock) {
        citeBlock[1].split('\n').map(l => l.trim())
          .filter(l => l.startsWith('-') || l.startsWith('•'))
          .forEach(l => {
            const url = (l.match(/https?:\/\/\S+/) || [])[0];
            if (!url) return;
            const t = l.replace(/[-•]\s*/, '').replace(url, '').trim();
            sources.push({ title: t || 'Source', url });
          });
      }

      cards.push({ title, bullets, sources, category: 'news' });
    }

    const docTitle =
      text.match(/^#?\s*Scout Pulse.*$/m)?.[0]?.replace(/^#\s*/, '').trim() ||
      text.match(/^#?\s*Portfolio Digest.*$/m)?.[0]?.replace(/^#\s*/, '').trim() ||
      'Portfolio Digest';

    return { title: docTitle, cards };
  }

  /* ===== Helpers ===== */
  formatMarkdown(text) {
    if (!text) return '';
    return text
      .replace(/\*\*(.*?)\*\*/g, '<strong>$1</strong>')
      .replace(/\*(.*?)\*/g, '<em>$1</em>');
  }

  /* ===== Render ===== */
  renderDigest() {
    if (!this.digest) return;
    const headerDate = document.querySelector('.date-display');
    const footerDate = document.querySelector('.last-updated');
    const digestDate = this.digest?.created_at ? new Date(this.digest.created_at) : new Date();

    if (headerDate) headerDate.textContent = this.formatDate(digestDate);
    if (footerDate)
      footerDate.textContent = `Last Update: ${digestDate.toLocaleString('en-US', {
        month: 'short',
        day: '2-digit',
        year: 'numeric',
        hour: '2-digit',
        minute: '2-digit',
        second: '2-digit'
      })}`;

    const el = document.getElementById('newsList');
    if (!el) return;
    el.innerHTML = this.digest.cards
      .map(
        (a, i) => `
      <div class="headline-item" data-i="${i}">
        <div class="headline-header">
          <div class="headline-text">${this.formatMarkdown(a.title)}</div>
          <div class="headline-toggle">▼</div>
        </div>
        <div class="headline-details">
          ${
            a.bullets.length
              ? `<ul class="headline-bullets">${a.bullets.map(b => `<li>${this.formatMarkdown(b)}</li>`).join('')}</ul>`
              : ''
          }
          ${
            a.sources.length
              ? `
            <div class="headline-sources">
              <strong>Sources:</strong>
              <ul class="source-list">
                ${a.sources.map(s => `
                  <li>
                    <a href="${s.url}" target="_blank" rel="noopener noreferrer">${this.formatMarkdown(s.title) || s.url}</a>
                  </li>`).join('')}
              </ul>
            </div>
          ` : ''
          }
        </div>
      </div>`
      )
      .join('');
  }

  /* ===== UI ===== */
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

  formatDate(d) {
    return d.toLocaleDateString('en-US', {
      month: 'short', day: 'numeric', year: 'numeric'
    });
  }
}

/* bootstrap */
document.addEventListener('DOMContentLoaded', () => {
  window.pulseWidget = new PulseWidget();
});
