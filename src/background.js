class BackgroundManager {
    constructor() {
        this.contextMenuId = 'pii-autofill-menu';
        this.profiles = { personal: {}, work: {}, custom: {} };
        this.settings = {};
        this.encryptionKey = null;
        this.syncEnabled = false;
        this.updateManager = null;
        
        this.init();
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
            this.settings = result.settings || { passwordProtected: false, syncEnabled: true };
            this.profiles = result.profiles || { personal: {}, work: {}, custom: {} };
            this.encryptionKey = result.encryptionKey || null;
            this.syncEnabled = this.settings.syncEnabled !== false;
        } catch (error) {
            console.error('Error loading settings:', error);
        }
    }

    async setupEncryption() {
        if (!this.encryptionKey) {
            this.encryptionKey = await this.generateEncryptionKey();
            await this.saveEncryptionKey();
        }
    }

    async generateEncryptionKey() {
        const key = await crypto.subtle.generateKey(
            {
                name: 'AES-GCM',
                length: 256
            },
            true,
            ['encrypt', 'decrypt']
        );
        return await crypto.subtle.exportKey('raw', key);
    }

    async saveEncryptionKey() {
        try {
            const keyArray = Array.from(new Uint8Array(this.encryptionKey));
            await chrome.storage.local.set({ encryptionKey: keyArray });
        } catch (error) {
            console.error('Error saving encryption key:', error);
        }
    }

    async loadEncryptionKey() {
        try {
            const result = await chrome.storage.local.get(['encryptionKey']);
            if (result.encryptionKey) {
                this.encryptionKey = new Uint8Array(result.encryptionKey).buffer;
                return await crypto.subtle.importKey(
                    'raw',
                    this.encryptionKey,
                    { name: 'AES-GCM' },
                    false,
                    ['encrypt', 'decrypt']
                );
            }
        } catch (error) {
            console.error('Error loading encryption key:', error);
        }
        return null;
    }

    async encryptData(data) {
        try {
            const key = await this.loadEncryptionKey();
            if (!key) return data;

            const encoder = new TextEncoder();
            const dataBuffer = encoder.encode(JSON.stringify(data));
            const iv = crypto.getRandomValues(new Uint8Array(12));
            
            const encrypted = await crypto.subtle.encrypt(
                { name: 'AES-GCM', iv: iv },
                key,
                dataBuffer
            );

            return {
                encrypted: Array.from(new Uint8Array(encrypted)),
                iv: Array.from(iv),
                isEncrypted: true
            };
        } catch (error) {
            console.error('Error encrypting data:', error);
            return data;
        }
    }

    async decryptData(encryptedData) {
        try {
            if (!encryptedData.isEncrypted) return encryptedData;

            const key = await this.loadEncryptionKey();
            if (!key) return encryptedData;

            const encrypted = new Uint8Array(encryptedData.encrypted);
            const iv = new Uint8Array(encryptedData.iv);

            const decrypted = await crypto.subtle.decrypt(
                { name: 'AES-GCM', iv: iv },
                key,
                encrypted
            );

            const decoder = new TextDecoder();
            return JSON.parse(decoder.decode(decrypted));
        } catch (error) {
            console.error('Error decrypting data:', error);
            return encryptedData;
        }
    }

    setupEventListeners() {
        // Extension installation/update
        chrome.runtime.onInstalled.addListener((details) => {
            this.handleInstallation(details);
        });

        // Keyboard shortcuts
        chrome.commands.onCommand.addListener((command) => {
            this.handleCommand(command);
        });

        // Context menu clicks
        chrome.contextMenus.onClicked.addListener((info, tab) => {
            this.handleContextMenuClick(info, tab);
        });

        // Message passing between components
        chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
            this.handleMessage(message, sender, sendResponse);
            return true; // Keep channel open for async response
        });

        // Tab updates for dynamic menu updates
        chrome.tabs.onUpdated.addListener((tabId, changeInfo, tab) => {
            if (changeInfo.status === 'complete') {
                this.updateContextMenuForTab(tab);
            }
        });

        // Storage changes for sync monitoring
        chrome.storage.onChanged.addListener((changes, namespace) => {
            this.handleStorageChange(changes, namespace);
        });
    }

    async handleInstallation(details) {
        if (details.reason === 'install') {
            console.log('PII Autofill Extension installed');
            await this.initializeDefaultSettings();
        } else if (details.reason === 'update') {
            console.log('PII Autofill Extension updated');
            await this.migrateData(details);
        }
    }

    async initializeDefaultSettings() {
        const defaultSettings = {
            passwordProtected: false,
            syncEnabled: true,
            autoFillEnabled: true,
            contextMenuEnabled: true,
            keyboardShortcutEnabled: true,
            encryptSensitiveFields: true
        };

        const defaultProfiles = {
            personal: {},
            work: {},
            custom: {}
        };

        await chrome.storage.sync.set({
            settings: defaultSettings,
            profiles: defaultProfiles,
            customFields: [],
            fieldMappings: {},
            version: '1.0.0'
        });
    }

    async migrateData(details) {
        // Handle data migration for updates
        const result = await chrome.storage.sync.get(['version']);
        const currentVersion = result.version || '1.0.0';
        
        if (this.compareVersions(currentVersion, '1.0.0') < 0) {
            // Perform migration if needed
            console.log('Migrating data from version', currentVersion);
        }
    }

    compareVersions(version1, version2) {
        const v1parts = version1.split('.').map(Number);
        const v2parts = version2.split('.').map(Number);
        
        for (let i = 0; i < Math.max(v1parts.length, v2parts.length); i++) {
            const v1part = v1parts[i] || 0;
            const v2part = v2parts[i] || 0;
            
            if (v1part < v2part) return -1;
            if (v1part > v2part) return 1;
        }
        return 0;
    }

    async handleCommand(command) {
        console.log('Keyboard command received:', command);
        
        if (command === 'autofill') {
            const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
            if (tab) {
                await this.triggerAutofill(tab);
            }
        }
    }

    async triggerAutofill(tab) {
        try {
            // Get current profiles
            const result = await chrome.storage.sync.get(['profiles', 'settings']);
            let profiles = result.profiles || { personal: {}, work: {}, custom: {} };
            const settings = result.settings || {};

            // Decrypt sensitive data if needed
            if (settings.encryptSensitiveFields) {
                profiles = await this.decryptProfiles(profiles);
            }

            // Combine profiles for autofill
            const autofillData = { ...profiles.personal, ...profiles.work };

            // Send to content script
            await chrome.tabs.sendMessage(tab.id, {
                action: 'autofill',
                data: autofillData
            });

            console.log('Autofill triggered successfully');
        } catch (error) {
            console.error('Error triggering autofill:', error);
        }
    }

    async decryptProfiles(profiles) {
        const decryptedProfiles = {};
        
        for (const [profileType, data] of Object.entries(profiles)) {
            if (data.isEncrypted) {
                decryptedProfiles[profileType] = await this.decryptData(data);
            } else {
                decryptedProfiles[profileType] = data;
            }
        }
        
        return decryptedProfiles;
    }

    createContextMenu() {
        chrome.contextMenus.removeAll(() => {
            chrome.contextMenus.create({
                id: this.contextMenuId,
                title: 'PII Autofill',
                contexts: ['editable'],
                documentUrlPatterns: ['http://*/*', 'https://*/*']
            });

            // Sub-menus for different profile types
            chrome.contextMenus.create({
                id: 'autofill-personal',
                parentId: this.contextMenuId,
                title: 'Fill Personal Info',
                contexts: ['editable']
            });

            chrome.contextMenus.create({
                id: 'autofill-work',
                parentId: this.contextMenuId,
                title: 'Fill Work Info',
                contexts: ['editable']
            });

            chrome.contextMenus.create({
                id: 'autofill-all',
                parentId: this.contextMenuId,
                title: 'Fill All Fields',
                contexts: ['editable']
            });

            chrome.contextMenus.create({
                id: 'separator1',
                parentId: this.contextMenuId,
                type: 'separator',
                contexts: ['editable']
            });

            chrome.contextMenus.create({
                id: 'detect-fields',
                parentId: this.contextMenuId,
                title: 'Detect Fields on Page',
                contexts: ['page']
            });
        });
    }

    async handleContextMenuClick(info, tab) {
        console.log('Context menu clicked:', info.menuItemId);

        switch (info.menuItemId) {
            case 'autofill-personal':
                await this.fillWithProfile(tab, 'personal');
                break;
            case 'autofill-work':
                await this.fillWithProfile(tab, 'work');
                break;
            case 'autofill-all':
                await this.triggerAutofill(tab);
                break;
            case 'detect-fields':
                await this.detectFields(tab);
                break;
        }
    }

    async fillWithProfile(tab, profileType) {
        try {
            const result = await chrome.storage.sync.get(['profiles', 'settings']);
            let profiles = result.profiles || { personal: {}, work: {}, custom: {} };
            const settings = result.settings || {};

            if (settings.encryptSensitiveFields) {
                profiles = await this.decryptProfiles(profiles);
            }

            const profileData = profiles[profileType] || {};

            await chrome.tabs.sendMessage(tab.id, {
                action: 'autofill',
                data: profileData
            });

            console.log(`${profileType} profile autofill completed`);
        } catch (error) {
            console.error('Error filling with profile:', error);
        }
    }

    async detectFields(tab) {
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
                    timestamp: Date.now()
                }
            });

        } catch (error) {
            console.error('Error detecting fields:', error);
        }
    }

    async updateContextMenuForTab(tab) {
        // Could be used to show/hide context menu based on page content
        if (!tab.url || tab.url.startsWith('chrome://')) {
            // Disable context menu for chrome pages
            return;
        }
    }

    async handleMessage(message, sender, sendResponse) {
        console.log('Background received message:', message);

        try {
            switch (message.action) {
                case 'getProfiles':
                    const profiles = await this.getProfiles();
                    sendResponse({ profiles });
                    break;

                case 'saveProfile':
                    await this.saveProfile(message.profileType, message.data);
                    sendResponse({ success: true });
                    break;

                case 'saveSettings':
                    await this.saveSettings(message.settings);
                    sendResponse({ success: true });
                    break;

                case 'exportData':
                    const exportData = await this.exportData();
                    sendResponse({ data: exportData });
                    break;

                case 'importData':
                    await this.importData(message.data);
                    sendResponse({ success: true });
                    break;

                case 'syncData':
                    await this.syncData();
                    sendResponse({ success: true });
                    break;

                case 'showContextMenu':
                    // Handle context menu request from content script
                    break;

                case 'autofillComplete':
                    console.log(`Autofill completed: ${message.fieldsCount} fields filled`);
                    await this.logAutofillEvent(message.fieldsCount);
                    break;

                default:
                    console.warn('Unknown message action:', message.action);
                    sendResponse({ error: 'Unknown action' });
            }
        } catch (error) {
            console.error('Error handling message:', error);
            sendResponse({ error: error.message });
        }
    }

    async getProfiles() {
        const result = await chrome.storage.sync.get(['profiles', 'settings']);
        let profiles = result.profiles || { personal: {}, work: {}, custom: {} };
        const settings = result.settings || {};

        if (settings.encryptSensitiveFields) {
            profiles = await this.decryptProfiles(profiles);
        }

        return profiles;
    }

    async saveProfile(profileType, data) {
        const result = await chrome.storage.sync.get(['profiles', 'settings']);
        let profiles = result.profiles || { personal: {}, work: {}, custom: {} };
        const settings = result.settings || {};

        // Encrypt sensitive fields if enabled
        if (settings.encryptSensitiveFields) {
            data = await this.encryptSensitiveFields(data);
        }

        profiles[profileType] = data;

        await chrome.storage.sync.set({ profiles });
        
        if (this.syncEnabled) {
            await this.syncData();
        }
    }

    async encryptSensitiveFields(data) {
        const sensitiveFields = ['cardNumber', 'cvv', 'password', 'ssn'];
        const encryptedData = { ...data };

        for (const field of sensitiveFields) {
            if (encryptedData[field]) {
                encryptedData[field] = await this.encryptData(encryptedData[field]);
            }
        }

        return encryptedData;
    }

    async saveSettings(settings) {
        this.settings = { ...this.settings, ...settings };
        await chrome.storage.sync.set({ settings: this.settings });
        
        if (settings.syncEnabled !== undefined) {
            this.syncEnabled = settings.syncEnabled;
        }

        // Update context menu if needed
        if (settings.contextMenuEnabled !== undefined) {
            if (settings.contextMenuEnabled) {
                this.createContextMenu();
            } else {
                chrome.contextMenus.removeAll();
            }
        }
    }

    async exportData() {
        const result = await chrome.storage.sync.get();
        
        // Don't export encryption keys or local data
        delete result.encryptionKey;
        
        return {
            ...result,
            exportDate: new Date().toISOString(),
            version: '1.0.0'
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
        if (typeof UpdateManager !== 'undefined') {
            this.updateManager = new UpdateManager();
        }
    }

    async syncData() {
        if (!this.syncEnabled) return;

        try {
            // Chrome handles sync automatically, but we can trigger a sync check
            const data = await chrome.storage.sync.get();
            console.log('Data sync check completed', Object.keys(data));
        } catch (error) {
            console.error('Error syncing data:', error);
        }
    }

    setupSyncMonitoring() {
        // Monitor sync status
        setInterval(async () => {
            if (this.syncEnabled) {
                await this.checkSyncStatus();
            }
        }, 60000); // Check every minute
    }

    async checkSyncStatus() {
        try {
            // Check if sync is working by comparing timestamps
            const result = await chrome.storage.sync.get(['lastSyncCheck']);
            const now = Date.now();
            
            await chrome.storage.sync.set({ lastSyncCheck: now });
            
            if (result.lastSyncCheck) {
                const timeSinceLastSync = now - result.lastSyncCheck;
                if (timeSinceLastSync > 300000) { // 5 minutes
                    console.warn('Sync may be delayed');
                }
            }
        } catch (error) {
            console.error('Error checking sync status:', error);
        }
    }

    handleStorageChange(changes, namespace) {
        console.log('Storage changed:', namespace, Object.keys(changes));

        // Reload settings if they changed
        if (changes.settings) {
            this.loadSettings();
        }

        // Update profiles cache
        if (changes.profiles) {
            this.profiles = changes.profiles.newValue || { personal: {}, work: {}, custom: {} };
        }
    }

    async logAutofillEvent(fieldsCount) {
        // Log usage statistics (without sensitive data)
        const stats = await chrome.storage.local.get(['usageStats']) || {};
        const currentStats = stats.usageStats || {
            totalAutofills: 0,
            totalFieldsFilled: 0,
            lastUsed: null
        };

        currentStats.totalAutofills += 1;
        currentStats.totalFieldsFilled += fieldsCount;
        currentStats.lastUsed = new Date().toISOString();

        await chrome.storage.local.set({ usageStats: currentStats });
    }
}

// Initialize background manager
// Import update manager
importScripts('update-manager.js');

const backgroundManager = new BackgroundManager();