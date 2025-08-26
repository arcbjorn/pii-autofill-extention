// Optimized content script with lazy loading and performance improvements
(function() {
    'use strict';

    // Performance optimization configuration
    const PERFORMANCE_CONFIG = {
        debounceDelay: 300,
        cacheTimeout: 5 * 60 * 1000, // 5 minutes
        maxCacheEntries: 100,
        lazyLoadDelay: 1000,
        observerThrottle: 250
    };

    // Minimal core field patterns for initial detection
    const CORE_FIELD_PATTERNS = {
        firstName: ['first.*name', 'fname', 'given.*name'],
        lastName: ['last.*name', 'lname', 'family.*name'],
        email: ['email', 'e.*mail'],
        phone: ['phone', 'tel'],
        street: ['street', 'address'],
        city: ['city'],
        state: ['state', 'province'],
        zip: ['zip', 'postal']
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
        'country': 'country'
    };

    // Cache for field detection results
    const detectionCache = new Map();
    const urlCache = new WeakMap();
    
    // Lazy-loaded modules
    let enhancedDetector = null;
    let siteRules = null;
    let isEnhancedLoaded = false;

    // Debounced functions
    const debouncedDetection = debounce(detectAndCacheFields, PERFORMANCE_CONFIG.debounceDelay);
    const throttledObserver = throttle(handleDOMChanges, PERFORMANCE_CONFIG.observerThrottle);

    // Performance utilities
    function debounce(func, wait) {
        let timeout;
        return function executedFunction(...args) {
            const later = () => {
                clearTimeout(timeout);
                func(...args);
            };
            clearTimeout(timeout);
            timeout = setTimeout(later, wait);
        };
    }

    function throttle(func, limit) {
        let inThrottle;
        return function() {
            const args = arguments;
            const context = this;
            if (!inThrottle) {
                func.apply(context, args);
                inThrottle = true;
                setTimeout(() => inThrottle = false, limit);
            }
        };
    }

    // Cache management
    function getCacheKey(element) {
        return `${element.tagName}_${element.name || element.id || element.className}_${element.type}`;
    }

    function getCachedDetection(element) {
        const key = getCacheKey(element);
        const cached = detectionCache.get(key);
        
        if (cached && Date.now() - cached.timestamp < PERFORMANCE_CONFIG.cacheTimeout) {
            return cached.result;
        }
        
        return null;
    }

    function setCachedDetection(element, result) {
        const key = getCacheKey(element);
        
        // Limit cache size
        if (detectionCache.size >= PERFORMANCE_CONFIG.maxCacheEntries) {
            const firstKey = detectionCache.keys().next().value;
            detectionCache.delete(firstKey);
        }
        
        detectionCache.set(key, {
            result,
            timestamp: Date.now()
        });
    }

    // Lazy loading for enhanced features
    async function loadEnhancedDetector() {
        if (isEnhancedLoaded) return enhancedDetector;

        try {
            // Load enhanced detector only when needed
            const script = document.createElement('script');
            script.src = chrome.runtime.getURL('src/detector.js');
            document.head.appendChild(script);

            // Wait for script to load
            await new Promise((resolve, reject) => {
                script.onload = resolve;
                script.onerror = reject;
            });

            // Enhanced detector should be available globally
            enhancedDetector = window.EnhancedFieldDetector || null;
            isEnhancedLoaded = true;

            console.log('🚀 Enhanced detector loaded lazily');
            return enhancedDetector;

        } catch (error) {
            console.warn('⚠️ Failed to load enhanced detector:', error);
            return null;
        }
    }

    async function loadSiteRules() {
        if (siteRules) return siteRules;

        try {
            const script = document.createElement('script');
            script.src = chrome.runtime.getURL('src/rules.js');
            document.head.appendChild(script);

            await new Promise((resolve, reject) => {
                script.onload = resolve;
                script.onerror = reject;
            });

            siteRules = window.SiteRulesEngine || null;
            console.log('🎯 Site rules loaded lazily');
            return siteRules;

        } catch (error) {
            console.warn('⚠️ Failed to load site rules:', error);
            return null;
        }
    }

    // Lightweight field type detection
    function getFieldTypeFast(element) {
        // Check cache first
        const cached = getCachedDetection(element);
        if (cached) return cached;

        let fieldType = 'unknown';

        // 1. Check autocomplete attribute (fastest)
        if (element.autocomplete && AUTOCOMPLETE_MAP[element.autocomplete]) {
            fieldType = AUTOCOMPLETE_MAP[element.autocomplete];
            setCachedDetection(element, fieldType);
            return fieldType;
        }

        // 2. Check input type
        if (element.type === 'email') fieldType = 'email';
        else if (element.type === 'tel') fieldType = 'phone';
        else if (element.type === 'password') fieldType = 'password';

        // 3. Quick pattern matching on name/id
        if (fieldType === 'unknown') {
            const identifier = (element.name + ' ' + element.id + ' ' + element.placeholder).toLowerCase();
            
            for (const [type, patterns] of Object.entries(CORE_FIELD_PATTERNS)) {
                for (const pattern of patterns) {
                    if (new RegExp(pattern, 'i').test(identifier)) {
                        fieldType = type;
                        break;
                    }
                }
                if (fieldType !== 'unknown') break;
            }
        }

        setCachedDetection(element, fieldType);
        return fieldType;
    }

    // Enhanced detection with lazy loading
    async function getFieldTypeEnhanced(element) {
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
    function detectFormFields(container = document) {
        const fields = [];
        const formElements = container.querySelectorAll('input:not([type="submit"]):not([type="button"]):not([type="reset"]), select, textarea');

        for (const element of formElements) {
            // Skip hidden fields and already processed fields
            if (element.type === 'hidden' || 
                element.offsetParent === null ||
                element.hasAttribute('data-pii-processed')) {
                continue;
            }

            const fieldType = getFieldTypeFast(element);
            
            if (fieldType !== 'unknown') {
                fields.push({
                    element,
                    type: fieldType,
                    confidence: fieldType === 'unknown' ? 0 : 0.8
                });

                // Mark as processed to avoid re-detection
                element.setAttribute('data-pii-processed', 'true');
            }
        }

        return fields;
    }

    // Detect and cache fields with performance optimization
    async function detectAndCacheFields() {
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
                await chrome.runtime.sendMessage({
                    action: 'cacheFieldData',
                    data: fieldData
                });

                console.log(`🔍 Detected ${fields.length} fields in ${(performance.now() - startTime).toFixed(2)}ms`);
            }

        } catch (error) {
            console.error('Field detection error:', error);
        }
    }

    // Generate efficient CSS selector for field
    function getFieldSelector(element) {
        if (element.id) return `#${element.id}`;
        if (element.name) return `[name="${element.name}"]`;
        if (element.className) return `.${element.className.split(' ')[0]}`;
        
        // Fallback to nth-child
        const siblings = Array.from(element.parentNode.children);
        const index = siblings.indexOf(element) + 1;
        return `${element.tagName.toLowerCase()}:nth-child(${index})`;
    }

    // Optimized autofill with batch operations
    async function handleAutofill(profileData, targetFields) {
        if (!profileData || !targetFields) return;

        const batch = [];
        
        for (const fieldInfo of targetFields) {
            try {
                const element = document.querySelector(fieldInfo.selector);
                if (!element || !profileData[fieldInfo.type]) continue;

                batch.push({
                    element,
                    value: profileData[fieldInfo.type],
                    type: fieldInfo.type
                });

            } catch (error) {
                console.warn('Selector failed:', fieldInfo.selector, error);
            }
        }

        // Apply autofill in batches for better performance
        const batchSize = 5;
        for (let i = 0; i < batch.length; i += batchSize) {
            const batchFields = batch.slice(i, i + batchSize);
            
            await new Promise(resolve => {
                requestAnimationFrame(() => {
                    batchFields.forEach(({ element, value, type }) => {
                        fillField(element, value, type);
                    });
                    resolve();
                });
            });

            // Small delay between batches to avoid blocking
            if (i + batchSize < batch.length) {
                await new Promise(resolve => setTimeout(resolve, 10));
            }
        }
    }

    // Optimized field filling
    function fillField(element, value, fieldType) {
        if (!element || !value) return;

        // Apply site-specific delays only when needed
        const isSensitive = ['cardNumber', 'cvv', 'password'].includes(fieldType);
        const delay = isSensitive ? 100 : 0;

        setTimeout(() => {
            try {
                // Trigger events efficiently
                element.focus();
                element.value = value;
                
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
    function setupDOMObserver() {
        const observer = new MutationObserver((mutations) => {
            let shouldCheck = false;

            for (const mutation of mutations) {
                if (mutation.type === 'childList' && mutation.addedNodes.length > 0) {
                    for (const node of mutation.addedNodes) {
                        if (node.nodeType === Node.ELEMENT_NODE) {
                            if (node.matches('form, input, select, textarea') ||
                                node.querySelector('form, input, select, textarea')) {
                                shouldCheck = true;
                                break;
                            }
                        }
                    }
                }
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

    function handleDOMChanges() {
        // Clear processed flags for dynamic content
        document.querySelectorAll('[data-pii-processed]').forEach(el => {
            el.removeAttribute('data-pii-processed');
        });

        debouncedDetection();
    }

    // Message handling with performance optimization
    chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
        switch (message.action) {
            case 'autofill':
                handleAutofill(message.data, message.fields)
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
    function initialize() {
        console.log('🚀 PII Autofill content script loaded (optimized)');

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

    // Export for debugging
    if (typeof window !== 'undefined') {
        window.PIIAutofillOptimized = {
            getCacheSize: () => detectionCache.size,
            clearCache: () => detectionCache.clear(),
            getPerformanceConfig: () => PERFORMANCE_CONFIG
        };
    }

})();