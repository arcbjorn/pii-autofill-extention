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
        this.siteRules = null;
        this.customRules = new Map();
        
        this.init();
    }

    async init() {
        await this.loadProfiles();
        this.setupEventListeners();
        this.setupTabs();
        this.loadCustomFields();
        this.detectCurrentPageFields();
        this.populateFieldMappings();
        await this.loadSiteRules();
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
        } else if (tab === 'rules') {
            this.loadSiteRules();
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

    // Site Rules Management
    async loadSiteRules() {
        try {
            const result = await chrome.storage.sync.get(['customSiteRules']);
            const customRules = result.customSiteRules || {};
            
            this.customRules = new Map(Object.entries(customRules));
            await this.getCurrentSiteRules();
            this.renderSiteRulesUI();
        } catch (error) {
            console.error('Error loading site rules:', error);
        }
    }

    async getCurrentSiteRules() {
        try {
            const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
            const response = await chrome.tabs.sendMessage(tab.id, {
                action: 'getCurrentSiteRules'
            });
            
            this.siteRules = response.rules || null;
            this.updateCurrentSiteDisplay();
        } catch (error) {
            console.error('Error getting current site rules:', error);
        }
    }

    updateCurrentSiteDisplay() {
        const container = document.getElementById('currentSiteRules');
        
        if (!this.siteRules) {
            container.innerHTML = '<p class="no-fields">No specific rules for current site</p>';
            return;
        }

        const hostname = new URL(window.location.href).hostname;
        container.innerHTML = `
            <div class="current-site-info">
                <div class="current-site-name">${hostname}</div>
                <div class="current-site-rules">
                    <span class="rule-status ${this.siteRules.site ? 'active' : 'inactive'}">
                        ${this.siteRules.site ? 'Active Rules' : 'No Rules'}
                    </span>
                    ${this.siteRules.type ? `<span class="rule-priority ${this.siteRules.type}">${this.siteRules.type}</span>` : ''}
                </div>
                ${this.siteRules.skipFields?.length ? `
                    <div class="skip-fields-list">
                        <h5>Skip Fields:</h5>
                        ${this.siteRules.skipFields.map(field => 
                            `<span class="skip-field-tag">${field}</span>`
                        ).join('')}
                    </div>
                ` : ''}
            </div>
        `;
    }

    renderSiteRulesUI() {
        this.renderCustomRules();
        this.setupRulesEventListeners();
    }

    renderCustomRules() {
        const container = document.getElementById('customRulesContainer');
        
        if (this.customRules.size === 0) {
            container.innerHTML = '<p class="no-fields">No custom rules defined</p>';
            return;
        }

        container.innerHTML = Array.from(this.customRules.entries()).map(([pattern, rules]) => `
            <div class="custom-rule-item">
                <div class="custom-rule-header">
                    <span class="custom-rule-pattern">${pattern}</span>
                    <div class="custom-rule-actions">
                        <button class="btn btn-secondary edit-rule" data-pattern="${pattern}">Edit</button>
                        <button class="btn remove-field remove-rule" data-pattern="${pattern}">Remove</button>
                    </div>
                </div>
                <div class="custom-rule-body">
                    ${this.renderRuleFields(rules)}
                </div>
            </div>
        `).join('');
    }

    renderRuleFields(rules) {
        const fields = rules.fields || {};
        const skipFields = rules.skipFields || [];
        
        let html = '<h5>Field Mappings:</h5>';
        
        if (Object.keys(fields).length === 0) {
            html += '<p style="font-size: 13px; color: #6c757d;">No field mappings defined</p>';
        } else {
            html += Object.entries(fields).map(([selector, config]) => `
                <div class="rule-field-mapping">
                    <code style="font-size: 11px; word-break: break-all;">${selector}</code>
                    <span>${config.type} <span class="rule-priority ${config.priority || 'medium'}">${config.priority || 'medium'}</span></span>
                    <span style="font-size: 12px;">${config.sensitive ? '🔒' : ''}</span>
                </div>
            `).join('');
        }
        
        if (skipFields.length > 0) {
            html += `
                <div class="skip-fields-list">
                    <h5>Skip Fields:</h5>
                    ${skipFields.map(field => `<span class="skip-field-tag">${field}</span>`).join('')}
                </div>
            `;
        }
        
        return html;
    }

    setupRulesEventListeners() {
        // Refresh site rules
        document.getElementById('refreshSiteRules')?.addEventListener('click', () => {
            this.getCurrentSiteRules();
        });

        // Add custom rule
        document.getElementById('addCustomRule')?.addEventListener('click', () => {
            this.showCustomRuleDialog();
        });

        // Remove custom rules
        document.querySelectorAll('.remove-rule').forEach(btn => {
            btn.addEventListener('click', (e) => {
                const pattern = e.target.dataset.pattern;
                this.removeCustomRule(pattern);
            });
        });

        // Edit custom rules
        document.querySelectorAll('.edit-rule').forEach(btn => {
            btn.addEventListener('click', (e) => {
                const pattern = e.target.dataset.pattern;
                this.showCustomRuleDialog(pattern, this.customRules.get(pattern));
            });
        });

        // Template usage
        document.querySelectorAll('.use-template-btn').forEach(btn => {
            btn.addEventListener('click', (e) => {
                const template = e.target.dataset.template;
                this.useRuleTemplate(template);
            });
        });

        // Import/Export rules
        document.getElementById('exportRules')?.addEventListener('click', () => {
            this.exportSiteRules();
        });

        document.getElementById('importRulesBtn')?.addEventListener('click', () => {
            document.getElementById('importRules').click();
        });

        document.getElementById('importRules')?.addEventListener('change', (e) => {
            this.importSiteRules(e);
        });
    }

    showCustomRuleDialog(pattern = '', existingRules = null) {
        const dialog = document.createElement('div');
        dialog.className = 'modal';
        dialog.style.display = 'flex';

        const isEdit = pattern !== '';
        const rules = existingRules || { fields: {}, skipFields: [], enabled: true };

        dialog.innerHTML = `
            <div class="modal-content" style="min-width: 500px; max-width: 600px;">
                <h3>${isEdit ? 'Edit' : 'Add'} Site Rule</h3>
                
                <div class="form-group">
                    <label>Site Pattern (e.g., amazon.com, *.google.com)</label>
                    <input type="text" id="rulePattern" value="${pattern}" placeholder="example.com">
                </div>

                <div class="form-group">
                    <label>
                        <input type="checkbox" id="ruleEnabled" ${rules.enabled ? 'checked' : ''}>
                        Enable this rule
                    </label>
                </div>

                <h4>Field Mappings</h4>
                <div id="ruleFieldMappings">
                    ${Object.entries(rules.fields || {}).map(([selector, config]) => `
                        <div class="rule-field-mapping">
                            <input type="text" placeholder="CSS selector" value="${selector}">
                            <select>
                                ${['firstName', 'lastName', 'fullName', 'email', 'phone', 'street', 'city', 'state', 'zip', 'country', 'cardNumber', 'cvv', 'expiryDate', 'company', 'jobTitle', 'website', 'linkedin']
                                    .map(type => `<option value="${type}" ${config.type === type ? 'selected' : ''}>${type}</option>`)
                                    .join('')}
                            </select>
                            <button type="button" class="remove-rule-field">×</button>
                        </div>
                    `).join('')}
                </div>
                <button type="button" class="add-rule-field" id="addRuleField">+ Add Field</button>

                <h4>Skip Fields (CSS selectors to ignore)</h4>
                <textarea id="skipFields" placeholder="input[type=password]&#10;.captcha&#10;#security-code" rows="3">${(rules.skipFields || []).join('\\n')}</textarea>

                <div class="modal-actions">
                    <button id="cancelRule" class="btn btn-secondary">Cancel</button>
                    <button id="saveRule" class="btn btn-primary">Save Rule</button>
                </div>
            </div>
        `;

        document.body.appendChild(dialog);

        // Event listeners for the dialog
        dialog.querySelector('#cancelRule').onclick = () => {
            document.body.removeChild(dialog);
        };

        dialog.querySelector('#addRuleField').onclick = () => {
            const container = dialog.querySelector('#ruleFieldMappings');
            const newMapping = document.createElement('div');
            newMapping.className = 'rule-field-mapping';
            newMapping.innerHTML = `
                <input type="text" placeholder="CSS selector">
                <select>
                    ${['firstName', 'lastName', 'fullName', 'email', 'phone', 'street', 'city', 'state', 'zip', 'country', 'cardNumber', 'cvv', 'expiryDate', 'company', 'jobTitle', 'website', 'linkedin']
                        .map(type => `<option value="${type}">${type}</option>`)
                        .join('')}
                </select>
                <button type="button" class="remove-rule-field">×</button>
            `;
            container.appendChild(newMapping);
            
            newMapping.querySelector('.remove-rule-field').onclick = () => {
                container.removeChild(newMapping);
            };
        };

        // Remove field buttons
        dialog.querySelectorAll('.remove-rule-field').forEach(btn => {
            btn.onclick = () => {
                btn.parentElement.remove();
            };
        });

        dialog.querySelector('#saveRule').onclick = () => {
            this.saveCustomRule(dialog, isEdit ? pattern : null);
            document.body.removeChild(dialog);
        };
    }

    saveCustomRule(dialog, originalPattern) {
        const pattern = dialog.querySelector('#rulePattern').value.trim();
        const enabled = dialog.querySelector('#ruleEnabled').checked;
        const skipFieldsText = dialog.querySelector('#skipFields').value;
        
        if (!pattern) {
            this.showMessage('Site pattern is required', 'error');
            return;
        }

        const fields = {};
        dialog.querySelectorAll('#ruleFieldMappings .rule-field-mapping').forEach(mapping => {
            const selector = mapping.querySelector('input').value.trim();
            const type = mapping.querySelector('select').value;
            
            if (selector && type) {
                fields[selector] = { type, priority: 'medium' };
            }
        });

        const skipFields = skipFieldsText
            .split('\n')
            .map(line => line.trim())
            .filter(line => line);

        const ruleData = {
            enabled,
            fields,
            skipFields
        };

        // Remove old pattern if editing
        if (originalPattern && originalPattern !== pattern) {
            this.customRules.delete(originalPattern);
        }

        this.customRules.set(pattern, ruleData);
        this.saveCustomRulesToStorage();
        this.renderCustomRules();
        
        this.showMessage(`Rule ${originalPattern ? 'updated' : 'added'} successfully`, 'success');
    }

    async saveCustomRulesToStorage() {
        try {
            const customRulesObj = Object.fromEntries(this.customRules);
            await chrome.storage.sync.set({ customSiteRules: customRulesObj });
        } catch (error) {
            console.error('Error saving custom rules:', error);
            this.showMessage('Error saving rules', 'error');
        }
    }

    removeCustomRule(pattern) {
        if (confirm(`Remove rule for "${pattern}"?`)) {
            this.customRules.delete(pattern);
            this.saveCustomRulesToStorage();
            this.renderCustomRules();
            this.showMessage('Rule removed successfully', 'success');
        }
    }

    useRuleTemplate(templateName) {
        const templates = {
            ecommerce: {
                pattern: '*.com',
                rules: {
                    enabled: true,
                    fields: {
                        'input[name*="email"]': { type: 'email', priority: 'high' },
                        'input[name*="firstName"]': { type: 'firstName', priority: 'high' },
                        'input[name*="lastName"]': { type: 'lastName', priority: 'high' },
                        'input[name*="address"]': { type: 'street', priority: 'high' },
                        'input[name*="city"]': { type: 'city', priority: 'high' },
                        'input[name*="state"]': { type: 'state', priority: 'high' },
                        'input[name*="zip"]': { type: 'zip', priority: 'high' }
                    },
                    skipFields: ['input[type="password"]', 'input[name*="card"]', 'input[name*="cvv"]']
                }
            },
            job: {
                pattern: '*.com',
                rules: {
                    enabled: true,
                    fields: {
                        'input[name*="firstName"]': { type: 'firstName', priority: 'high' },
                        'input[name*="lastName"]': { type: 'lastName', priority: 'high' },
                        'input[name*="email"]': { type: 'email', priority: 'high' },
                        'input[name*="phone"]': { type: 'phone', priority: 'high' },
                        'input[name*="company"]': { type: 'company', priority: 'high' },
                        'input[name*="title"]': { type: 'jobTitle', priority: 'high' },
                        'input[name*="website"]': { type: 'website', priority: 'medium' }
                    },
                    skipFields: ['input[type="password"]', 'input[name*="resume"]', 'textarea[name*="cover"]']
                }
            },
            contact: {
                pattern: '*.com',
                rules: {
                    enabled: true,
                    fields: {
                        'input[name*="name"]': { type: 'fullName', priority: 'high' },
                        'input[name*="email"]': { type: 'email', priority: 'high' },
                        'input[name*="phone"]': { type: 'phone', priority: 'medium' },
                        'input[name*="company"]': { type: 'company', priority: 'medium' }
                    },
                    skipFields: ['textarea[name*="message"]', 'input[name*="subject"]']
                }
            }
        };

        const template = templates[templateName];
        if (template) {
            this.showCustomRuleDialog(template.pattern, template.rules);
        }
    }

    exportSiteRules() {
        const exportData = {
            customRules: Object.fromEntries(this.customRules),
            exportDate: new Date().toISOString(),
            version: '1.0'
        };

        const blob = new Blob([JSON.stringify(exportData, null, 2)], { type: 'application/json' });
        const url = URL.createObjectURL(blob);
        const a = document.createElement('a');
        a.href = url;
        a.download = `pii-autofill-site-rules-${new Date().toISOString().split('T')[0]}.json`;
        a.click();
        URL.revokeObjectURL(url);
        
        this.showMessage('Site rules exported successfully!', 'success');
    }

    async importSiteRules(event) {
        const file = event.target.files[0];
        if (!file) return;

        try {
            const text = await file.text();
            const importData = JSON.parse(text);

            if (importData.customRules) {
                Object.entries(importData.customRules).forEach(([pattern, rules]) => {
                    this.customRules.set(pattern, rules);
                });

                await this.saveCustomRulesToStorage();
                this.renderCustomRules();
                this.showMessage('Site rules imported successfully!', 'success');
            } else {
                this.showMessage('Invalid site rules file format', 'error');
            }
        } catch (error) {
            console.error('Error importing site rules:', error);
            this.showMessage('Error importing site rules. Please check the file format.', 'error');
        }

        // Clear the file input
        event.target.value = '';
    }
}

// Initialize popup when DOM is ready
document.addEventListener('DOMContentLoaded', () => {
    new PopupManager();
});