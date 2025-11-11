// widget.js — Portfolio Pulse (Stable MVP + Scheduler)

class PulseWidget {
  constructor() {
    this.digest = null;
    this.isGenerating = false;
    this.init();
  }

  /* ===== Lifecycle ===== */
  init() {
    this.bindUI();
    this.loadLatestDigest(); // run once on load
    this.scheduleDigestAt("09:30"); // automatic daily update
    // Optional second run: this.scheduleDigestAt("15:45");
  }

  bindUI() {
    const btn = document.getElementById('generateBtn');
    if (btn) btn.addEventListener('click', () => this.generateDigest());

    document.addEventListener('click', e => {
      const header = e.target.closest('.headline-header');
      if (!header) return;
      header.closest('.headline-item')?.classList.toggle('expanded');
    });
  }

  /* ===== Auto Generation ===== */
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
      this.scheduleDigestAt(timeStr); // reschedule daily
    }, delay);
  }

  /* ===== Manual Trigger ===== */
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
      await new Promise(r => setTimeout(r, 5 * 60 * 1000)); // wait for completion
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
    }
  }

  /* ===== Load Digest ===== */
  async loadLatestDigest() {
    this.updateStatus('Loading...', false);

    try {
      const { objects = [] } = await vertesiaAPI.loadAllObjects(1000);
      if (!objects.length) return this.showEmpty('No documents found');

      objects.sort((a, b) => new Date(b.updated_at || b.created_at) - new Date(a.updated_at || a.created_at));
      const digestObj = objects.find(o => (o.name || '').toLowerCase().includes('digest'));
      if (!digestObj) return this.showEmpty('No digest found');

      const object = digestObj;
      const src = object?.content?.source || object?.content || object?.source;
      if (!src) return this.showEmpty('No digest content found');

      let text = typeof src === 'string' ? src : await this.downloadAsText(src.file || src.store || src.path || src.key);
      if (!text || text.trim().length < 20) return this.showEmpty('Empty digest text');

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
    const urlData = await vertesiaAPI.getDownloadUrl(fileRef, 'original');
    const res = await fetch(urlData.url);
    return res.text();
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
      const titleMatch = lines.find(l => /^#+\s*/.test(l) || /\*\*(.+)\*\*/.test(l));
      if (titleMatch) title = titleMatch.replace(/^#+\s*/, '').replace(/\*\*/g, '').trim();

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

      cards.push({ title, bullets, sources });
    }

    const docTitle = text.match(/^#?\s*Scout Pulse.*$/m)?.[0]?.replace(/^#\s*/, '').trim()
      || text.match(/^#?\s*Portfolio Digest.*$/m)?.[0]?.replace(/^#\s*/, '').trim()
      || 'Portfolio Digest';

    return { title: docTitle, cards };
  }

  /* ===== Render ===== */
  renderDigest() {
    if (!this.digest) return;
    const list = document.getElementById('newsList');
    const headerDate = document.querySelector('.date-display');
    const footerDate = document.querySelector('.last-updated');
    const createdAt = new Date(this.digest.created_at);

    if (headerDate) headerDate.textContent = createdAt.toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' });
    if (footerDate) footerDate.textContent = `Last Update: ${createdAt.toLocaleString()}`;

    list.innerHTML = this.digest.cards.map((a, i) => `
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
    return text.replace(/\*\*(.*?)\*\*/g, '<strong>$1</strong>').replace(/\*(.*?)\*/g, '<em>$1</em>');
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

/* bootstrap */
document.addEventListener('DOMContentLoaded', () => {
  window.pulseWidget = new PulseWidget();
});
