// Data management and storage utilities
class StorageManager {
    constructor() {
        this.syncEnabled = true;
        this.encryptionEnabled = false;
        this.encryptionKey = null;
    }

    async init() {
        // Load settings
        const result = await chrome.storage.sync.get('settings');
        const settings = result.settings || {};
        
        this.syncEnabled = settings.syncEnabled !== false;
        this.encryptionEnabled = settings.encryptSensitiveFields || false;
        
        if (this.encryptionEnabled && !this.encryptionKey) {
            await this.loadEncryptionKey();
        }
    }

    async loadEncryptionKey() {
        const result = await chrome.storage.local.get('encryptionKey');
        this.encryptionKey = result.encryptionKey;
        
        if (!this.encryptionKey) {
            this.encryptionKey = await this.generateEncryptionKey();
            await chrome.storage.local.set({ encryptionKey: this.encryptionKey });
        }
    }

    async generateEncryptionKey() {
        const key = await crypto.subtle.generateKey(
            { name: 'AES-GCM', length: 256 },
            true,
            ['encrypt', 'decrypt']
        );
        return await crypto.subtle.exportKey('raw', key);
    }

    // Profile management
    async getProfiles() {
        const result = await chrome.storage.sync.get('profiles');
        return result.profiles || { personal: {}, work: {}, custom: {} };
    }

    async saveProfile(type, data) {
        const profiles = await this.getProfiles();
        profiles[type] = data;
        
        if (this.syncEnabled) {
            await chrome.storage.sync.set({ profiles });
        } else {
            await chrome.storage.local.set({ profiles });
        }
    }

    async getProfile(type) {
        const profiles = await this.getProfiles();
        return profiles[type] || {};
    }

    // Settings management
    async getSettings() {
        const result = await chrome.storage.sync.get('settings');
        return result.settings || {};
    }

    async saveSetting(key, value) {
        const settings = await this.getSettings();
        settings[key] = value;
        await chrome.storage.sync.set({ settings });
    }

    // Custom fields management
    async getCustomFields() {
        const result = await chrome.storage.sync.get('customFields');
        return result.customFields || [];
    }

    async saveCustomFields(fields) {
        await chrome.storage.sync.set({ customFields: fields });
    }

    // Site rules management
    async getSiteRules(hostname = null) {
        const result = await chrome.storage.sync.get('siteRules');
        const allRules = result.siteRules || {};
        
        if (hostname) {
            return allRules[hostname] || null;
        }
        
        return allRules;
    }

    async saveSiteRules(hostname, rules) {
        const allRules = await this.getSiteRules();
        allRules[hostname] = rules;
        await chrome.storage.sync.set({ siteRules: allRules });
    }

    // Field mappings
    async getFieldMappings() {
        const result = await chrome.storage.sync.get('fieldMappings');
        return result.fieldMappings || {};
    }

    async saveFieldMapping(detectedField, mappedField) {
        const mappings = await this.getFieldMappings();
        mappings[detectedField] = mappedField;
        await chrome.storage.sync.set({ fieldMappings: mappings });
    }

    // Detected fields cache
    async getLastDetectedFields() {
        const result = await chrome.storage.local.get('lastDetectedFields');
        return result.lastDetectedFields || null;
    }

    async saveDetectedFields(tabId, url, fields) {
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
    async exportData() {
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

    async importData(data) {
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
    async encryptData(data) {
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

            const encrypted = await crypto.subtle.encrypt(
                { name: 'AES-GCM', iv },
                key,
                encodedData
            );

            return {
                encrypted: Array.from(new Uint8Array(encrypted)),
                iv: Array.from(iv)
            };
        } catch (error) {
            console.error('Encryption failed:', error);
            return data;
        }
    }

    async decryptData(encryptedData) {
        if (!encryptedData.encrypted || !encryptedData.iv) {
            return encryptedData;
        }

        try {
            const key = await crypto.subtle.importKey(
                'raw',
                this.encryptionKey,
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
    setupStorageMonitoring() {
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
    async clearAllData() {
        await Promise.all([
            chrome.storage.sync.clear(),
            chrome.storage.local.clear()
        ]);
    }

    // Storage statistics
    async getStorageStats() {
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
    window.storageManager = storageManager;
}

// Export for modules
if (typeof module !== 'undefined' && module.exports) {
    module.exports = StorageManager;
}