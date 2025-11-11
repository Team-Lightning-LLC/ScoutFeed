// vertesia-api.js
// Works with widget.js expectations: executeAsync, loadAllObjects, getObject, getFileContent
// Also keeps your convenience methods: generateDigest, loadDocuments, getDocumentContent

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
    // /objects returns an array; other endpoints return objects
    const data = await res.json();
    return data;
  }

  /* ===== Methods the widget expects ===== */

  // Starts a background run (alias of your existing generate flow)
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

  // Returns { objects: [...] } so widget code `response.objects || []` works
  async loadAllObjects(limit = 1000, offset = 0) {
    const objects = await this.call(`/objects?limit=${limit}&offset=${offset}`, { method: 'GET' });
    return Array.isArray(objects) ? { objects } : { objects: [] };
  }

  // Fetch a single object by id
  async getObject(id) {
    if (!id) throw new Error('getObject: id is required');
    return this.call(`/objects/${encodeURIComponent(id)}`, { method: 'GET' });
  }

  // Resolve signed URL and return file text
  async getFileContent(fileRef, format = 'original') {
    const file = typeof fileRef === 'string' ? fileRef : fileRef?.file;
    if (!file) throw new Error('getFileContent: invalid file reference');

    const { url } = await this.call('/objects/download-url', {
      method: 'POST',
      body: JSON.stringify({ file, format })
    });

    const res = await fetch(url);
    if (!res.ok) throw new Error(`Download failed: ${res.status} ${res.statusText}`);
    return res.text();
  }

  /* ===== Your existing convenience methods (kept) ===== */

  async generateDigest() {
    return this.executeAsync({ Task: 'begin' });
  }

  // Library loader used by other parts of your app
  async loadDocuments() {
    try {
      const allObjects = await this.call('/objects?limit=1000&offset=0', { method: 'GET' });
      const docs = [];
      for (const obj of allObjects) {
        try { docs.push(this.transformDocument(obj)); }
        catch (e) { console.error('Transform failed:', obj?.name, e); }
      }
      docs.sort((a, b) => new Date(b.created_at) - new Date(a.created_at));
      return docs;
    } catch (e) {
      console.error('loadDocuments failed:', e);
      return [];
    }
  }

  // Use when you already have a doc with content_source
  async getDocumentContent(doc) {
    if (!doc?.content_source) throw new Error('No content source found');
    const { url } = await this.call('/objects/download-url', {
      method: 'POST',
      body: JSON.stringify({ file: doc.content_source, format: 'original' })
    });
    const res = await fetch(url);
    if (!res.ok) throw new Error(`Download failed: ${res.status} ${res.statusText}`);
    return res.text();
  }

  transformDocument(obj) {
    let title = obj.name || 'Untitled';
    ['DeepResearch_','Deep Research_','deep research_','DEEP RESEARCH_','DEEP RESEARCH:','Digest:']
      .forEach(p => { if (title.startsWith(p)) title = title.substring(p.length).trim(); });
    title = title.replace(/[_-]/g, ' ').trim();

    return {
      id: obj.id,
      title,
      area: obj.properties?.capability || 'Research',
      topic: obj.properties?.framework || 'General',
      created_at: obj.created_at || obj.properties?.generated_at || new Date().toISOString(),
      content_source: obj.content?.source,
      when: this.formatDate(obj.created_at || obj.properties?.generated_at),
      modifiers: obj.properties?.modifiers || null,
      parent_document_id: obj.properties?.parent_document_id || null
    };
  }

  formatDate(s) {
    if (!s) return 'Recent';
    try { return new Date(s).toLocaleDateString('en-US',{month:'short',day:'numeric',year:'numeric'}); }
    catch { return 'Recent'; }
  }
}

// Make available to widget.js
window.vertesiaAPI = new VertesiaAPI();
