"use strict";

import { StorageOperation, StorageStats, CompressedData } from '../types/extension';

// Optimized storage manager with efficient Chrome storage usage
export class OptimizedStorageManager {
    private cache = new Map<string, { data: any; timestamp: number; storageType: 'sync' | 'local' }>();
    private pendingWrites = new Map<string, any>();
    private writeQueue: Array<{
        key: string;
        data: any;
        storageType: 'sync' | 'local';
        options: any;
        timestamp: number;
    }> = [];
    private isProcessingQueue = false;
    
    private config = {
        syncQuotaBytes: 100 * 1024, // 100KB Chrome sync limit
        localQuotaBytes: 5 * 1024 * 1024, // 5MB Chrome local limit
        maxItemSizeSync: 8 * 1024, // 8KB per item sync limit
        maxItemSizeLocal: 1024 * 1024, // 1MB per item local limit
        batchDelay: 50, // ms delay for batching writes
        cacheTimeout: 5 * 60 * 1000, // 5 minutes
        compressionThreshold: 1000 // bytes
    };
    
    private quotaUsage = {
        sync: 0,
        local: 0
    };

    constructor() {
        this.initializeQuotaTracking();
        this.setupWriteQueue();
    }

    // Initialize quota tracking
    private async initializeQuotaTracking(): Promise<void> {
        try {
            const [syncUsage, localUsage] = await Promise.all([
                chrome.storage.sync.getBytesInUse(),
                chrome.storage.local.getBytesInUse()
            ]);
            
            this.quotaUsage.sync = syncUsage;
            this.quotaUsage.local = localUsage;
            
            console.log('📊 Storage quota usage:', {
                sync: `${syncUsage} / ${this.config.syncQuotaBytes} bytes`,
                local: `${localUsage} / ${this.config.localQuotaBytes} bytes`
            });
        } catch (error) {
            console.error('Failed to initialize quota tracking:', error);
        }
    }

    // Smart storage type selection based on data characteristics
    private determineOptimalStorage(key: string, data: any): 'sync' | 'local' {
        const dataSize = this.estimateDataSize(data);
        const isSensitive = this.isSensitiveData(key, data);
        const isFrequentlyAccessed = this.isFrequentlyAccessed(key);

        // Sensitive data always goes to local storage
        if (isSensitive) {
            return 'local';
        }

        // Large data goes to local storage
        if (dataSize > this.config.maxItemSizeSync) {
            return 'local';
        }

        // Check quota availability
        if (this.quotaUsage.sync + dataSize > this.config.syncQuotaBytes * 0.8) {
            return 'local';
        }

        // Frequently accessed small data can use sync for cross-device availability
        if (isFrequentlyAccessed && dataSize < 1024) {
            return 'sync';
        }

        // Default to local for better performance
        return 'local';
    }

    private isSensitiveData(key: string, data: any): boolean {
        const sensitiveKeys = ['cardNumber', 'cvv', 'password', 'encryptionKey', 'privateKey'];
        return sensitiveKeys.some(sensitive => 
            key.toLowerCase().includes(sensitive) ||
            (typeof data === 'object' && JSON.stringify(data).toLowerCase().includes(sensitive))
        );
    }

    private isFrequentlyAccessed(key: string): boolean {
        const frequentKeys = ['profiles', 'settings', 'customFields', 'recentFields'];
        return frequentKeys.some(frequent => key.includes(frequent));
    }

    private estimateDataSize(data: any): number {
        try {
            return new Blob([JSON.stringify(data)]).size;
        } catch {
            return String(data).length * 2; // Rough estimate
        }
    }

    // Optimized get with intelligent caching
    async get(key: string, options: { storageType?: 'sync' | 'local' } = {}): Promise<any> {
        const storageType = options.storageType || this.determineOptimalStorage(key, null);
        const cacheKey = `${storageType}_${key}`;

        // Check cache first
        const cached = this.cache.get(cacheKey);
        if (cached && Date.now() - cached.timestamp < this.config.cacheTimeout) {
            return cached.data;
        }

        try {
            const result = await chrome.storage[storageType].get(key);
            const data = result[key];

            // Cache the result
            if (data !== undefined) {
                this.cache.set(cacheKey, {
                    data,
                    timestamp: Date.now(),
                    storageType
                });
            }

            return data;
        } catch (error) {
            console.error(`Storage get error for ${key}:`, error);
            return null;
        }
    }

    // Batch get for multiple keys
    async getBatch(keys: string[], options: { storageType?: 'sync' | 'local' } = {}): Promise<Record<string, any>> {
        const batches: {
            sync: string[],
            local: string[]
        } = { sync: [], local: [] };
        const results: Record<string, any> = {};

        // Group keys by optimal storage type
        for (const key of keys) {
            const storageType = options.storageType || this.determineOptimalStorage(key, null);
            batches[storageType].push(key);
        }

        // Execute batched gets
        const promises: Promise<void>[] = [];
        for (const [storageType, batchKeys] of Object.entries(batches) as ['sync' | 'local', string[]][]) {
            if (batchKeys.length > 0) {
                promises.push(
                    chrome.storage[storageType].get(batchKeys).then(data => {
                        Object.assign(results, data);
                        
                        // Cache results
                        for (const [key, value] of Object.entries(data)) {
                            if (value !== undefined) {
                                this.cache.set(`${storageType}_${key}`, {
                                    data: value,
                                    timestamp: Date.now(),
                                    storageType
                                });
                            }
                        }
                    })
                );
            }
        }

        await Promise.all(promises);
        return results;
    }

    // Optimized set with write queue and compression
    async set(key: string, data: any, options: { storageType?: 'sync' | 'local' } = {}): Promise<void> {
        const storageType = options.storageType || this.determineOptimalStorage(key, data);
        const dataSize = this.estimateDataSize(data);

        // Check quota limits
        if (storageType === 'sync' && this.quotaUsage.sync + dataSize > this.config.syncQuotaBytes * 0.9) {
            console.warn('Sync quota nearly exceeded, switching to local storage');
            return this.set(key, data, { ...options, storageType: 'local' });
        }

        // Handle large data with chunking
        if (dataSize > this.config.maxItemSizeSync && storageType === 'sync') {
            return this.setChunked(key, data, storageType);
        }

        // Add to write queue for batching
        this.queueWrite(key, data, storageType, options);

        // Update cache immediately for consistency
        this.cache.set(`${storageType}_${key}`, {
            data,
            timestamp: Date.now(),
            storageType
        });
    }

    // Queue writes for batching
    private queueWrite(key: string, data: any, storageType: 'sync' | 'local', options: any = {}): void {
        const writeOp = {
            key,
            data,
            storageType,
            options,
            timestamp: Date.now()
        };

        // Cancel any pending write for the same key
        const existingIndex = this.writeQueue.findIndex(op => op.key === key && op.storageType === storageType);
        if (existingIndex >= 0) {
            this.writeQueue[existingIndex] = writeOp;
        } else {
            this.writeQueue.push(writeOp);
        }

        // Process queue if not already processing
        if (!this.isProcessingQueue) {
            setTimeout(() => this.processWriteQueue(), this.config.batchDelay);
        }
    }

    // Process batched writes
    private async processWriteQueue(): Promise<void> {
        if (this.isProcessingQueue || this.writeQueue.length === 0) return;

        this.isProcessingQueue = true;

        try {
            // Group writes by storage type
            const batches: {
                sync: Record<string, any>,
                local: Record<string, any>
            } = { sync: {}, local: {} };
            
            const operations = [...this.writeQueue];
            this.writeQueue = [];

            for (const op of operations) {
                // Apply compression if needed
                let data = op.data;
                if (this.estimateDataSize(data) > this.config.compressionThreshold) {
                    data = await this.compressData(data);
                }
                
                batches[op.storageType][op.key] = data;
            }

            // Execute batched writes
            const promises: Promise<void>[] = [];
            for (const [storageType, batch] of Object.entries(batches) as ['sync' | 'local', Record<string, any>][]) {
                if (Object.keys(batch).length > 0) {
                    promises.push(
                        chrome.storage[storageType].set(batch).then(() => {
                            // Update quota tracking
                            const batchSize = this.estimateDataSize(batch);
                            this.quotaUsage[storageType] += batchSize;
                        })
                    );
                }
            }

            await Promise.all(promises);
        } catch (error) {
            console.error('Batch write error:', error);
        } finally {
            this.isProcessingQueue = false;
            
            // Process any new writes that came in
            if (this.writeQueue.length > 0) {
                setTimeout(() => this.processWriteQueue(), this.config.batchDelay);
            }
        }
    }

    // Chunked storage for large data
    private async setChunked(key: string, data: any, storageType: 'sync' | 'local'): Promise<void> {
        const jsonString = JSON.stringify(data);
        const chunkSize = storageType === 'sync' ? 7000 : 900000; // Leave room for metadata
        const chunks: string[] = [];

        for (let i = 0; i < jsonString.length; i += chunkSize) {
            chunks.push(jsonString.slice(i, i + chunkSize));
        }

        const metadata = {
            chunked: true,
            totalChunks: chunks.length,
            timestamp: Date.now(),
            originalSize: jsonString.length
        };

        // Store metadata
        await chrome.storage[storageType].set({
            [`${key}_meta`]: metadata
        });

        // Store chunks
        const chunkPromises = chunks.map((chunk, index) =>
            chrome.storage[storageType].set({
                [`${key}_chunk_${index}`]: chunk
            })
        );

        await Promise.all(chunkPromises);

        // Update cache
        this.cache.set(`${storageType}_${key}`, {
            data,
            timestamp: Date.now(),
            storageType
        });
    }

    // Get chunked data
    private async getChunked(key: string, storageType: 'sync' | 'local'): Promise<any> {
        try {
            // Get metadata
            const metaResult = await chrome.storage[storageType].get(`${key}_meta`);
            const metadata = metaResult[`${key}_meta`];
            
            if (!metadata || !metadata.chunked) {
                return null;
            }

            // Get all chunks
            const chunkKeys = Array.from({ length: metadata.totalChunks }, (_, i) => `${key}_chunk_${i}`);
            const chunkResults = await chrome.storage[storageType].get(chunkKeys);

            // Reconstruct data
            let jsonString = '';
            for (let i = 0; i < metadata.totalChunks; i++) {
                const chunkKey = `${key}_chunk_${i}`;
                if (chunkResults[chunkKey]) {
                    jsonString += chunkResults[chunkKey];
                }
            }

            return JSON.parse(jsonString);
        } catch (error) {
            console.error('Chunked data retrieval error:', error);
            return null;
        }
    }

    // Simple compression
    private async compressData(data: any): Promise<CompressedData> {
        const jsonString = JSON.stringify(data);
        
        // Simple compression using base64 encoding with gzip if available
        if (typeof CompressionStream !== 'undefined') {
            try {
                const stream = new CompressionStream('gzip');
                const writer = stream.writable.getWriter();
                const reader = stream.readable.getReader();
                
                writer.write(new TextEncoder().encode(jsonString));
                writer.close();

                const chunks: Uint8Array[] = [];
                let done = false;
                while (!done) {
                    const { value, done: readerDone } = await reader.read();
                    done = readerDone;
                    if (value) chunks.push(value);
                }

                const compressed = new Uint8Array(chunks.reduce((acc, chunk) => [...acc, ...chunk], [] as number[]));
                
                return {
                    compressed: true,
                    data: Array.from(compressed),
                    originalSize: jsonString.length,
                    timestamp: Date.now()
                };
            } catch (error) {
                console.warn('Compression failed:', error);
            }
        }

        return {
            compressed: false,
            data: data,
            originalSize: jsonString.length,
            timestamp: Date.now()
        };
    }

    // Remove data and clean up chunks
    async remove(key: string, storageType: 'sync' | 'local' | null = null): Promise<void> {
        if (!storageType) {
            // Try to determine storage type from cache
            const syncCacheKey = `sync_${key}`;
            const localCacheKey = `local_${key}`;
            
            if (this.cache.has(syncCacheKey)) {
                storageType = 'sync';
            } else if (this.cache.has(localCacheKey)) {
                storageType = 'local';
            } else {
                // Check both storage types
                await Promise.all([
                    this.remove(key, 'sync'),
                    this.remove(key, 'local')
                ]);
                return;
            }
        }

        try {
            // Check if it's chunked data
            const metaResult = await chrome.storage[storageType].get(`${key}_meta`);
            const metadata = metaResult[`${key}_meta`];
            
            if (metadata && metadata.chunked) {
                // Remove all chunks
                const keysToRemove = [`${key}_meta`];
                for (let i = 0; i < metadata.totalChunks; i++) {
                    keysToRemove.push(`${key}_chunk_${i}`);
                }
                await chrome.storage[storageType].remove(keysToRemove);
            } else {
                // Remove single item
                await chrome.storage[storageType].remove(key);
            }

            // Remove from cache
            this.cache.delete(`${storageType}_${key}`);
        } catch (error) {
            console.error(`Remove error for ${key}:`, error);
        }
    }

    // Setup periodic write queue processing
    private setupWriteQueue(): void {
        // Ensure writes are processed even if the delay mechanism fails
        setInterval(() => {
            if (this.writeQueue.length > 0 && !this.isProcessingQueue) {
                this.processWriteQueue();
            }
        }, 1000);
    }

    // Storage statistics
    async getStorageStats(): Promise<StorageStats> {
        const [syncUsage, localUsage] = await Promise.all([
            chrome.storage.sync.getBytesInUse().catch(() => 0),
            chrome.storage.local.getBytesInUse().catch(() => 0)
        ]);

        return {
            sync: {
                used: syncUsage,
                quota: this.config.syncQuotaBytes,
                percentage: Math.round((syncUsage / this.config.syncQuotaBytes) * 100)
            },
            local: {
                used: localUsage,
                quota: this.config.localQuotaBytes,
                percentage: Math.round((localUsage / this.config.localQuotaBytes) * 100)
            },
            cache: {
                entries: this.cache.size,
                pendingWrites: this.writeQueue.length
            }
        };
    }

    // Clear expired cache entries
    clearExpiredCache(): void {
        const now = Date.now();
        for (const [key, value] of this.cache.entries()) {
            if (now - value.timestamp > this.config.cacheTimeout) {
                this.cache.delete(key);
            }
        }
    }

    // Flush pending writes immediately
    async flush(): Promise<void> {
        if (this.writeQueue.length > 0) {
            await this.processWriteQueue();
        }
    }
}

// Create optimized storage manager instance
const optimizedStorage = new OptimizedStorageManager();

// Make available globally
if (typeof window !== 'undefined') {
    window.optimizedStorage = optimizedStorage;
}

// Export for both CommonJS and ES modules
export default OptimizedStorageManager;

// CommonJS export for backward compatibility
if (typeof module !== 'undefined' && module.exports) {
    module.exports = OptimizedStorageManager;
}