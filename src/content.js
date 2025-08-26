(function() {
    'use strict';

    const FIELD_PATTERNS = {
        firstName: ['first.*name', 'fname', 'first_name', 'firstname', 'given.*name', 'forename'],
        lastName: ['last.*name', 'lname', 'last_name', 'lastname', 'family.*name', 'surname'],
        fullName: ['full.*name', 'name', 'full_name', 'fullname', 'complete.*name', 'contact.*name'],
        email: ['email', 'e.*mail', 'mail', 'email.*address', 'user.*email'],
        phone: ['phone', 'tel', 'telephone', 'mobile', 'cell', 'phone.*number', 'contact.*number'],
        
        street: ['street', 'address', 'addr', 'address.*1', 'address.*line.*1', 'street.*address'],
        city: ['city', 'town', 'locality', 'municipal'],
        state: ['state', 'province', 'region', 'territory', 'county'],
        zip: ['zip', 'postal', 'post.*code', 'zipcode', 'postal.*code'],
        country: ['country', 'nation', 'citizenship'],
        
        cardNumber: ['card.*number', 'cc.*number', 'credit.*card', 'debit.*card', 'card.*no'],
        cvv: ['cvv', 'cvc', 'security.*code', 'card.*code', 'verification.*code'],
        expiryDate: ['expiry', 'exp.*date', 'expiration', 'valid.*until', 'expires'],
        
        company: ['company', 'organization', 'employer', 'workplace', 'business'],
        jobTitle: ['job.*title', 'position', 'role', 'designation', 'occupation'],
        website: ['website', 'url', 'web.*site', 'homepage', 'web.*page'],
        linkedin: ['linkedin', 'linked.*in', 'profile.*url']
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
            this.detectedFields = new Map();
            this.init();
        }

        init() {
            this.scanForFields();
            this.setupEventListeners();
            this.setupMutationObserver();
            this.addStyles();
        }

        fuzzyMatch(text, patterns) {
            if (!text) return false;
            const normalizedText = text.toLowerCase().replace(/[_\-\s]/g, '');
            
            return patterns.some(pattern => {
                const regex = new RegExp(pattern, 'i');
                return regex.test(text) || regex.test(normalizedText);
            });
        }

        getFieldType(element) {
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
                return element.labels[0].textContent;
            }
            
            if (element.id) {
                const label = document.querySelector(`label[for="${element.id}"]`);
                if (label) return label.textContent;
            }
            
            const parentLabel = element.closest('label');
            if (parentLabel) return parentLabel.textContent;
            
            const previousLabel = element.previousElementSibling;
            if (previousLabel && previousLabel.tagName === 'LABEL') {
                return previousLabel.textContent;
            }
            
            return '';
        }

        isFormField(element) {
            if (!element.tagName) return false;
            
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
                if (this.isFormField(element)) {
                    const fieldType = this.getFieldType(element);
                    if (fieldType) {
                        this.detectedFields.set(element, fieldType);
                        this.addFieldHighlighting(element);
                    }
                }
            });
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
                    this.autofillFields(message.data);
                } else if (message.action === 'getDetectedFields') {
                    const fieldTypes = Array.from(this.detectedFields.values());
                    sendResponse({ fieldTypes: [...new Set(fieldTypes)] });
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
                                const hasFormFields = node.querySelectorAll('input, textarea, select').length > 0;
                                if (hasFormFields || this.isFormField(node)) {
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

        autofillFields(userData) {
            const fieldsToFill = [];
            
            this.detectedFields.forEach((fieldType, element) => {
                if (userData[fieldType] && element.offsetParent !== null) {
                    fieldsToFill.push({ element, value: userData[fieldType] });
                }
            });
            
            fieldsToFill.forEach(({ element, value }, index) => {
                setTimeout(() => {
                    element.classList.add('pii-autofill-filling');
                    
                    element.focus();
                    element.value = value;
                    
                    ['input', 'change', 'blur'].forEach(eventType => {
                        element.dispatchEvent(new Event(eventType, { bubbles: true }));
                    });
                    
                    if (element.tagName.toLowerCase() === 'select') {
                        const option = Array.from(element.options).find(opt => 
                            opt.value.toLowerCase().includes(value.toLowerCase()) ||
                            opt.textContent.toLowerCase().includes(value.toLowerCase())
                        );
                        if (option) {
                            element.value = option.value;
                            element.dispatchEvent(new Event('change', { bubbles: true }));
                        }
                    }
                    
                    setTimeout(() => {
                        element.classList.remove('pii-autofill-filling');
                    }, 500);
                    
                }, index * 100);
            });
            
            if (fieldsToFill.length > 0) {
                chrome.runtime.sendMessage({
                    action: 'autofillComplete',
                    fieldsCount: fieldsToFill.length
                });
            }
        }

        getFieldsOnPage() {
            const fieldsMap = {};
            this.detectedFields.forEach((fieldType, element) => {
                if (!fieldsMap[fieldType]) fieldsMap[fieldType] = [];
                fieldsMap[fieldType].push({
                    element: element,
                    name: element.name || element.id || 'unnamed',
                    placeholder: element.placeholder || '',
                    visible: element.offsetParent !== null
                });
            });
            return fieldsMap;
        }
    }

    if (document.readyState === 'loading') {
        document.addEventListener('DOMContentLoaded', () => {
            window.piiAutofillDetector = new FieldDetector();
        });
    } else {
        window.piiAutofillDetector = new FieldDetector();
    }

})();