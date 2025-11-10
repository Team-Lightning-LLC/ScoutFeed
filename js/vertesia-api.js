class VertesiaAPI {
  constructor() {
    this.baseURL = CONFIG.VERTESIA_BASE_URL;
    this.apiKey = CONFIG.VERTESIA_API_KEY;
  }

  async call(endpoint, options = {}) {
    const url = `${this.baseURL}${endpoint}`;
    
    const defaultOptions = {
      method: 'GET',
      headers: {
        'Authorization': `Bearer ${this.apiKey}`,
        'Content-Type': 'application/json'
      }
    };

    const response = await fetch(url, { ...defaultOptions, ...options });
    
    if (!response.ok) {
      throw new Error(`API call failed: ${response.statusText}`);
    }

    return await response.json();
  }

  // Generate digest
  async generateDigest() {
    console.log('Triggering Pulse interaction...');
    
    const response = await this.call('/execute/async', {
      method: 'POST',
      body: JSON.stringify({
        type: 'conversation',
        interaction: CONFIG.INTERACTION_NAME,
        data: {
          Task: 'begin'
        },
        config: {
          environment: CONFIG.ENVIRONMENT_ID,
          model: CONFIG.MODEL
        }
      })
    });

    return response;
  }

  // Load ALL documents from API (matching original app pattern)
  async loadAllDocuments() {
    try {
      console.log('Loading all documents...');
      
      const response = await fetch(`${this.baseURL}/objects?limit=1000&offset=0`, {
        method: 'GET',
        headers: {
          'Authorization': `Bearer ${this.apiKey}`,
          'Content-Type': 'application/json'
        }
      });
      
      if (!response.ok) {
        throw new Error(`API call failed: ${response.status} ${response.statusText}`);
      }
      
      const data = await response.json();
      const allObjects = data.objects || []; // ← KEY: response has .objects property
      
      console.log('Loaded objects:', allObjects.length);
      
      // Transform to standard format
      const documents = allObjects.map(obj => ({
        id: obj.id,
        name: obj.name || 'Untitled',
        createdAt: obj.created_at || new Date().toISOString(),
        contentSource: obj.content?.source,
        properties: obj.properties || {}
      }));
      
      // Sort by creation date (newest first)
      documents.sort((a, b) => new Date(b.createdAt) - new Date(a.createdAt));
      
      return documents;
      
    } catch (error) {
      console.error('Failed to load documents:', error);
      return [];
    }
  }

  // Get most recent digest (filter from all docs)
  async getLatestDigest() {
    const allDocs = await this.loadAllDocuments();
    
    // Filter for documents starting with "Digest:"
    const digests = allDocs.filter(doc => 
      doc.name && doc.name.startsWith('Digest:')
    );
    
    console.log('Found digests:', digests.length);
    
    if (digests.length === 0) {
      return null;
    }
    
    // Return most recent
    return digests[0];
  }

  // Get document content
  async getDocumentContent(documentId) {
    const doc = await this.call(`/objects/${documentId}`);
    
    if (doc.content && doc.content.source) {
      if (typeof doc.content.source === 'object' && doc.content.source.file) {
        return await this.downloadFileContent(doc.content.source.file);
      }
      return doc.content.source;
    }
    
    throw new Error('No content found in document');
  }

  async downloadFileContent(fileRef) {
    const downloadData = await this.getDownloadUrl(fileRef);
    const response = await fetch(downloadData.url);
    
    if (!response.ok) {
      throw new Error(`Failed to download file: ${response.statusText}`);
    }
    
    return await response.text();
  }

  async getDownloadUrl(fileSource) {
    return await this.call('/objects/download-url', {
      method: 'POST',
      body: JSON.stringify({ 
        file: fileSource,
        format: 'original'
      })
    });
  }
}

const vertesiaAPI = new VertesiaAPI();
