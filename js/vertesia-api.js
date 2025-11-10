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

    try {
      const response = await fetch(url, { ...defaultOptions, ...options });
      
      if (!response.ok) {
        const errorText = await response.text();
        console.error('API Error:', response.status, errorText);
        throw new Error(`API call failed: ${response.status} ${response.statusText}`);
      }

      return await response.json();
    } catch (error) {
      console.error('Fetch error:', error);
      throw error;
    }
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

  // Fetch ALL documents from content objects
  async fetchAllDocuments() {
    console.log('Fetching all documents from content objects...');
    
    let allDocuments = [];
    let offset = 0;
    const limit = 100; // Max per request
    let hasMore = true;
    
    while (hasMore) {
      try {
        const response = await this.call(`/objects?limit=${limit}&offset=${offset}`);
        
        const objects = response.objects || [];
        console.log(`Fetched ${objects.length} documents (offset: ${offset})`);
        
        allDocuments.push(...objects);
        
        // Check if there are more
        hasMore = objects.length === limit;
        offset += limit;
        
        // Safety limit
        if (allDocuments.length > 1000) {
          console.warn('Hit 1000 document limit, stopping...');
          break;
        }
        
      } catch (error) {
        console.error('Error fetching documents:', error);
        hasMore = false;
      }
    }
    
    console.log(`Total documents fetched: ${allDocuments.length}`);
    
    // Sort by creation date (newest first)
    allDocuments.sort((a, b) => {
      const dateA = new Date(a.created_at || 0);
      const dateB = new Date(b.created_at || 0);
      return dateB - dateA;
    });
    
    return allDocuments.map(doc => ({
      id: doc.id,
      name: doc.name,
      createdAt: doc.created_at,
      contentSource: doc.content?.source
    }));
  }

  // Get most recent digest
  async getLatestDigest() {
    console.log('Looking for latest digest...');
    
    const documents = await this.fetchAllDocuments();
    
    console.log('All documents:', documents.map(d => d.name));
    
    // Filter for "Digest:" OR "Scout Pulse:" documents
    const digests = documents.filter(doc => {
      if (!doc.name) return false;
      const name = doc.name.toLowerCase();
      return name.includes('digest:') || name.includes('scout pulse:');
    });
    
    console.log('Found digests:', digests.map(d => d.name));
    
    if (digests.length === 0) {
      console.warn('No digests found');
      return null;
    }
    
    const latest = digests[0];
    console.log('Latest digest:', latest.name);
    
    return latest;
  }

  // Get document content
  async getDocumentContent(documentId) {
    console.log('Fetching document content:', documentId);
    
    const doc = await this.call(`/objects/${documentId}`);
    
    console.log('Document structure:', doc);
    
    if (doc.content && doc.content.source) {
      // Check if it's a file reference
      if (typeof doc.content.source === 'object' && doc.content.source.file) {
        console.log('Document is a file, downloading...');
        return await this.downloadFileContent(doc.content.source.file);
      }
      
      // Direct text content
      console.log('Document has direct text content');
      return doc.content.source;
    }
    
    throw new Error('No content found in document');
  }

  async downloadFileContent(fileRef) {
    console.log('Getting download URL for file:', fileRef);
    
    const downloadData = await this.getDownloadUrl(fileRef);
    console.log('Download URL:', downloadData.url);
    
    const response = await fetch(downloadData.url);
    
    if (!response.ok) {
      throw new Error(`Failed to download file: ${response.statusText}`);
    }
    
    const text = await response.text();
    console.log('Downloaded text length:', text.length);
    
    return text;
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
