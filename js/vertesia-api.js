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

  // Generate digest by sending "begin" to Pulse
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

  // Fetch recent documents
  async fetchRecentDocuments(limit = 20) {
    const response = await this.call(`/objects?limit=${limit}&offset=0`);
    const documents = response.objects || [];
    
    documents.sort((a, b) => {
      const dateA = new Date(a.created_at || 0);
      const dateB = new Date(b.created_at || 0);
      return dateB - dateA;
    });
    
    return documents.map(doc => ({
      id: doc.id,
      name: doc.name,
      createdAt: doc.created_at,
      contentSource: doc.content?.source
    }));
  }

  // Get most recent digest
  async getLatestDigest() {
    const documents = await this.fetchRecentDocuments();
    
    const digests = documents.filter(doc => 
      doc.name && doc.name.startsWith('Digest:')
    );
    
    if (digests.length === 0) {
      return null;
    }
    
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
