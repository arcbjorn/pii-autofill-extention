// Encryption utilities for sensitive data
class EncryptionManager {
    constructor() {
        this.algorithm = 'AES-GCM';
        this.keyLength = 256;
        this.ivLength = 12;
        this.tagLength = 16;
        this.key = null;
        this.isInitialized = false;
    }

    async init() {
        if (this.isInitialized) return;

        try {
            // Try to load existing key
            const stored = await chrome.storage.local.get('encryptionKey');
            
            if (stored.encryptionKey) {
                this.key = await this.importKey(stored.encryptionKey);
            } else {
                // Generate new key
                this.key = await this.generateKey();
                const exportedKey = await this.exportKey(this.key);
                await chrome.storage.local.set({ encryptionKey: exportedKey });
            }

            this.isInitialized = true;
            console.log('🔐 Encryption manager initialized');

        } catch (error) {
            console.error('❌ Encryption initialization failed:', error);
            throw error;
        }
    }

    async generateKey() {
        return await crypto.subtle.generateKey(
            {
                name: this.algorithm,
                length: this.keyLength
            },
            true,
            ['encrypt', 'decrypt']
        );
    }

    async exportKey(key) {
        const exported = await crypto.subtle.exportKey('raw', key);
        return Array.from(new Uint8Array(exported));
    }

    async importKey(keyData) {
        const keyBuffer = new Uint8Array(keyData).buffer;
        return await crypto.subtle.importKey(
            'raw',
            keyBuffer,
            { name: this.algorithm },
            false,
            ['encrypt', 'decrypt']
        );
    }

    async encrypt(data) {
        if (!this.isInitialized) {
            await this.init();
        }

        if (!data || typeof data !== 'string') {
            throw new Error('Data must be a non-empty string');
        }

        try {
            // Generate random IV
            const iv = crypto.getRandomValues(new Uint8Array(this.ivLength));
            
            // Encode data
            const encodedData = new TextEncoder().encode(data);

            // Encrypt
            const encrypted = await crypto.subtle.encrypt(
                {
                    name: this.algorithm,
                    iv: iv
                },
                this.key,
                encodedData
            );

            // Return as serializable object
            return {
                encrypted: Array.from(new Uint8Array(encrypted)),
                iv: Array.from(iv),
                algorithm: this.algorithm,
                timestamp: Date.now()
            };

        } catch (error) {
            console.error('❌ Encryption failed:', error);
            throw error;
        }
    }

    async decrypt(encryptedData) {
        if (!this.isInitialized) {
            await this.init();
        }

        if (!encryptedData || !encryptedData.encrypted || !encryptedData.iv) {
            throw new Error('Invalid encrypted data format');
        }

        try {
            // Convert arrays back to Uint8Arrays
            const encrypted = new Uint8Array(encryptedData.encrypted);
            const iv = new Uint8Array(encryptedData.iv);

            // Decrypt
            const decrypted = await crypto.subtle.decrypt(
                {
                    name: this.algorithm,
                    iv: iv
                },
                this.key,
                encrypted
            );

            // Decode
            return new TextDecoder().decode(decrypted);

        } catch (error) {
            console.error('❌ Decryption failed:', error);
            throw error;
        }
    }

    // Encrypt an object (converts to JSON first)
    async encryptObject(obj) {
        const jsonString = JSON.stringify(obj);
        return await this.encrypt(jsonString);
    }

    // Decrypt to an object (parses JSON after decryption)
    async decryptObject(encryptedData) {
        const jsonString = await this.decrypt(encryptedData);
        return JSON.parse(jsonString);
    }

    // Secure field encryption for forms
    async encryptFieldData(fields) {
        const encryptedFields = {};
        
        for (const [fieldName, fieldValue] of Object.entries(fields)) {
            if (this.shouldEncryptField(fieldName, fieldValue)) {
                encryptedFields[fieldName] = await this.encrypt(String(fieldValue));
            } else {
                encryptedFields[fieldName] = fieldValue;
            }
        }

        return encryptedFields;
    }

    async decryptFieldData(encryptedFields) {
        const decryptedFields = {};
        
        for (const [fieldName, fieldValue] of Object.entries(encryptedFields)) {
            if (this.isEncryptedData(fieldValue)) {
                try {
                    decryptedFields[fieldName] = await this.decrypt(fieldValue);
                } catch (error) {
                    console.warn(`Failed to decrypt field ${fieldName}:`, error);
                    decryptedFields[fieldName] = '[ENCRYPTED]';
                }
            } else {
                decryptedFields[fieldName] = fieldValue;
            }
        }

        return decryptedFields;
    }

    // Determine if a field should be encrypted
    shouldEncryptField(fieldName, fieldValue) {
        if (!fieldValue || typeof fieldValue !== 'string') return false;

        const sensitiveFields = [
            'cardnumber', 'card_number', 'creditcard', 'credit_card',
            'cvv', 'cvc', 'cvv2', 'cid', 'security_code',
            'ssn', 'social_security', 'tax_id',
            'password', 'pin', 'passcode',
            'account_number', 'routing_number',
            'passport', 'license_number'
        ];

        const fieldNameLower = fieldName.toLowerCase().replace(/[-_\s]/g, '');
        
        return sensitiveFields.some(sensitive => 
            fieldNameLower.includes(sensitive) || 
            fieldNameLower === sensitive
        );
    }

    // Check if data is encrypted
    isEncryptedData(data) {
        return data && 
               typeof data === 'object' && 
               data.encrypted && 
               data.iv && 
               data.algorithm === this.algorithm;
    }

    // Generate a hash for data integrity
    async generateHash(data) {
        const encoder = new TextEncoder();
        const dataBuffer = encoder.encode(JSON.stringify(data));
        const hashBuffer = await crypto.subtle.digest('SHA-256', dataBuffer);
        return Array.from(new Uint8Array(hashBuffer));
    }

    // Verify data integrity
    async verifyHash(data, expectedHash) {
        const computedHash = await this.generateHash(data);
        return this.arrayEquals(computedHash, expectedHash);
    }

    arrayEquals(a, b) {
        return a.length === b.length && a.every((val, i) => val === b[i]);
    }

    // Secure key rotation
    async rotateKey() {
        console.log('🔄 Rotating encryption key...');
        
        // Generate new key
        const newKey = await this.generateKey();
        const oldKey = this.key;

        try {
            // Re-encrypt all sensitive data with new key
            this.key = newKey;
            
            // Export and save new key
            const exportedKey = await this.exportKey(newKey);
            await chrome.storage.local.set({ 
                encryptionKey: exportedKey,
                keyRotatedAt: Date.now()
            });

            console.log('✅ Key rotation completed');
            return true;

        } catch (error) {
            console.error('❌ Key rotation failed:', error);
            // Restore old key on failure
            this.key = oldKey;
            throw error;
        }
    }

    // Clear encryption key (logout functionality)
    async clearKey() {
        this.key = null;
        this.isInitialized = false;
        await chrome.storage.local.remove('encryptionKey');
        console.log('🧹 Encryption key cleared');
    }

    // Get encryption status
    getStatus() {
        return {
            initialized: this.isInitialized,
            hasKey: !!this.key,
            algorithm: this.algorithm,
            keyLength: this.keyLength
        };
    }
}

// Create global instance
const encryptionManager = new EncryptionManager();

// Auto-initialize in supported environments
if (typeof chrome !== 'undefined' && chrome.storage) {
    encryptionManager.init().catch(error => {
        console.error('Failed to initialize encryption:', error);
    });
}

// Make available globally
if (typeof window !== 'undefined') {
    window.encryptionManager = encryptionManager;
}

// Export for modules
if (typeof module !== 'undefined' && module.exports) {
    module.exports = EncryptionManager;
}