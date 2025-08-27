// Optimized content script with lazy loading and performance improvements (TypeScript)
import type { 
  FieldTypeName, 
  DetectedField, 
  PerformanceConfig, 
  FormContext,
  MessageRequest,
  AutofillMessage,
  DetectionMessage
} from '../types/extension';

interface CoreFieldPatterns {
  [key: string]: RegExp;
}

interface AutocompleteShortcuts {
  [key: string]: string;
}

interface FieldCache {
  [key: string]: string;
}

interface LazyModules {
  enhancedDetector: any;
  siteRules: any;
  isEnhancedLoaded: boolean;
}

(function(): void {
    'use strict';

    // Performance optimization configuration
    const PERFORMANCE_CONFIG: PerformanceConfig = {
        debounceDelay: 300,
        cacheTimeout: 5 * 60 * 1000, // 5 minutes
        maxCacheEntries: 100,
        lazyLoadDelay: 1000,
        observerThrottle: 250
    };

    // Minimal core field patterns for initial detection
    const CORE_FIELD_PATTERNS: CoreFieldPatterns = {
        firstName: /first.*name|fname|given.*name/i,
        lastName: /last.*name|lname|family.*name/i,
        email: /email|e.*mail/i,
        phone: /phone|tel/i,
        street: /street|address/i,
        city: /city/i,
        state: /state|province/i,
        zip: /zip|postal/i
    };

    const AUTOCOMPLETE_MAP: AutocompleteShortcuts = {
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
        'country': 'country'
    };

    // Cache for field detection results
    const detectionCache = new Map<string, { result: string; timestamp: number }>();
    const urlCache = new WeakMap<HTMLElement, string>();
    
    // Lazy-loaded modules
    const lazyModules: LazyModules = {
        enhancedDetector: null,
        siteRules: null,
        isEnhancedLoaded: false
    };

    // Debounced functions
    const debouncedDetection = debounce(detectAndCacheFields, PERFORMANCE_CONFIG.debounceDelay);
    const throttledObserver = throttle(handleDOMChanges, PERFORMANCE_CONFIG.observerThrottle);

    // Performance utilities
    function debounce<T extends (...args: any[]) => any>(
        func: T, 
        wait: number
    ): (...args: Parameters<T>) => void {
        let timeout: number | undefined;
        return function executedFunction(this: any, ...args: Parameters<T>): void {
            const later = (): void => {
                clearTimeout(timeout);
                func.apply(this, args);
            };
            clearTimeout(timeout);
            timeout = setTimeout(later, wait);
        };
    }

    function throttle<T extends (...args: any[]) => any>(
        func: T, 
        limit: number
    ): (...args: Parameters<T>) => void {
        let inThrottle: boolean;
        return function(this: any, ...args: Parameters<T>): void {
            if (!inThrottle) {
                func.apply(this, args);
                inThrottle = true;
                setTimeout(() => inThrottle = false, limit);
            }
        };
    }

    // Cache management
    function getCacheKey(element: HTMLElement): string {
        return `${element.tagName}_${element.getAttribute('name') || element.id || element.className}_${(element as HTMLInputElement).type}`;
    }

    function getCachedDetection(element: HTMLElement): string | null {
        const key = getCacheKey(element);
        const cached = detectionCache.get(key);
        
        if (cached && Date.now() - cached.timestamp < PERFORMANCE_CONFIG.cacheTimeout) {
            return cached.result;
        }
        
        return null;
    }

    function setCachedDetection(element: HTMLElement, result: string): void {
        const key = getCacheKey(element);
        
        // Limit cache size
        if (detectionCache.size >= PERFORMANCE_CONFIG.maxCacheEntries) {
            const firstKey = detectionCache.keys().next().value;
            if (firstKey) {
                detectionCache.delete(firstKey);
            }
        }
        
        detectionCache.set(key, {
            result,
            timestamp: Date.now()
        });
    }

    // Lazy loading for enhanced features
    async function loadEnhancedDetector(): Promise<any> {
        if (lazyModules.isEnhancedLoaded) return lazyModules.enhancedDetector;

        try {
            // Load enhanced detector only when needed
            const script = document.createElement('script');
            script.src = chrome.runtime.getURL('src/detector.js');
            document.head.appendChild(script);

            // Wait for script to load
            await new Promise<void>((resolve, reject) => {
                script.onload = () => resolve();
                script.onerror = () => reject(new Error('Failed to load detector'));
            });

            // Enhanced detector should be available globally
            lazyModules.enhancedDetector = (window as any).EnhancedFieldDetector || null;
            lazyModules.isEnhancedLoaded = true;

            console.log('🚀 Enhanced detector loaded lazily');
            return lazyModules.enhancedDetector;

        } catch (error) {
            console.warn('⚠️ Failed to load enhanced detector:', error);
            return null;
        }
    }

    async function loadSiteRules(): Promise<any> {
        if (lazyModules.siteRules) return lazyModules.siteRules;

        try {
            const script = document.createElement('script');
            script.src = chrome.runtime.getURL('src/rules.js');
            document.head.appendChild(script);

            await new Promise<void>((resolve, reject) => {
                script.onload = () => resolve();
                script.onerror = () => reject(new Error('Failed to load rules'));
            });

            lazyModules.siteRules = (window as any).SiteRulesEngine || null;
            console.log('🎯 Site rules loaded lazily');
            return lazyModules.siteRules;

        } catch (error) {
            console.warn('⚠️ Failed to load site rules:', error);
            return null;
        }
    }

    // Lightweight field type detection
    function getFieldTypeFast(element: HTMLInputElement | HTMLSelectElement | HTMLTextAreaElement): string {
        // Check cache first
        const cached = getCachedDetection(element);
        if (cached) return cached;

        let fieldType = 'unknown';

        // 1. Check autocomplete attribute (fastest)
        const autocomplete = element.getAttribute('autocomplete');
        if (autocomplete && AUTOCOMPLETE_MAP[autocomplete]) {
            fieldType = AUTOCOMPLETE_MAP[autocomplete];
            setCachedDetection(element, fieldType);
            return fieldType;
        }

        // 2. Check input type
        const inputElement = element as HTMLInputElement;
        if (inputElement.type === 'email') fieldType = 'email';
        else if (inputElement.type === 'tel') fieldType = 'phone';
        else if (inputElement.type === 'password') fieldType = 'password';

        // 3. Quick pattern matching on name/id
        if (fieldType === 'unknown') {
            const identifier = [
                element.getAttribute('name') || '',
                element.id || '',
                element.getAttribute('placeholder') || ''
            ].join(' ').toLowerCase();
            
            for (const [type, pattern] of Object.entries(CORE_FIELD_PATTERNS)) {
                if (pattern.test(identifier)) {
                    fieldType = type;
                    break;
                }
            }
        }

        setCachedDetection(element, fieldType);
        return fieldType;
    }

    // Enhanced detection with lazy loading
    async function getFieldTypeEnhanced(element: HTMLInputElement | HTMLSelectElement | HTMLTextAreaElement): Promise<string> {
        const fastResult = getFieldTypeFast(element);
        
        // If we got a good result from fast detection, use it
        if (fastResult !== 'unknown') {
            return fastResult;
        }

        // Load enhanced detector for complex cases
        const detector = await loadEnhancedDetector();
        if (detector && detector.detectFieldType) {
            try {
                return detector.detectFieldType(element);
            } catch (error) {
                console.warn('Enhanced detection failed:', error);
            }
        }

        return fastResult;
    }

    // Optimized form field detection
    function detectFormFields(container: Document | HTMLElement = document): DetectedField[] {
        const fields: DetectedField[] = [];
        const formElements = container.querySelectorAll(
            'input:not([type="submit"]):not([type="button"]):not([type="reset"]), select, textarea'
        ) as NodeListOf<HTMLInputElement | HTMLSelectElement | HTMLTextAreaElement>;

        for (const element of formElements) {
            // Skip hidden fields and already processed fields
            if ((element as HTMLInputElement).type === 'hidden' || 
                !element.offsetParent ||
                element.hasAttribute('data-pii-processed')) {
                continue;
            }

            const fieldType = getFieldTypeFast(element);
            
            if (fieldType && fieldType !== 'unknown') {
                fields.push({
                    element,
                    type: fieldType as FieldTypeName,
                    confidence: 0.8
                });

                // Mark as processed to avoid re-detection
                element.setAttribute('data-pii-processed', 'true');
            }
        }

        return fields;
    }

    // Detect and cache fields with performance optimization
    async function detectAndCacheFields(): Promise<void> {
        const startTime = performance.now();
        
        try {
            const fields = detectFormFields();
            
            if (fields.length > 0) {
                // Store detected fields efficiently
                const fieldData = {
                    fields: fields.map(f => ({
                        type: f.type,
                        selector: getFieldSelector(f.element),
                        confidence: f.confidence
                    })),
                    url: window.location.href,
                    timestamp: Date.now()
                };

                // Use efficient storage
                chrome.runtime.sendMessage({
                    action: 'cacheFieldData',
                    data: fieldData
                } as MessageRequest).catch(() => {
                    // Ignore errors if background script is not available
                });

                console.log(`🔍 Detected ${fields.length} fields in ${(performance.now() - startTime).toFixed(2)}ms`);
            }

        } catch (error) {
            console.error('Field detection error:', error);
        }
    }

    // Generate efficient CSS selector for field
    function getFieldSelector(element: HTMLElement): string {
        if (element.id) return `#${element.id}`;
        if (element.getAttribute('name')) return `[name="${element.getAttribute('name')}"]`;
        if (element.className) return `.${element.className.split(' ')[0]}`;
        
        // Fallback to nth-child
        const parent = element.parentNode;
        if (parent) {
            const siblings = Array.from(parent.children);
            const index = siblings.indexOf(element) + 1;
            return `${element.tagName.toLowerCase()}:nth-child(${index})`;
        }
        
        return element.tagName.toLowerCase();
    }

    // Optimized autofill with batch operations
    async function handleAutofill(profileData: Partial<PIIAutofill.FieldType>, targetFields: any[]): Promise<void> {
        if (!profileData || !targetFields) return;

        const batch: Array<{
            element: HTMLElement;
            value: string;
            type: string;
        }> = [];
        
        for (const fieldInfo of targetFields) {
            try {
                const element = document.querySelector(fieldInfo.selector) as HTMLInputElement | HTMLSelectElement | HTMLTextAreaElement;
                const value = profileData[fieldInfo.type as keyof PIIAutofill.FieldType];
                
                if (element && value) {
                    batch.push({
                        element,
                        value,
                        type: fieldInfo.type
                    });
                }

            } catch (error) {
                console.warn('Selector failed:', fieldInfo.selector, error);
            }
        }

        // Apply autofill in batches for better performance
        const batchSize = 5;
        for (let i = 0; i < batch.length; i += batchSize) {
            const batchFields = batch.slice(i, i + batchSize);
            
            await new Promise<void>(resolve => {
                requestAnimationFrame(() => {
                    batchFields.forEach(({ element, value, type }) => {
                        fillField(element as HTMLInputElement, value, type);
                    });
                    resolve();
                });
            });

            // Small delay between batches to avoid blocking
            if (i + batchSize < batch.length) {
                await new Promise<void>(resolve => setTimeout(resolve, 10));
            }
        }
    }

    // Optimized field filling
    function fillField(element: HTMLInputElement | HTMLSelectElement | HTMLTextAreaElement, value: string, fieldType: string): void {
        if (!element || !value) return;

        // Apply site-specific delays only when needed
        const isSensitive = ['cardNumber', 'cvv', 'password'].includes(fieldType);
        const delay = isSensitive ? 100 : 0;

        setTimeout(() => {
            try {
                // Trigger events efficiently
                element.focus();
                (element as HTMLInputElement).value = value;
                
                // Fire necessary events
                element.dispatchEvent(new Event('input', { bubbles: true }));
                element.dispatchEvent(new Event('change', { bubbles: true }));
                element.blur();

            } catch (error) {
                console.warn('Fill failed for field:', fieldType, error);
            }
        }, delay);
    }

    // Optimized DOM observation
    function setupDOMObserver(): MutationObserver {
        const observer = new MutationObserver((mutations) => {
            let shouldCheck = false;

            for (const mutation of mutations) {
                if (mutation.type === 'childList' && mutation.addedNodes.length > 0) {
                    for (const node of mutation.addedNodes) {
                        if (node.nodeType === Node.ELEMENT_NODE) {
                            const element = node as HTMLElement;
                            if (element.matches('form, input, select, textarea') ||
                                element.querySelector('form, input, select, textarea')) {
                                shouldCheck = true;
                                break;
                            }
                        }
                    }
                }
                if (shouldCheck) break;
            }

            if (shouldCheck) {
                throttledObserver();
            }
        });

        observer.observe(document.body, {
            childList: true,
            subtree: true
        });

        return observer;
    }

    function handleDOMChanges(): void {
        // Clear processed flags for dynamic content
        document.querySelectorAll('[data-pii-processed]').forEach(el => {
            el.removeAttribute('data-pii-processed');
        });

        debouncedDetection();
    }

    // Message handling with performance optimization
    chrome.runtime.onMessage.addListener((
        message: MessageRequest, 
        sender: chrome.runtime.MessageSender, 
        sendResponse: (response: any) => void
    ): boolean | void => {
        switch (message.action) {
            case 'autofill':
                const autofillMsg = message as AutofillMessage;
                handleAutofill(autofillMsg.data, autofillMsg.fields || [])
                    .then(() => sendResponse({ success: true }))
                    .catch(error => sendResponse({ success: false, error: error.message }));
                return true;

            case 'getDetectedFields':
                const fields = detectFormFields();
                sendResponse({
                    fieldTypes: fields.map(f => f.type),
                    count: fields.length
                });
                break;

            case 'clearCache':
                detectionCache.clear();
                sendResponse({ success: true });
                break;
        }
    });

    // Lazy initialization
    function initialize(): void {
        console.log('🚀 PII Autofill content script loaded (optimized TypeScript)');

        // Initial field detection
        if (document.readyState === 'loading') {
            document.addEventListener('DOMContentLoaded', debouncedDetection);
        } else {
            // Small delay to avoid blocking initial page load
            setTimeout(debouncedDetection, 100);
        }

        // Set up DOM observation
        setupDOMObserver();

        // Lazy load enhanced features after initial load
        setTimeout(() => {
            loadEnhancedDetector();
            loadSiteRules();
        }, PERFORMANCE_CONFIG.lazyLoadDelay);

        // Periodic cache cleanup
        setInterval(() => {
            const cutoffTime = Date.now() - PERFORMANCE_CONFIG.cacheTimeout;
            for (const [key, value] of detectionCache.entries()) {
                if (value.timestamp < cutoffTime) {
                    detectionCache.delete(key);
                }
            }
        }, 60000); // Clean every minute
    }

    // Start initialization
    initialize();

    // Export for debugging (TypeScript-safe)
    interface PIIAutofillOptimized {
        getCacheSize(): number;
        clearCache(): void;
        getPerformanceConfig(): PerformanceConfig;
    }

    if (typeof window !== 'undefined') {
        (window as any).PIIAutofillOptimized = {
            getCacheSize: (): number => detectionCache.size,
            clearCache: (): void => detectionCache.clear(),
            getPerformanceConfig: (): PerformanceConfig => PERFORMANCE_CONFIG
        } as PIIAutofillOptimized;
    }

})();