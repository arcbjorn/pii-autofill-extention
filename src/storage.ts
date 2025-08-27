import type { 
  Profile, 
  Settings, 
  CustomField, 
  SiteRule, 
  FieldMapping, 
  DetectedField 
} from '../types/extension';

interface EncryptedData {
  encrypted: number[];
  iv: number[];
}

interface ExportData {
  sync: any;
  local: any;
  exportDate: string;
  version: string;
}

interface StorageStats {
  syncBytes: number;
  localBytes: number;
  syncQuota: number;
  localQuota: number;
}

interface DetectedFieldsCache {
  tabId: number;
  url: string;
  fields: DetectedField[];
  timestamp: number;
}

class StorageManager {
    private syncEnabled: boolean;
    private encryptionEnabled: boolean;
    private encryptionKey: ArrayBuffer | null;

    constructor() {
        this.syncEnabled = true;
        this.encryptionEnabled = false;
        this.encryptionKey = null;
    }

    async init(): Promise<void> {
        // Load settings
        const result = await chrome.storage.sync.get('settings');
        const settings = result.settings || {};
        
        this.syncEnabled = settings.syncEnabled !== false;
        this.encryptionEnabled = settings.encryptSensitiveFields || false;
        
        if (this.encryptionEnabled && !this.encryptionKey) {
            await this.loadEncryptionKey();
        }
    }

    private async loadEncryptionKey(): Promise<void> {
        const result = await chrome.storage.local.get('encryptionKey');
        this.encryptionKey = result.encryptionKey;
        
        if (!this.encryptionKey) {
            this.encryptionKey = await this.generateEncryptionKey();
            await chrome.storage.local.set({ encryptionKey: this.encryptionKey });
        }
    }

    private async generateEncryptionKey(): Promise<ArrayBuffer> {
        const key = await crypto.subtle.generateKey(
            { name: 'AES-GCM', length: 256 }, 
            true, 
            ['encrypt', 'decrypt']
        );
        return await crypto.subtle.exportKey('raw', key);
    }

    // Profile management
    async getProfiles(): Promise<{ [key: string]: Profile }> {
        const result = await chrome.storage.sync.get('profiles');
        return result.profiles || { personal: {}, work: {}, custom: {} };
    }

    async saveProfile(type: string, data: Profile): Promise<void> {
        const profiles = await this.getProfiles();
        profiles[type] = data;
        
        if (this.syncEnabled) {
            await chrome.storage.sync.set({ profiles });
        } else {
            await chrome.storage.local.set({ profiles });
        }
    }

    async getProfile(type: string): Promise<Profile> {
        const profiles = await this.getProfiles();
        return profiles[type] || {};
    }

    // Settings management
    async getSettings(): Promise<Settings> {
        const result = await chrome.storage.sync.get('settings');
        return result.settings || {};
    }

    async saveSetting(key: keyof Settings, value: any): Promise<void> {
        const settings = await this.getSettings();
        settings[key] = value;
        await chrome.storage.sync.set({ settings });
    }

    // Custom fields management
    async getCustomFields(): Promise<CustomField[]> {
        const result = await chrome.storage.sync.get('customFields');
        return result.customFields || [];
    }

    async saveCustomFields(fields: CustomField[]): Promise<void> {
        await chrome.storage.sync.set({ customFields: fields });
    }

    // Site rules management
    async getSiteRules(hostname?: string): Promise<{ [key: string]: SiteRule } | SiteRule | null> {
        const result = await chrome.storage.sync.get('siteRules');
        const allRules = result.siteRules || {};
        
        if (hostname) {
            return allRules[hostname] || null;
        }
        
        return allRules;
    }

    async saveSiteRules(hostname: string, rules: SiteRule): Promise<void> {
        const allRules = await this.getSiteRules() as { [key: string]: SiteRule };
        allRules[hostname] = rules;
        await chrome.storage.sync.set({ siteRules: allRules });
    }

    // Field mappings
    async getFieldMappings(): Promise<{ [key: string]: FieldMapping }> {
        const result = await chrome.storage.sync.get('fieldMappings');
        return result.fieldMappings || {};
    }

    async saveFieldMapping(detectedField: string, mappedField: FieldMapping): Promise<void> {
        const mappings = await this.getFieldMappings();
        mappings[detectedField] = mappedField;
        await chrome.storage.sync.set({ fieldMappings: mappings });
    }

    // Detected fields cache
    async getLastDetectedFields(): Promise<DetectedFieldsCache | null> {
        const result = await chrome.storage.local.get('lastDetectedFields');
        return result.lastDetectedFields || null;
    }

    async saveDetectedFields(tabId: number, url: string, fields: DetectedField[]): Promise<void> {
        await chrome.storage.local.set({
            lastDetectedFields: {
                tabId,
                url,
                fields,
                timestamp: Date.now()
            }
        });
    }

    // Import/Export functionality
    async exportData(): Promise<ExportData> {
        const [syncData, localData] = await Promise.all([
            chrome.storage.sync.get(),
            chrome.storage.local.get()
        ]);
        
        return {
            sync: syncData,
            local: localData,
            exportDate: new Date().toISOString(),
            version: chrome.runtime.getManifest().version
        };
    }

    async importData(data: ExportData): Promise<void> {
        if (!data.sync && !data.local) {
            throw new Error('Invalid import data format');
        }
        
        // Import sync data
        if (data.sync) {
            const filteredSync = { ...data.sync };
            delete filteredSync.exportDate;
            await chrome.storage.sync.set(filteredSync);
        }
        
        // Import local data (excluding sensitive keys)
        if (data.local) {
            const filteredLocal = { ...data.local };
            delete filteredLocal.encryptionKey;
            await chrome.storage.local.set(filteredLocal);
        }
        
        // Reinitialize
        await this.init();
    }

    // Data encryption utilities
    async encryptData(data: any): Promise<any> {
        if (!this.encryptionEnabled || !this.encryptionKey) {
            return data;
        }
        
        try {
            const key = await crypto.subtle.importKey(
                'raw', 
                this.encryptionKey, 
                { name: 'AES-GCM' }, 
                false, 
                ['encrypt']
            );
            
            const iv = crypto.getRandomValues(new Uint8Array(12));
            const encodedData = new TextEncoder().encode(JSON.stringify(data));
            const encrypted = await crypto.subtle.encrypt({ name: 'AES-GCM', iv }, key, encodedData);
            
            return {
                encrypted: Array.from(new Uint8Array(encrypted)),
                iv: Array.from(iv)
            };
        } catch (error) {
            console.error('Encryption failed:', error);
            return data;
        }
    }

    async decryptData(encryptedData: any): Promise<any> {
        if (!encryptedData.encrypted || !encryptedData.iv) {
            return encryptedData;
        }
        
        try {
            const key = await crypto.subtle.importKey(
                'raw', 
                this.encryptionKey!, 
                { name: 'AES-GCM' }, 
                false, 
                ['decrypt']
            );
            
            const decrypted = await crypto.subtle.decrypt(
                {
                    name: 'AES-GCM',
                    iv: new Uint8Array(encryptedData.iv)
                }, 
                key, 
                new Uint8Array(encryptedData.encrypted)
            );
            
            const decodedData = new TextDecoder().decode(decrypted);
            return JSON.parse(decodedData);
        } catch (error) {
            console.error('Decryption failed:', error);
            return encryptedData;
        }
    }

    // Storage monitoring
    setupStorageMonitoring(): void {
        chrome.storage.onChanged.addListener((changes, namespace) => {
            console.log(`Storage changed in ${namespace}:`, changes);
            
            // Notify other parts of the extension about storage changes
            chrome.runtime.sendMessage({
                type: 'storageChanged',
                namespace,
                changes
            }).catch(() => {
                // Ignore if no listeners
            });
        });
    }

    // Clear all data
    async clearAllData(): Promise<void> {
        await Promise.all([
            chrome.storage.sync.clear(),
            chrome.storage.local.clear()
        ]);
    }

    // Storage statistics
    async getStorageStats(): Promise<StorageStats> {
        const [sync, local] = await Promise.all([
            chrome.storage.sync.getBytesInUse(),
            chrome.storage.local.getBytesInUse()
        ]);
        
        return {
            syncBytes: sync,
            localBytes: local,
            syncQuota: chrome.storage.sync.QUOTA_BYTES,
            localQuota: chrome.storage.local.QUOTA_BYTES
        };
    }
}

// Create global instance
const storageManager = new StorageManager();

// Initialize when loaded
if (typeof chrome !== 'undefined' && chrome.storage) {
    storageManager.init().then(() => {
        storageManager.setupStorageMonitoring();
        console.log('Storage manager initialized');
    });
}

// Make available globally
if (typeof window !== 'undefined') {
    (window as any).storageManager = storageManager;
}

// Export for modules
if (typeof module !== 'undefined' && module.exports) {
    module.exports = StorageManager;
}

export default StorageManager;