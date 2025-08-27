// Background service worker with TypeScript
import type {
    Profile,
    Settings,
    FieldType,
    MessageRequest,
    AutofillMessage,
    DetectionMessage,
    StorageMessage,
    ExtensionError
} from '../types/extension';

class BackgroundManager {
    private contextMenuId: string = 'pii-autofill-menu';
    private profiles: Profile;
    private settings: Settings;

    constructor() {
        this.profiles = { personal: {} };
        this.settings = {
            autoDetectFields: true,
            debugMode: false
        };
        
        this.init().catch(this.handleError);
    }

    private async init(): Promise<void> {
        await this.loadSettings();
        this.setupEventListeners();
        this.createContextMenu();
    }

    private async loadSettings(): Promise<void> {
        try {
            const result = await chrome.storage.sync.get(['settings', 'profiles']);
            
            this.settings = {
                ...this.settings,
                ...(result.settings || {})
            };
            
            this.profiles = result.profiles || { personal: {} };
            
        } catch (error) {
            this.handleError('Error loading settings', error);
        }
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


    private async handleMessage(
        message: MessageRequest, 
        sender: chrome.runtime.MessageSender, 
        sendResponse: (response: any) => void
    ): Promise<void> {

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
        try {
            // Check if extension is enabled
            const extensionState = await chrome.storage.local.get('extensionEnabled');
            const isEnabled = extensionState.extensionEnabled !== false; // default to true
            
            if (!isEnabled) {
                sendResponse({ success: false, error: 'Extension is disabled' });
                return;
            }

            // Get active tab if not provided
            let tabId = sender.tab?.id;
            if (!tabId) {
                const [activeTab] = await chrome.tabs.query({ active: true, currentWindow: true });
                if (!activeTab?.id) {
                    sendResponse({ success: false, error: 'No active tab found' });
                    return;
                }
                tabId = activeTab.id;
            }

            const profileType = message.profileType || 'personal';
            let profileData = message.data;

            if (!profileData) {
                profileData = this.profiles[profileType];
            }


            // Send autofill data to content script
            const response = await chrome.tabs.sendMessage(tabId, {
                action: 'autofill',
                data: profileData,
                fields: message.fields
            });
            
            const safeResponse = {
                success: true, 
                response: response || { success: true }
            };
            
            sendResponse(safeResponse);
        } catch (error) {
            this.handleError('Autofill error', error);
            sendResponse({ success: false, error: (error as Error).message });
        }
    }

    private async handleDetectionRequest(
        message: DetectionMessage,
        sender: chrome.runtime.MessageSender,
        sendResponse: (response: any) => void
    ): Promise<void> {
        try {
            // Get active tab if not provided
            let tabId = sender.tab?.id;
            if (!tabId) {
                const [activeTab] = await chrome.tabs.query({ active: true, currentWindow: true });
                if (!activeTab?.id) {
                    sendResponse({ success: false, error: 'No active tab found' });
                    return;
                }
                tabId = activeTab.id;
            }

            let response;
            try {
                response = await chrome.tabs.sendMessage(tabId, {
                    action: 'getDetectedFields'
                });
            } catch (connectionError) {
                // Return empty response if content script not available
                sendResponse({ 
                    success: true, 
                    fieldTypes: [], 
                    count: 0, 
                    error: 'Content script not available on this page' 
                });
                return;
            }

            // Store detected fields for popup usage (with null safety)
            const fieldsToStore = {
                tabId: tabId,
                fields: Array.isArray(response?.fieldTypes) ? response.fieldTypes.filter((f: any) => f != null) : [],
                count: typeof response?.count === 'number' ? response.count : 0,
                timestamp: Date.now()
            };
            
            await chrome.storage.local.set({
                lastDetectedFields: fieldsToStore
            });

            const safeResponse = {
                success: true, 
                fieldTypes: Array.isArray(response?.fieldTypes) ? response.fieldTypes : [],
                count: typeof response?.count === 'number' ? response.count : 0
            };
            
            sendResponse(safeResponse);

        } catch (error) {
            this.handleError('Field detection error', error);
            sendResponse({ success: false, error: (error as Error).message, count: 0 });
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

        let dataToSave = profileData;

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
                await this.fillWithProfile('personal', tab);
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
            let profiles = settings.profiles || { personal: {} };


            const profileData = profiles[profileType] || {};

            await chrome.tabs.sendMessage(tab.id, {
                action: 'autofill',
                data: profileData
            });

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


    private handleError(context: string, error: any = null): void {
        const errorMessage = error instanceof Error ? error.message : String(error || 'Unknown error');
    }
}

// Initialize background manager
const backgroundManager = new BackgroundManager();

// Make available globally for debugging
if (typeof globalThis !== 'undefined') {
    (globalThis as any).backgroundManager = backgroundManager;
}

// Export for type checking (removed for content script compatibility)