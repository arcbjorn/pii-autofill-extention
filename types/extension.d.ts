// TypeScript definitions for Chrome Extension and PII Autofill Extension

declare global {
  interface Window {
    PIIAutofillOptimized?: {
      getCacheSize(): number;
      clearCache(): void;
      getPerformanceConfig(): PerformanceConfig;
    };
    cacheManager?: CacheManager;
    optimizedStorage?: OptimizedStorageManager;
    devClient?: DevClient;
    updateManager?: UpdateManager;
    EnhancedFieldDetector?: EnhancedFieldDetector;
    SiteRulesEngine?: SiteRulesEngine;
  }
}

// Core Types
export interface FieldType {
  firstName: string;
  lastName: string;
  fullName: string;
  email: string;
  phone: string;
  street: string;
  city: string;
  state: string;
  zip: string;
  country: string;
  cardNumber: string;
  cvv: string;
  expiryDate: string;
  company: string;
  jobTitle: string;
  website: string;
  linkedin: string;
  password: string;
}

export type FieldTypeName = keyof FieldType;

export interface DetectedField {
  element: HTMLInputElement | HTMLSelectElement | HTMLTextAreaElement;
  type: FieldTypeName;
  confidence: number;
  selector?: string;
  context?: FormContext;
}

export interface DetectionResult {
  type: FieldTypeName;
  confidence: 'high' | 'medium' | 'low' | 'none' | 'learned';
  score?: number;
  isLearned?: boolean;
  method: 'autocomplete' | 'type' | 'pattern' | 'enhanced' | 'ml';
  context?: DetectionContext;
}

export interface UserCorrection {
  detectedType: string;
  correctedType: string;
  timestamp: number;
  signals: any;
  rejectedTypes?: string[];
}

export interface LearningData {
  signature: string;
  detectedType: string;
  correctedType: string;
  signals: any;
  timestamp: number;
}

export interface CustomField {
  name: string;
  type: string;
  value?: string;
  required?: boolean;
}

export interface SiteRule {
  patterns: string[];
  fields: { [selector: string]: any };
  skipFields?: string[];
}

export interface FieldMapping {
  from: string;
  to: string;
  confidence?: number;
}

export interface FormContext {
  formId?: string;
  url: string;
  hostname: string;
  title: string;
  timestamp: number;
}

export interface Profile {
  personal: Partial<FieldType>;
  work: Partial<FieldType>;
  custom: Partial<FieldType>;
}

export interface Settings {
  passwordProtected: boolean;
  syncEnabled: boolean;
  encryptSensitiveFields: boolean;
  autoDetectFields: boolean;
  debugMode: boolean;
}

// Performance Configuration
export interface PerformanceConfig {
  debounceDelay: number;
  cacheTimeout: number;
  maxCacheEntries: number;
  lazyLoadDelay: number;
  observerThrottle: number;
}

// Cache Types
export interface CacheEntry<T = any> {
  data: T;
  timestamp: number;
  lastAccessed?: number;
  hits?: number;
  context?: any;
  storageType?: 'sync' | 'local';
  url?: string;
}

export interface CacheStats {
  fieldCache: {
    size: number;
    maxSize: number;
    timeout: number;
  };
  storageCache: {
    size: number;
    maxSize: number;
    timeout: number;
  };
  urlPatternCache: {
    size: number;
    maxSize: number;
    timeout: number;
  };
}

// Storage Types
export interface StorageOperation {
  action: 'get' | 'set';
  key: string;
  value?: any;
  storageType?: 'sync' | 'local';
}

export interface StorageStats {
  sync: {
    used: number;
    quota: number;
    percentage: number;
  };
  local: {
    used: number;
    quota: number;
    percentage: number;
  };
  cache: {
    entries: number;
    pendingWrites: number;
  };
}

export interface CompressedData {
  compressed: boolean;
  data: any;
  originalSize?: number;
  timestamp: number;
}

// Field Detection Types
export interface FieldPattern {
  [key: string]: RegExp[];
}

export interface AutocompleteMap {
  [autocompleteValue: string]: FieldTypeName;
}


export interface DetectionContext {
  formContext: FormContext;
  surroundingText: string;
  labelText: string;
  placeholderText: string;
  elementAttributes: Record<string, string>;
}

// Site Rules Types
export interface SiteRule {
  hostname: string;
  selectors: Record<FieldTypeName, string>;
  delays: Record<FieldTypeName, number>;
  customHandlers?: Record<FieldTypeName, string>;
  exclusions?: string[];
  metadata?: SiteRuleMetadata;
}

export interface FieldConfig {
  type: string;
  priority: 'low' | 'medium' | 'high';
  sensitive: boolean;
  format?: string;
  element?: HTMLElement;
}

export interface StepInfo {
  step: string;
  fields: { [selector: string]: FieldConfig; };
  nextButton?: string;
  waitForLoad: number;
  skipFields: string[];
}

export interface SiteRuleMetadata {
  name: string;
  version: string;
  description: string;
  author?: string;
  lastUpdated: string;
  tags?: string[];
}

// Message Types
export interface MessageRequest {
  action: string;
  type?: string;
  data?: any;
  tabId?: number;
  timestamp?: number;
  element?: HTMLElement;
  detectedType?: string;
  correctedType?: string;
}

export interface AutofillMessage extends MessageRequest {
  action: 'autofill';
  data: Partial<FieldType>;
  fields?: DetectedField[];
  profileType?: keyof Profile;
}

export interface DetectionMessage extends MessageRequest {
  action: 'getDetectedFields' | 'detectFields';
}

export interface StorageMessage extends MessageRequest {
  action: 'saveProfile' | 'loadProfile' | 'clearCache';
  profileType?: keyof Profile;
  data?: Partial<FieldType>;
}

export interface UpdateMessage extends MessageRequest {
  action: 'checkForUpdates' | 'startUpdate';
}

// Developer Tools Types
export interface DevLogEntry {
  type: 'log';
  level: 'error' | 'warn' | 'info' | 'debug';
  message: string;
  timestamp: number;
  source: 'popup' | 'background' | 'content' | 'extension';
  data?: any;
}

export interface ExtensionInfo {
  id: string;
  version: string;
  manifestVersion: number;
  lastReload?: string;
}

// Update System Types
export interface UpdateInfo {
  version: string;
  downloadUrl: string;
  releaseNotes: string;
  publishedAt: string;
}

export interface UpdateStatus {
  updateAvailable: boolean;
  currentVersion: string;
  latestVersion?: string;
  updateInProgress: boolean;
}

// Error Types
export interface ExtensionError extends Error {
  context?: string;
  severity?: 'low' | 'medium' | 'high' | 'critical';
  metadata?: Record<string, any>;
}

// Utility Types
export type DeepPartial<T> = {
  [P in keyof T]?: T[P] extends object ? DeepPartial<T[P]> : T[P];
};

export type RequiredFields<T, K extends keyof T> = T & Required<Pick<T, K>>;

export type OptionalFields<T, K extends keyof T> = Omit<T, K> & Partial<Pick<T, K>>;

// Event Types for DOM
export interface CustomExtensionEvent extends CustomEvent {
  detail: {
    type: string;
    data?: any;
    timestamp: number;
  };
}

// Export for global usage
export as namespace PIIAutofill;