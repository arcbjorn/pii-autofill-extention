// Minimal content script for maximum performance
(function() {
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
        if (C.has(k)) return C.get(k);

        let t = A[e.autocomplete] || 
               (e.type === 'email' ? 'em' : 
                e.type === 'tel' ? 'ph' : 'u');

        if (t === 'u') {
            const s = (e.name + ' ' + e.id + ' ' + e.placeholder).toLowerCase();
            for (const [type, pattern] of Object.entries(P)) {
                if (pattern.test(s)) { t = type; break; }
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
            if (el.offsetParent && !el.hasAttribute('data-pii')) {
                const type = d(el);
                if (type !== 'u') {
                    f.push({ element: el, type });
                    el.setAttribute('data-pii', type);
                }
            }
        }

        if (f.length) {
            chrome.runtime.sendMessage({
                action: 'fieldsDetected',
                count: f.length,
                types: f.map(x => x.type),
                url: location.href
            }).catch(() => {});
        }
    }

    // Throttled detection
    function td() {
        if (T) return;
        T = setTimeout(() => {
            detect();
            T = 0;
        }, 300);
    }

    // Fill field
    function fill(el, val) {
        if (!el || !val) return;
        el.focus();
        el.value = val;
        el.dispatchEvent(new Event('input', { bubbles: true }));
        el.blur();
    }

    // Message handler
    chrome.runtime.onMessage.addListener((msg, _, res) => {
        if (msg.action === 'autofill' && msg.data) {
            const els = document.querySelectorAll('[data-pii]');
            for (const el of els) {
                const type = el.getAttribute('data-pii');
                const val = msg.data[type === 'fn' ? 'firstName' : 
                                  type === 'ln' ? 'lastName' :
                                  type === 'em' ? 'email' :
                                  type === 'ph' ? 'phone' :
                                  type === 'st' ? 'street' :
                                  type === 'cy' ? 'city' :
                                  type === 'zp' ? 'zip' : type];
                if (val) fill(el, val);
            }
            res({ success: true });
        } else if (msg.action === 'getFields') {
            const els = document.querySelectorAll('[data-pii]');
            res({ count: els.length, types: Array.from(els).map(e => e.getAttribute('data-pii')) });
        }
    });

    // DOM observer
    new MutationObserver(muts => {
        for (const mut of muts) {
            if (mut.addedNodes.length) {
                for (const node of mut.addedNodes) {
                    if (node.nodeType === 1 && 
                        (node.matches('input,select,textarea,form') || 
                         node.querySelector('input,select,textarea'))) {
                        td();
                        return;
                    }
                }
            }
        }
    }).observe(document.body, { childList: true, subtree: true });

    // Initialize
    if (document.readyState === 'loading') {
        document.addEventListener('DOMContentLoaded', td);
    } else {
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