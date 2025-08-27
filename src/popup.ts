// Popup TypeScript implementation with type safety
import type {
    Profile,
    Settings,
    FieldType,
    FieldTypeName,
    DetectedField,
    MessageRequest,
    AutofillMessage,
    StorageMessage,
    SiteRule,
    DevLogEntry,
    ExtensionInfo,
    UpdateInfo,
    StorageStats
} from '../types/extension';

interface PopupElements {
    [key: string]: HTMLElement | null;
}

interface CustomField {
    id: string;
    name: string;
    type: 'text' | 'email' | 'tel' | 'url';
    value: string;
}

interface FormValidationResult {
    isValid: boolean;
    errors: string[];
}

class PopupManager {
    private profiles: Profile;
    private settings: Settings;
    private customFields: CustomField[];
    private fieldMappings: Record<string, string>;
    private currentTab: string;
    private elements: PopupElements;
    private devLogs: DevLogEntry[];
    private updateInfo: UpdateInfo | null;

    constructor() {
        this.profiles = { personal: {}, work: {}, custom: {} };
        this.settings = {
            passwordProtected: false,
            syncEnabled: true,
            encryptSensitiveFields: false,
            autoDetectFields: true,
            debugMode: false
        };
        this.customFields = [];
        this.fieldMappings = {};
        this.currentTab = 'personal';
        this.elements = {};
        this.devLogs = [];
        this.updateInfo = null;

        this.init();
    }

    private async init(): Promise<void> {
        try {
            await this.loadProfiles();
            this.cacheElements();
            this.setupEventListeners();
            this.setupTabs();
            this.loadCustomFields();
            // this.detectCurrentPageFields(); // Method not implemented
            this.populateFieldMappings();
            await this.loadSiteRules();
            this.initDevTools();
            this.initializeUpdates();
        } catch (error) {
            console.error('Popup initialization error:', error);
            this.showMessage('Failed to initialize popup', 'error');
        }
    }

    private cacheElements(): void {
        // Cache frequently used elements
        const elementIds = [
            'fillAllFields', 'saveProfile', 'detectFieldsBtn', 'settingsBtn',
            'exportProfiles', 'importProfiles', 'importProfilesBtn',
            'addCustomField', 'customFieldsContainer', 'fieldMappingContainer',
            'enablePassword', 'masterPassword', 'passwordGroup',
            'currentVersion', 'checkUpdates', 'updateNotification', 'updateProgress',
            'devTab', 'devLogs', 'storageContent', 'extensionId', 'extensionVersion'
        ];

        for (const id of elementIds) {
            this.elements[id] = document.getElementById(id);
        }

        // Cache form inputs for each profile
        const profileTypes: (keyof Profile)[] = ['personal', 'work', 'custom'];
        
        for (const profileType of profileTypes) {
            const inputs = document.querySelectorAll(`#${profileType}-tab input, #${profileType}-tab select, #${profileType}-tab textarea`);
            inputs.forEach((input) => {
                const element = input as HTMLInputElement;
                if (element.dataset.field) {
                    this.elements[`${profileType}_${element.dataset.field}`] = element;
                }
            });
        }
    }

    private async loadProfiles(): Promise<void> {
        try {
            const result = await chrome.storage.sync.get(['profiles', 'settings', 'customFields', 'fieldMappings']);
            
            this.profiles = result.profiles || { personal: {}, work: {}, custom: {} };
            this.settings = { ...this.settings, ...(result.settings || {}) };
            this.customFields = result.customFields || [];
            this.fieldMappings = result.fieldMappings || {};

            this.populateFormFields();
            this.updateUIFromSettings();

        } catch (error) {
            console.error('Error loading profiles:', error);
            this.showMessage('Failed to load profiles', 'error');
        }
    }

    private populateFormFields(): void {
        for (const [profileType, profileData] of Object.entries(this.profiles)) {
            for (const [fieldName, fieldValue] of Object.entries(profileData)) {
                const elementKey = `${profileType}_${fieldName}`;
                const element = this.elements[elementKey] as HTMLInputElement;
                
                if (element && fieldValue) {
                    element.value = String(fieldValue);
                }
            }
        }
    }

    private updateUIFromSettings(): void {
        const passwordCheckbox = this.elements.enablePassword as HTMLInputElement;
        const passwordGroup = this.elements.passwordGroup as HTMLElement;

        if (passwordCheckbox) {
            passwordCheckbox.checked = this.settings.passwordProtected;
            
            if (passwordGroup) {
                passwordGroup.style.display = this.settings.passwordProtected ? 'block' : 'none';
            }
        }

        // Show/hide dev tab based on development mode
        const devTab = this.elements.devTab as HTMLElement;
        if (devTab) {
            devTab.style.display = this.isDevelopmentMode() ? 'inline-block' : 'none';
        }
    }

    private setupEventListeners(): void {
        // Fill all fields button
        this.elements.fillAllFields?.addEventListener('click', () => {
            this.fillAllFields();
        });

        // Save profile button
        this.elements.saveProfile?.addEventListener('click', () => {
            this.saveCurrentProfile();
        });

        // Detect fields button
        this.elements.detectFieldsBtn?.addEventListener('click', () => {
            this.detectFields();
        });

        // Export/Import buttons
        this.elements.exportProfiles?.addEventListener('click', () => {
            this.exportProfiles();
        });

        this.elements.importProfilesBtn?.addEventListener('click', () => {
            this.elements.importProfiles?.click();
        });

        this.elements.importProfiles?.addEventListener('change', (event) => {
            this.importProfiles(event as Event);
        });

        // Settings
        this.elements.enablePassword?.addEventListener('change', (event) => {
            this.togglePasswordProtection((event.target as HTMLInputElement).checked);
        });

        // Custom fields
        this.elements.addCustomField?.addEventListener('click', () => {
            this.showCustomFieldDialog();
        });

        // Form change listeners for auto-save
        this.setupFormChangeListeners();

        // Update listeners
        this.setupUpdateListeners();
    }

    private setupFormChangeListeners(): void {
        const forms = document.querySelectorAll('form, .form-section');
        
        forms.forEach(form => {
            const inputs = form.querySelectorAll('input, select, textarea');
            
            inputs.forEach(input => {
                input.addEventListener('input', this.debounce(() => {
                    this.autoSaveProfile();
                }, 1000));
            });
        });
    }

    private setupTabs(): void {
        const tabButtons = document.querySelectorAll('.tab-button');
        const tabContents = document.querySelectorAll('.tab-content');

        tabButtons.forEach(button => {
            button.addEventListener('click', (event) => {
                const target = event.target as HTMLElement;
                const tabName = target.dataset.tab;
                
                if (tabName) {
                    this.switchTab(tabName);
                }
            });
        });
    }

    private switchTab(tabName: string): void {
        // Update active tab button
        const tabButtons = document.querySelectorAll('.tab-button');
        tabButtons.forEach(button => {
            button.classList.toggle('active', button.getAttribute('data-tab') === tabName);
        });

        // Update active tab content
        const tabContents = document.querySelectorAll('.tab-content');
        tabContents.forEach(content => {
            content.classList.toggle('active', content.id === `${tabName}-tab`);
        });

        this.currentTab = tabName;
    }

    private async fillAllFields(): Promise<void> {
        try {
            const profileData = this.profiles[this.currentTab as keyof Profile];
            
            if (!profileData || Object.keys(profileData).length === 0) {
                this.showMessage('No profile data to fill with', 'warning');
                return;
            }

            // Validate required fields
            const validation = this.validateProfile(profileData);
            if (!validation.isValid) {
                this.showMessage(`Validation errors: ${validation.errors.join(', ')}`, 'error');
                return;
            }

            const message: AutofillMessage = {
                action: 'autofill',
                data: profileData,
                profileType: this.currentTab as keyof Profile,
                timestamp: Date.now()
            };

            const [activeTab] = await chrome.tabs.query({ active: true, currentWindow: true });
            if (activeTab?.id) {
                await chrome.tabs.sendMessage(activeTab.id, message);
                this.showMessage('Fields filled successfully', 'success');
            } else {
                this.showMessage('No active tab found', 'error');
            }

        } catch (error) {
            console.error('Autofill error:', error);
            this.showMessage('Failed to fill fields', 'error');
        }
    }

    private async saveCurrentProfile(): Promise<void> {
        try {
            const profileData = this.collectFormData(this.currentTab);
            
            const validation = this.validateProfile(profileData);
            if (!validation.isValid) {
                this.showMessage(`Validation errors: ${validation.errors.join(', ')}`, 'error');
                return;
            }

            this.profiles[this.currentTab as keyof Profile] = profileData;

            await chrome.storage.sync.set({ profiles: this.profiles });
            this.showMessage('Profile saved successfully', 'success');

        } catch (error) {
            console.error('Save error:', error);
            this.showMessage('Failed to save profile', 'error');
        }
    }

    private collectFormData(profileType: string): Partial<FieldType> {
        const data: Partial<FieldType> = {};
        const container = document.getElementById(`${profileType}-tab`);
        
        if (!container) return data;

        const inputs = container.querySelectorAll('input, select, textarea');
        
        inputs.forEach(input => {
            const element = input as HTMLInputElement;
            const fieldName = element.dataset.field as FieldTypeName;
            
            if (fieldName && element.value.trim()) {
                data[fieldName] = element.value.trim();
            }
        });

        return data;
    }

    private validateProfile(profileData: Partial<FieldType>): FormValidationResult {
        const errors: string[] = [];
        
        // Email validation
        if (profileData.email && !this.isValidEmail(profileData.email)) {
            errors.push('Invalid email format');
        }

        // Phone validation
        if (profileData.phone && !this.isValidPhone(profileData.phone)) {
            errors.push('Invalid phone format');
        }

        // URL validation
        if (profileData.website && !this.isValidUrl(profileData.website)) {
            errors.push('Invalid website URL');
        }

        if (profileData.linkedin && !this.isValidUrl(profileData.linkedin)) {
            errors.push('Invalid LinkedIn URL');
        }

        return {
            isValid: errors.length === 0,
            errors
        };
    }

    private isValidEmail(email: string): boolean {
        const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
        return emailRegex.test(email);
    }

    private isValidPhone(phone: string): boolean {
        const phoneRegex = /^[\+]?[\s\-\(\)]*([0-9][\s\-\(\)]*){10,}$/;
        return phoneRegex.test(phone);
    }

    private isValidUrl(url: string): boolean {
        try {
            new URL(url);
            return true;
        } catch {
            return false;
        }
    }

    private async detectFields(): Promise<void> {
        try {
            const [activeTab] = await chrome.tabs.query({ active: true, currentWindow: true });
            
            if (!activeTab?.id) {
                this.showMessage('No active tab found', 'error');
                return;
            }

            const response = await chrome.tabs.sendMessage(activeTab.id, {
                action: 'getDetectedFields'
            } as MessageRequest);

            if (response.count > 0) {
                this.showMessage(`Detected ${response.count} fields`, 'success');
                this.updateDetectedFieldsDisplay(response.fieldTypes);
            } else {
                this.showMessage('No fields detected on current page', 'info');
            }

        } catch (error) {
            console.error('Field detection error:', error);
            this.showMessage('Failed to detect fields', 'error');
        }
    }

    private updateDetectedFieldsDisplay(fieldTypes: string[]): void {
        const detectedFieldsInfo = document.getElementById('detectedFieldsInfo');
        
        if (detectedFieldsInfo) {
            if (fieldTypes.length > 0) {
                const fieldList = fieldTypes.map(type => `<span class="field-badge">${type}</span>`).join(' ');
                detectedFieldsInfo.innerHTML = `
                    <h4>Detected Fields (${fieldTypes.length})</h4>
                    <div class="detected-fields">${fieldList}</div>
                `;
            } else {
                detectedFieldsInfo.innerHTML = '<p class="no-fields">No fields detected on current page</p>';
            }
        }
    }

    private async autoSaveProfile(): Promise<void> {
        try {
            const profileData = this.collectFormData(this.currentTab);
            this.profiles[this.currentTab as keyof Profile] = { ...this.profiles[this.currentTab as keyof Profile], ...profileData };
            
            await chrome.storage.sync.set({ profiles: this.profiles });
            
        } catch (error) {
            console.error('Auto-save error:', error);
        }
    }

    private async exportProfiles(): Promise<void> {
        try {
            const message: MessageRequest = {
                action: 'exportData',
                timestamp: Date.now()
            };

            const response = await chrome.runtime.sendMessage(message);
            
            if (response.success) {
                const blob = new Blob([JSON.stringify(response.data, null, 2)], { type: 'application/json' });
                const url = URL.createObjectURL(blob);
                const a = document.createElement('a');
                a.href = url;
                a.download = `pii-autofill-backup-${new Date().toISOString().split('T')[0]}.json`;
                a.click();
                URL.revokeObjectURL(url);
                
                this.showMessage('Data exported successfully', 'success');
            } else {
                this.showMessage('Export failed', 'error');
            }

        } catch (error) {
            console.error('Export error:', error);
            this.showMessage('Failed to export data', 'error');
        }
    }

    private async importProfiles(event: Event): Promise<void> {
        const input = event.target as HTMLInputElement;
        const file = input.files?.[0];
        
        if (!file) return;

        try {
            const text = await file.text();
            const importData = JSON.parse(text);
            
            const message: MessageRequest = {
                action: 'importData',
                data: importData,
                timestamp: Date.now()
            };

            const response = await chrome.runtime.sendMessage(message);
            
            if (response.success) {
                await this.loadProfiles();
                this.showMessage('Data imported successfully', 'success');
            } else {
                this.showMessage('Import failed', 'error');
            }

        } catch (error) {
            console.error('Import error:', error);
            this.showMessage('Invalid import file', 'error');
        }
    }

    private togglePasswordProtection(enabled: boolean): void {
        this.settings.passwordProtected = enabled;
        const passwordGroup = this.elements.passwordGroup as HTMLElement;
        
        if (passwordGroup) {
            passwordGroup.style.display = enabled ? 'block' : 'none';
        }

        this.saveSettings();
    }

    private async saveSettings(): Promise<void> {
        try {
            await chrome.storage.sync.set({ settings: this.settings });
        } catch (error) {
            console.error('Settings save error:', error);
        }
    }

    private loadCustomFields(): void {
        const container = this.elements.customFieldsContainer as HTMLElement;
        
        if (!container) return;

        container.innerHTML = '';
        
        this.customFields.forEach((field, index) => {
            const fieldHtml = this.createCustomFieldHTML(field, index);
            container.insertAdjacentHTML('beforeend', fieldHtml);
        });
    }

    private createCustomFieldHTML(field: CustomField, index: number): string {
        return `
            <div class="custom-field-item" data-index="${index}">
                <div class="form-group">
                    <label>${field.name}</label>
                    <input type="${field.type}" value="${field.value}" data-field-id="${field.id}">
                    <button type="button" class="remove-field-btn" onclick="removeCustomField(${index})">Remove</button>
                </div>
            </div>
        `;
    }

    private showCustomFieldDialog(): void {
        const name = prompt('Enter field name:');
        if (!name) return;

        const type = prompt('Enter field type (text, email, tel, url):') || 'text';
        
        const customField: CustomField = {
            id: `custom_${Date.now()}`,
            name: name.trim(),
            type: type as CustomField['type'],
            value: ''
        };

        this.customFields.push(customField);
        this.saveCustomFields();
        this.loadCustomFields();
    }

    private async saveCustomFields(): Promise<void> {
        try {
            await chrome.storage.sync.set({ customFields: this.customFields });
        } catch (error) {
            console.error('Custom fields save error:', error);
        }
    }

    private populateFieldMappings(): void {
        // Implementation for field mapping UI
        const container = this.elements.fieldMappingContainer as HTMLElement;
        if (container) {
            // Populate with detected vs mapped fields
        }
    }

    private async loadSiteRules(): Promise<void> {
        try {
            // Load site-specific rules for current page
            const [activeTab] = await chrome.tabs.query({ active: true, currentWindow: true });
            
            if (activeTab?.url) {
                const hostname = new URL(activeTab.url).hostname;
                // Load rules for this hostname
            }
        } catch (error) {
            console.error('Site rules load error:', error);
        }
    }

    private initDevTools(): void {
        if (!this.isDevelopmentMode()) return;

        // Initialize developer tools
        this.loadDevLogs();
        this.loadExtensionInfo();
        this.setupDevToolsListeners();
    }

    private isDevelopmentMode(): boolean {
        const manifest = chrome.runtime.getManifest();
        return !('update_url' in manifest) || this.settings.debugMode;
    }

    private loadDevLogs(): void {
        // Implementation for loading development logs
    }

    private loadExtensionInfo(): void {
        const manifest = chrome.runtime.getManifest();
        
        const elements = {
            extensionId: chrome.runtime.id,
            extensionVersion: manifest.version,
            manifestVersion: manifest.manifest_version.toString()
        };

        for (const [key, value] of Object.entries(elements)) {
            const element = document.getElementById(key);
            if (element) {
                element.textContent = value;
            }
        }
    }

    private setupDevToolsListeners(): void {
        // Development tools event listeners
        const reloadButton = document.getElementById('reloadExtension');
        reloadButton?.addEventListener('click', () => {
            chrome.runtime.reload();
        });
    }

    // Update management methods
    private async initializeUpdates(): Promise<void> {
        const manifest = chrome.runtime.getManifest();
        const versionElement = this.elements.currentVersion as HTMLElement;
        
        if (versionElement) {
            versionElement.textContent = `Version: ${manifest.version}`;
        }

        await this.checkForPendingUpdate();
        this.setupUpdateListeners();
        this.setupUpdateMessageHandlers();
    }

    private async checkForPendingUpdate(): Promise<void> {
        try {
            const result = await chrome.storage.local.get('pendingUpdate');
            if (result.pendingUpdate) {
                this.showUpdateNotification(result.pendingUpdate);
            }
        } catch (error) {
            console.error('Error checking for pending update:', error);
        }
    }

    private setupUpdateListeners(): void {
        this.elements.checkUpdates?.addEventListener('click', async () => {
            this.showMessage('Checking for updates...', 'info');
            
            try {
                const response = await chrome.runtime.sendMessage({ action: 'checkForUpdates' } as MessageRequest);
                if (response.success) {
                    this.showMessage('Update check completed', 'success');
                } else {
                    this.showMessage('Error checking for updates', 'error');
                }
            } catch (error) {
                this.showMessage('Error checking for updates', 'error');
            }
        });

        const installUpdateBtn = document.getElementById('installUpdate');
        installUpdateBtn?.addEventListener('click', async () => {
            await this.startUpdate();
        });

        const dismissUpdateBtn = document.getElementById('dismissUpdate');
        dismissUpdateBtn?.addEventListener('click', () => {
            this.hideUpdateNotification();
        });
    }

    private setupUpdateMessageHandlers(): void {
        chrome.runtime.onMessage.addListener((message: MessageRequest) => {
            switch (message.type) {
                case 'update-updateAvailable':
                    this.showUpdateNotification(message.data);
                    break;
                case 'update-updateCompleted':
                    this.onUpdateCompleted(message.data);
                    break;
                case 'update-updateFailed':
                    this.onUpdateFailed(message.data);
                    break;
                case 'update-reloadPopup':
                    window.location.reload();
                    break;
            }
        });
    }

    private showUpdateNotification(updateInfo: UpdateInfo): void {
        const notification = this.elements.updateNotification as HTMLElement;
        const versionElement = document.getElementById('updateVersion');
        
        if (notification && versionElement) {
            versionElement.textContent = `Version ${updateInfo.version} is ready to install`;
            notification.style.display = 'block';
        }
    }

    private hideUpdateNotification(): void {
        const notification = this.elements.updateNotification as HTMLElement;
        if (notification) {
            notification.style.display = 'none';
        }
    }

    private async startUpdate(): Promise<void> {
        const progressContainer = this.elements.updateProgress as HTMLElement;
        const progressFill = document.getElementById('progressFill') as HTMLElement;
        const statusElement = document.getElementById('updateStatus') as HTMLElement;
        
        if (!progressContainer || !progressFill || !statusElement) return;

        this.hideUpdateNotification();
        progressContainer.style.display = 'block';
        
        // Animate progress
        let progress = 0;
        const progressInterval = setInterval(() => {
            progress += Math.random() * 15;
            if (progress > 90) progress = 90;
            
            progressFill.style.width = `${progress}%`;
        }, 200);

        try {
            statusElement.textContent = 'Backing up user data...';
            await new Promise(resolve => setTimeout(resolve, 1000));

            statusElement.textContent = 'Downloading update...';
            await new Promise(resolve => setTimeout(resolve, 1500));

            statusElement.textContent = 'Installing update...';
            
            await chrome.runtime.sendMessage({ action: 'startUpdate' } as MessageRequest);
            
        } catch (error) {
            clearInterval(progressInterval);
            this.onUpdateFailed({ error: (error as Error).message });
        }
    }

    private onUpdateCompleted(data: any): void {
        const progressFill = document.getElementById('progressFill') as HTMLElement;
        const statusElement = document.getElementById('updateStatus') as HTMLElement;
        
        if (progressFill && statusElement) {
            progressFill.style.width = '100%';
            statusElement.textContent = `Successfully updated to version ${data.version}!`;
            
            setTimeout(() => {
                const progressContainer = this.elements.updateProgress as HTMLElement;
                const versionElement = this.elements.currentVersion as HTMLElement;
                
                if (progressContainer) progressContainer.style.display = 'none';
                if (versionElement) versionElement.textContent = `Version: ${data.version}`;
                
                this.showMessage(`Updated to version ${data.version}!`, 'success');
            }, 2000);
        }
    }

    private onUpdateFailed(data: any): void {
        const progressContainer = this.elements.updateProgress as HTMLElement;
        const statusElement = document.getElementById('updateStatus') as HTMLElement;
        
        if (statusElement) {
            statusElement.textContent = `Update failed: ${data.error}`;
        }
        
        setTimeout(() => {
            if (progressContainer) {
                progressContainer.style.display = 'none';
            }
            this.showMessage('Update failed. Please try again later.', 'error');
        }, 3000);
    }

    // Utility methods
    private debounce<T extends (...args: any[]) => any>(func: T, wait: number): (...args: Parameters<T>) => void {
        let timeout: number;
        return (...args: Parameters<T>): void => {
            clearTimeout(timeout);
            timeout = setTimeout(() => func.apply(this, args), wait);
        };
    }

    private showMessage(message: string, type: 'success' | 'error' | 'warning' | 'info' = 'info'): void {
        // Create or update message display
        let messageEl = document.getElementById('popup-message') as HTMLElement;
        
        if (!messageEl) {
            messageEl = document.createElement('div');
            messageEl.id = 'popup-message';
            messageEl.className = 'popup-message';
            document.body.appendChild(messageEl);
        }

        messageEl.textContent = message;
        messageEl.className = `popup-message ${type}`;
        messageEl.style.display = 'block';

        // Auto-hide after 3 seconds
        setTimeout(() => {
            messageEl.style.display = 'none';
        }, 3000);
    }
}

// Initialize popup when DOM is ready
document.addEventListener('DOMContentLoaded', () => {
    new PopupManager();
});

// Global functions for HTML onclick handlers
(window as any).removeCustomField = (index: number): void => {
    // Implementation for removing custom field
};