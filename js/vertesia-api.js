// vertesia-api.js — Stable MVP version

class VertesiaAPI {
  constructor() {
    this.baseURL = CONFIG.VERTESIA_BASE_URL;
    this.apiKey = CONFIG.VERTESIA_API_KEY;
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

  async executeAsync(data = { Task: 'begin' }) {
    return this.call('/execute/async', {
      method: 'POST',
      body: JSON.stringify({
        type: 'conversation',
        interaction: CONFIG.INTERACTION_NAME,
        data,
        config: { environment: CONFIG.ENVIRONMENT_ID, model: CONFIG.MODEL }
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

  formatDate(s) {
    if (!s) return 'Recent';
    try {
      return new Date(s).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' });
    } catch {
      return 'Recent';
    }
  }
}

window.vertesiaAPI = new VertesiaAPI();
