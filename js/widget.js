// widget.js — Portfolio Pulse (Stable Viewer + Structured Digest Support)

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
      await vertesiaAPI.executeAsync({ Task: 'begin' });
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

      objects.sort((a, b) =>
        new Date(b.updated_at || b.created_at) - new Date(a.updated_at || a.created_at)
      );

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

  /* ===== Parse (New Structured Article Format) ===== */
/* ===== Parse (New Structured Article Format + Bullet Detection) ===== */
parseDigest(raw) {
  const text = raw.replace(/\r/g, '').replace(/\u00AD/g, '').trim();
  const articleBlocks = text.split(/(?=Article\s+\d+)/gi).map(b => b.trim()).filter(Boolean);
  const cards = [];

  for (const block of articleBlocks) {
    const titleMatch = block.match(/Article\s+\d+\s*[-–:]\s*(.+)/i);
    const title = titleMatch ? titleMatch[1].trim() : 'Untitled Article';

    // Extract "Contents" section
    const contentsMatch = block.match(/Contents\s*\d*[\s\S]*?(?=(Citations|Article\s+\d+|$))/i);
    let contents = contentsMatch
      ? contentsMatch[0].replace(/Contents\s*\d*/i, '').trim()
      : '';

    /* 🟦 Convert inline dash-bullets (- **Something:** ...) into proper list items */
    const bulletLines = contents
      .split('\n')
      .map(l => l.trim())
      .filter(l => l.length > 0);

    const formatted = [];
    for (const line of bulletLines) {
      // Detect either a true list or a "- **Header:**" pattern
      if (/^[-•*]\s*\*\*.+?:/.test(line)) {
        formatted.push(`<li>${this.formatMarkdown(line.replace(/^[-•*]\s*/, '').trim())}</li>`);
      } else if (/^[-•*]\s+/.test(line)) {
        formatted.push(`<li>${this.formatMarkdown(line.replace(/^[-•*]\s*/, '').trim())}</li>`);
      } else {
        // treat as a normal paragraph
        formatted.push(`<p>${this.formatMarkdown(line)}</p>`);
      }
    }

    // join them into clean readable HTML
    contents = `<ul class="article-contents">${formatted.join('')}</ul>`;

    // Extract "Citations" section
    const citations = [];
    const citationsMatch = block.match(/Citations\s*\d*[\s\S]*?(?=(Article\s+\d+|$))/i);
    if (citationsMatch) {
      const lines = citationsMatch[0]
        .replace(/Citations\s*\d*/i, '')
        .split('\n')
        .map(l => l.trim())
        .filter(Boolean);
      for (const line of lines) {
        const url = (line.match(/\((https?:\/\/[^\s)]+)\)/) || [])[1];
        const text = line.replace(/\[|\]/g, '').replace(/\(https?:\/\/[^\s)]+\)/, '').trim();
        if (url) citations.push({ title: text || 'Source', url });
      }
    }

    cards.push({ title, contents, citations });
  }

  const docTitle =
    text.match(/^#?\s*Scout Pulse Portfolio Digest.*$/m)?.[0]?.replace(/^#\s*/, '').trim() ||
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

    newsList.innerHTML = this.digest.cards
      .map(
        a => `
        <div class="headline-item">
          <div class="headline-header">
            <div class="headline-text"><strong>${this.formatMarkdown(a.title)}</strong></div>
            <div class="headline-toggle">▼</div>
          </div>
          <div class="headline-details">
            <div class="article-contents">${this.formatMarkdown(a.contents)}</div>
            ${
              a.citations.length
                ? `<div class="headline-sources">
                    <strong>Citations:</strong>
                    <ul class="source-list">
                      ${a.citations
                        .map(
                          s =>
                            `<li><a href="${s.url}" target="_blank">${this.formatMarkdown(
                              s.title
                            )}</a></li>`
                        )
                        .join('')}
                    </ul>
                  </div>`
                : ''
            }
          </div>
        </div>`
      )
      .join('');
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

/* bootstrap */
document.addEventListener('DOMContentLoaded', () => {
  window.pulseWidget = new PulseWidget();
});
