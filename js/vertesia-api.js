// vertesia-api.js — final stable version
// Compatible with widget.js (PulseWidget) expectations

class VertesiaAPI {
  constructor() {
    this.baseURL = CONFIG.VERTESIA_BASE_URL;
    this.apiKey  = CONFIG.VERTESIA_API_KEY;
  }

  _headers() {
    return {
      'Authorization': `Bearer ${this.apiKey}`,
      'Content-Type': 'application/json'
    };
  }

  async call(endpoint, options = {}) {
    const url = `${this.baseURL}${endpoint}`;
    const defaults = { method: 'GET', headers: this._headers() };
    const res = await fetch(url, { ...defaults, ...options });
    if (!res.ok) throw new Error(`API call failed: ${res.status} ${res.statusText}`);
    return res.headers.get('content-type')?.includes('application/json')
      ? res.json()
      : res.text();
  }

  // ---------- Core Methods ----------
  async executeAsync(interactionData = { Task: 'begin' }) {
    return await this.call('/execute/async', {
      method: 'POST',
      body: JSON.stringify({
        type: 'conversation',
        interaction: 'Pulse',
        data: interactionData,
        config: {
          environment: CONFIG.ENVIRONMENT_ID,
          model: CONFIG.MODEL
        }
      })
    });
  }

  async loadAllObjects(limit = 1000, offset = 0) {
    const objects = await this.call(`/objects?limit=${limit}&offset=${offset}`, { method: 'GET' });
    return Array.isArray(objects) ? { objects } : { objects: [] };
  }

  async getObject(id) {
    if (!id) throw new Error('getObject: id required');
    return this.call(`/objects/${encodeURIComponent(id)}`, { method: 'GET' });
  }

  async getDownloadUrl(file, format = 'original') {
    return this.call('/objects/download-url', {
      method: 'POST',
      body: JSON.stringify({ file, format })
    });
  }

  async getFileContent(fileRef, format = 'original') {
    const file = typeof fileRef === 'string'
      ? fileRef
      : (fileRef?.file || fileRef?.store || fileRef?.path || fileRef?.key);

    if (!file) throw new Error('getFileContent: invalid file reference');

    const { url } = await this.getDownloadUrl(file, format);
    const res = await fetch(url);
    if (!res.ok) throw new Error(`Download failed: ${res.status} ${res.statusText}`);
    return res.text();
  }

  // ---------- Utility ----------
  transformDocument(obj) {
    let title = obj.name || 'Untitled';
    ['DeepResearch_', 'Digest:', 'DEEP RESEARCH:', 'Research_']
      .forEach(p => { if (title.startsWith(p)) title = title.substring(p.length).trim(); });
    title = title.replace(/[_-]/g, ' ').trim();

    return {
      id: obj.id,
      title,
      created_at: obj.created_at || obj.updated_at || new Date().toISOString(),
      content_source: obj.content?.source,
      when: this.formatDate(obj.created_at || obj.updated_at)
    };
  }

  formatDate(s) {
    if (!s) return 'Recent';
    try {
      return new Date(s).toLocaleDateString('en-US', {
        month: 'short', day: 'numeric', year: 'numeric'
      });
    } catch {
      return 'Recent';
    }
  }
}

window.vertesiaAPI = new VertesiaAPI();
