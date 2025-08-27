// Simple field detection content script

import { FieldTypeName } from '../types/extension';

const FIELD_PATTERNS: Record<FieldTypeName, RegExp[]> = {
    firstName: [/first.*name/i, /fname/i, /first_name/i, /firstname/i, /given.*name/i, /forename/i],
    lastName: [/last.*name/i, /lname/i, /last_name/i, /lastname/i, /family.*name/i, /surname/i],
    email: [/email/i, /e.*mail/i, /mail/i, /email.*address/i, /user.*email/i],
    phone: [/phone/i, /tel/i, /telephone/i, /mobile/i, /cell/i, /phone.*number/i, /contact.*number/i],
    location: [/location/i, /\bcity\b/i, /residence/i, /current.*city/i, /home.*city/i, /based.*in/i, /work.*location/i, /office.*location/i],
    country: [/country/i, /nation/i, /nationality/i, /country.*residence/i, /home.*country/i, /citizenship/i],
    company: [/company/i, /organization/i, /employer/i, /workplace/i, /business/i, /current.*company/i],
    jobTitle: [/job.*title/i, /position/i, /role/i, /designation/i, /occupation/i, /current.*title/i, /title/i],
    linkedin: [/linkedin/i, /linked.*in/i, /profile.*url/i, /linkedin.*profile/i],
    github: [/github/i, /git.*hub/i, /github.*profile/i, /github.*url/i, /repository/i, /git.*profile/i],
    xProfile: [/twitter/i, /x\.com/i, /x.*profile/i, /twitter.*profile/i, /x.*handle/i, /twitter.*handle/i],
    googleScholar: [/google.*scholar/i, /scholar/i, /scholar.*profile/i, /academic.*profile/i, /research.*profile/i],
    exceptionalWork: [/exceptional.*work/i, /exceptional/i, /work.*done/i, /accomplishments/i, /achievements/i, /notable.*work/i, /proud.*of/i, /piece.*work/i],
    visaSponsorship: [/visa/i, /sponsorship/i, /work.*authorization/i, /employment.*visa/i, /h.*1.*b/i, /visa.*status/i, /require.*sponsorship/i, /work.*legally/i, /authorization.*work/i],
    interviewingProcesses: [/interviewing.*process/i, /other.*interview/i, /active.*interview/i, /interview.*elsewhere/i, /other.*opportunities/i, /interviewing.*elsewhere/i, /interview.*process/i],
    gender: [/gender/i, /sex/i, /gender.*identity/i, /male.*female/i],
    veteranStatus: [/veteran/i, /military/i, /veteran.*status/i, /armed.*forces/i, /military.*service/i, /protected.*veteran/i],
    hispanicLatino: [/hispanic/i, /latino/i, /hispanic.*latino/i, /ethnicity/i, /hispanic.*origin/i],
    race: [/race/i, /racial/i, /ethnicity/i, /ethnic.*background/i, /racial.*identity/i, /identify.*race/i],
    disabilityStatus: [/disability/i, /disabled/i, /disability.*status/i, /accommodation/i, /ada/i, /impairment/i]
};

const AUTOCOMPLETE_MAP: Record<string, FieldTypeName> = {
    'given-name': 'firstName',
    'family-name': 'lastName',
    'email': 'email',
    'tel': 'phone',
    'organization': 'company',
    'organization-title': 'jobTitle',
    'url': 'linkedin'
};

const INPUT_TYPE_MAP: Record<string, FieldTypeName> = {
    'email': 'email',
    'tel': 'phone',
    'url': 'linkedin'
};

class FieldDetector {
    private detectedFields: Map<HTMLElement, FieldTypeName>;

    constructor() {
        this.detectedFields = new Map();
        this.init();
    }

    private init(): void {
        this.scanForFields();
        this.setupEventListeners();
        this.setupMutationObserver();
        this.addStyles();
    }

    private fuzzyMatch(text: string, patterns: RegExp[]): boolean {
        if (!text) return false;
        const normalizedText = text.toLowerCase().replace(/[_\-\s]/g, '');
        return patterns.some(pattern => pattern.test(text) || pattern.test(normalizedText));
    }

    private getFieldType(element: HTMLInputElement | HTMLTextAreaElement | HTMLSelectElement): FieldTypeName | null {
        const name = element.getAttribute('name') || '';
        const id = element.id || '';
        const placeholder = (element as HTMLInputElement).placeholder || '';
        const type = (element as HTMLInputElement).type || '';
        const autocomplete = element.getAttribute('autocomplete') || '';
        const className = element.className || '';


        // Check autocomplete first
        if (autocomplete && AUTOCOMPLETE_MAP[autocomplete]) {
            return AUTOCOMPLETE_MAP[autocomplete];
        }

        // Check input type
        if (type && INPUT_TYPE_MAP[type]) {
            return INPUT_TYPE_MAP[type];
        }

        const label = this.getAssociatedLabel(element);
        const allText = [name, id, placeholder, label, className].join(' ');

        // Check all patterns
        for (const fieldType of Object.keys(FIELD_PATTERNS) as FieldTypeName[]) {
            const patterns = FIELD_PATTERNS[fieldType];
            if (this.fuzzyMatch(allText, patterns)) {
                return fieldType;
            }
        }

        return null;
    }

    private getAssociatedLabel(element: HTMLElement): string {
        const inputElement = element as HTMLInputElement;
        
        if (inputElement.labels && inputElement.labels.length > 0) {
            const label = inputElement.labels[0];
            return label ? (label.textContent || '') : '';
        }

        if (element.id) {
            const label = document.querySelector(`label[for="${element.id}"]`);
            if (label) return label.textContent || '';
        }

        const parentLabel = element.closest('label');
        if (parentLabel) return parentLabel.textContent || '';

        const previousLabel = element.previousElementSibling;
        if (previousLabel && previousLabel.tagName === 'LABEL') {
            return previousLabel.textContent || '';
        }

        return '';
    }

    private isFormField(element: HTMLElement): boolean {
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
            const htmlElement = element as HTMLElement;
            if (this.isFormField(htmlElement)) {
                const fieldType = this.getFieldType(htmlElement as HTMLInputElement | HTMLTextAreaElement | HTMLSelectElement);
                if (fieldType) {
                    this.detectedFields.set(htmlElement, fieldType);
                    this.addFieldHighlighting(htmlElement);
                }
            }
        });
    }

    private addFieldHighlighting(element: HTMLElement): void {
        element.addEventListener('mouseenter', () => {
            (element as any).style.transition = 'border-color 0.2s ease';
            (element as any).style.borderColor = '#4CAF50';
            (element as any).style.borderWidth = '2px';
            (element as any).style.borderStyle = 'solid';
        });

        element.addEventListener('mouseleave', () => {
            (element as any).style.borderColor = '';
            (element as any).style.borderWidth = '';
            (element as any).style.borderStyle = '';
        });
    }

    private setupEventListeners(): void {
        chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {

            if (message.action === 'autofill') {
                this.autofillFields(message.data).then(() => {
                    const safeResponse = JSON.parse(JSON.stringify({ success: true }));
                    sendResponse(safeResponse);
                }).catch(error => {
                    const safeResponse = JSON.parse(JSON.stringify({ 
                        success: false, 
                        error: String(error?.message || 'Unknown error')
                    }));
                    sendResponse(safeResponse);
                });
                return true; // Keep message channel open for async response
            } else if (message.action === 'getDetectedFields') {
                const fieldTypes = Array.from(this.detectedFields.values()).filter(type => type != null && type !== undefined);
                const uniqueFieldTypes = [...new Set(fieldTypes)].filter(type => type != null);
                
                const safeResponse = JSON.parse(JSON.stringify({ 
                    success: true,
                    fieldTypes: uniqueFieldTypes,
                    count: Number(this.detectedFields.size) || 0
                }));
                
                sendResponse(safeResponse);
            }
            
            return true; // Keep message channel open for async responses
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
                            if (hasFormFields || this.isFormField(element as HTMLElement)) {
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
            .pii-autofill-filling {
                background-color: #E8F5E8 !important;
                transition: background-color 0.3s ease !important;
            }
        `;
        document.head.appendChild(style);
    }

    private async autofillFields(userData: Record<string, any>): Promise<void> {
        const fieldsToFill: Array<{ element: HTMLElement; value: string; fieldType: FieldTypeName }> = [];

        this.detectedFields.forEach((fieldType, element) => {
            if (userData[fieldType] && (element as any).offsetParent !== null) {
                fieldsToFill.push({
                    element,
                    value: userData[fieldType],
                    fieldType
                });
            }
        });

        fieldsToFill.forEach(({ element, value, fieldType }, index) => {
            setTimeout(() => {
                
                element.classList.add('pii-autofill-filling');
                (element as HTMLInputElement).focus();

                if (element.tagName.toLowerCase() === 'select') {
                    const selectEl = element as HTMLSelectElement;
                    
                    // First try exact value match (for our test data and saved profiles)
                    let option = Array.from(selectEl.options).find(opt => 
                        opt.value === value || opt.textContent === value
                    );
                    
                    // If no exact match, try smart matching based on field type
                    if (!option) {
                        option = Array.from(selectEl.options).find(opt => {
                            const optText = (opt.textContent || opt.value).toLowerCase();
                            const optValue = opt.value.toLowerCase();
                            const targetValue = value.toLowerCase();
                            
                            // Handle yes/no questions (visa, interview processes)
                            if ((fieldType === 'visaSponsorship' || fieldType === 'interviewingProcesses') && 
                                (targetValue === 'yes' || targetValue === 'no')) {
                                return optText === targetValue || optValue === targetValue;
                            }
                            
                            // Handle gender
                            if (fieldType === 'gender') {
                                if (targetValue === 'male' && optText === 'male') return true;
                                if (targetValue === 'female' && optText === 'female') return true;
                                if (targetValue === 'decline' && optText.includes('decline')) return true;
                                return false;
                            }
                            
                            // Handle Hispanic/Latino
                            if (fieldType === 'hispanicLatino') {
                                if (targetValue === 'yes' && optText === 'yes') return true;
                                if (targetValue === 'no' && optText === 'no') return true;
                                if (targetValue === 'decline' && optText.includes('decline')) return true;
                                return false;
                            }
                            
                            // Handle race - try to match common variations
                            if (fieldType === 'race') {
                                if (targetValue === 'white' && optText === 'white') return true;
                                if (targetValue === 'asian' && optText === 'asian') return true;
                                if (targetValue === 'black' && optText.includes('black')) return true;
                                if (targetValue === 'hispanic' && optText.includes('hispanic')) return true;
                                if (targetValue === 'decline' && optText.includes('decline')) return true;
                                return false;
                            }
                            
                            // Handle veteran status
                            if (fieldType === 'veteranStatus') {
                                if ((targetValue === 'no' || targetValue === 'not') && optText.includes('not a protected')) return true;
                                if ((targetValue === 'yes' || targetValue === 'veteran') && optText.includes('identify as')) return true;
                                if (targetValue === 'decline' && optText.includes('don\'t wish')) return true;
                                return false;
                            }
                            
                            // Handle disability status
                            if (fieldType === 'disabilityStatus') {
                                if ((targetValue === 'yes' || targetValue === 'have') && optText.includes('yes, i have')) return true;
                                if ((targetValue === 'no' || targetValue === 'not') && optText.includes('no, i do not')) return true;
                                if (targetValue === 'decline' && optText.includes('do not want')) return true;
                                return false;
                            }
                            
                            return false;
                        });
                    }
                    
                    if (option) {
                        selectEl.value = option.value;
                        selectEl.dispatchEvent(new Event('change', { bubbles: true }));
                    }
                } else {
                    (element as HTMLInputElement).value = value;
                    ['input', 'change', 'blur'].forEach(eventType => {
                        element.dispatchEvent(new Event(eventType, { bubbles: true }));
                    });
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
}

// Initialize the detector
if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', () => {
        (window as any).piiAutofillDetector = new FieldDetector();
    });
} else {
    (window as any).piiAutofillDetector = new FieldDetector();
}