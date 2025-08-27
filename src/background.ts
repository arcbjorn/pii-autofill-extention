// Background service worker with TypeScript
import type {
    Profile,
    Settings,
    FieldType,
    MessageRequest,
    AutofillMessage,
    DetectionMessage,
    StorageMessage,
    UpdateMessage,
    ExtensionError
} from '../types/extension';

interface EncryptionKeyData {
    key: ArrayBuffer;
    algorithm: string;
}

class BackgroundManager {
    private contextMenuId: string = 'pii-autofill-menu';
    private profiles: Profile;
    private settings: Settings;
    private encryptionKey: ArrayBuffer | null = null;
    private syncEnabled: boolean = false;
    private updateManager: any = null;

    constructor() {
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

    private async init(): Promise<void> {
        await this.loadSettings();
        await this.setupEncryption();
        this.setupEventListeners();
        this.createContextMenu();
        this.setupSyncMonitoring();
        this.initializeUpdateManager();
    }

    private async loadSettings(): Promise<void> {
        try {
            const result = await chrome.storage.sync.get(['settings', 'profiles', 'encryptionKey']);
            
            this.settings = {
                ...this.settings,
                ...(result.settings || {})
            };
            
            this.profiles = result.profiles || { personal: {}, work: {}, custom: {} };
            this.encryptionKey = result.encryptionKey || null;
            this.syncEnabled = this.settings.syncEnabled !== false;
            
        } catch (error) {
            this.handleError('Error loading settings', error);
        }
    }

    private async setupEncryption(): Promise<void> {
        if (!this.encryptionKey) {
            this.encryptionKey = await this.generateEncryptionKey();
            await this.saveEncryptionKey();
        }
    }

    private async generateEncryptionKey(): Promise<ArrayBuffer> {
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

    private async saveEncryptionKey(): Promise<void> {
        if (this.encryptionKey) {
            await chrome.storage.local.set({ encryptionKey: this.encryptionKey });
        }
    }

    private async encryptData(data: string): Promise<{ encrypted: number[]; iv: number[] }> {
        if (!this.encryptionKey) {
            throw new Error('Encryption key not available');
        }

        const key = await crypto.subtle.importKey(
            'raw',
            this.encryptionKey,
            { name: 'AES-GCM' },
            false,
            ['encrypt']
        );

        const iv = crypto.getRandomValues(new Uint8Array(12));
        const encodedData = new TextEncoder().encode(data);

        const encrypted = await crypto.subtle.encrypt(
            {
                name: 'AES-GCM',
                iv: iv
            },
            key,
            encodedData
        );

        return {
            encrypted: Array.from(new Uint8Array(encrypted)),
            iv: Array.from(iv)
        };
    }

    private async decryptData(encryptedData: { encrypted: number[]; iv: number[] }): Promise<string> {
        if (!this.encryptionKey) {
            throw new Error('Encryption key not available');
        }

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

        return new TextDecoder().decode(decrypted);
    }

    private setupEventListeners(): void {
        // Message handling
        chrome.runtime.onMessage.addListener(
            (message: MessageRequest, sender: chrome.runtime.MessageSender, sendResponse: (response: any) => void): boolean => {
                this.handleMessage(message, sender, sendResponse);
                return true; // Keep message channel open for async responses
            }
        );

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

    private createContextMenu(): void {
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

    private setupSyncMonitoring(): void {
        if (!this.syncEnabled) return;

        chrome.storage.onChanged.addListener((changes, namespace) => {
            if (namespace === 'sync') {
                this.handleStorageChanges(changes);
            }
        });
    }

    private handleStorageChanges(changes: { [key: string]: chrome.storage.StorageChange }): void {
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

    private async handleMessage(
        message: MessageRequest, 
        sender: chrome.runtime.MessageSender, 
        sendResponse: (response: any) => void
    ): Promise<void> {
        console.log('Background received message:', message);

        try {
            switch (message.action) {
                case 'autofill':
                    await this.handleAutofillRequest(message as AutofillMessage, sender, sendResponse);
                    break;

                case 'getDetectedFields':
                    await this.handleDetectionRequest(message as DetectionMessage, sender, sendResponse);
                    break;

                case 'saveProfile':
                    await this.handleSaveProfile(message as StorageMessage, sendResponse);
                    break;

                case 'loadProfile':
                    await this.handleLoadProfile(message as StorageMessage, sendResponse);
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
                    await this.handleUpdateCheck(message as UpdateMessage, sendResponse);
                    break;

                case 'startUpdate':
                    await this.handleStartUpdate(message as UpdateMessage, sendResponse);
                    break;

                default:
                    sendResponse({ success: false, error: 'Unknown action' });
            }
        } catch (error) {
            this.handleError('Message handling error', error);
            sendResponse({ success: false, error: (error as Error).message });
        }
    }

    private async handleAutofillRequest(
        message: AutofillMessage, 
        sender: chrome.runtime.MessageSender, 
        sendResponse: (response: any) => void
    ): Promise<void> {
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

    private async handleDetectionRequest(
        message: DetectionMessage,
        sender: chrome.runtime.MessageSender,
        sendResponse: (response: any) => void
    ): Promise<void> {
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

        } catch (error) {
            this.handleError('Field detection error', error);
            sendResponse({ success: false, error: (error as Error).message });
        }
    }

    private async handleSaveProfile(
        message: StorageMessage,
        sendResponse: (response: any) => void
    ): Promise<void> {
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

    private async handleLoadProfile(
        message: StorageMessage,
        sendResponse: (response: any) => void
    ): Promise<void> {
        const profileType = message.profileType || 'personal';
        let profileData = this.profiles[profileType];

        // Decrypt sensitive fields if encryption is enabled
        if (this.settings.encryptSensitiveFields) {
            profileData = await this.decryptProfile(profileData);
        }

        sendResponse({ success: true, data: profileData });
    }

    private async handleExportData(sendResponse: (response: any) => void): Promise<void> {
        const exportData = await this.exportAllData();
        sendResponse({ success: true, data: exportData });
    }

    private async handleImportData(
        message: any,
        sendResponse: (response: any) => void
    ): Promise<void> {
        await this.importData(message.data);
        sendResponse({ success: true });
    }

    private async handleCacheFieldData(
        message: any,
        sendResponse: (response: any) => void
    ): Promise<void> {
        // Store field detection cache for performance
        await chrome.storage.local.set({
            fieldDetectionCache: {
                ...message.data,
                timestamp: Date.now()
            }
        });

        sendResponse({ success: true });
    }

    private async handleUpdateCheck(
        message: UpdateMessage,
        sendResponse: (response: any) => void
    ): Promise<void> {
        if (this.updateManager && this.updateManager.checkForUpdates) {
            try {
                await this.updateManager.checkForUpdates();
                sendResponse({ success: true });
            } catch (error) {
                sendResponse({ success: false, error: (error as Error).message });
            }
        } else {
            sendResponse({ success: false, error: 'Update manager not available' });
        }
    }

    private async handleStartUpdate(
        message: UpdateMessage,
        sendResponse: (response: any) => void
    ): Promise<void> {
        if (this.updateManager && this.updateManager.startUpdate) {
            try {
                await this.updateManager.startUpdate();
                sendResponse({ success: true });
            } catch (error) {
                sendResponse({ success: false, error: (error as Error).message });
            }
        } else {
            sendResponse({ success: false, error: 'Update manager not available' });
        }
    }

    private async handleContextMenuClick(
        info: chrome.contextMenus.OnClickData,
        tab: chrome.tabs.Tab
    ): Promise<void> {
        if (!tab.id) return;

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

    private async handleCommand(command: string): Promise<void> {
        const [activeTab] = await chrome.tabs.query({ active: true, currentWindow: true });
        if (!activeTab?.id) return;

        switch (command) {
            case 'autofill':
                await this.fillWithProfile('personal', activeTab);
                break;
        }
    }

    private async fillWithProfile(profileType: keyof Profile, tab: chrome.tabs.Tab): Promise<void> {
        if (!tab.id) return;

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
        } catch (error) {
            this.handleError('Error filling with profile', error);
        }
    }

    private async detectFields(tab: chrome.tabs.Tab): Promise<void> {
        if (!tab.id) return;

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

        } catch (error) {
            this.handleError('Error detecting fields', error);
        }
    }

    private async updateContextMenuForTab(tab: chrome.tabs.Tab): Promise<void> {
        // Could be used to show/hide context menu based on page content
        if (!tab.url || tab.url.startsWith('chrome://')) {
            // Disable context menu for chrome pages
            return;
        }
    }

    private async encryptProfile(profile: Partial<FieldType>): Promise<Partial<FieldType>> {
        const sensitiveFields = ['cardNumber', 'cvv', 'password'];
        const encryptedProfile: Partial<FieldType> = { ...profile };

        for (const field of sensitiveFields) {
            const key = field as keyof FieldType;
            const value = profile[key];
            if (value) {
                const encrypted = await this.encryptData(value);
                (encryptedProfile as any)[key] = encrypted;
            }
        }

        return encryptedProfile;
    }

    private async decryptProfile(profile: Partial<FieldType>): Promise<Partial<FieldType>> {
        const decryptedProfile: Partial<FieldType> = { ...profile };
        
        for (const [key, value] of Object.entries(profile)) {
            if (value && typeof value === 'object' && 'encrypted' in value) {
                try {
                    const decrypted = await this.decryptData(value as any);
                    (decryptedProfile as any)[key] = decrypted;
                } catch (error) {
                    console.warn(`Failed to decrypt field ${key}:`, error);
                    (decryptedProfile as any)[key] = '[ENCRYPTED]';
                }
            }
        }

        return decryptedProfile;
    }

    private async decryptProfiles(profiles: Profile): Promise<Profile> {
        const decrypted: Profile = { personal: {}, work: {}, custom: {} };
        
        for (const [profileType, profileData] of Object.entries(profiles)) {
            decrypted[profileType as keyof Profile] = await this.decryptProfile(profileData);
        }
        
        return decrypted;
    }

    private async exportAllData(): Promise<any> {
        const result = await chrome.storage.sync.get();
        
        return {
            ...result,
            exportDate: new Date().toISOString(),
            version: chrome.runtime.getManifest().version
        };
    }

    private async importData(importData: any): Promise<void> {
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

    private initializeUpdateManager(): void {
        // Initialize update manager
        try {
            // Dynamic import would be ideal, but for compatibility we'll use global
            this.updateManager = (globalThis as any).UpdateManager ? new (globalThis as any).UpdateManager() : null;
        } catch (error) {
            console.warn('Update manager initialization failed:', error);
        }
    }

    private async syncData(): Promise<void> {
        if (!this.syncEnabled) return;

        try {
            const localData = await chrome.storage.local.get(['profiles', 'settings']);
            
            if (localData.profiles || localData.settings) {
                await chrome.storage.sync.set(localData);
                console.log('Data synced successfully');
            }
        } catch (error) {
            this.handleError('Sync error', error);
        }
    }

    private handleError(context: string, error: any = null): void {
        const errorMessage = error instanceof Error ? error.message : String(error);
        const extensionError: ExtensionError = new Error(`${context}: ${errorMessage}`) as ExtensionError;
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
    (globalThis as any).backgroundManager = backgroundManager;
}

// Export for type checking
export default BackgroundManager;