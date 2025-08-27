"use strict";

import { 
    FieldTypeName, 
    FieldType, 
    DetectedField, 
    FormContext,
    MessageRequest,
    AutofillMessage,
    DetectionMessage,
    FieldPattern
} from '../types/extension';

(function() {
    'use strict';

    // Load enhanced detection system and site rules
    const enhancedScript = document.createElement('script');
    enhancedScript.src = chrome.runtime.getURL('src/detector.js');
    document.head.appendChild(enhancedScript);

    const rulesScript = document.createElement('script');
    rulesScript.src = chrome.runtime.getURL('src/rules.js');
    document.head.appendChild(rulesScript);

    const FIELD_PATTERNS: Record<FieldTypeName, RegExp[]> = {
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

    const AUTOCOMPLETE_MAP: Record<string, FieldTypeName> = {
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

    const INPUT_TYPE_MAP: Record<string, FieldTypeName> = {
        'email': 'email',
        'tel': 'phone',
        'url': 'website'
    };

    interface EnhancedDetector {
        detectFieldType(element: HTMLInputElement | HTMLSelectElement | HTMLTextAreaElement): { type: FieldTypeName; score: number; confidence: number; isLearned?: boolean } | null;
        recordUserCorrection(element: HTMLInputElement | HTMLSelectElement | HTMLTextAreaElement, detectedType: FieldTypeName, correctedType: FieldTypeName): Promise<void>;
        getDetectionDetails(element: HTMLInputElement | HTMLSelectElement | HTMLTextAreaElement): any;
        retrainModel?(): Promise<void>;
    }

    interface SiteRulesEngine {
        shouldSkipField(element: HTMLInputElement | HTMLSelectElement | HTMLTextAreaElement): boolean;
        getApplicableRules(): { rules?: any; security?: any; delays?: any } | null;
        executeCustomHandler?(handler: string, context: any): Promise<boolean>;
    }

    class FieldDetector {
        private detectedFields = new Map<HTMLInputElement | HTMLSelectElement | HTMLTextAreaElement, FieldTypeName>();
        private enhancedDetector: EnhancedDetector | null = null;
        private siteRulesEngine: SiteRulesEngine | null = null;

        constructor() {
            this.init();
        }

        private async init(): Promise<void> {
            await this.initializeEnhancedDetection();
            this.scanForFields();
            this.setupEventListeners();
            this.setupMutationObserver();
            this.addStyles();
        }

        private async initializeEnhancedDetection(): Promise<void> {
            // Wait for enhanced detection script to load
            let attempts = 0;
            while (!(window as any).EnhancedFieldDetector && attempts < 50) {
                await new Promise(resolve => setTimeout(resolve, 100));
                attempts++;
            }

            if ((window as any).EnhancedFieldDetector) {
                this.enhancedDetector = new (window as any).EnhancedFieldDetector();
                console.log('Enhanced field detection initialized');
            } else {
                console.warn('Enhanced field detection failed to load, using fallback');
            }

            // Wait for site rules engine to load
            attempts = 0;
            while (!(window as any).SiteRulesEngine && attempts < 50) {
                await new Promise(resolve => setTimeout(resolve, 100));
                attempts++;
            }

            if ((window as any).SiteRulesEngine) {
                this.siteRulesEngine = new (window as any).SiteRulesEngine();
                console.log('Site rules engine initialized');
            } else {
                console.warn('Site rules engine failed to load');
            }
        }

        private fuzzyMatch(text: string, patterns: RegExp[]): boolean {
            if (!text) return false;
            
            const normalizedText = text.toLowerCase().replace(/[_\-\s]/g, '');
            return patterns.some(pattern => 
                pattern.test(text) || pattern.test(normalizedText)
            );
        }

        private getFieldType(element: HTMLInputElement | HTMLSelectElement | HTMLTextAreaElement): FieldTypeName | null {
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

        private getFieldTypeFallback(element: HTMLInputElement | HTMLSelectElement | HTMLTextAreaElement): FieldTypeName | null {
            const name = (element as HTMLInputElement).name || '';
            const id = element.id || '';
            const placeholder = (element as HTMLInputElement).placeholder || '';
            const type = (element as HTMLInputElement).type || '';
            const autocomplete = (element as HTMLInputElement).autocomplete || '';
            const className = element.className || '';

            if (autocomplete && AUTOCOMPLETE_MAP[autocomplete]) {
                return AUTOCOMPLETE_MAP[autocomplete];
            }

            if (type && INPUT_TYPE_MAP[type]) {
                return INPUT_TYPE_MAP[type];
            }

            const label = this.getAssociatedLabel(element);
            const allText = [name, id, placeholder, label, className].join(' ');

            for (const [fieldType, patterns] of Object.entries(FIELD_PATTERNS) as [FieldTypeName, RegExp[]][]) {
                if (this.fuzzyMatch(allText, patterns)) {
                    return fieldType;
                }
            }

            return null;
        }

        private getAssociatedLabel(element: HTMLInputElement | HTMLSelectElement | HTMLTextAreaElement): string {
            if ((element as HTMLInputElement).labels && (element as HTMLInputElement).labels!.length > 0) {
                return (element as HTMLInputElement).labels![0].textContent || '';
            }

            if (element.id) {
                const label = document.querySelector(`label[for="${element.id}"]`);
                if (label) return label.textContent || '';
            }

            const parentLabel = element.closest('label');
            if (parentLabel) return parentLabel.textContent || '';

            const previousLabel = element.previousElementSibling as HTMLLabelElement;
            if (previousLabel && previousLabel.tagName === 'LABEL') {
                return previousLabel.textContent || '';
            }

            return '';
        }

        private isFormField(element: Element): element is HTMLInputElement | HTMLSelectElement | HTMLTextAreaElement {
            if (!element.tagName) return false;
            
            const tagName = element.tagName.toLowerCase();
            if (tagName === 'input') {
                const type = ((element as HTMLInputElement).type || 'text').toLowerCase();
                return ['text', 'email', 'tel', 'url', 'password'].includes(type);
            }
            
            return tagName === 'textarea' || tagName === 'select';
        }

        private scanForFields(): void {
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

        private shouldSkipField(element: HTMLInputElement | HTMLSelectElement | HTMLTextAreaElement): boolean {
            if (!this.siteRulesEngine) return false;
            return this.siteRulesEngine.shouldSkipField(element);
        }

        private addFieldHighlighting(element: HTMLInputElement | HTMLSelectElement | HTMLTextAreaElement): void {
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

        private setupEventListeners(): void {
            document.addEventListener('contextmenu', (e) => {
                if (this.isFormField(e.target as Element) && this.detectedFields.has(e.target as any)) {
                    chrome.runtime.sendMessage({
                        action: 'showContextMenu',
                        fieldType: this.detectedFields.get(e.target as any)
                    });
                }
            });

            chrome.runtime.onMessage.addListener((message: MessageRequest, sender, sendResponse) => {
                if (message.action === 'autofill') {
                    const autofillMsg = message as AutofillMessage;
                    this.autofillFields(autofillMsg.data);
                } else if (message.action === 'getDetectedFields') {
                    const fieldTypes = Array.from(this.detectedFields.values());
                    sendResponse({ fieldTypes: [...new Set(fieldTypes)] });
                } else if (message.action === 'correctFieldType') {
                    this.handleFieldCorrection(message.element, message.detectedType, message.correctedType);
                } else if (message.action === 'getDetectionDetails') {
                    const details = this.getFieldDetectionDetails();
                    sendResponse({ details });
                } else if (message.action === 'retrainModel') {
                    this.retrainDetectionModel();
                } else if (message.action === 'getCurrentSiteRules') {
                    const rules = this.siteRulesEngine?.getApplicableRules();
                    sendResponse({ rules });
                }
            });
        }

        private setupMutationObserver(): void {
            const observer = new MutationObserver((mutations) => {
                let shouldRescan = false;
                
                mutations.forEach(mutation => {
                    if (mutation.type === 'childList') {
                        mutation.addedNodes.forEach(node => {
                            if (node.nodeType === Node.ELEMENT_NODE) {
                                const element = node as Element;
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

        private addStyles(): void {
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

        private async autofillFields(userData: Partial<FieldType>): Promise<void> {
            const fieldsToFill: Array<{ element: HTMLInputElement | HTMLSelectElement | HTMLTextAreaElement; value: string; fieldType: FieldTypeName }> = [];

            // Check site rules for custom handlers and security restrictions
            let siteRules: any = null;
            if (this.siteRulesEngine) {
                siteRules = this.siteRulesEngine.getApplicableRules();
                
                // Execute beforeFill handler if exists
                if (siteRules?.rules?.customHandlers?.beforeFill) {
                    const canProceed = await this.siteRulesEngine.executeCustomHandler?.(
                        siteRules.rules.customHandlers.beforeFill,
                        { userData, fields: this.detectedFields }
                    );
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
                        value: userData[fieldType] as string, 
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
                            const selectEl = element as HTMLSelectElement;
                            const option = Array.from(selectEl.options).find(opt => 
                                opt.value.toLowerCase().includes(value.toLowerCase()) ||
                                opt.textContent?.toLowerCase().includes(value.toLowerCase())
                            );
                            if (option) {
                                selectEl.value = option.value;
                                selectEl.dispatchEvent(new Event('change', { bubbles: true }));
                            }
                        } else {
                            (element as HTMLInputElement | HTMLTextAreaElement).value = value;
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

        private getFieldsOnPage(): Record<FieldTypeName, Array<{ element: HTMLInputElement | HTMLSelectElement | HTMLTextAreaElement; name: string; placeholder: string; visible: boolean }>> {
            const fieldsMap: Record<string, Array<{ element: HTMLInputElement | HTMLSelectElement | HTMLTextAreaElement; name: string; placeholder: string; visible: boolean }>> = {};

            this.detectedFields.forEach((fieldType, element) => {
                if (!fieldsMap[fieldType]) fieldsMap[fieldType] = [];
                
                fieldsMap[fieldType].push({
                    element: element,
                    name: (element as HTMLInputElement).name || element.id || 'unnamed',
                    placeholder: (element as HTMLInputElement).placeholder || '',
                    visible: element.offsetParent !== null
                });
            });

            return fieldsMap;
        }

        private async handleFieldCorrection(elementSelector: string, detectedType: FieldTypeName, correctedType: FieldTypeName): Promise<void> {
            if (!this.enhancedDetector) return;

            const element = document.querySelector(elementSelector) as HTMLInputElement | HTMLSelectElement | HTMLTextAreaElement;
            if (element) {
                await this.enhancedDetector.recordUserCorrection(element, detectedType, correctedType);
                
                // Update the field mapping
                this.detectedFields.set(element, correctedType);
                console.log(`Field correction recorded: ${detectedType} -> ${correctedType}`);
                
                // Trigger retrain after collecting corrections
                setTimeout(() => this.retrainDetectionModel(), 1000);
            }
        }

        private getFieldDetectionDetails(): Record<string, any> {
            if (!this.enhancedDetector) return {};

            const details: Record<string, any> = {};
            this.detectedFields.forEach((fieldType, element) => {
                const elementDetails = this.enhancedDetector!.getDetectionDetails(element);
                const selector = this.generateElementSelector(element);
                
                details[selector] = {
                    fieldType,
                    score: element.dataset.detectionScore || 'unknown',
                    confidence: element.dataset.detectionConfidence || 'unknown',
                    isLearned: element.dataset.isLearned === 'true',
                    element: {
                        name: (element as HTMLInputElement).name,
                        id: element.id,
                        placeholder: (element as HTMLInputElement).placeholder,
                        type: (element as HTMLInputElement).type
                    },
                    detectionDetails: elementDetails
                };
            });

            return details;
        }

        private generateElementSelector(element: HTMLInputElement | HTMLSelectElement | HTMLTextAreaElement): string {
            if (element.id) return `#${element.id}`;
            if ((element as HTMLInputElement).name) return `input[name="${(element as HTMLInputElement).name}"]`;

            // Generate a more specific selector
            let selector = element.tagName.toLowerCase();
            if (element.className) {
                selector += `.${element.className.split(' ')[0]}`;
            }

            // Add position if needed
            const parent = element.parentElement;
            if (parent) {
                const siblings = Array.from(parent.children).filter(child => 
                    child.tagName === element.tagName &&
                    child.className === element.className
                );
                if (siblings.length > 1) {
                    const index = siblings.indexOf(element) + 1;
                    selector += `:nth-child(${index})`;
                }
            }

            return selector;
        }

        private async retrainDetectionModel(): Promise<void> {
            if (this.enhancedDetector && this.enhancedDetector.retrainModel) {
                await this.enhancedDetector.retrainModel();
                console.log('Detection model retrained based on user corrections');
                
                // Rescan fields with updated model
                setTimeout(() => this.scanForFields(), 500);
            }
        }

        // Add context menu for field correction
        private addFieldCorrectionMenu(element: HTMLInputElement | HTMLSelectElement | HTMLTextAreaElement): void {
            element.addEventListener('contextmenu', (e) => {
                if (e.ctrlKey && this.detectedFields.has(element)) {
                    e.preventDefault();
                    this.showFieldCorrectionDialog(element);
                }
            });
        }

        private showFieldCorrectionDialog(element: HTMLInputElement | HTMLSelectElement | HTMLTextAreaElement): void {
            const detectedType = this.detectedFields.get(element);
            const fieldTypes: FieldTypeName[] = [
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

            dialog.querySelector('#cancelCorrection')!.addEventListener('click', () => {
                document.body.removeChild(dialog);
            });

            dialog.querySelector('#confirmCorrection')!.addEventListener('click', () => {
                const correctedType = (dialog.querySelector('#correctionSelect') as HTMLSelectElement).value as FieldTypeName;
                const selector = this.generateElementSelector(element);
                this.handleFieldCorrection(selector, detectedType!, correctedType);
                document.body.removeChild(dialog);
            });
        }
    }

    if (document.readyState === 'loading') {
        document.addEventListener('DOMContentLoaded', () => {
            (window as any).piiAutofillDetector = new FieldDetector();
        });
    } else {
        (window as any).piiAutofillDetector = new FieldDetector();
    }
})();