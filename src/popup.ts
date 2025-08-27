// Popup TypeScript implementation with type safety
import type {
    Profile,
    Settings,
    FieldType,
    FieldTypeName
} from '../types/extension';

interface PopupElements {
    [key: string]: HTMLElement | null;
}

interface FormValidationResult {
    isValid: boolean;
    errors: string[];
}

class PopupManager {
    private profiles: Profile;
    private settings: Settings;
    private currentTab: string;
    private elements: PopupElements;

    constructor() {
        this.profiles = { personal: {} };
        this.settings = {
            autoDetectFields: true,
            debugMode: false
        };
        this.currentTab = 'personal';
        this.elements = {};

        this.init();
    }

    private async init(): Promise<void> {
        try {
            await this.loadProfiles();
            this.cacheElements();
            this.setupEventListeners();
            await this.initializeToggleButton();
        } catch (error) {
            this.showMessage('Failed to initialize popup', 'error');
        }
    }

    private cacheElements(): void {
        const elementIds = [
            'fillAllFields', 'saveProfile', 'detectFieldsBtn', 'toggleExtensionBtn',
            'toggleExtensionText'
        ];

        for (const id of elementIds) {
            this.elements[id] = document.getElementById(id);
        }
    }

    private async loadProfiles(): Promise<void> {
        try {
            const result = await chrome.storage.sync.get(['profiles', 'settings']);
            
            this.profiles = result.profiles || { personal: {} };
            this.settings = { ...this.settings, ...(result.settings || {}) };

            this.populateFormFields();

        } catch (error) {
            this.showMessage('Failed to load profiles', 'error');
        }
    }

    private populateFormFields(): void {
        for (const [fieldName, fieldValue] of Object.entries(this.profiles.personal)) {
            const element = document.getElementById(fieldName) as HTMLInputElement;
            
            if (element && fieldValue) {
                element.value = String(fieldValue);
            }
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

        // Toggle extension button
        this.elements.toggleExtensionBtn?.addEventListener('click', () => {
            this.toggleExtension();
        });

        // Form change listeners for auto-save
        this.setupFormChangeListeners();
    }

    private setupFormChangeListeners(): void {
        const container = document.getElementById('personal-tab');
        if (!container) return;
        
        const inputs = container.querySelectorAll('input, select, textarea');
        
        inputs.forEach(input => {
            input.addEventListener('input', this.debounce(() => {
                this.autoSaveProfile();
            }, 1000));
        });
    }

    private async fillAllFields(): Promise<void> {
        try {
            const profileData = this.profiles.personal;
            
            if (!profileData || Object.keys(profileData).length === 0) {
                this.showMessage('No profile data to fill with. Please save some data first.', 'warning');
                return;
            }

            // Validate required fields
            const validation = this.validateProfile(profileData);
            if (!validation.isValid) {
                this.showMessage(`Validation errors: ${validation.errors.join(', ')}`, 'error');
                return;
            }

            const message = {
                action: 'autofill',
                data: profileData,
                profileType: this.currentTab
            };

            // Ensure message is JSON serializable
            const safeMessage = JSON.parse(JSON.stringify(message));
            const response = await chrome.runtime.sendMessage(safeMessage);
            
            if (response?.success) {
                this.showMessage('Fields filled successfully', 'success');
            } else {
                this.showMessage(`Autofill failed: ${response?.error || 'Unknown error'}`, 'error');
            }

        } catch (error) {
            this.showMessage('Failed to fill fields', 'error');
        }
    }

    private async saveCurrentProfile(): Promise<void> {
        try {
            const profileData = this.collectFormData();
            
            const validation = this.validateProfile(profileData);
            if (!validation.isValid) {
                this.showMessage(`Validation errors: ${validation.errors.join(', ')}`, 'error');
                return;
            }

            this.profiles.personal = profileData;

            await chrome.storage.sync.set({ profiles: this.profiles });
            this.showMessage('Profile saved successfully', 'success');

        } catch (error) {
            this.showMessage('Failed to save profile', 'error');
        }
    }

    private async toggleExtension(): Promise<void> {
        try {
            const result = await chrome.storage.local.get('extensionEnabled');
            const currentState = result.extensionEnabled !== false; // default to true
            const newState = !currentState;
            
            await chrome.storage.local.set({ extensionEnabled: newState });
            
            this.updateToggleButtonState(newState);
            
            const message = newState ? 'Extension enabled' : 'Extension disabled';
            this.showMessage(message, 'info');
            
        } catch (error) {
            this.showMessage('Failed to toggle extension', 'error');
        }
    }

    private updateToggleButtonState(enabled: boolean): void {
        const toggleText = this.elements.toggleExtensionText;
        const toggleBtn = this.elements.toggleExtensionBtn;
        
        if (toggleText) {
            toggleText.textContent = enabled ? 'Disable' : 'Enable';
        }
        
        if (toggleBtn) {
            toggleBtn.title = enabled ? 'Disable Extension' : 'Enable Extension';
            toggleBtn.className = enabled ? 'btn btn-secondary' : 'btn btn-primary';
        }
    }

    private async initializeToggleButton(): Promise<void> {
        try {
            const result = await chrome.storage.local.get('extensionEnabled');
            const enabled = result.extensionEnabled !== false; // default to true
            this.updateToggleButtonState(enabled);
        } catch (error) {
            // Default to enabled state
            this.updateToggleButtonState(true);
        }
    }

    private collectFormData(): Partial<FieldType> {
        const data: Partial<FieldType> = {};
        const container = document.getElementById('personal-tab');
        
        if (!container) return data;

        const inputs = container.querySelectorAll('input, select, textarea');
        
        inputs.forEach(input => {
            const element = input as HTMLInputElement;
            const fieldName = element.dataset.field as FieldTypeName;
            const value = element.value?.trim();
            
            if (fieldName && value) {
                data[fieldName] = value;
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

        // LinkedIn URL validation
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
            const safeMessage = JSON.parse(JSON.stringify({
                action: 'getDetectedFields'
            }));
            const response = await chrome.runtime.sendMessage(safeMessage);

            const safeResponse = response || {};
            const count = Number(safeResponse.count) || 0;

            if (count > 0) {
                this.showMessage(`Detected ${count} fields`, 'success');
            } else {
                this.showMessage('No fields detected on current page', 'info');
            }

        } catch (error) {
            this.showMessage('Failed to detect fields', 'error');
        }
    }

    private async autoSaveProfile(): Promise<void> {
        try {
            const profileData = this.collectFormData();
            this.profiles.personal = { ...this.profiles.personal, ...profileData };
            
            await chrome.storage.sync.set({ profiles: this.profiles });
            
        } catch (error) {
            // Silent fail for auto-save
        }
    }

    private debounce<T extends (...args: any[]) => any>(func: T, wait: number): (...args: Parameters<T>) => void {
        let timeout: ReturnType<typeof setTimeout>;
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
    try {
        new PopupManager();
    } catch (error) {
        // Silent fail
    }
});