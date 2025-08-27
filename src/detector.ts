import type { 
  FieldTypeName, 
  DetectedField,
  UserCorrection,
  LearningData,
  DetectionResult 
} from '../types/extension';

interface ExactPatterns {
  [key: string]: string[];
}

interface FuzzyPatterns {
  [key: string]: RegExp[];
}

interface CommonPatterns {
  [key: string]: RegExp[];
}

interface ContextVector {
  keywords: string[];
  weight: number;
}

interface ElementSignals {
  attributes: ElementAttributes;
  context: ElementContext;
  structure: StructuralContext;
  visual: VisualSignals;
  behavioral: BehavioralSignals;
}

interface ElementAttributes {
  name: string;
  id: string;
  className: string;
  placeholder: string;
  type: string;
  autocomplete: string;
  title: string;
  ariaLabel: string;
  dataTestId: string;
}

interface ElementContext {
  label: string;
  parentText: string;
  siblingText: string;
  pageContext: PageContext;
}

interface PageContext {
  title: string;
  url: string;
  headings: string;
}

interface StructuralContext {
  formClass: string;
  fieldsetLegend: string;
  sectionContext: string;
  elementPosition: number;
}

interface VisualSignals {
  width: number;
  height: number;
  fontSize: number;
  isVisible: boolean;
  inputType: string;
  maxLength: number;
}

interface BehavioralSignals {
  hasBeenFocused: boolean;
  hasUserInput: boolean;
  isRequired: boolean;
  hasValidation: boolean;
}

interface DetectionScores {
  [key: string]: number;
}

interface CorrectionPatterns {
  [key: string]: ElementSignals[];
}

class EnhancedFieldDetector {
    private readonly SCORE_THRESHOLD = 60;
    private readonly EXACT_MATCH_SCORE = 100;
    private readonly FUZZY_MATCH_SCORE = 70;
    private readonly PATTERN_MATCH_SCORE = 50;
    private readonly ML_CONTEXT_SCORE = 40;
    
    private userCorrections: Map<string, UserCorrection>;
    private learningData: LearningData[];
    private contextVectors: Map<string, ContextVector>;
    private exactPatterns: ExactPatterns = {};
    private fuzzyPatterns: FuzzyPatterns = {};
    private commonPatterns: CommonPatterns = {};

    constructor() {
        this.userCorrections = new Map();
        this.learningData = [];
        this.contextVectors = new Map();
        this.init();
    }

    async init(): Promise<void> {
        await this.loadLearningData();
        this.initializeContextVectors();
        this.setupPatterns();
    }

    private setupPatterns(): void {
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
            cardNumber: ['cardnumber', 'card_number', 'ccnumber', 'cc_number'],
            cvv: ['cvv', 'cvc', 'security_code', 'card_code'],
            expiryDate: ['expiry', 'exp_date', 'expiration', 'exp'],
            company: ['company', 'organization', 'employer', 'workplace'],
            jobTitle: ['job_title', 'position', 'title', 'role'],
            website: ['website', 'url', 'web_site', 'homepage'],
            linkedin: ['linkedin', 'linked_in', 'profile_url']
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
            cardNumber: [/card.*number/i, /credit.*card/i, /cc.*num/i],
            cvv: [/security.*code/i, /cvv.*code/i, /card.*verification/i],
            company: [/company.*name/i, /organization.*name/i],
            jobTitle: [/job.*title/i, /work.*title/i, /position.*title/i]
        };

        this.commonPatterns = {
            firstName: [/^fn$/i, /^givenname$/i, /first$/i],
            lastName: [/^ln$/i, /^familyname$/i, /last$/i],
            email: [/@/i, /mail$/i, /^em$/i],
            phone: [/^\d{3}[-.\s]?\d{3}[-.\s]?\d{4}$/, /tel$/i, /ph$/i],
            zip: [/^\d{5}(-\d{4})?$/, /postal$/i, /^zip$/i],
            cardNumber: [/^\d{4}[-\s]?\d{4}[-\s]?\d{4}[-\s]?\d{4}$/, /card$/i],
            cvv: [/^\d{3,4}$/, /security$/i]
        };
    }

    private initializeContextVectors(): void {
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

    private async loadLearningData(): Promise<void> {
        try {
            const result = await chrome.storage.local.get(['userCorrections', 'learningData']);
            this.userCorrections = new Map(result.userCorrections || []);
            this.learningData = result.learningData || [];
        } catch (error) {
            console.error('Error loading learning data:', error);
        }
    }

    private async saveLearningData(): Promise<void> {
        try {
            await chrome.storage.local.set({
                userCorrections: Array.from(this.userCorrections.entries()),
                learningData: this.learningData
            });
        } catch (error) {
            console.error('Error saving learning data:', error);
        }
    }

    public detectFieldType(element: HTMLInputElement | HTMLSelectElement | HTMLTextAreaElement): DetectionResult | null {
        const signals = this.gatherSignals(element);
        const scores = this.calculateScores(signals);
        const bestMatch = this.findBestMatch(scores);
        
        const correctedType = this.applyLearning(element, bestMatch);
        return correctedType;
    }

    private gatherSignals(element: HTMLInputElement | HTMLSelectElement | HTMLTextAreaElement): ElementSignals {
        return {
            attributes: this.getElementAttributes(element),
            context: this.getElementContext(element),
            structure: this.getStructuralContext(element),
            visual: this.getVisualSignals(element),
            behavioral: this.getBehavioralSignals(element)
        };
    }

    private getElementAttributes(element: HTMLInputElement | HTMLSelectElement | HTMLTextAreaElement): ElementAttributes {
        return {
            name: (element.name || '').toLowerCase(),
            id: (element.id || '').toLowerCase(),
            className: (element.className || '').toLowerCase(),
            placeholder: ((element as HTMLInputElement).placeholder || '').toLowerCase(),
            type: ((element as HTMLInputElement).type || '').toLowerCase(),
            autocomplete: (element.autocomplete || '').toLowerCase(),
            title: (element.title || '').toLowerCase(),
            ariaLabel: (element.getAttribute('aria-label') || '').toLowerCase(),
            dataTestId: (element.getAttribute('data-testid') || '').toLowerCase()
        };
    }

    private getElementContext(element: HTMLElement): ElementContext {
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

    private getAssociatedLabel(element: HTMLElement): string {
        const inputElement = element as HTMLInputElement;
        
        if (inputElement.labels && inputElement.labels.length > 0) {
            return inputElement.labels[0].textContent?.trim() || '';
        }
        
        if (element.id) {
            const label = document.querySelector(`label[for="${element.id}"]`);
            if (label) return label.textContent?.trim() || '';
        }
        
        const parentLabel = element.closest('label');
        if (parentLabel) return parentLabel.textContent?.trim() || '';
        
        let prev = element.previousElementSibling;
        while (prev && prev.tagName !== 'INPUT') {
            if (prev.tagName === 'LABEL' || (prev.textContent?.trim().length || 0) < 100) {
                return prev.textContent?.trim() || '';
            }
            prev = prev.previousElementSibling;
        }
        
        return '';
    }

    private getParentContext(element: HTMLElement): string {
        const parent = element.parentElement;
        if (!parent) return '';
        
        const clone = parent.cloneNode(true) as HTMLElement;
        const inputs = clone.querySelectorAll('input, textarea, select');
        inputs.forEach(input => input.remove());
        
        return clone.textContent?.trim() || '';
    }

    private getSiblingContext(element: HTMLElement): string {
        const siblings = Array.from(element.parentElement?.children || []);
        const elementIndex = siblings.indexOf(element);
        
        const contextText = siblings
            .slice(Math.max(0, elementIndex - 2), elementIndex + 3)
            .filter(sibling => sibling !== element)
            .map(sibling => sibling.textContent?.trim() || '')
            .join(' ');
            
        return contextText;
    }

    private getPageContext(): PageContext {
        const title = document.title.toLowerCase();
        const url = window.location.href.toLowerCase();
        const headings = Array.from(document.querySelectorAll('h1, h2, h3'))
            .map(h => h.textContent?.trim().toLowerCase() || '')
            .join(' ');
            
        return { title, url, headings };
    }

    private getStructuralContext(element: HTMLElement): StructuralContext {
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

    private getElementPosition(element: HTMLElement): number {
        const form = element.closest('form');
        if (!form) return 0;
        
        const formInputs = Array.from(form.querySelectorAll('input, textarea, select'));
        return formInputs.indexOf(element);
    }

    private getVisualSignals(element: HTMLElement): VisualSignals {
        const computedStyle = window.getComputedStyle(element);
        const rect = element.getBoundingClientRect();
        const inputElement = element as HTMLInputElement;
        
        return {
            width: rect.width,
            height: rect.height,
            fontSize: parseFloat(computedStyle.fontSize),
            isVisible: rect.width > 0 && rect.height > 0,
            inputType: inputElement.type || '',
            maxLength: inputElement.maxLength || 0
        };
    }

    private getBehavioralSignals(element: HTMLElement): BehavioralSignals {
        const inputElement = element as HTMLInputElement;
        
        return {
            hasBeenFocused: element.dataset.hasBeenFocused === 'true',
            hasUserInput: (inputElement.value?.length || 0) > 0,
            isRequired: inputElement.required || false,
            hasValidation: !!(inputElement.pattern || inputElement.min || inputElement.max)
        };
    }

    private calculateScores(signals: ElementSignals): DetectionScores {
        const scores: DetectionScores = {};
        
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

    private calculateExactMatchScore(attributes: ElementAttributes, patterns: string[]): number {
        let score = 0;
        const attributeValues = Object.values(attributes).join(' ');
        
        for (const pattern of patterns) {
            if (attributeValues.includes(pattern)) {
                score = Math.max(score, this.EXACT_MATCH_SCORE);
            }
        }
        
        return score;
    }

    private calculateFuzzyMatchScore(signals: ElementSignals, fieldType: string): number {
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

    private calculatePatternMatchScore(signals: ElementSignals, fieldType: string): number {
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

    private calculateMLContextScore(signals: ElementSignals, fieldType: string): number {
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
            
            const contextFieldMapping: { [key: string]: string[] } = {
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

    private applyUserCorrectionBoost(signals: ElementSignals, fieldType: string, baseScore: number): number {
        const elementSignature = this.createElementSignature(signals);
        const correction = this.userCorrections.get(elementSignature);
        
        if (correction) {
            if (correction.correctedType === fieldType) {
                return baseScore + 30;
            } else if (correction.rejectedTypes?.includes(fieldType)) {
                return Math.max(0, baseScore - 30);
            }
        }
        
        return baseScore;
    }

    private createElementSignature(signals: ElementSignals): string {
        const signature = [
            signals.attributes.name,
            signals.attributes.id,
            signals.context.label,
            signals.structure.elementPosition.toString()
        ].filter(Boolean).join('|');
        
        return signature;
    }

    private findBestMatch(scores: DetectionScores): DetectionResult | null {
        let bestType: string | null = null;
        let bestScore = 0;
        
        for (const [fieldType, score] of Object.entries(scores)) {
            if (score >= this.SCORE_THRESHOLD && score > bestScore) {
                bestScore = score;
                bestType = fieldType;
            }
        }
        
        return bestType ? {
            type: bestType as FieldTypeName,
            score: bestScore,
            confidence: this.calculateConfidence(bestScore)
        } : null;
    }

    private calculateConfidence(score: number): 'high' | 'medium' | 'low' | 'none' {
        if (score >= 90) return 'high';
        if (score >= 70) return 'medium';
        if (score >= this.SCORE_THRESHOLD) return 'low';
        return 'none';
    }

    private applyLearning(element: HTMLInputElement | HTMLSelectElement | HTMLTextAreaElement, detection: DetectionResult | null): DetectionResult | null {
        if (!detection) return null;
        
        const signals = this.gatherSignals(element);
        const signature = this.createElementSignature(signals);
        const correction = this.userCorrections.get(signature);
        
        if (correction && correction.correctedType !== detection.type) {
            return {
                type: correction.correctedType as FieldTypeName,
                score: detection.score + 30,
                confidence: 'learned',
                isLearned: true
            };
        }
        
        return detection;
    }

    public async recordUserCorrection(
        element: HTMLInputElement | HTMLSelectElement | HTMLTextAreaElement,
        detectedType: string,
        correctedType: string
    ): Promise<void> {
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

    public getDetectionDetails(element: HTMLInputElement | HTMLSelectElement | HTMLTextAreaElement) {
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

    public async retrainModel(): Promise<void> {
        if (this.learningData.length < 10) return;
        
        console.log('Retraining model with', this.learningData.length, 'corrections');
        
        const correctionPatterns: CorrectionPatterns = {};
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

    private async updatePatternsFromCorrections(pattern: string, signals: ElementSignals[]): Promise<void> {
        const commonAttributes = this.findCommonAttributes(signals);
        const [, correctedType] = pattern.split('->');
        
        if (commonAttributes.commonWords.length > 0) {
            if (!this.fuzzyPatterns[correctedType]) {
                this.fuzzyPatterns[correctedType] = [];
            }
            
            for (const word of commonAttributes.commonWords) {
                const escapedWord = word.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
                const newPattern = new RegExp(escapedWord, 'i');
                
                if (!this.fuzzyPatterns[correctedType].some(p => p.source === newPattern.source)) {
                    this.fuzzyPatterns[correctedType].push(newPattern);
                }
            }
        }
    }

    private findCommonAttributes(signals: ElementSignals[]): { commonWords: string[]; commonAttributes: string[] } {
        const words = new Map<string, number>();
        const attributes = new Map<string, number>();
        
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
} else if (typeof window !== 'undefined') {
    (window as any).EnhancedFieldDetector = EnhancedFieldDetector;
}

export default EnhancedFieldDetector;