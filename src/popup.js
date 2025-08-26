class PopupManager {
    constructor() {
        this.profiles = {
            personal: {},
            work: {},
            custom: {}
        };
        this.currentProfile = 'personal';
        this.isPasswordProtected = false;
        this.masterPassword = '';
        this.customFields = [];
        this.fieldMappings = {};
        this.detectedFields = [];
        
        this.init();
    }

    async init() {
        await this.loadProfiles();
        this.setupEventListeners();
        this.setupTabs();
        this.loadCustomFields();
        this.detectCurrentPageFields();
        this.populateFieldMappings();
    }

    async loadProfiles() {
        try {
            const result = await chrome.storage.sync.get(['profiles', 'settings', 'customFields', 'fieldMappings']);
            
            this.profiles = result.profiles || { personal: {}, work: {}, custom: {} };
            const settings = result.settings || {};
            this.customFields = result.customFields || [];
            this.fieldMappings = result.fieldMappings || {};
            
            this.isPasswordProtected = settings.passwordProtected || false;
            this.masterPassword = settings.masterPassword || '';
            
            this.populateForm();
            this.updateSecuritySettings();
            
        } catch (error) {
            console.error('Error loading profiles:', error);
        }
    }

    async saveProfiles() {
        try {
            await chrome.storage.sync.set({
                profiles: this.profiles,
                settings: {
                    passwordProtected: this.isPasswordProtected,
                    masterPassword: this.masterPassword
                },
                customFields: this.customFields,
                fieldMappings: this.fieldMappings
            });
            this.showMessage('Profile saved successfully!', 'success');
        } catch (error) {
            console.error('Error saving profiles:', error);
            this.showMessage('Error saving profile', 'error');
        }
    }

    setupEventListeners() {
        // Tab switching
        document.querySelectorAll('.tab-button').forEach(button => {
            button.addEventListener('click', (e) => {
                this.switchTab(e.target.dataset.tab);
            });
        });

        // Form inputs
        document.querySelectorAll('input[data-field]').forEach(input => {
            input.addEventListener('input', (e) => {
                this.updateProfile(e.target.dataset.field, e.target.value);
            });
        });

        // Visibility toggles for sensitive fields
        document.querySelectorAll('.toggle-visibility').forEach(button => {
            button.addEventListener('click', (e) => {
                this.toggleFieldVisibility(e.target.dataset.target);
            });
        });

        // Action buttons
        document.getElementById('saveProfile').addEventListener('click', () => this.saveProfiles());
        document.getElementById('fillAllFields').addEventListener('click', () => this.fillAllFields());
        document.getElementById('detectFieldsBtn').addEventListener('click', () => this.detectCurrentPageFields());
        
        // Import/Export
        document.getElementById('exportProfiles').addEventListener('click', () => this.exportProfiles());
        document.getElementById('importProfilesBtn').addEventListener('click', () => this.triggerImport());
        document.getElementById('importProfiles').addEventListener('change', (e) => this.importProfiles(e));

        // Custom fields
        document.getElementById('addCustomField').addEventListener('click', () => this.addCustomField());

        // Quick fill buttons
        document.querySelectorAll('.quick-fill-btn').forEach(button => {
            button.addEventListener('click', (e) => {
                this.quickFillSite(e.target.dataset.site);
            });
        });

        // Security settings
        document.getElementById('enablePassword').addEventListener('change', (e) => {
            this.togglePasswordProtection(e.target.checked);
        });

        document.getElementById('masterPassword').addEventListener('input', (e) => {
            this.masterPassword = e.target.value;
        });

        // Password modal
        document.getElementById('confirmPassword').addEventListener('click', () => this.confirmPassword());
        document.getElementById('cancelPassword').addEventListener('click', () => this.hidePasswordModal());
    }

    setupTabs() {
        document.querySelectorAll('.tab-button').forEach(button => {
            button.classList.remove('active');
        });
        document.querySelectorAll('.tab-content').forEach(content => {
            content.classList.remove('active');
        });
        
        document.querySelector(`[data-tab="${this.currentProfile}"]`).classList.add('active');
        document.getElementById(`${this.currentProfile}-tab`).classList.add('active');
    }

    switchTab(tab) {
        this.currentProfile = tab;
        this.setupTabs();
        if (tab === 'custom') {
            this.loadCustomFields();
        }
    }

    populateForm() {
        Object.entries(this.profiles).forEach(([profileType, data]) => {
            Object.entries(data).forEach(([field, value]) => {
                const input = document.querySelector(`input[data-field="${field}"]`);
                if (input && (profileType === this.currentProfile || profileType === 'personal')) {
                    if (input.dataset.sensitive && this.isPasswordProtected) {
                        input.type = 'password';
                    }
                    input.value = value;
                }
            });
        });
    }

    updateProfile(field, value) {
        if (!this.profiles[this.currentProfile]) {
            this.profiles[this.currentProfile] = {};
        }
        this.profiles[this.currentProfile][field] = value;
    }

    toggleFieldVisibility(targetId) {
        const input = document.getElementById(targetId);
        const button = document.querySelector(`[data-target="${targetId}"]`);
        
        if (input.type === 'password') {
            input.type = 'text';
            button.textContent = '🙈';
        } else {
            input.type = 'password';
            button.textContent = '👁️';
        }
    }

    async fillAllFields() {
        if (this.isPasswordProtected && !await this.verifyPassword()) {
            return;
        }

        const currentData = { ...this.profiles.personal, ...this.profiles[this.currentProfile] };
        
        try {
            const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
            await chrome.tabs.sendMessage(tab.id, {
                action: 'autofill',
                data: currentData
            });
            this.showMessage('Fields filled successfully!', 'success');
        } catch (error) {
            console.error('Error filling fields:', error);
            this.showMessage('Error filling fields', 'error');
        }
    }

    async detectCurrentPageFields() {
        try {
            const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
            const response = await chrome.tabs.sendMessage(tab.id, {
                action: 'getDetectedFields'
            });
            
            this.detectedFields = response.fieldTypes || [];
            this.updateDetectedFieldsDisplay();
            this.populateFieldMappings();
            this.showMessage(`Detected ${this.detectedFields.length} field types`, 'success');
        } catch (error) {
            console.error('Error detecting fields:', error);
            this.showMessage('Error detecting fields on current page', 'error');
        }
    }

    updateDetectedFieldsDisplay() {
        const container = document.getElementById('detectedFieldsInfo');
        
        if (this.detectedFields.length === 0) {
            container.innerHTML = '<p class="no-fields">No fields detected on current page</p>';
            return;
        }

        const fieldCounts = this.detectedFields.reduce((acc, field) => {
            acc[field] = (acc[field] || 0) + 1;
            return acc;
        }, {});

        container.innerHTML = Object.entries(fieldCounts)
            .map(([field, count]) => `
                <div class="detected-field">
                    <span class="detected-field-name">${field}</span>
                    <span class="detected-field-type">${count} field${count > 1 ? 's' : ''}</span>
                </div>
            `).join('');
    }

    populateFieldMappings() {
        const container = document.getElementById('fieldMappingContainer');
        const uniqueFields = [...new Set(this.detectedFields)];
        
        if (uniqueFields.length === 0) {
            container.innerHTML = '<p class="no-fields">No fields detected for mapping</p>';
            return;
        }

        container.innerHTML = uniqueFields.map(field => `
            <div class="mapping-row">
                <span>${field}</span>
                <select data-detected-field="${field}">
                    <option value="">-- Select Profile Field --</option>
                    <option value="firstName" ${this.fieldMappings[field] === 'firstName' ? 'selected' : ''}>First Name</option>
                    <option value="lastName" ${this.fieldMappings[field] === 'lastName' ? 'selected' : ''}>Last Name</option>
                    <option value="email" ${this.fieldMappings[field] === 'email' ? 'selected' : ''}>Email</option>
                    <option value="phone" ${this.fieldMappings[field] === 'phone' ? 'selected' : ''}>Phone</option>
                    <option value="street" ${this.fieldMappings[field] === 'street' ? 'selected' : ''}>Street</option>
                    <option value="city" ${this.fieldMappings[field] === 'city' ? 'selected' : ''}>City</option>
                    <option value="state" ${this.fieldMappings[field] === 'state' ? 'selected' : ''}>State</option>
                    <option value="zip" ${this.fieldMappings[field] === 'zip' ? 'selected' : ''}>ZIP Code</option>
                    <option value="country" ${this.fieldMappings[field] === 'country' ? 'selected' : ''}>Country</option>
                    <option value="company" ${this.fieldMappings[field] === 'company' ? 'selected' : ''}>Company</option>
                    <option value="jobTitle" ${this.fieldMappings[field] === 'jobTitle' ? 'selected' : ''}>Job Title</option>
                </select>
            </div>
        `).join('');

        // Add event listeners for mapping changes
        container.querySelectorAll('select').forEach(select => {
            select.addEventListener('change', (e) => {
                const detectedField = e.target.dataset.detectedField;
                const mappedField = e.target.value;
                if (mappedField) {
                    this.fieldMappings[detectedField] = mappedField;
                } else {
                    delete this.fieldMappings[detectedField];
                }
            });
        });
    }

    addCustomField() {
        const fieldId = `custom_${Date.now()}`;
        const customField = {
            id: fieldId,
            name: '',
            value: ''
        };
        
        this.customFields.push(customField);
        this.renderCustomFields();
    }

    removeCustomField(fieldId) {
        this.customFields = this.customFields.filter(field => field.id !== fieldId);
        this.renderCustomFields();
    }

    loadCustomFields() {
        this.renderCustomFields();
    }

    renderCustomFields() {
        const container = document.getElementById('customFieldsContainer');
        
        if (this.customFields.length === 0) {
            container.innerHTML = '<p class="no-fields">No custom fields added</p>';
            return;
        }

        container.innerHTML = this.customFields.map(field => `
            <div class="custom-field-item">
                <input type="text" placeholder="Field name" value="${field.name}" 
                       data-field-id="${field.id}" data-field-prop="name">
                <input type="text" placeholder="Field value" value="${field.value}" 
                       data-field-id="${field.id}" data-field-prop="value">
                <button class="btn remove-field" data-field-id="${field.id}">Remove</button>
            </div>
        `).join('');

        // Add event listeners
        container.querySelectorAll('input').forEach(input => {
            input.addEventListener('input', (e) => {
                const fieldId = e.target.dataset.fieldId;
                const prop = e.target.dataset.fieldProp;
                const field = this.customFields.find(f => f.id === fieldId);
                if (field) {
                    field[prop] = e.target.value;
                }
            });
        });

        container.querySelectorAll('.remove-field').forEach(button => {
            button.addEventListener('click', (e) => {
                this.removeCustomField(e.target.dataset.fieldId);
            });
        });
    }

    exportProfiles() {
        const exportData = {
            profiles: this.profiles,
            customFields: this.customFields,
            fieldMappings: this.fieldMappings,
            exportDate: new Date().toISOString(),
            version: '1.0'
        };

        const blob = new Blob([JSON.stringify(exportData, null, 2)], { type: 'application/json' });
        const url = URL.createObjectURL(blob);
        const a = document.createElement('a');
        a.href = url;
        a.download = `pii-autofill-profiles-${new Date().toISOString().split('T')[0]}.json`;
        a.click();
        URL.revokeObjectURL(url);
        
        this.showMessage('Profiles exported successfully!', 'success');
    }

    triggerImport() {
        document.getElementById('importProfiles').click();
    }

    async importProfiles(event) {
        const file = event.target.files[0];
        if (!file) return;

        try {
            const text = await file.text();
            const importData = JSON.parse(text);

            if (importData.profiles) this.profiles = importData.profiles;
            if (importData.customFields) this.customFields = importData.customFields;
            if (importData.fieldMappings) this.fieldMappings = importData.fieldMappings;

            this.populateForm();
            this.loadCustomFields();
            this.populateFieldMappings();
            
            await this.saveProfiles();
            this.showMessage('Profiles imported successfully!', 'success');
        } catch (error) {
            console.error('Error importing profiles:', error);
            this.showMessage('Error importing profiles. Please check the file format.', 'error');
        }
    }

    quickFillSite(site) {
        const siteProfiles = {
            amazon: { ...this.profiles.personal },
            linkedin: { ...this.profiles.work },
            generic: { ...this.profiles.personal, ...this.profiles[this.currentProfile] }
        };

        const data = siteProfiles[site] || siteProfiles.generic;
        this.fillFieldsWithData(data);
    }

    async fillFieldsWithData(data) {
        try {
            const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
            await chrome.tabs.sendMessage(tab.id, {
                action: 'autofill',
                data: data
            });
            this.showMessage('Quick fill completed!', 'success');
        } catch (error) {
            console.error('Error with quick fill:', error);
            this.showMessage('Error with quick fill', 'error');
        }
    }

    togglePasswordProtection(enabled) {
        this.isPasswordProtected = enabled;
        document.getElementById('passwordGroup').style.display = enabled ? 'block' : 'none';
        
        if (!enabled) {
            this.masterPassword = '';
            document.getElementById('masterPassword').value = '';
        }
        
        this.updateSensitiveFields();
    }

    updateSecuritySettings() {
        document.getElementById('enablePassword').checked = this.isPasswordProtected;
        document.getElementById('passwordGroup').style.display = this.isPasswordProtected ? 'block' : 'none';
        document.getElementById('masterPassword').value = this.masterPassword;
        this.updateSensitiveFields();
    }

    updateSensitiveFields() {
        document.querySelectorAll('input[data-sensitive="true"]').forEach(input => {
            if (this.isPasswordProtected) {
                input.type = 'password';
            } else {
                input.type = 'text';
            }
        });
    }

    async verifyPassword() {
        return new Promise((resolve) => {
            if (!this.isPasswordProtected || !this.masterPassword) {
                resolve(true);
                return;
            }

            this.showPasswordModal((password) => {
                resolve(password === this.masterPassword);
            });
        });
    }

    showPasswordModal(callback) {
        const modal = document.getElementById('passwordModal');
        const input = document.getElementById('modalPassword');
        
        modal.style.display = 'flex';
        input.value = '';
        input.focus();
        
        this.passwordCallback = callback;
    }

    confirmPassword() {
        const password = document.getElementById('modalPassword').value;
        this.hidePasswordModal();
        
        if (this.passwordCallback) {
            this.passwordCallback(password);
            this.passwordCallback = null;
        }
    }

    hidePasswordModal() {
        document.getElementById('passwordModal').style.display = 'none';
        document.getElementById('modalPassword').value = '';
    }

    showMessage(message, type = 'success') {
        // Remove existing messages
        document.querySelectorAll('.success-message, .error-message').forEach(el => el.remove());
        
        const messageEl = document.createElement('div');
        messageEl.className = type === 'success' ? 'success-message' : 'error-message';
        messageEl.textContent = message;
        
        const container = document.querySelector('.container');
        container.insertBefore(messageEl, container.children[1]);
        
        setTimeout(() => {
            messageEl.remove();
        }, 3000);
    }
}

// Initialize popup when DOM is ready
document.addEventListener('DOMContentLoaded', () => {
    new PopupManager();
});