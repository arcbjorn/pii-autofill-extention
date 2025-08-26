// Optimized cache management system for field detection and storage
class CacheManager {
    constructor() {
        this.fieldCache = new Map();
        this.storageCache = new Map();
        this.urlPatternCache = new Map();
        
        this.config = {
            fieldCacheTimeout: 5 * 60 * 1000, // 5 minutes
            storageCacheTimeout: 30 * 60 * 1000, // 30 minutes
            urlCacheTimeout: 10 * 60 * 1000, // 10 minutes
            maxFieldCacheSize: 200,
            maxStorageCacheSize: 50,
            maxUrlCacheSize: 100,
            cleanupInterval: 2 * 60 * 1000 // 2 minutes
        };

        this.setupCleanupInterval();
        this.setupStorageOptimization();
    }

    // Field detection cache
    getCachedFieldDetection(fieldKey, context = {}) {
        const cacheKey = this.generateFieldCacheKey(fieldKey, context);
        const cached = this.fieldCache.get(cacheKey);
        
        if (cached && this.isCacheValid(cached, this.config.fieldCacheTimeout)) {
            cached.hits = (cached.hits || 0) + 1;
            cached.lastAccessed = Date.now();
            return cached.data;
        }
        
        return null;
    }

    setCachedFieldDetection(fieldKey, data, context = {}) {
        const cacheKey = this.generateFieldCacheKey(fieldKey, context);
        
        this.ensureCacheSize(this.fieldCache, this.config.maxFieldCacheSize);
        
        this.fieldCache.set(cacheKey, {
            data,
            timestamp: Date.now(),
            lastAccessed: Date.now(),
            hits: 1,
            context
        });
    }

    generateFieldCacheKey(fieldKey, context) {
        const contextKey = context.url ? new URL(context.url).hostname : '';
        return `${fieldKey}_${contextKey}_${context.formId || 'no-form'}`;
    }

    // Storage cache for frequently accessed data
    async getCachedStorage(key, storageType = 'sync') {
        const cacheKey = `${storageType}_${key}`;
        const cached = this.storageCache.get(cacheKey);
        
        if (cached && this.isCacheValid(cached, this.config.storageCacheTimeout)) {
            return cached.data;
        }
        
        // Fetch from Chrome storage if not cached
        try {
            const result = await chrome.storage[storageType].get(key);
            const data = result[key];
            
            if (data) {
                this.setCachedStorage(key, data, storageType);
            }
            
            return data;
        } catch (error) {
            console.error('Storage cache fetch error:', error);
            return null;
        }
    }

    setCachedStorage(key, data, storageType = 'sync') {
        const cacheKey = `${storageType}_${key}`;
        
        this.ensureCacheSize(this.storageCache, this.config.maxStorageCacheSize);
        
        this.storageCache.set(cacheKey, {
            data,
            timestamp: Date.now(),
            storageType
        });
    }

    // Invalidate storage cache when data changes
    invalidateStorageCache(key, storageType = 'sync') {
        const cacheKey = `${storageType}_${key}`;
        this.storageCache.delete(cacheKey);
    }

    // URL pattern matching cache
    getCachedUrlPattern(url) {
        const domain = this.extractDomain(url);
        const cached = this.urlPatternCache.get(domain);
        
        if (cached && this.isCacheValid(cached, this.config.urlCacheTimeout)) {
            return cached.data;
        }
        
        return null;
    }

    setCachedUrlPattern(url, patterns) {
        const domain = this.extractDomain(url);
        
        this.ensureCacheSize(this.urlPatternCache, this.config.maxUrlCacheSize);
        
        this.urlPatternCache.set(domain, {
            data: patterns,
            timestamp: Date.now(),
            url: domain
        });
    }

    extractDomain(url) {
        try {
            return new URL(url).hostname;
        } catch {
            return url;
        }
    }

    // Batch storage operations
    async batchStorageOperation(operations) {
        const batches = {
            sync: { get: [], set: {} },
            local: { get: [], set: {} }
        };

        // Group operations by storage type
        for (const op of operations) {
            const storageType = op.storageType || 'sync';
            
            if (op.action === 'get') {
                batches[storageType].get.push(op.key);
            } else if (op.action === 'set') {
                batches[storageType].set[op.key] = op.value;
            }
        }

        const results = {};

        // Execute batched operations
        for (const [storageType, batch] of Object.entries(batches)) {
            try {
                // Batch get operations
                if (batch.get.length > 0) {
                    const getResults = await chrome.storage[storageType].get(batch.get);
                    Object.assign(results, getResults);
                    
                    // Cache the results
                    for (const [key, value] of Object.entries(getResults)) {
                        if (value !== undefined) {
                            this.setCachedStorage(key, value, storageType);
                        }
                    }
                }

                // Batch set operations
                if (Object.keys(batch.set).length > 0) {
                    await chrome.storage[storageType].set(batch.set);
                    
                    // Update cache
                    for (const [key, value] of Object.entries(batch.set)) {
                        this.setCachedStorage(key, value, storageType);
                    }
                }

            } catch (error) {
                console.error(`Batch ${storageType} storage error:`, error);
            }
        }

        return results;
    }

    // Optimized storage with compression for large data
    async setCompressedStorage(key, data, storageType = 'sync') {
        try {
            const jsonString = JSON.stringify(data);
            
            // Compress large data sets
            if (jsonString.length > 1000) {
                const compressed = await this.compressData(jsonString);
                await chrome.storage[storageType].set({
                    [key]: {
                        compressed: true,
                        data: compressed,
                        timestamp: Date.now()
                    }
                });
            } else {
                await chrome.storage[storageType].set({
                    [key]: {
                        compressed: false,
                        data: data,
                        timestamp: Date.now()
                    }
                });
            }

            this.setCachedStorage(key, data, storageType);

        } catch (error) {
            console.error('Compressed storage error:', error);
        }
    }

    async getCompressedStorage(key, storageType = 'sync') {
        try {
            // Check cache first
            const cached = await this.getCachedStorage(key, storageType);
            if (cached) return cached;

            const result = await chrome.storage[storageType].get(key);
            const stored = result[key];
            
            if (!stored) return null;

            let data;
            if (stored.compressed) {
                data = await this.decompressData(stored.data);
                data = JSON.parse(data);
            } else {
                data = stored.data;
            }

            this.setCachedStorage(key, data, storageType);
            return data;

        } catch (error) {
            console.error('Compressed storage retrieval error:', error);
            return null;
        }
    }

    // Simple compression using browser's CompressionStream if available
    async compressData(data) {
        if (typeof CompressionStream !== 'undefined') {
            try {
                const stream = new CompressionStream('gzip');
                const writer = stream.writable.getWriter();
                const reader = stream.readable.getReader();

                writer.write(new TextEncoder().encode(data));
                writer.close();

                const chunks = [];
                let done = false;
                while (!done) {
                    const { value, done: readerDone } = await reader.read();
                    done = readerDone;
                    if (value) chunks.push(value);
                }

                return Array.from(new Uint8Array(chunks.reduce((acc, chunk) => [...acc, ...chunk], [])));
            } catch (error) {
                console.warn('Compression failed, storing uncompressed:', error);
                return data;
            }
        }
        
        return data; // Fallback to uncompressed
    }

    async decompressData(compressedData) {
        if (typeof DecompressionStream !== 'undefined' && Array.isArray(compressedData)) {
            try {
                const stream = new DecompressionStream('gzip');
                const writer = stream.writable.getWriter();
                const reader = stream.readable.getReader();

                writer.write(new Uint8Array(compressedData));
                writer.close();

                const chunks = [];
                let done = false;
                while (!done) {
                    const { value, done: readerDone } = await reader.read();
                    done = readerDone;
                    if (value) chunks.push(value);
                }

                return new TextDecoder().decode(new Uint8Array(chunks.reduce((acc, chunk) => [...acc, ...chunk], [])));
            } catch (error) {
                console.warn('Decompression failed:', error);
                return compressedData;
            }
        }
        
        return compressedData; // Fallback
    }

    // Cache utilities
    isCacheValid(cacheEntry, timeout) {
        return Date.now() - cacheEntry.timestamp < timeout;
    }

    ensureCacheSize(cache, maxSize) {
        if (cache.size >= maxSize) {
            // Remove least recently used entries
            const entries = Array.from(cache.entries());
            entries.sort((a, b) => {
                const aAccessed = a[1].lastAccessed || a[1].timestamp;
                const bAccessed = b[1].lastAccessed || b[1].timestamp;
                return aAccessed - bAccessed;
            });

            // Remove oldest 20% of entries
            const toRemove = Math.floor(maxSize * 0.2);
            for (let i = 0; i < toRemove; i++) {
                cache.delete(entries[i][0]);
            }
        }
    }

    setupCleanupInterval() {
        setInterval(() => {
            this.cleanup();
        }, this.config.cleanupInterval);
    }

    cleanup() {
        const now = Date.now();

        // Clean field cache
        for (const [key, value] of this.fieldCache.entries()) {
            if (now - value.timestamp > this.config.fieldCacheTimeout) {
                this.fieldCache.delete(key);
            }
        }

        // Clean storage cache
        for (const [key, value] of this.storageCache.entries()) {
            if (now - value.timestamp > this.config.storageCacheTimeout) {
                this.storageCache.delete(key);
            }
        }

        // Clean URL pattern cache
        for (const [key, value] of this.urlPatternCache.entries()) {
            if (now - value.timestamp > this.config.urlCacheTimeout) {
                this.urlPatternCache.delete(key);
            }
        }
    }

    setupStorageOptimization() {
        // Listen for storage changes to invalidate cache
        if (typeof chrome !== 'undefined' && chrome.storage) {
            chrome.storage.onChanged.addListener((changes, namespace) => {
                for (const key of Object.keys(changes)) {
                    this.invalidateStorageCache(key, namespace);
                }
            });
        }
    }

    // Cache statistics for performance monitoring
    getCacheStats() {
        return {
            fieldCache: {
                size: this.fieldCache.size,
                maxSize: this.config.maxFieldCacheSize,
                timeout: this.config.fieldCacheTimeout
            },
            storageCache: {
                size: this.storageCache.size,
                maxSize: this.config.maxStorageCacheSize,
                timeout: this.config.storageCacheTimeout
            },
            urlPatternCache: {
                size: this.urlPatternCache.size,
                maxSize: this.config.maxUrlCacheSize,
                timeout: this.config.urlCacheTimeout
            }
        };
    }

    // Clear all caches
    clearAllCaches() {
        this.fieldCache.clear();
        this.storageCache.clear();
        this.urlPatternCache.clear();
    }
}

// Create global instance
const cacheManager = new CacheManager();

// Make available globally for debugging
if (typeof window !== 'undefined') {
    window.cacheManager = cacheManager;
}

// Export for modules
if (typeof module !== 'undefined' && module.exports) {
    module.exports = CacheManager;
}