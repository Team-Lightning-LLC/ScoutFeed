// Timeline UI Rendering
class TimelineUI {
  constructor() {
    this.expandedDigests = new Set();
  }

  // Render all digests
  renderDigests() {
    const container = document.getElementById('digestList');
    if (!container) return;
    
    const digests = digestEngine.getDigests();
    
    if (digests.length === 0) {
      container.innerHTML = '<p class="empty">No digests generated yet. Enable auto-updates or click "Generate Now" to start.</p>';
      return;
    }
    
    container.innerHTML = digests.map(digest => this.renderDigest(digest)).join('');
    
    // Attach event listeners
    this.attachEventListeners();
  }

  // Render single digest
  renderDigest(digest) {
    const isExpanded = this.expandedDigests.has(digest.id);
    
    return `
      <div class="digest-card ${isExpanded ? 'expanded' : ''}" data-digest-id="${digest.id}">
        <div class="digest-header" data-action="toggle">
          <div class="digest-meta">
            <div class="digest-time">${digest.timeLabel}</div>
            <div class="digest-title">${digest.title}</div>
          </div>
          <div class="digest-toggle">
            ${isExpanded ? '▼' : '▶'}
          </div>
        </div>
        
        ${isExpanded ? this.renderDigestContent(digest) : ''}
      </div>
    `;
  }

  // Render digest content (expandable)
  renderDigestContent(digest) {
    if (!digest.items || digest.items.length === 0) {
      return `
        <div class="digest-content">
          <p class="empty">No items in this digest.</p>
        </div>
      `;
    }
    
    return `
      <div class="digest-content">
        ${digest.items.map(item => this.renderDigestItem(item)).join('')}
      </div>
    `;
  }

  // Render individual ticker item
  renderDigestItem(item) {
    return `
      <div class="digest-item">
        <div class="digest-item-header">
          <span class="digest-ticker">${item.ticker}</span>
          <span class="digest-exposure">${item.exposure.toFixed(1)}% exposure</span>
        </div>
        <div class="digest-item-headline">${item.headline}</div>
        ${item.bullets && item.bullets.length > 0 ? `
          <ul class="digest-bullets">
            ${item.bullets.map(bullet => `<li>${bullet}</li>`).join('')}
          </ul>
        ` : ''}
        ${item.sources && item.sources.length > 0 ? `
          <div class="digest-sources">
            <strong>Sources:</strong>
            ${item.sources.map(src => `
              <a href="${src.url}" target="_blank" rel="noopener noreferrer">${src.title}</a>
            `).join(', ')}
          </div>
        ` : ''}
      </div>
    `;
  }

  // Attach event listeners
  attachEventListeners() {
    const container = document.getElementById('digestList');
    if (!container) return;
    
    // Event delegation for toggle
    container.addEventListener('click', (e) => {
      const toggleElement = e.target.closest('[data-action="toggle"]');
      if (!toggleElement) return;
      
      const card = toggleElement.closest('.digest-card');
      if (!card) return;
      
      const digestId = card.dataset.digestId;
      this.toggleDigest(digestId);
    });
  }

  // Toggle digest expansion
  toggleDigest(digestId) {
    if (this.expandedDigests.has(digestId)) {
      this.expandedDigests.delete(digestId);
    } else {
      this.expandedDigests.add(digestId);
    }
    
    this.renderDigests();
  }

  // Render portfolio display
  renderPortfolio() {
    const container = document.getElementById('portfolioDisplay');
    if (!container) return;
    
    if (!portfolioManager.hasPortfolio()) {
      container.innerHTML = '<p class="empty">No portfolio saved yet</p>';
      return;
    }
    
    const summary = portfolioManager.getSummary();
    
    container.innerHTML = `
      <div class="portfolio-summary">
        <div class="portfolio-stat">
          <span class="stat-label">Total Value</span>
          <span class="stat-value">$${summary.totalValue.toLocaleString()}</span>
        </div>
        <div class="portfolio-stat">
          <span class="stat-label">Holdings</span>
          <span class="stat-value">${summary.holdingCount}</span>
        </div>
        <div class="portfolio-stat">
          <span class="stat-label">Last Updated</span>
          <span class="stat-value">${summary.lastUpdated}</span>
        </div>
      </div>
      
      <div class="portfolio-holdings">
        <h4>Top Holdings</h4>
        ${summary.topHoldings.map(h => `
          <div class="holding-row">
            <span class="holding-ticker">${h.ticker}</span>
            <span class="holding-quantity">${h.quantity} shares</span>
            <span class="holding-exposure">${h.exposure.toFixed(1)}%</span>
          </div>
        `).join('')}
      </div>
    `;
  }
}

// Create global instance
const timelineUI = new TimelineUI();
window.timelineUI = timelineUI;  // Make available globally
