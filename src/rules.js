class SiteRulesEngine {
    constructor() {
        this.customRules = new Map();
        this.defaultRules = new Map();
        this.currentSite = null;
        this.stepState = new Map();
        
        this.initializeDefaultRules();
        this.loadCustomRules();
    }

    async loadCustomRules() {
        try {
            const result = await chrome.storage.sync.get(['customSiteRules']);
            const customRules = result.customSiteRules || {};
            
            Object.entries(customRules).forEach(([pattern, rules]) => {
                this.customRules.set(pattern, rules);
            });
            
            console.log('Custom site rules loaded:', this.customRules.size, 'rules');
        } catch (error) {
            console.error('Error loading custom rules:', error);
        }
    }

    async saveCustomRules() {
        try {
            const customRulesObj = Object.fromEntries(this.customRules);
            await chrome.storage.sync.set({ customSiteRules: customRulesObj });
            console.log('Custom site rules saved');
        } catch (error) {
            console.error('Error saving custom rules:', error);
        }
    }

    initializeDefaultRules() {
        // Amazon rules
        this.defaultRules.set('amazon', {
            patterns: ['amazon.com', 'amazon.ca', 'amazon.co.uk', 'amazon.de', 'amazon.fr', 'amazon.it'],
            rules: {
                checkout: {
                    enabled: true,
                    steps: [
                        {
                            name: 'address',
                            urlPattern: '/checkout/address',
                            fields: {
                                'input[name="address1"]': { type: 'street', priority: 'high' },
                                'input[name="city"]': { type: 'city', priority: 'high' },
                                'input[name="state"]': { type: 'state', priority: 'high' },
                                'input[name="postalCode"]': { type: 'zip', priority: 'high' },
                                'input[name="phoneNumber"]': { type: 'phone', priority: 'medium' }
                            },
                            nextButton: 'input[name="shipToThisAddress"], .a-button-primary'
                        },
                        {
                            name: 'payment',
                            urlPattern: '/checkout/payment',
                            fields: {
                                'input[name="addCreditCardNumber"]': { type: 'cardNumber', priority: 'high', sensitive: true },
                                'input[name="ppw-accountHolderName"]': { type: 'fullName', priority: 'medium' },
                                'select[name="ppw-expirationDate_month"]': { type: 'expiryDate', priority: 'high', format: 'month' },
                                'select[name="ppw-expirationDate_year"]': { type: 'expiryDate', priority: 'high', format: 'year' }
                            },
                            skipFields: ['input[name="addCreditCardVerificationNumber"]'],
                            nextButton: '.a-button-primary',
                            waitForLoad: 2000
                        }
                    ]
                },
                profile: {
                    enabled: true,
                    fields: {
                        'input[name="customerName"]': { type: 'fullName', priority: 'high' },
                        'input[name="email"]': { type: 'email', priority: 'high' },
                        'input[name="phoneNumber"]': { type: 'phone', priority: 'medium' }
                    }
                },
                skipFields: [
                    'input[name="password"]',
                    'input[name="passwordCheck"]',
                    'input[type="password"]',
                    '.cvf-widget input',
                    '[data-testid="captcha"]'
                ],
                delays: {
                    betweenFields: 300,
                    afterStep: 1500
                },
                triggers: {
                    autoAdvance: false,
                    confirmBeforeFill: true
                }
            }
        });

        // Google rules
        this.defaultRules.set('google', {
            patterns: ['google.com', 'accounts.google.com', 'myaccount.google.com'],
            rules: {
                profile: {
                    enabled: true,
                    fields: {
                        'input[name="firstName"]': { type: 'firstName', priority: 'high' },
                        'input[name="lastName"]': { type: 'lastName', priority: 'high' },
                        'input[name="Email"]': { type: 'email', priority: 'high' },
                        'input[name="RecoveryPhoneNumber"]': { type: 'phone', priority: 'medium' }
                    }
                },
                skipFields: [
                    'input[name="Passwd"]',
                    'input[name="PasswdAgain"]',
                    'input[type="password"]',
                    'div[data-sitekey]', // reCAPTCHA
                    '.g-recaptcha',
                    '#recaptcha',
                    '[role="button"][aria-label*="CAPTCHA"]',
                    'iframe[src*="recaptcha"]',
                    'iframe[src*="captcha"]',
                    '.captcha-container',
                    'input[name="ca"]',
                    'input[name="challengeId"]'
                ],
                customHandlers: {
                    beforeFill: 'handleGoogleBeforeFill',
                    afterFill: 'handleGoogleAfterFill'
                }
            }
        });

        // Banking sites rules
        this.defaultRules.set('banking', {
            patterns: [
                'bankofamerica.com', 'chase.com', 'wellsfargo.com', 'citibank.com',
                'usbank.com', 'pnc.com', 'capitalone.com', 'ally.com',
                'americanexpress.com', 'discover.com'
            ],
            rules: {
                security: {
                    enabled: true,
                    requireConfirmation: true,
                    maxFields: 3, // Limit autofill to 3 fields at once
                    allowedFields: ['firstName', 'lastName', 'email', 'phone', 'street', 'city', 'state', 'zip'],
                    restrictedFields: ['password', 'ssn', 'accountNumber', 'routingNumber']
                },
                profile: {
                    enabled: true,
                    fields: {
                        'input[name*="firstName"], input[name*="first_name"]': { type: 'firstName', priority: 'medium' },
                        'input[name*="lastName"], input[name*="last_name"]': { type: 'lastName', priority: 'medium' },
                        'input[name*="email"]': { type: 'email', priority: 'medium' },
                        'input[name*="phone"]': { type: 'phone', priority: 'medium' },
                        'input[name*="address"], input[name*="street"]': { type: 'street', priority: 'medium' },
                        'input[name*="city"]': { type: 'city', priority: 'medium' },
                        'input[name*="state"]': { type: 'state', priority: 'medium' },
                        'input[name*="zip"], input[name*="postal"]': { type: 'zip', priority: 'medium' }
                    }
                },
                skipFields: [
                    'input[type="password"]',
                    'input[name*="password"]',
                    'input[name*="ssn"]',
                    'input[name*="social"]',
                    'input[name*="account"]',
                    'input[name*="routing"]',
                    'input[name*="pin"]',
                    'input[name*="cvv"]',
                    'input[name*="security"]',
                    '.mfa-input',
                    '.otp-input',
                    '.security-question'
                ],
                delays: {
                    betweenFields: 800,
                    beforeFill: 1000
                },
                customHandlers: {
                    beforeFill: 'handleBankingBeforeFill',
                    securityCheck: 'performBankingSecurity'
                }
            }
        });

        // Job sites rules
        this.defaultRules.set('jobs', {
            patterns: [
                'linkedin.com', 'indeed.com', 'glassdoor.com', 'monster.com',
                'ziprecruiter.com', 'careerbuilder.com', 'dice.com',
                'angellist.com', 'stackoverflow.com/jobs'
            ],
            rules: {
                application: {
                    enabled: true,
                    resumeFields: {
                        'input[name*="firstName"], input[placeholder*="first name" i]': { type: 'firstName', priority: 'high' },
                        'input[name*="lastName"], input[placeholder*="last name" i]': { type: 'lastName', priority: 'high' },
                        'input[name*="email"], input[type="email"]': { type: 'email', priority: 'high' },
                        'input[name*="phone"], input[type="tel"]': { type: 'phone', priority: 'high' },
                        'input[name*="company"], input[placeholder*="company" i]': { type: 'company', priority: 'high' },
                        'input[name*="title"], input[placeholder*="job title" i], input[placeholder*="position" i]': { type: 'jobTitle', priority: 'high' },
                        'input[name*="website"], input[placeholder*="website" i]': { type: 'website', priority: 'medium' },
                        'input[name*="linkedin"], input[placeholder*="linkedin" i]': { type: 'linkedin', priority: 'medium' },
                        'textarea[name*="summary"], textarea[placeholder*="summary" i]': { type: 'summary', priority: 'medium' },
                        'textarea[name*="experience"], textarea[placeholder*="experience" i]': { type: 'experience', priority: 'medium' }
                    },
                    addressFields: {
                        'input[name*="address"], input[placeholder*="address" i]': { type: 'street', priority: 'medium' },
                        'input[name*="city"], input[placeholder*="city" i]': { type: 'city', priority: 'medium' },
                        'input[name*="state"], input[placeholder*="state" i]': { type: 'state', priority: 'medium' },
                        'input[name*="zip"], input[placeholder*="zip" i]': { type: 'zip', priority: 'medium' }
                    }
                },
                linkedin: {
                    enabled: true,
                    specificSelectors: {
                        'input[name="firstName"]': { type: 'firstName', priority: 'high' },
                        'input[name="lastName"]': { type: 'lastName', priority: 'high' },
                        'input[name="email"]': { type: 'email', priority: 'high' },
                        'input[name="phoneNumber"]': { type: 'phone', priority: 'high' },
                        'input[name="easyApplyFormElement"]': { type: 'resume', priority: 'high', fileUpload: true }
                    }
                },
                delays: {
                    betweenFields: 500,
                    afterSection: 1000
                },
                validation: {
                    required: ['firstName', 'lastName', 'email'],
                    phoneFormat: 'US'
                }
            }
        });

        // E-commerce general rules
        this.defaultRules.set('ecommerce', {
            patterns: [
                'shopify.com', 'woocommerce.com', 'magento.com',
                'etsy.com', 'ebay.com', 'walmart.com', 'target.com'
            ],
            rules: {
                checkout: {
                    enabled: true,
                    fields: {
                        'input[name*="email"]': { type: 'email', priority: 'high' },
                        'input[name*="firstName"], input[name*="first_name"]': { type: 'firstName', priority: 'high' },
                        'input[name*="lastName"], input[name*="last_name"]': { type: 'lastName', priority: 'high' },
                        'input[name*="address1"], input[name*="street"]': { type: 'street', priority: 'high' },
                        'input[name*="city"]': { type: 'city', priority: 'high' },
                        'input[name*="province"], input[name*="state"]': { type: 'state', priority: 'high' },
                        'input[name*="zip"], input[name*="postal"]': { type: 'zip', priority: 'high' },
                        'input[name*="phone"]': { type: 'phone', priority: 'medium' }
                    }
                },
                skipFields: [
                    'input[name*="password"]',
                    'input[name*="card"]',
                    'input[name*="cvv"]',
                    'input[name*="security"]'
                ]
            }
        });

        console.log('Default site rules initialized:', this.defaultRules.size, 'rule sets');
    }

    getCurrentSite() {
        const hostname = window.location.hostname.toLowerCase();
        const pathname = window.location.pathname.toLowerCase();
        
        // Check custom rules first
        for (const [pattern, rules] of this.customRules.entries()) {
            if (this.matchesPattern(hostname, pattern) || this.matchesPattern(pathname, pattern)) {
                return { type: 'custom', pattern, rules };
            }
        }

        // Check default rules
        for (const [siteType, config] of this.defaultRules.entries()) {
            for (const pattern of config.patterns) {
                if (hostname.includes(pattern)) {
                    return { type: 'default', pattern: siteType, rules: config.rules };
                }
            }
        }

        return null;
    }

    matchesPattern(text, pattern) {
        if (pattern.includes('*')) {
            const regexPattern = pattern.replace(/\*/g, '.*');
            return new RegExp(regexPattern, 'i').test(text);
        }
        return text.includes(pattern.toLowerCase());
    }

    shouldSkipField(element) {
        const site = this.getCurrentSite();
        if (!site) return false;

        const skipFields = site.rules.skipFields || [];
        
        for (const skipPattern of skipFields) {
            if (this.elementMatchesSelector(element, skipPattern)) {
                console.log('Skipping field due to site rule:', skipPattern);
                return true;
            }
        }

        // Check for security restrictions (banking)
        if (site.rules.security?.restrictedFields) {
            const fieldType = this.getElementFieldType(element);
            if (site.rules.security.restrictedFields.includes(fieldType)) {
                console.log('Skipping restricted field type:', fieldType);
                return true;
            }
        }

        return false;
    }

    elementMatchesSelector(element, selector) {
        try {
            return element.matches(selector);
        } catch (e) {
            // Fallback for complex selectors
            try {
                return document.querySelector(selector) === element;
            } catch (e2) {
                return false;
            }
        }
    }

    getElementFieldType(element) {
        const name = element.name?.toLowerCase() || '';
        const id = element.id?.toLowerCase() || '';
        const type = element.type?.toLowerCase() || '';

        if (name.includes('password') || type === 'password') return 'password';
        if (name.includes('ssn') || name.includes('social')) return 'ssn';
        if (name.includes('card') || name.includes('credit')) return 'cardNumber';
        if (name.includes('cvv') || name.includes('security')) return 'cvv';
        
        return 'unknown';
    }

    getFieldMappingForSite(elements) {
        const site = this.getCurrentSite();
        if (!site) return {};

        const mapping = {};
        const rules = site.rules;

        // Handle different rule types
        const fieldSets = [
            rules.profile?.fields,
            rules.checkout?.fields,
            rules.application?.resumeFields,
            rules.application?.addressFields,
            rules.linkedin?.specificSelectors
        ].filter(Boolean);

        elements.forEach(element => {
            if (this.shouldSkipField(element)) return;

            for (const fieldSet of fieldSets) {
                for (const [selector, config] of Object.entries(fieldSet)) {
                    if (this.elementMatchesSelector(element, selector)) {
                        mapping[this.generateElementKey(element)] = {
                            type: config.type,
                            priority: config.priority || 'medium',
                            sensitive: config.sensitive || false,
                            format: config.format,
                            element: element
                        };
                        break;
                    }
                }
            }
        });

        return mapping;
    }

    generateElementKey(element) {
        if (element.id) return `#${element.id}`;
        if (element.name) return `[name="${element.name}"]`;
        
        const path = this.getElementPath(element);
        return path;
    }

    getElementPath(element) {
        const path = [];
        while (element && element.nodeType === Node.ELEMENT_NODE) {
            let selector = element.nodeName.toLowerCase();
            
            if (element.id) {
                selector += `#${element.id}`;
                path.unshift(selector);
                break;
            }
            
            if (element.className) {
                const classes = element.className.split(' ').filter(c => c);
                if (classes.length > 0) {
                    selector += `.${classes[0]}`;
                }
            }
            
            const parent = element.parentNode;
            if (parent) {
                const siblings = Array.from(parent.children).filter(child => 
                    child.nodeName === element.nodeName
                );
                if (siblings.length > 1) {
                    const index = siblings.indexOf(element) + 1;
                    selector += `:nth-child(${index})`;
                }
            }
            
            path.unshift(selector);
            element = parent;
        }
        
        return path.join(' > ');
    }

    async handleMultiStepProcess(currentStep) {
        const site = this.getCurrentSite();
        if (!site || !site.rules.checkout?.steps) return null;

        const steps = site.rules.checkout.steps;
        const currentUrl = window.location.href;

        for (const step of steps) {
            if (currentUrl.includes(step.urlPattern) || 
                (step.name === currentStep)) {
                
                console.log('Handling multi-step process:', step.name);
                
                // Store step state
                this.stepState.set('currentStep', step.name);
                this.stepState.set('stepConfig', step);
                
                return {
                    step: step.name,
                    fields: step.fields,
                    nextButton: step.nextButton,
                    waitForLoad: step.waitForLoad || 1000,
                    skipFields: step.skipFields || []
                };
            }
        }

        return null;
    }

    async executeCustomHandler(handlerName, context = {}) {
        try {
            switch (handlerName) {
                case 'handleGoogleBeforeFill':
                    return this.handleGoogleBeforeFill(context);
                case 'handleGoogleAfterFill':
                    return this.handleGoogleAfterFill(context);
                case 'handleBankingBeforeFill':
                    return this.handleBankingBeforeFill(context);
                case 'performBankingSecurity':
                    return this.performBankingSecurity(context);
                default:
                    console.warn('Unknown custom handler:', handlerName);
                    return true;
            }
        } catch (error) {
            console.error('Error executing custom handler:', handlerName, error);
            return false;
        }
    }

    async handleGoogleBeforeFill(context) {
        // Check for active CAPTCHA
        const captchaElements = document.querySelectorAll(
            'div[data-sitekey], .g-recaptcha, #recaptcha, iframe[src*="recaptcha"]'
        );
        
        if (captchaElements.length > 0) {
            console.log('CAPTCHA detected, skipping autofill');
            return false;
        }
        
        // Wait for any dynamic content to load
        await new Promise(resolve => setTimeout(resolve, 500));
        return true;
    }

    async handleGoogleAfterFill(context) {
        // Check if any required fields are still empty
        const requiredFields = document.querySelectorAll('input[required]');
        const emptyRequired = Array.from(requiredFields).filter(field => !field.value);
        
        if (emptyRequired.length > 0) {
            console.log('Some required fields remain empty:', emptyRequired.length);
        }
        
        return true;
    }

    async handleBankingBeforeFill(context) {
        // Show security warning
        const confirmed = await this.showSecurityConfirmation(
            'Banking Site Detected',
            'This appears to be a banking website. Only basic contact information will be filled. Continue?'
        );
        
        if (!confirmed) {
            console.log('User declined banking autofill');
            return false;
        }

        // Additional security checks
        return this.performBankingSecurity(context);
    }

    async performBankingSecurity(context) {
        // Check for suspicious elements
        const suspiciousSelectors = [
            'input[name*="password"]',
            'input[name*="ssn"]',
            'input[name*="account"]',
            'input[name*="pin"]'
        ];

        for (const selector of suspiciousSelectors) {
            const elements = document.querySelectorAll(selector);
            if (elements.length > 0) {
                console.log('Suspicious banking fields detected, limiting autofill');
                return { maxFields: 2, allowedTypes: ['firstName', 'lastName', 'email'] };
            }
        }

        return true;
    }

    async showSecurityConfirmation(title, message) {
        return new Promise((resolve) => {
            const dialog = document.createElement('div');
            dialog.style.cssText = `
                position: fixed;
                top: 0;
                left: 0;
                width: 100%;
                height: 100%;
                background: rgba(0, 0, 0, 0.7);
                z-index: 999999;
                display: flex;
                align-items: center;
                justify-content: center;
                font-family: Arial, sans-serif;
            `;

            dialog.innerHTML = `
                <div style="
                    background: white;
                    border-radius: 8px;
                    padding: 24px;
                    max-width: 400px;
                    box-shadow: 0 4px 20px rgba(0,0,0,0.3);
                ">
                    <h3 style="margin: 0 0 16px 0; color: #d32f2f;">${title}</h3>
                    <p style="margin: 0 0 20px 0; line-height: 1.5;">${message}</p>
                    <div style="text-align: right;">
                        <button id="cancelSecurity" style="
                            margin-right: 12px;
                            padding: 8px 16px;
                            border: 1px solid #ccc;
                            background: white;
                            border-radius: 4px;
                            cursor: pointer;
                        ">Cancel</button>
                        <button id="confirmSecurity" style="
                            padding: 8px 16px;
                            border: none;
                            background: #1976d2;
                            color: white;
                            border-radius: 4px;
                            cursor: pointer;
                        ">Continue</button>
                    </div>
                </div>
            `;

            document.body.appendChild(dialog);

            dialog.querySelector('#cancelSecurity').onclick = () => {
                document.body.removeChild(dialog);
                resolve(false);
            };

            dialog.querySelector('#confirmSecurity').onclick = () => {
                document.body.removeChild(dialog);
                resolve(true);
            };
        });
    }

    addCustomRule(pattern, rules) {
        this.customRules.set(pattern, rules);
        this.saveCustomRules();
    }

    removeCustomRule(pattern) {
        this.customRules.delete(pattern);
        this.saveCustomRules();
    }

    getCustomRules() {
        return Object.fromEntries(this.customRules);
    }

    exportRules() {
        return {
            custom: Object.fromEntries(this.customRules),
            defaults: Object.fromEntries(this.defaultRules),
            exportDate: new Date().toISOString()
        };
    }

    async importRules(rulesData) {
        if (rulesData.custom) {
            Object.entries(rulesData.custom).forEach(([pattern, rules]) => {
                this.customRules.set(pattern, rules);
            });
            await this.saveCustomRules();
        }
        
        console.log('Rules imported successfully');
    }

    getApplicableRules() {
        const site = this.getCurrentSite();
        if (!site) return null;

        return {
            site: site.pattern,
            type: site.type,
            rules: site.rules,
            skipFields: site.rules.skipFields || [],
            delays: site.rules.delays || {},
            security: site.rules.security || {}
        };
    }
}

// Export for use in content script
if (typeof module !== 'undefined' && module.exports) {
    module.exports = SiteRulesEngine;
} else if (typeof window !== 'undefined') {
    window.SiteRulesEngine = SiteRulesEngine;
}