// vertesia-api.js
// Compatible with widget.js expectations + tolerant file handling.

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

  // ---------- Methods the widget expects ----------
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

  // Accepts: string OR {file}|{store}|{path}|{key}
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

  // ---------- Convenience (kept) ----------
  async generateDigest() { return this.executeAsync({ Task: 'begin' }); }

  async loadDocuments() {
    try {
      const allObjects = await this.call('/objects?limit=1000&offset=0', { method: 'GET' });
      const docs = [];
      for (const obj of allObjects) {
        try { docs.push(this.transformDocument(obj)); }
        catch (e) { console.error('Transform failed:', obj?.name, e); }
      }
      docs.sort((a,b)=>new Date(b.created_at)-new Date(a.created_at));
      return docs;
    } catch (e) {
      console.error('loadDocuments failed:', e);
      return [];
    }
  }

  async getDocumentContent(doc) {
    if (!doc?.content_source) throw new Error('No content source found');
    const { url } = await this.getDownloadUrl(doc.content_source, 'original');
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

window.vertesiaAPI = new VertesiaAPI();
