"use strict";
// Minimal content script for maximum performance
(function () {
    'use strict';
    // Core field patterns (minimal set)
    const P = {
        fn: /first.*name|fname|given/i,
        ln: /last.*name|lname|family/i,
        em: /email|e.*mail/i,
        ph: /phone|tel/i,
        st: /street|address/i,
        cy: /city/i,
        zp: /zip|postal/i
    };
    // Autocomplete shortcuts
    const A = {
        'given-name': 'fn', 'family-name': 'ln', 'name': 'fn',
        'email': 'em', 'tel': 'ph', 'street-address': 'st',
        'address-line1': 'st', 'address-level2': 'cy', 'postal-code': 'zp'
    };
    // Cache
    const C = new Map();
    let T = 0; // Throttle timer
    // Fast field detection
    function d(e) {
        const k = e.name + e.id + e.className;
        if (C.has(k))
            return C.get(k);
        let t = A[e.autocomplete] ||
            (e.type === 'email' ? 'em' :
                e.type === 'tel' ? 'ph' : 'u');
        if (t === 'u') {
            const s = (e.name + ' ' + e.id + ' ' + (e.placeholder || '')).toLowerCase();
            for (const [type, pattern] of Object.entries(P)) {
                if (pattern.test(s)) {
                    t = type;
                    break;
                }
            }
        }
        C.set(k, t);
        return t;
    }
    // Detect fields
    function detect() {
        const f = [];
        const els = document.querySelectorAll('input:not([type="hidden"]):not([type="submit"]):not([type="button"]),select,textarea');
        for (const el of els) {
            const element = el;
            if (element.offsetParent && !element.hasAttribute('data-pii')) {
                const type = d(element);
                if (type !== 'u') {
                    f.push({ element, type });
                    element.setAttribute('data-pii', type);
                }
            }
        }
        if (f.length) {
            chrome.runtime.sendMessage({
                action: 'fieldsDetected',
                count: f.length,
                types: f.map(x => x.type),
                url: location.href
            }).catch(() => { });
        }
    }
    // Throttled detection
    function td() {
        if (T)
            return;
        T = window.setTimeout(() => {
            detect();
            T = 0;
        }, 300);
    }
    // Fill field
    function fill(el, val) {
        if (!el || !val)
            return;
        el.focus();
        if (el.tagName.toLowerCase() === 'select') {
            // Handle select elements
            const selectEl = el;
            const option = Array.from(selectEl.options).find(opt => opt.value.toLowerCase().includes(val.toLowerCase()) ||
                opt.textContent?.toLowerCase().includes(val.toLowerCase()));
            if (option) {
                selectEl.value = option.value;
                selectEl.dispatchEvent(new Event('change', { bubbles: true }));
            }
        }
        else {
            el.value = val;
            el.dispatchEvent(new Event('input', { bubbles: true }));
        }
        el.blur();
    }
    // Type mapping for autofill data
    const typeMapping = {
        'fn': 'firstName',
        'ln': 'lastName',
        'em': 'email',
        'ph': 'phone',
        'st': 'street',
        'cy': 'city',
        'zp': 'zip'
    };
    // Message handler
    chrome.runtime.onMessage.addListener((msg, _, res) => {
        if (msg.action === 'autofill' && msg.data) {
            const els = document.querySelectorAll('[data-pii]');
            for (const el of els) {
                const element = el;
                const type = element.getAttribute('data-pii');
                if (type && typeMapping[type]) {
                    const val = msg.data[typeMapping[type]];
                    if (val)
                        fill(element, val);
                }
            }
            res && res({ success: true });
        }
        else if (msg.action === 'getFields') {
            const els = document.querySelectorAll('[data-pii]');
            const types = Array.from(els).map(e => e.getAttribute('data-pii')).filter(Boolean);
            res && res({ count: els.length, types });
        }
    });
    // DOM observer
    new MutationObserver(muts => {
        for (const mut of muts) {
            if (mut.addedNodes.length) {
                for (const node of mut.addedNodes) {
                    if (node.nodeType === 1) {
                        const element = node;
                        if (element.matches('input,select,textarea,form') ||
                            element.querySelector('input,select,textarea')) {
                            td();
                            return;
                        }
                    }
                }
            }
        }
    }).observe(document.body, { childList: true, subtree: true });
    // Initialize
    if (document.readyState === 'loading') {
        document.addEventListener('DOMContentLoaded', td);
    }
    else {
        setTimeout(td, 50);
    }
    // Lazy load enhanced features
    setTimeout(() => {
        if (document.querySelectorAll('input,select,textarea').length > 10) {
            const s = document.createElement('script');
            s.src = chrome.runtime.getURL('src/detector.js');
            document.head.appendChild(s);
        }
    }, 2000);
    console.log('🚀 PII Autofill (minimal)');
})();
export {};
//# sourceMappingURL=content-minimal.js.map