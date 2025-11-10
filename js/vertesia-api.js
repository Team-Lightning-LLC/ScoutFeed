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
// Load all documents from API
  async loadDocuments() {
    try {
      console.log('Loading all documents...');

      const response = await fetch${CONFIG.VERTESIA_API_BASE}/objects?limit=1000&offset=0, {
        method: 'GET',
        headers: {
          'Authorization': Bearer ${CONFIG.VERTESIA_API_KEY},
          'Content-Type': 'application/json'
        }
      });

      if (!response.ok) {
        throw new ErrorAPI call failed: ${response.status} ${response.statusText});
      }

      const allObjects = await response.json();
      console.log('Loaded all objects:', allObjects.length);

      this.documents = [];
      for (const obj of allObjects) {
        try {
          const transformed = this.transformDocument(obj);
          this.documents.push(transformed);
        } catch (error) {
          console.error('Failed to transform:', obj.name, error);
        }
      }

      this.documents.sort((a, b) => new Date(b.created_at) - new Date(a.created_at));

      console.log('Final documents array:', this.documents.length);

    } catch (error) {
      console.error('Failed to load documents:', error);
      this.documents = [];
    }
  }
  // Transform API object to document format
  transformDocument(obj) {
    let title = obj.name || 'Untitled';

    const prefixes = ['DeepResearch_', 'Deep Research_', 'deep research_', 'DEEP RESEARCH_', 'DEEP RESEARCH:'];
    prefixes.forEach(prefix => {
      if (title.startsWith(prefix)) {
        title = title.substring(prefix.length);
      }
    });

    title = title.replace(/[_-]/g, ' ').trim();

    return {
      id: obj.id,
      title: title,
      area: obj.properties?.capability || 'Research',
      topic: obj.properties?.framework || 'General',
      created_at: obj.created_at || obj.properties?.generated_at || new Date().toISOString(),
      content_source: obj.content?.source,
      when: this.formatDate(obj.created_at || obj.properties?.generated_at),
      modifiers: obj.properties?.modifiers || null,
      parent_document_id: obj.properties?.parent_document_id || null
    };
  }
      
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
