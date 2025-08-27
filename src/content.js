"use strict";
(function () {
    'use strict';
    // Load enhanced detection system and site rules
    const enhancedScript = document.createElement('script');
    enhancedScript.src = chrome.runtime.getURL('src/detector.js');
    document.head.appendChild(enhancedScript);
    const rulesScript = document.createElement('script');
    rulesScript.src = chrome.runtime.getURL('src/rules.js');
    document.head.appendChild(rulesScript);
    const FIELD_PATTERNS = {
        firstName: [/first.*name/i, /fname/i, /first_name/i, /firstname/i, /given.*name/i, /forename/i],
        lastName: [/last.*name/i, /lname/i, /last_name/i, /lastname/i, /family.*name/i, /surname/i],
        fullName: [/full.*name/i, /name/i, /full_name/i, /fullname/i, /complete.*name/i, /contact.*name/i],
        email: [/email/i, /e.*mail/i, /mail/i, /email.*address/i, /user.*email/i],
        phone: [/phone/i, /tel/i, /telephone/i, /mobile/i, /cell/i, /phone.*number/i, /contact.*number/i],
        street: [/street/i, /address/i, /addr/i, /address.*1/i, /address.*line.*1/i, /street.*address/i],
        city: [/city/i, /town/i, /locality/i, /municipal/i],
        state: [/state/i, /province/i, /region/i, /territory/i, /county/i],
        zip: [/zip/i, /postal/i, /post.*code/i, /zipcode/i, /postal.*code/i],
        country: [/country/i, /nation/i, /citizenship/i],
        cardNumber: [/card.*number/i, /cc.*number/i, /credit.*card/i, /debit.*card/i, /card.*no/i],
        cvv: [/cvv/i, /cvc/i, /security.*code/i, /card.*code/i, /verification.*code/i],
        expiryDate: [/expiry/i, /exp.*date/i, /expiration/i, /valid.*until/i, /expires/i],
        company: [/company/i, /organization/i, /employer/i, /workplace/i, /business/i],
        jobTitle: [/job.*title/i, /position/i, /role/i, /designation/i, /occupation/i],
        website: [/website/i, /url/i, /web.*site/i, /homepage/i, /web.*page/i],
        linkedin: [/linkedin/i, /linked.*in/i, /profile.*url/i],
        password: [/password/i, /pass/i, /pwd/i]
    };
    const AUTOCOMPLETE_MAP = {
        'given-name': 'firstName',
        'family-name': 'lastName',
        'name': 'fullName',
        'email': 'email',
        'tel': 'phone',
        'street-address': 'street',
        'address-line1': 'street',
        'address-level2': 'city',
        'address-level1': 'state',
        'postal-code': 'zip',
        'country': 'country',
        'cc-number': 'cardNumber',
        'cc-csc': 'cvv',
        'cc-exp': 'expiryDate',
        'organization': 'company',
        'organization-title': 'jobTitle',
        'url': 'website'
    };
    const INPUT_TYPE_MAP = {
        'email': 'email',
        'tel': 'phone',
        'url': 'website'
    };
    class FieldDetector {
        constructor() {
            Object.defineProperty(this, "detectedFields", {
                enumerable: true,
                configurable: true,
                writable: true,
                value: new Map()
            });
            Object.defineProperty(this, "enhancedDetector", {
                enumerable: true,
                configurable: true,
                writable: true,
                value: null
            });
            Object.defineProperty(this, "siteRulesEngine", {
                enumerable: true,
                configurable: true,
                writable: true,
                value: null
            });
            this.init();
        }
        async init() {
            await this.initializeEnhancedDetection();
            this.scanForFields();
            this.setupEventListeners();
            this.setupMutationObserver();
            this.addStyles();
        }
        async initializeEnhancedDetection() {
            // Wait for enhanced detection script to load
            let attempts = 0;
            while (!window.EnhancedFieldDetector && attempts < 50) {
                await new Promise(resolve => setTimeout(resolve, 100));
                attempts++;
            }
            if (window.EnhancedFieldDetector) {
                this.enhancedDetector = new window.EnhancedFieldDetector();
                console.log('Enhanced field detection initialized');
            }
            else {
                console.warn('Enhanced field detection failed to load, using fallback');
            }
            // Wait for site rules engine to load
            attempts = 0;
            while (!window.SiteRulesEngine && attempts < 50) {
                await new Promise(resolve => setTimeout(resolve, 100));
                attempts++;
            }
            if (window.SiteRulesEngine) {
                this.siteRulesEngine = new window.SiteRulesEngine();
                console.log('Site rules engine initialized');
            }
            else {
                console.warn('Site rules engine failed to load');
            }
        }
        fuzzyMatch(text, patterns) {
            if (!text)
                return false;
            const normalizedText = text.toLowerCase().replace(/[_\-\s]/g, '');
            return patterns.some(pattern => pattern.test(text) || pattern.test(normalizedText));
        }
        getFieldType(element) {
            // Use enhanced detection if available
            if (this.enhancedDetector) {
                const detection = this.enhancedDetector.detectFieldType(element);
                if (detection && detection.type) {
                    // Store detection details for learning
                    element.dataset.detectionScore = detection.score.toString();
                    element.dataset.detectionConfidence = detection.confidence.toString();
                    element.dataset.isLearned = (detection.isLearned || false).toString();
                    console.log(`Enhanced detection: ${detection.type} (score: ${detection.score}, confidence: ${detection.confidence})`);
                    return detection.type;
                }
            }
            // Fallback to original detection logic
            return this.getFieldTypeFallback(element);
        }
        getFieldTypeFallback(element) {
            const name = element.name || '';
            const id = element.id || '';
            const placeholder = element.placeholder || '';
            const type = element.type || '';
            const autocomplete = element.autocomplete || '';
            const className = element.className || '';
            if (autocomplete && AUTOCOMPLETE_MAP[autocomplete]) {
                return AUTOCOMPLETE_MAP[autocomplete];
            }
            if (type && INPUT_TYPE_MAP[type]) {
                return INPUT_TYPE_MAP[type];
            }
            const label = this.getAssociatedLabel(element);
            const allText = [name, id, placeholder, label, className].join(' ');
            for (const [fieldType, patterns] of Object.entries(FIELD_PATTERNS)) {
                if (this.fuzzyMatch(allText, patterns)) {
                    return fieldType;
                }
            }
            return null;
        }
        getAssociatedLabel(element) {
            if (element.labels && element.labels.length > 0) {
                const label = element.labels[0];
                return label ? (label.textContent || '') : '';
            }
            if (element.id) {
                const label = document.querySelector(`label[for="${element.id}"]`);
                if (label)
                    return label.textContent || '';
            }
            const parentLabel = element.closest('label');
            if (parentLabel)
                return parentLabel.textContent || '';
            const previousLabel = element.previousElementSibling;
            if (previousLabel && previousLabel.tagName === 'LABEL') {
                return previousLabel.textContent || '';
            }
            return '';
        }
        isFormField(element) {
            if (!element.tagName)
                return false;
            const tagName = element.tagName.toLowerCase();
            if (tagName === 'input') {
                const type = (element.type || 'text').toLowerCase();
                return ['text', 'email', 'tel', 'url', 'password'].includes(type);
            }
            return tagName === 'textarea' || tagName === 'select';
        }
        scanForFields() {
            this.detectedFields.clear();
            const formElements = document.querySelectorAll('input, textarea, select');
            formElements.forEach(element => {
                if (this.isFormField(element) && !this.shouldSkipField(element)) {
                    const fieldType = this.getFieldType(element);
                    if (fieldType) {
                        this.detectedFields.set(element, fieldType);
                        this.addFieldHighlighting(element);
                        this.addFieldCorrectionMenu(element);
                    }
                }
            });
        }
        shouldSkipField(element) {
            if (!this.siteRulesEngine)
                return false;
            return this.siteRulesEngine.shouldSkipField(element);
        }
        addFieldHighlighting(element) {
            element.addEventListener('mouseenter', () => {
                element.style.transition = 'border-color 0.2s ease';
                element.style.borderColor = '#4CAF50';
                element.style.borderWidth = '2px';
                element.style.borderStyle = 'solid';
            });
            element.addEventListener('mouseleave', () => {
                element.style.borderColor = '';
                element.style.borderWidth = '';
                element.style.borderStyle = '';
            });
        }
        setupEventListeners() {
            document.addEventListener('contextmenu', (e) => {
                if (this.isFormField(e.target) && this.detectedFields.has(e.target)) {
                    chrome.runtime.sendMessage({
                        action: 'showContextMenu',
                        fieldType: this.detectedFields.get(e.target)
                    });
                }
            });
            chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
                if (message.action === 'autofill') {
                    const autofillMsg = message;
                    this.autofillFields(autofillMsg.data);
                }
                else if (message.action === 'getDetectedFields') {
                    const fieldTypes = Array.from(this.detectedFields.values());
                    sendResponse({ fieldTypes: [...new Set(fieldTypes)] });
                }
                else if (message.action === 'correctFieldType') {
                    const element = message.element;
                    const elementSelector = element ? this.generateElementSelector(element) : '';
                    if (elementSelector && message.detectedType && message.correctedType) {
                        this.handleFieldCorrection(elementSelector, message.detectedType, message.correctedType);
                    }
                }
                else if (message.action === 'getDetectionDetails') {
                    const details = this.getFieldDetectionDetails();
                    sendResponse({ details });
                }
                else if (message.action === 'retrainModel') {
                    this.retrainDetectionModel();
                }
                else if (message.action === 'getCurrentSiteRules') {
                    const rules = this.siteRulesEngine?.getApplicableRules();
                    sendResponse({ rules });
                }
            });
        }
        setupMutationObserver() {
            const observer = new MutationObserver((mutations) => {
                let shouldRescan = false;
                mutations.forEach(mutation => {
                    if (mutation.type === 'childList') {
                        mutation.addedNodes.forEach(node => {
                            if (node.nodeType === Node.ELEMENT_NODE) {
                                const element = node;
                                const hasFormFields = element.querySelectorAll('input, textarea, select').length > 0;
                                if (hasFormFields || this.isFormField(element)) {
                                    shouldRescan = true;
                                }
                            }
                        });
                    }
                });
                if (shouldRescan) {
                    setTimeout(() => this.scanForFields(), 100);
                }
            });
            observer.observe(document.body, {
                childList: true,
                subtree: true
            });
        }
        addStyles() {
            const style = document.createElement('style');
            style.textContent = `
                .pii-autofill-highlighted {
                    box-shadow: 0 0 0 2px #4CAF50 !important;
                    transition: box-shadow 0.2s ease !important;
                }
                
                .pii-autofill-filling {
                    background-color: #E8F5E8 !important;
                    transition: background-color 0.3s ease !important;
                }
            `;
            document.head.appendChild(style);
        }
        async autofillFields(userData) {
            const fieldsToFill = [];
            // Check site rules for custom handlers and security restrictions
            let siteRules = null;
            if (this.siteRulesEngine) {
                siteRules = this.siteRulesEngine.getApplicableRules();
                // Execute beforeFill handler if exists
                if (siteRules?.rules?.customHandlers?.beforeFill) {
                    const canProceed = await this.siteRulesEngine.executeCustomHandler?.(siteRules.rules.customHandlers.beforeFill, { userData, fields: this.detectedFields });
                    if (!canProceed) {
                        console.log('Site rules prevented autofill');
                        return;
                    }
                }
                // Apply security restrictions (banking sites)
                if (siteRules?.security?.maxFields) {
                    console.log('Applying security restrictions:', siteRules.security);
                }
            }
            this.detectedFields.forEach((fieldType, element) => {
                if (userData[fieldType] && element.offsetParent !== null) {
                    // Check security restrictions
                    if (siteRules?.security?.allowedFields &&
                        !siteRules.security.allowedFields.includes(fieldType)) {
                        console.log('Skipping restricted field:', fieldType);
                        return;
                    }
                    fieldsToFill.push({
                        element,
                        value: userData[fieldType],
                        fieldType
                    });
                }
            });
            // Apply maxFields restriction
            if (siteRules?.security?.maxFields && fieldsToFill.length > siteRules.security.maxFields) {
                fieldsToFill.splice(siteRules.security.maxFields);
                console.log('Limited to', siteRules.security.maxFields, 'fields for security');
            }
            // Get site-specific delays
            const delays = siteRules?.delays || {};
            const betweenFieldsDelay = delays.betweenFields || 100;
            const beforeFillDelay = delays.beforeFill || 0;
            // Apply beforeFill delay if specified
            setTimeout(() => {
                fieldsToFill.forEach(({ element, value }, index) => {
                    setTimeout(() => {
                        element.classList.add('pii-autofill-filling');
                        element.focus();
                        if (element.tagName.toLowerCase() === 'select') {
                            const selectEl = element;
                            const option = Array.from(selectEl.options).find(opt => opt.value.toLowerCase().includes(value.toLowerCase()) ||
                                opt.textContent?.toLowerCase().includes(value.toLowerCase()));
                            if (option) {
                                selectEl.value = option.value;
                                selectEl.dispatchEvent(new Event('change', { bubbles: true }));
                            }
                        }
                        else {
                            element.value = value;
                            ['input', 'change', 'blur'].forEach(eventType => {
                                element.dispatchEvent(new Event(eventType, { bubbles: true }));
                            });
                        }
                        setTimeout(() => {
                            element.classList.remove('pii-autofill-filling');
                        }, 500);
                    }, index * betweenFieldsDelay);
                });
                if (fieldsToFill.length > 0) {
                    chrome.runtime.sendMessage({
                        action: 'autofillComplete',
                        fieldsCount: fieldsToFill.length
                    });
                }
            }, beforeFillDelay);
        }
        getFieldsOnPage() {
            const fieldsMap = {};
            this.detectedFields.forEach((fieldType, element) => {
                if (!fieldsMap[fieldType])
                    fieldsMap[fieldType] = [];
                fieldsMap[fieldType].push({
                    element: element,
                    name: element.name || element.id || 'unnamed',
                    placeholder: element.placeholder || '',
                    visible: element.offsetParent !== null
                });
            });
            return fieldsMap;
        }
        async handleFieldCorrection(elementSelector, detectedType, correctedType) {
            if (!this.enhancedDetector)
                return;
            const element = document.querySelector(elementSelector);
            if (element) {
                await this.enhancedDetector.recordUserCorrection(element, detectedType, correctedType);
                // Update the field mapping
                this.detectedFields.set(element, correctedType);
                console.log(`Field correction recorded: ${detectedType} -> ${correctedType}`);
                // Trigger retrain after collecting corrections
                setTimeout(() => this.retrainDetectionModel(), 1000);
            }
        }
        getFieldDetectionDetails() {
            if (!this.enhancedDetector)
                return {};
            const details = {};
            this.detectedFields.forEach((fieldType, element) => {
                const elementDetails = this.enhancedDetector.getDetectionDetails(element);
                const selector = this.generateElementSelector(element);
                details[selector] = {
                    fieldType,
                    score: element.dataset.detectionScore || 'unknown',
                    confidence: element.dataset.detectionConfidence || 'unknown',
                    isLearned: element.dataset.isLearned === 'true',
                    element: {
                        name: element.name,
                        id: element.id,
                        placeholder: element.placeholder,
                        type: element.type
                    },
                    detectionDetails: elementDetails
                };
            });
            return details;
        }
        generateElementSelector(element) {
            if (element.id)
                return `#${element.id}`;
            if (element.name)
                return `input[name="${element.name}"]`;
            // Generate a more specific selector
            let selector = element.tagName.toLowerCase();
            if (element.className) {
                selector += `.${element.className.split(' ')[0]}`;
            }
            // Add position if needed
            const parent = element.parentElement;
            if (parent) {
                const siblings = Array.from(parent.children).filter(child => child.tagName === element.tagName &&
                    child.className === element.className);
                if (siblings.length > 1) {
                    const index = siblings.indexOf(element) + 1;
                    selector += `:nth-child(${index})`;
                }
            }
            return selector;
        }
        async retrainDetectionModel() {
            if (this.enhancedDetector && this.enhancedDetector.retrainModel) {
                await this.enhancedDetector.retrainModel();
                console.log('Detection model retrained based on user corrections');
                // Rescan fields with updated model
                setTimeout(() => this.scanForFields(), 500);
            }
        }
        // Add context menu for field correction
        addFieldCorrectionMenu(element) {
            element.addEventListener('contextmenu', (e) => {
                const mouseEvent = e;
                if (mouseEvent.ctrlKey && this.detectedFields.has(element)) {
                    e.preventDefault();
                    this.showFieldCorrectionDialog(element);
                }
            });
        }
        showFieldCorrectionDialog(element) {
            const detectedType = this.detectedFields.get(element);
            const fieldTypes = [
                'firstName', 'lastName', 'fullName', 'email', 'phone',
                'street', 'city', 'state', 'zip', 'country',
                'cardNumber', 'cvv', 'expiryDate',
                'company', 'jobTitle', 'website', 'linkedin'
            ];
            // Create a simple correction interface
            const dialog = document.createElement('div');
            dialog.style.cssText = `
                position: fixed;
                top: 50%;
                left: 50%;
                transform: translate(-50%, -50%);
                background: white;
                border: 2px solid #667eea;
                border-radius: 8px;
                padding: 20px;
                z-index: 10000;
                box-shadow: 0 4px 20px rgba(0,0,0,0.3);
                font-family: Arial, sans-serif;
            `;
            dialog.innerHTML = `
                <h3>Correct Field Detection</h3>
                <p>Detected as: <strong>${detectedType}</strong></p>
                <p>Correct type:</p>
                <select id="correctionSelect" style="width: 100%; padding: 5px; margin: 10px 0;">
                    ${fieldTypes.map(type => `<option value="${type}" ${type === detectedType ? 'selected' : ''}>${type}</option>`).join('')}
                </select>
                <div style="text-align: right; margin-top: 15px;">
                    <button id="cancelCorrection" style="margin-right: 10px; padding: 5px 15px;">Cancel</button>
                    <button id="confirmCorrection" style="padding: 5px 15px; background: #667eea; color: white; border: none; border-radius: 4px;">Confirm</button>
                </div>
            `;
            document.body.appendChild(dialog);
            dialog.querySelector('#cancelCorrection').addEventListener('click', () => {
                document.body.removeChild(dialog);
            });
            dialog.querySelector('#confirmCorrection').addEventListener('click', () => {
                const correctedType = dialog.querySelector('#correctionSelect').value;
                const selector = this.generateElementSelector(element);
                this.handleFieldCorrection(selector, detectedType, correctedType);
                document.body.removeChild(dialog);
            });
        }
    }
    if (document.readyState === 'loading') {
        document.addEventListener('DOMContentLoaded', () => {
            window.piiAutofillDetector = new FieldDetector();
        });
    }
    else {
        window.piiAutofillDetector = new FieldDetector();
    }
})();
export {};
//# sourceMappingURL=content.js.map