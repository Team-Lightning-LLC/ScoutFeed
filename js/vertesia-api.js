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

  // Load all documents from API
 await vertesiaAPI.loadDocuments();
    try {
      console.log('Loading all documents...');

      const response = await fetch(`${CONFIG.VERTESIA_BASE_URL}/objects?limit=1000&offset=0`, {
        method: 'GET',
        headers: {
          'Authorization': `Bearer ${CONFIG.VERTESIA_API_KEY}`,
          'Content-Type': 'application/json'
        }
      });

      if (!response.ok) {
        throw new Error(`API call failed: ${response.status} ${response.statusText}`);
      }

      const allObjects = await response.json();
      console.log('Loaded all objects:', allObjects.length);

      const documents = [];
      for (const obj of allObjects) {
        try {
          const transformed = this.transformDocument(obj);
          documents.push(transformed);
        } catch (error) {
          console.error('Failed to transform:', obj.name, error);
        }
      }

      documents.sort((a, b) => new Date(b.created_at) - new Date(a.created_at));

      console.log('Final documents array:', documents.length);
      return documents;

    } catch (error) {
      console.error('Failed to load documents:', error);
      return [];
    }
  }

  // Transform API object to document format
  transformDocument(obj) {
    let title = obj.name || 'Untitled';

    const prefixes = ['DeepResearch_', 'Deep Research_', 'deep research_', 'DEEP RESEARCH_', 'DEEP RESEARCH:', 'Digest:'];
    prefixes.forEach(prefix => {
      if (title.startsWith(prefix)) {
        title = title.substring(prefix.length).trim();
      }
    });

    title = title.replace(/[_-]/g, ' ').trim();

    return {
      id: obj.id,
      title: title,
      area: obj.properties?.capability || 'Research',
      topic: obj.properties?.framework || 'General',
      created_at: obj.created_at || obj.properties?.generated_at || new Date().toISOString(),
      content_source: obj.content?.source,  // ← CRITICAL: This stores the content reference
      when: this.formatDate(obj.created_at || obj.properties?.generated_at),
      modifiers: obj.properties?.modifiers || null,
      parent_document_id: obj.properties?.parent_document_id || null
    };
  }

  // Format date for display
  formatDate(dateString) {
    if (!dateString) return 'Recent';
    
    try {
      const date = new Date(dateString);
      return date.toLocaleDateString('en-US', { 
        month: 'short', 
        day: 'numeric', 
        year: 'numeric' 
      });
    } catch {
      return 'Recent';
    }
  }

  // Get most recent digest (filter from all docs)
  async getLatestDigest() {
    const allDocs = await this.loadAllDocuments();
    
    // Filter for documents starting with "Digest:"
    const digests = allDocs.filter(doc => 
      doc.title && (doc.title.toLowerCase().includes('digest') || doc.area === 'Pulse')
    );
    
    console.log('Found digests:', digests.length);
    
    if (digests.length === 0) {
      return null;
    }
    
    // Return most recent
    return digests[0];
  }

  // Get document content (like Scout does)
  async getDocumentContent(doc) {
    try {
      if (!doc.content_source) {
        throw new Error('No content source found');
      }

      // Step 1: Get download URL
      const downloadResponse = await fetch(`${CONFIG.VERTESIA_BASE_URL}/objects/download-url`, {
        method: 'POST',
        headers: {
          'Authorization': `Bearer ${CONFIG.VERTESIA_API_KEY}`,
          'Content-Type': 'application/json'
        },
        body: JSON.stringify({ 
          file: doc.content_source,
          format: 'original'
        })
      });

      if (!downloadResponse.ok) {
        throw new Error(`Failed to get download URL: ${downloadResponse.statusText}`);
      }

      const downloadData = await downloadResponse.json();

      // Step 2: Fetch content from signed URL
      const contentResponse = await fetch(downloadData.url);
      if (!contentResponse.ok) {
        throw new Error(`Failed to download content: ${contentResponse.statusText}`);
      }

      const content = await contentResponse.text();
      return content;

    } catch (error) {
      console.error('Failed to get document content:', error);
      throw error;
    }
  }
}

const vertesiaAPI = new VertesiaAPI();
