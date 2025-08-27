class BackgroundManager {
    constructor() {
        Object.defineProperty(this, "contextMenuId", {
            enumerable: true,
            configurable: true,
            writable: true,
            value: 'pii-autofill-menu'
        });
        Object.defineProperty(this, "profiles", {
            enumerable: true,
            configurable: true,
            writable: true,
            value: void 0
        });
        Object.defineProperty(this, "settings", {
            enumerable: true,
            configurable: true,
            writable: true,
            value: void 0
        });
        Object.defineProperty(this, "encryptionKey", {
            enumerable: true,
            configurable: true,
            writable: true,
            value: null
        });
        Object.defineProperty(this, "syncEnabled", {
            enumerable: true,
            configurable: true,
            writable: true,
            value: false
        });
        Object.defineProperty(this, "updateManager", {
            enumerable: true,
            configurable: true,
            writable: true,
            value: null
        });
        this.profiles = { personal: {}, work: {}, custom: {} };
        this.settings = {
            passwordProtected: false,
            syncEnabled: true,
            encryptSensitiveFields: false,
            autoDetectFields: true,
            debugMode: false
        };
        this.init().catch(this.handleError);
    }
    async init() {
        await this.loadSettings();
        await this.setupEncryption();
        this.setupEventListeners();
        this.createContextMenu();
        this.setupSyncMonitoring();
        this.initializeUpdateManager();
    }
    async loadSettings() {
        try {
            const result = await chrome.storage.sync.get(['settings', 'profiles', 'encryptionKey']);
            this.settings = {
                ...this.settings,
                ...(result.settings || {})
            };
            this.profiles = result.profiles || { personal: {}, work: {}, custom: {} };
            this.encryptionKey = result.encryptionKey || null;
            this.syncEnabled = this.settings.syncEnabled !== false;
        }
        catch (error) {
            this.handleError('Error loading settings', error);
        }
    }
    async setupEncryption() {
        if (!this.encryptionKey) {
            this.encryptionKey = await this.generateEncryptionKey();
            await this.saveEncryptionKey();
        }
    }
    async generateEncryptionKey() {
        const key = await crypto.subtle.generateKey({
            name: 'AES-GCM',
            length: 256
        }, true, ['encrypt', 'decrypt']);
        return await crypto.subtle.exportKey('raw', key);
    }
    async saveEncryptionKey() {
        if (this.encryptionKey) {
            await chrome.storage.local.set({ encryptionKey: this.encryptionKey });
        }
    }
    async encryptData(data) {
        if (!this.encryptionKey) {
            throw new Error('Encryption key not available');
        }
        const key = await crypto.subtle.importKey('raw', this.encryptionKey, { name: 'AES-GCM' }, false, ['encrypt']);
        const iv = crypto.getRandomValues(new Uint8Array(12));
        const encodedData = new TextEncoder().encode(data);
        const encrypted = await crypto.subtle.encrypt({
            name: 'AES-GCM',
            iv: iv
        }, key, encodedData);
        return {
            encrypted: Array.from(new Uint8Array(encrypted)),
            iv: Array.from(iv)
        };
    }
    async decryptData(encryptedData) {
        if (!this.encryptionKey) {
            throw new Error('Encryption key not available');
        }
        const key = await crypto.subtle.importKey('raw', this.encryptionKey, { name: 'AES-GCM' }, false, ['decrypt']);
        const decrypted = await crypto.subtle.decrypt({
            name: 'AES-GCM',
            iv: new Uint8Array(encryptedData.iv)
        }, key, new Uint8Array(encryptedData.encrypted));
        return new TextDecoder().decode(decrypted);
    }
    setupEventListeners() {
        // Message handling
        chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
            this.handleMessage(message, sender, sendResponse);
            return true; // Keep message channel open for async responses
        });
        // Context menu clicks
        chrome.contextMenus.onClicked.addListener((info, tab) => {
            if (tab?.id) {
                this.handleContextMenuClick(info, tab);
            }
        });
        // Keyboard shortcuts
        chrome.commands.onCommand.addListener((command) => {
            this.handleCommand(command);
        });
        // Tab updates
        chrome.tabs.onUpdated.addListener((tabId, changeInfo, tab) => {
            if (changeInfo.status === 'complete' && tab.url) {
                this.updateContextMenuForTab(tab);
            }
        });
    }
    createContextMenu() {
        chrome.contextMenus.removeAll(() => {
            chrome.contextMenus.create({
                id: this.contextMenuId,
                title: 'PII Autofill',
                contexts: ['editable'],
                documentUrlPatterns: ['http://*/*', 'https://*/*']
            });
            chrome.contextMenus.create({
                id: 'autofill-personal',
                parentId: this.contextMenuId,
                title: 'Fill with Personal Info',
                contexts: ['editable']
            });
            chrome.contextMenus.create({
                id: 'autofill-work',
                parentId: this.contextMenuId,
                title: 'Fill with Work Info',
                contexts: ['editable']
            });
            chrome.contextMenus.create({
                id: 'detect-fields',
                parentId: this.contextMenuId,
                title: 'Detect Form Fields',
                contexts: ['page']
            });
        });
    }
    setupSyncMonitoring() {
        if (!this.syncEnabled)
            return;
        chrome.storage.onChanged.addListener((changes, namespace) => {
            if (namespace === 'sync') {
                this.handleStorageChanges(changes);
            }
        });
    }
    handleStorageChanges(changes) {
        let shouldReload = false;
        if (changes.profiles) {
            this.profiles = changes.profiles.newValue || { personal: {}, work: {}, custom: {} };
            shouldReload = true;
        }
        if (changes.settings) {
            this.settings = { ...this.settings, ...(changes.settings.newValue || {}) };
            this.syncEnabled = this.settings.syncEnabled !== false;
            shouldReload = true;
        }
        if (shouldReload) {
            console.log('Settings updated from sync');
        }
    }
    async handleMessage(message, sender, sendResponse) {
        console.log('Background received message:', message);
        try {
            switch (message.action) {
                case 'autofill':
                    await this.handleAutofillRequest(message, sender, sendResponse);
                    break;
                case 'getDetectedFields':
                    await this.handleDetectionRequest(message, sender, sendResponse);
                    break;
                case 'saveProfile':
                    await this.handleSaveProfile(message, sendResponse);
                    break;
                case 'loadProfile':
                    await this.handleLoadProfile(message, sendResponse);
                    break;
                case 'exportData':
                    await this.handleExportData(sendResponse);
                    break;
                case 'importData':
                    await this.handleImportData(message, sendResponse);
                    break;
                case 'cacheFieldData':
                    await this.handleCacheFieldData(message, sendResponse);
                    break;
                case 'checkForUpdates':
                    await this.handleUpdateCheck(message, sendResponse);
                    break;
                case 'startUpdate':
                    await this.handleStartUpdate(message, sendResponse);
                    break;
                default:
                    sendResponse({ success: false, error: 'Unknown action' });
            }
        }
        catch (error) {
            this.handleError('Message handling error', error);
            sendResponse({ success: false, error: error.message });
        }
    }
    async handleAutofillRequest(message, sender, sendResponse) {
        if (!sender.tab?.id) {
            sendResponse({ success: false, error: 'No active tab' });
            return;
        }
        const profileType = message.profileType || 'personal';
        let profileData = message.data;
        if (!profileData) {
            profileData = this.profiles[profileType];
        }
        // Decrypt sensitive fields if encryption is enabled
        if (this.settings.encryptSensitiveFields) {
            profileData = await this.decryptProfile(profileData);
        }
        // Send autofill data to content script
        chrome.tabs.sendMessage(sender.tab.id, {
            action: 'autofill',
            data: profileData,
            fields: message.fields
        }).then(() => {
            sendResponse({ success: true });
        }).catch((error) => {
            sendResponse({ success: false, error: error.message });
        });
    }
    async handleDetectionRequest(message, sender, sendResponse) {
        if (!sender.tab?.id) {
            sendResponse({ success: false, error: 'No active tab' });
            return;
        }
        try {
            const response = await chrome.tabs.sendMessage(sender.tab.id, {
                action: 'getDetectedFields'
            });
            // Store detected fields for popup usage
            await chrome.storage.local.set({
                lastDetectedFields: {
                    tabId: sender.tab.id,
                    url: sender.tab.url,
                    fields: response.fieldTypes || [],
                    count: response.count || 0,
                    timestamp: Date.now()
                }
            });
            sendResponse({ success: true, ...response });
        }
        catch (error) {
            this.handleError('Field detection error', error);
            sendResponse({ success: false, error: error.message });
        }
    }
    async handleSaveProfile(message, sendResponse) {
        const profileType = message.profileType || 'personal';
        const profileData = message.data;
        if (!profileData) {
            sendResponse({ success: false, error: 'No profile data provided' });
            return;
        }
        // Encrypt sensitive fields if enabled
        let dataToSave = profileData;
        if (this.settings.encryptSensitiveFields) {
            dataToSave = await this.encryptProfile(profileData);
        }
        this.profiles[profileType] = { ...this.profiles[profileType], ...dataToSave };
        await chrome.storage.sync.set({ profiles: this.profiles });
        sendResponse({ success: true });
    }
    async handleLoadProfile(message, sendResponse) {
        const profileType = message.profileType || 'personal';
        let profileData = this.profiles[profileType];
        // Decrypt sensitive fields if encryption is enabled
        if (this.settings.encryptSensitiveFields) {
            profileData = await this.decryptProfile(profileData);
        }
        sendResponse({ success: true, data: profileData });
    }
    async handleExportData(sendResponse) {
        const exportData = await this.exportAllData();
        sendResponse({ success: true, data: exportData });
    }
    async handleImportData(message, sendResponse) {
        await this.importData(message.data);
        sendResponse({ success: true });
    }
    async handleCacheFieldData(message, sendResponse) {
        // Store field detection cache for performance
        await chrome.storage.local.set({
            fieldDetectionCache: {
                ...message.data,
                timestamp: Date.now()
            }
        });
        sendResponse({ success: true });
    }
    async handleUpdateCheck(message, sendResponse) {
        if (this.updateManager && this.updateManager.checkForUpdates) {
            try {
                await this.updateManager.checkForUpdates();
                sendResponse({ success: true });
            }
            catch (error) {
                sendResponse({ success: false, error: error.message });
            }
        }
        else {
            sendResponse({ success: false, error: 'Update manager not available' });
        }
    }
    async handleStartUpdate(message, sendResponse) {
        if (this.updateManager && this.updateManager.startUpdate) {
            try {
                await this.updateManager.startUpdate();
                sendResponse({ success: true });
            }
            catch (error) {
                sendResponse({ success: false, error: error.message });
            }
        }
        else {
            sendResponse({ success: false, error: 'Update manager not available' });
        }
    }
    async handleContextMenuClick(info, tab) {
        if (!tab.id)
            return;
        switch (info.menuItemId) {
            case 'autofill-personal':
                await this.fillWithProfile('personal', tab);
                break;
            case 'autofill-work':
                await this.fillWithProfile('work', tab);
                break;
            case 'detect-fields':
                await this.detectFields(tab);
                break;
        }
    }
    async handleCommand(command) {
        const [activeTab] = await chrome.tabs.query({ active: true, currentWindow: true });
        if (!activeTab?.id)
            return;
        switch (command) {
            case 'autofill':
                await this.fillWithProfile('personal', activeTab);
                break;
        }
    }
    async fillWithProfile(profileType, tab) {
        if (!tab.id)
            return;
        try {
            const settings = await chrome.storage.sync.get(['settings', 'profiles']);
            let profiles = settings.profiles || { personal: {}, work: {}, custom: {} };
            // Decrypt profiles if encryption is enabled
            if (settings.encryptSensitiveFields) {
                profiles = await this.decryptProfiles(profiles);
            }
            const profileData = profiles[profileType] || {};
            await chrome.tabs.sendMessage(tab.id, {
                action: 'autofill',
                data: profileData
            });
            console.log(`${profileType} profile autofill completed`);
        }
        catch (error) {
            this.handleError('Error filling with profile', error);
        }
    }
    async detectFields(tab) {
        if (!tab.id)
            return;
        try {
            const response = await chrome.tabs.sendMessage(tab.id, {
                action: 'getDetectedFields'
            });
            console.log('Detected fields:', response.fieldTypes);
            // Store detected fields for popup usage
            await chrome.storage.local.set({
                lastDetectedFields: {
                    tabId: tab.id,
                    url: tab.url,
                    fields: response.fieldTypes || [],
                    count: response.count || 0,
                    timestamp: Date.now()
                }
            });
        }
        catch (error) {
            this.handleError('Error detecting fields', error);
        }
    }
    async updateContextMenuForTab(tab) {
        // Could be used to show/hide context menu based on page content
        if (!tab.url || tab.url.startsWith('chrome://')) {
            // Disable context menu for chrome pages
            return;
        }
    }
    async encryptProfile(profile) {
        const sensitiveFields = ['cardNumber', 'cvv', 'password'];
        const encryptedProfile = { ...profile };
        for (const field of sensitiveFields) {
            const key = field;
            const value = profile[key];
            if (value) {
                const encrypted = await this.encryptData(value);
                encryptedProfile[key] = encrypted;
            }
        }
        return encryptedProfile;
    }
    async decryptProfile(profile) {
        const decryptedProfile = { ...profile };
        for (const [key, value] of Object.entries(profile)) {
            if (value && typeof value === 'object' && 'encrypted' in value) {
                try {
                    const decrypted = await this.decryptData(value);
                    decryptedProfile[key] = decrypted;
                }
                catch (error) {
                    console.warn(`Failed to decrypt field ${key}:`, error);
                    decryptedProfile[key] = '[ENCRYPTED]';
                }
            }
        }
        return decryptedProfile;
    }
    async decryptProfiles(profiles) {
        const decrypted = { personal: {}, work: {}, custom: {} };
        for (const [profileType, profileData] of Object.entries(profiles)) {
            decrypted[profileType] = await this.decryptProfile(profileData);
        }
        return decrypted;
    }
    async exportAllData() {
        const result = await chrome.storage.sync.get();
        return {
            ...result,
            exportDate: new Date().toISOString(),
            version: chrome.runtime.getManifest().version
        };
    }
    async importData(importData) {
        // Validate import data
        if (!importData.profiles) {
            throw new Error('Invalid import data: missing profiles');
        }
        // Merge with existing data
        const currentData = await chrome.storage.sync.get();
        const mergedData = {
            ...currentData,
            ...importData,
            importDate: new Date().toISOString()
        };
        delete mergedData.exportDate; // Remove export date
        await chrome.storage.sync.set(mergedData);
        // Reload settings
        await this.loadSettings();
    }
    initializeUpdateManager() {
        // Initialize update manager
        try {
            // Dynamic import would be ideal, but for compatibility we'll use global
            this.updateManager = globalThis.UpdateManager ? new globalThis.UpdateManager() : null;
        }
        catch (error) {
            console.warn('Update manager initialization failed:', error);
        }
    }
    async syncData() {
        if (!this.syncEnabled)
            return;
        try {
            const localData = await chrome.storage.local.get(['profiles', 'settings']);
            if (localData.profiles || localData.settings) {
                await chrome.storage.sync.set(localData);
                console.log('Data synced successfully');
            }
        }
        catch (error) {
            this.handleError('Sync error', error);
        }
    }
    handleError(context, error = null) {
        const errorMessage = error instanceof Error ? error.message : String(error);
        const extensionError = new Error(`${context}: ${errorMessage}`);
        extensionError.context = context;
        extensionError.severity = 'medium';
        console.error('Background error:', extensionError);
        // Could send to error reporting service in production
    }
}
// Initialize background manager
const backgroundManager = new BackgroundManager();
// Make available globally for debugging
if (typeof globalThis !== 'undefined') {
    globalThis.backgroundManager = backgroundManager;
}
// Export for type checking
export default BackgroundManager;
//# sourceMappingURL=background.js.map