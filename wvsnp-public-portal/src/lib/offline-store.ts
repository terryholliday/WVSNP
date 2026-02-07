// Offline form persistence using IndexedDB
// Stores application state locally for offline resilience

interface StoredApplication {
  id: string; // Application reference code
  applicationId: string; // Backend application ID
  data: any; // Form data
  lastSaved: string; // ISO timestamp
  step: string; // Current wizard step
}

// IndexedDB wrapper for offline storage
export class OfflineStore {
  private db: IDBDatabase | null = null;
  private readonly dbName = 'wvsnp-portal';
  private readonly version = 1;

  async init(): Promise<void> {
    return new Promise((resolve, reject) => {
      const request = indexedDB.open(this.dbName, this.version);

      request.onerror = () => reject(request.error);
      request.onsuccess = () => {
        this.db = request.result;
        resolve();
      };

      request.onupgradeneeded = (event) => {
        const db = (event.target as IDBOpenDBRequest).result;

        // Create applications store
        if (!db.objectStoreNames.contains('applications')) {
          const store = db.createObjectStore('applications', { keyPath: 'id' });
          store.createIndex('applicationId', 'applicationId', { unique: false });
          store.createIndex('lastSaved', 'lastSaved', { unique: false });
        }
      };
    });
  }

  // Save application data
  async saveApplication(id: string, applicationId: string, data: any, step: string): Promise<void> {
    if (!this.db) await this.init();

    return new Promise((resolve, reject) => {
      const transaction = this.db!.transaction(['applications'], 'readwrite');
      const store = transaction.objectStore('applications');

      const application: StoredApplication = {
        id,
        applicationId,
        data,
        lastSaved: new Date().toISOString(),
        step,
      };

      const request = store.put(application);

      request.onerror = () => reject(request.error);
      request.onsuccess = () => resolve();
    });
  }

  // Load application data
  async loadApplication(id: string): Promise<StoredApplication | null> {
    if (!this.db) await this.init();

    return new Promise((resolve, reject) => {
      const transaction = this.db!.transaction(['applications'], 'readonly');
      const store = transaction.objectStore('applications');
      const request = store.get(id);

      request.onerror = () => reject(request.error);
      request.onsuccess = () => resolve(request.result || null);
    });
  }

  // Get all saved applications
  async getAllApplications(): Promise<StoredApplication[]> {
    if (!this.db) await this.init();

    return new Promise((resolve, reject) => {
      const transaction = this.db!.transaction(['applications'], 'readonly');
      const store = transaction.objectStore('applications');
      const request = store.getAll();

      request.onerror = () => reject(request.error);
      request.onsuccess = () => resolve(request.result);
    });
  }

  // Delete application data
  async deleteApplication(id: string): Promise<void> {
    if (!this.db) await this.init();

    return new Promise((resolve, reject) => {
      const transaction = this.db!.transaction(['applications'], 'readwrite');
      const store = transaction.objectStore('applications');
      const request = store.delete(id);

      request.onerror = () => reject(request.error);
      request.onsuccess = () => resolve();
    });
  }

  // Clear all stored data (for testing/privacy)
  async clearAll(): Promise<void> {
    if (!this.db) await this.init();

    return new Promise((resolve, reject) => {
      const transaction = this.db!.transaction(['applications'], 'readwrite');
      const store = transaction.objectStore('applications');
      const request = store.clear();

      request.onerror = () => reject(request.error);
      request.onsuccess = () => resolve();
    });
  }

  // Check if IndexedDB is available
  static isAvailable(): boolean {
    return typeof window !== 'undefined' &&
           typeof window.indexedDB !== 'undefined';
  }
}

// Export singleton instance
export const offlineStore = new OfflineStore();
