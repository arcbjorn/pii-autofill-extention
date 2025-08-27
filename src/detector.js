class EnhancedFieldDetector {
    constructor() {
        Object.defineProperty(this, "SCORE_THRESHOLD", {
            enumerable: true,
            configurable: true,
            writable: true,
            value: 60
        });
        Object.defineProperty(this, "EXACT_MATCH_SCORE", {
            enumerable: true,
            configurable: true,
            writable: true,
            value: 100
        });
        Object.defineProperty(this, "FUZZY_MATCH_SCORE", {
            enumerable: true,
            configurable: true,
            writable: true,
            value: 70
        });
        Object.defineProperty(this, "PATTERN_MATCH_SCORE", {
            enumerable: true,
            configurable: true,
            writable: true,
            value: 50
        });
        Object.defineProperty(this, "ML_CONTEXT_SCORE", {
            enumerable: true,
            configurable: true,
            writable: true,
            value: 40
        });
        Object.defineProperty(this, "userCorrections", {
            enumerable: true,
            configurable: true,
            writable: true,
            value: void 0
        });
        Object.defineProperty(this, "learningData", {
            enumerable: true,
            configurable: true,
            writable: true,
            value: void 0
        });
        Object.defineProperty(this, "contextVectors", {
            enumerable: true,
            configurable: true,
            writable: true,
            value: void 0
        });
        Object.defineProperty(this, "exactPatterns", {
            enumerable: true,
            configurable: true,
            writable: true,
            value: {}
        });
        Object.defineProperty(this, "fuzzyPatterns", {
            enumerable: true,
            configurable: true,
            writable: true,
            value: {}
        });
        Object.defineProperty(this, "commonPatterns", {
            enumerable: true,
            configurable: true,
            writable: true,
            value: {}
        });
        this.userCorrections = new Map();
        this.learningData = [];
        this.contextVectors = new Map();
        this.init();
    }
    async init() {
        await this.loadLearningData();
        this.initializeContextVectors();
        this.setupPatterns();
    }
    setupPatterns() {
        this.exactPatterns = {
            firstName: ['firstname', 'first_name', 'given_name', 'fname', 'forename'],
            lastName: ['lastname', 'last_name', 'family_name', 'surname', 'lname'],
            fullName: ['fullname', 'full_name', 'name', 'complete_name'],
            email: ['email', 'email_address', 'e_mail', 'emailaddress'],
            phone: ['phone', 'telephone', 'tel', 'mobile', 'cell', 'phone_number'],
            street: ['street', 'address', 'street_address', 'addr', 'address1'],
            city: ['city', 'town', 'locality', 'municipality'],
            state: ['state', 'province', 'region', 'territory'],
            zip: ['zip', 'zipcode', 'postal', 'postal_code', 'postcode'],
            country: ['country', 'nation', 'nationality'],
            company: ['company', 'organization', 'employer', 'workplace'],
            jobTitle: ['job_title', 'position', 'title', 'role'],
            website: ['website', 'url', 'web_site', 'homepage'],
            linkedin: ['linkedin', 'linked_in', 'linkedin_profile', 'linkedin_url'],
            twitter: ['twitter', 'twitter_handle', 'twitter_username', 'twitter_profile'],
            facebook: ['facebook', 'fb', 'facebook_profile', 'facebook_url'],
            instagram: ['instagram', 'ig', 'instagram_handle', 'instagram_profile'],
            github: ['github', 'github_username', 'github_profile', 'git_username'],
            youtube: ['youtube', 'youtube_channel', 'yt', 'youtube_handle'],
            tiktok: ['tiktok', 'tik_tok', 'tiktok_handle', 'tiktok_username'],
            snapchat: ['snapchat', 'snap', 'snapchat_username', 'snap_handle'],
            discord: ['discord', 'discord_username', 'discord_handle', 'discord_tag']
        };
        this.fuzzyPatterns = {
            firstName: [/first.*name/i, /given.*name/i, /f.*name/i],
            lastName: [/last.*name/i, /family.*name/i, /sur.*name/i],
            fullName: [/full.*name/i, /complete.*name/i, /your.*name/i],
            email: [/e.*mail/i, /mail.*address/i, /email.*addr/i],
            phone: [/phone.*number/i, /tel.*number/i, /mobile.*number/i],
            street: [/street.*address/i, /home.*address/i, /address.*line/i],
            city: [/city.*name/i, /town.*name/i],
            state: [/state.*province/i, /region.*state/i],
            zip: [/zip.*code/i, /postal.*code/i, /post.*code/i],
            company: [/company.*name/i, /organization.*name/i],
            jobTitle: [/job.*title/i, /work.*title/i, /position.*title/i],
            linkedin: [/linkedin.*profile/i, /linkedin.*url/i, /linked.*in/i],
            twitter: [/twitter.*handle/i, /twitter.*profile/i, /@.*twitter/i],
            facebook: [/facebook.*profile/i, /facebook.*url/i, /fb.*profile/i],
            instagram: [/instagram.*handle/i, /ig.*profile/i, /instagram.*account/i],
            github: [/github.*profile/i, /github.*username/i, /git.*profile/i],
            youtube: [/youtube.*channel/i, /yt.*channel/i, /youtube.*handle/i],
            tiktok: [/tiktok.*handle/i, /tik.*tok/i, /tiktok.*username/i],
            snapchat: [/snapchat.*username/i, /snap.*handle/i, /snapchat.*profile/i],
            discord: [/discord.*username/i, /discord.*tag/i, /discord.*handle/i]
        };
        this.commonPatterns = {
            firstName: [/^fn$/i, /^givenname$/i, /first$/i],
            lastName: [/^ln$/i, /^familyname$/i, /last$/i],
            email: [/@/i, /mail$/i, /^em$/i],
            phone: [/^\d{3}[-.\s]?\d{3}[-.\s]?\d{4}$/, /tel$/i, /ph$/i],
            zip: [/^\d{5}(-\d{4})?$/, /postal$/i, /^zip$/i],
            linkedin: [/linkedin\.com/i, /^@/i, /profile$/i],
            twitter: [/twitter\.com/i, /^@/i, /handle$/i],
            facebook: [/facebook\.com/i, /fb\.com/i, /^@/i],
            instagram: [/instagram\.com/i, /^@/i, /ig$/i],
            github: [/github\.com/i, /^@/i, /git$/i],
            youtube: [/youtube\.com/i, /youtu\.be/i, /channel$/i],
            tiktok: [/tiktok\.com/i, /^@/i, /tt$/i],
            snapchat: [/snapchat\.com/i, /^@/i, /snap$/i],
            discord: [/#\d{4}$/i, /discord$/i, /^@/i]
        };
    }
    initializeContextVectors() {
        this.contextVectors.set('personal', {
            keywords: ['name', 'personal', 'profile', 'bio', 'about', 'contact'],
            weight: 1.2
        });
        this.contextVectors.set('address', {
            keywords: ['address', 'location', 'home', 'residence', 'shipping', 'billing'],
            weight: 1.1
        });
        this.contextVectors.set('payment', {
            keywords: ['payment', 'card', 'billing', 'checkout', 'purchase', 'order'],
            weight: 1.3
        });
        this.contextVectors.set('work', {
            keywords: ['work', 'job', 'career', 'professional', 'business', 'employment'],
            weight: 1.0
        });
    }
    async loadLearningData() {
        try {
            const result = await chrome.storage.local.get(['userCorrections', 'learningData']);
            this.userCorrections = new Map(result.userCorrections || []);
            this.learningData = result.learningData || [];
        }
        catch (error) {
            console.error('Error loading learning data:', error);
        }
    }
    async saveLearningData() {
        try {
            await chrome.storage.local.set({
                userCorrections: Array.from(this.userCorrections.entries()),
                learningData: this.learningData
            });
        }
        catch (error) {
            console.error('Error saving learning data:', error);
        }
    }
    detectFieldType(element) {
        const signals = this.gatherSignals(element);
        const scores = this.calculateScores(signals);
        const bestMatch = this.findBestMatch(scores);
        const correctedType = this.applyLearning(element, bestMatch);
        return correctedType;
    }
    gatherSignals(element) {
        return {
            attributes: this.getElementAttributes(element),
            context: this.getElementContext(element),
            structure: this.getStructuralContext(element),
            visual: this.getVisualSignals(element),
            behavioral: this.getBehavioralSignals(element)
        };
    }
    getElementAttributes(element) {
        return {
            name: (element.name || '').toLowerCase(),
            id: (element.id || '').toLowerCase(),
            className: (element.className || '').toLowerCase(),
            placeholder: (element.placeholder || '').toLowerCase(),
            type: (element.type || '').toLowerCase(),
            autocomplete: (element.autocomplete || '').toLowerCase(),
            title: (element.title || '').toLowerCase(),
            ariaLabel: (element.getAttribute('aria-label') || '').toLowerCase(),
            dataTestId: (element.getAttribute('data-testid') || '').toLowerCase()
        };
    }
    getElementContext(element) {
        const label = this.getAssociatedLabel(element);
        const parentText = this.getParentContext(element);
        const siblingText = this.getSiblingContext(element);
        return {
            label: label.toLowerCase(),
            parentText: parentText.toLowerCase(),
            siblingText: siblingText.toLowerCase(),
            pageContext: this.getPageContext()
        };
    }
    getAssociatedLabel(element) {
        const inputElement = element;
        if (inputElement.labels && inputElement.labels.length > 0) {
            const label = inputElement.labels[0];
            return label?.textContent?.trim() || '';
        }
        if (element.id) {
            const label = document.querySelector(`label[for="${element.id}"]`);
            if (label)
                return label.textContent?.trim() || '';
        }
        const parentLabel = element.closest('label');
        if (parentLabel)
            return parentLabel.textContent?.trim() || '';
        let prev = element.previousElementSibling;
        while (prev && prev.tagName !== 'INPUT') {
            if (prev.tagName === 'LABEL' || (prev.textContent?.trim().length || 0) < 100) {
                return prev.textContent?.trim() || '';
            }
            prev = prev.previousElementSibling;
        }
        return '';
    }
    getParentContext(element) {
        const parent = element.parentElement;
        if (!parent)
            return '';
        const clone = parent.cloneNode(true);
        const inputs = clone.querySelectorAll('input, textarea, select');
        inputs.forEach(input => input.remove());
        return clone.textContent?.trim() || '';
    }
    getSiblingContext(element) {
        const siblings = Array.from(element.parentElement?.children || []);
        const elementIndex = siblings.indexOf(element);
        const contextText = siblings
            .slice(Math.max(0, elementIndex - 2), elementIndex + 3)
            .filter(sibling => sibling !== element)
            .map(sibling => sibling.textContent?.trim() || '')
            .join(' ');
        return contextText;
    }
    getPageContext() {
        const title = document.title.toLowerCase();
        const url = window.location.href.toLowerCase();
        const headings = Array.from(document.querySelectorAll('h1, h2, h3'))
            .map(h => h.textContent?.trim().toLowerCase() || '')
            .join(' ');
        return { title, url, headings };
    }
    getStructuralContext(element) {
        const form = element.closest('form');
        const fieldset = element.closest('fieldset');
        const section = element.closest('section, div[class*="section"]');
        return {
            formClass: form?.className || '',
            fieldsetLegend: fieldset?.querySelector('legend')?.textContent || '',
            sectionContext: section?.textContent?.substring(0, 200) || '',
            elementPosition: this.getElementPosition(element)
        };
    }
    getElementPosition(element) {
        const form = element.closest('form');
        if (!form)
            return 0;
        const formInputs = Array.from(form.querySelectorAll('input, textarea, select'));
        return formInputs.indexOf(element);
    }
    getVisualSignals(element) {
        const computedStyle = window.getComputedStyle(element);
        const rect = element.getBoundingClientRect();
        const inputElement = element;
        return {
            width: rect.width,
            height: rect.height,
            fontSize: parseFloat(computedStyle.fontSize),
            isVisible: rect.width > 0 && rect.height > 0,
            inputType: inputElement.type || '',
            maxLength: inputElement.maxLength || 0
        };
    }
    getBehavioralSignals(element) {
        const inputElement = element;
        return {
            hasBeenFocused: element.dataset.hasBeenFocused === 'true',
            hasUserInput: (inputElement.value?.length || 0) > 0,
            isRequired: inputElement.required || false,
            hasValidation: !!(inputElement.pattern || inputElement.min || inputElement.max)
        };
    }
    calculateScores(signals) {
        const scores = {};
        for (const [fieldType, patterns] of Object.entries(this.exactPatterns)) {
            let score = 0;
            score += this.calculateExactMatchScore(signals.attributes, patterns);
            score += this.calculateFuzzyMatchScore(signals, fieldType);
            score += this.calculatePatternMatchScore(signals, fieldType);
            score += this.calculateMLContextScore(signals, fieldType);
            score = this.applyUserCorrectionBoost(signals, fieldType, score);
            scores[fieldType] = Math.min(score, 100);
        }
        return scores;
    }
    calculateExactMatchScore(attributes, patterns) {
        let score = 0;
        const attributeValues = Object.values(attributes).join(' ');
        for (const pattern of patterns) {
            if (attributeValues.includes(pattern)) {
                score = Math.max(score, this.EXACT_MATCH_SCORE);
            }
        }
        return score;
    }
    calculateFuzzyMatchScore(signals, fieldType) {
        const fuzzyPatterns = this.fuzzyPatterns[fieldType] || [];
        const textToSearch = [
            signals.attributes.name,
            signals.attributes.id,
            signals.attributes.placeholder,
            signals.context.label,
            signals.context.parentText
        ].join(' ');
        let maxScore = 0;
        for (const pattern of fuzzyPatterns) {
            if (pattern.test(textToSearch)) {
                maxScore = Math.max(maxScore, this.FUZZY_MATCH_SCORE);
            }
        }
        return maxScore;
    }
    calculatePatternMatchScore(signals, fieldType) {
        const patterns = this.commonPatterns[fieldType] || [];
        const testValue = signals.attributes.placeholder || signals.behavioral.hasUserInput.toString();
        let score = 0;
        for (const pattern of patterns) {
            if (pattern.test(testValue)) {
                score = Math.max(score, this.PATTERN_MATCH_SCORE);
            }
        }
        return score;
    }
    calculateMLContextScore(signals, fieldType) {
        let contextScore = 0;
        const allText = [
            signals.context.label,
            signals.context.parentText,
            signals.context.pageContext.title,
            signals.context.pageContext.headings,
            signals.structure.sectionContext
        ].join(' ').toLowerCase();
        for (const [contextType, vector] of this.contextVectors.entries()) {
            let relevance = 0;
            for (const keyword of vector.keywords) {
                if (allText.includes(keyword)) {
                    relevance += vector.weight;
                }
            }
            const contextFieldMapping = {
                'personal': ['firstName', 'lastName', 'fullName', 'email', 'phone'],
                'address': ['street', 'city', 'state', 'zip', 'country'],
                'payment': ['cardNumber', 'cvv', 'expiryDate'],
                'work': ['company', 'jobTitle', 'website', 'linkedin']
            };
            if (contextFieldMapping[contextType]?.includes(fieldType)) {
                contextScore = Math.max(contextScore, relevance * this.ML_CONTEXT_SCORE);
            }
        }
        return Math.min(contextScore, this.ML_CONTEXT_SCORE);
    }
    applyUserCorrectionBoost(signals, fieldType, baseScore) {
        const elementSignature = this.createElementSignature(signals);
        const correction = this.userCorrections.get(elementSignature);
        if (correction) {
            if (correction.correctedType === fieldType) {
                return baseScore + 30;
            }
            else if (correction.rejectedTypes?.includes(fieldType)) {
                return Math.max(0, baseScore - 30);
            }
        }
        return baseScore;
    }
    createElementSignature(signals) {
        const signature = [
            signals.attributes.name,
            signals.attributes.id,
            signals.context.label,
            signals.structure.elementPosition.toString()
        ].filter(Boolean).join('|');
        return signature;
    }
    findBestMatch(scores) {
        let bestType = null;
        let bestScore = 0;
        for (const [fieldType, score] of Object.entries(scores)) {
            if (score >= this.SCORE_THRESHOLD && score > bestScore) {
                bestScore = score;
                bestType = fieldType;
            }
        }
        return bestType ? {
            type: bestType,
            score: bestScore,
            confidence: this.calculateConfidence(bestScore),
            method: 'enhanced'
        } : null;
    }
    calculateConfidence(score) {
        if (score >= 90)
            return 'high';
        if (score >= 70)
            return 'medium';
        if (score >= this.SCORE_THRESHOLD)
            return 'low';
        return 'none';
    }
    applyLearning(element, detection) {
        if (!detection)
            return null;
        const signals = this.gatherSignals(element);
        const signature = this.createElementSignature(signals);
        const correction = this.userCorrections.get(signature);
        if (correction && correction.correctedType !== detection.type) {
            return {
                type: correction.correctedType,
                score: (detection.score || 0) + 30,
                confidence: 'learned',
                isLearned: true,
                method: 'ml'
            };
        }
        return detection;
    }
    async recordUserCorrection(element, detectedType, correctedType) {
        const signals = this.gatherSignals(element);
        const signature = this.createElementSignature(signals);
        this.userCorrections.set(signature, {
            detectedType,
            correctedType,
            timestamp: Date.now(),
            signals: signals
        });
        this.learningData.push({
            signature,
            detectedType,
            correctedType,
            signals,
            timestamp: Date.now()
        });
        if (this.learningData.length > 1000) {
            this.learningData = this.learningData.slice(-800);
        }
        await this.saveLearningData();
        console.log(`Learned correction: ${detectedType} -> ${correctedType} for element ${signature}`);
    }
    getDetectionDetails(element) {
        const signals = this.gatherSignals(element);
        const scores = this.calculateScores(signals);
        const bestMatch = this.findBestMatch(scores);
        return {
            element,
            signals,
            scores,
            detection: bestMatch,
            threshold: this.SCORE_THRESHOLD
        };
    }
    async retrainModel() {
        if (this.learningData.length < 10)
            return;
        console.log('Retraining model with', this.learningData.length, 'corrections');
        const correctionPatterns = {};
        for (const correction of this.learningData) {
            const key = `${correction.detectedType}->${correction.correctedType}`;
            if (!correctionPatterns[key]) {
                correctionPatterns[key] = [];
            }
            correctionPatterns[key].push(correction.signals);
        }
        for (const [pattern, signals] of Object.entries(correctionPatterns)) {
            if (signals.length >= 3) {
                await this.updatePatternsFromCorrections(pattern, signals);
            }
        }
        console.log('Model retrained with', Object.keys(correctionPatterns).length, 'patterns');
    }
    async updatePatternsFromCorrections(pattern, signals) {
        const commonAttributes = this.findCommonAttributes(signals);
        const [, correctedType] = pattern.split('->');
        if (correctedType && commonAttributes.commonWords.length > 0) {
            if (!this.fuzzyPatterns[correctedType]) {
                this.fuzzyPatterns[correctedType] = [];
            }
            for (const word of commonAttributes.commonWords) {
                const escapedWord = word.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
                const newPattern = new RegExp(escapedWord, 'i');
                if (!this.fuzzyPatterns[correctedType].some((p) => p.source === newPattern.source)) {
                    this.fuzzyPatterns[correctedType].push(newPattern);
                }
            }
        }
    }
    findCommonAttributes(signals) {
        const words = new Map();
        const attributes = new Map();
        for (const signal of signals) {
            const text = [
                signal.context.label,
                signal.context.parentText,
                signal.attributes.placeholder
            ].join(' ').toLowerCase();
            const textWords = text.match(/\b\w{3,}\b/g) || [];
            for (const word of textWords) {
                words.set(word, (words.get(word) || 0) + 1);
            }
            for (const [attr, value] of Object.entries(signal.attributes)) {
                if (value) {
                    attributes.set(`${attr}:${value}`, (attributes.get(`${attr}:${value}`) || 0) + 1);
                }
            }
        }
        const threshold = Math.ceil(signals.length * 0.6);
        return {
            commonWords: Array.from(words.entries())
                .filter(([, count]) => count >= threshold)
                .map(([word]) => word),
            commonAttributes: Array.from(attributes.entries())
                .filter(([, count]) => count >= threshold)
                .map(([attr]) => attr)
        };
    }
}
// Export for use in content script
if (typeof module !== 'undefined' && module.exports) {
    module.exports = EnhancedFieldDetector;
}
else if (typeof window !== 'undefined') {
    window.EnhancedFieldDetector = EnhancedFieldDetector;
}
export default EnhancedFieldDetector;
//# sourceMappingURL=detector.js.map