// Development client for extension auto-reload and debugging
class DevClient {
    constructor() {
        this.ws = null;
        this.reconnectAttempts = 0;
        this.maxReconnectAttempts = 10;
        this.reconnectDelay = 1000;
        this.isEnabled = false;
        this.logs = [];
        this.maxLogs = 100;
        
        // Only initialize in development
        if (this.isDevelopment()) {
            this.init();
        }
    }

    isDevelopment() {
        // Check if we're in development mode
        return !('update_url' in chrome.runtime.getManifest()) || 
               chrome.runtime.getManifest().name.includes('Dev') ||
               window.location.hostname === 'localhost';
    }

    async init() {
        console.log('🛠️ Dev client initializing...');
        this.isEnabled = true;
        
        // Override console methods to capture logs
        this.interceptConsole();
        
        // Connect to dev server
        this.connect();
        
        // Send extension ID
        this.sendExtensionId();
        
        // Set up storage monitoring
        this.setupStorageMonitoring();
        
        // Notify server that extension is ready
        setTimeout(() => {
            this.send({ type: 'extension-ready', timestamp: Date.now() });
        }, 1000);
    }

    connect() {
        if (!this.isEnabled) return;

        try {
            this.ws = new WebSocket('ws://localhost:3001');
            
            this.ws.onopen = () => {
                console.log('🔗 Connected to dev server');
                this.reconnectAttempts = 0;
                this.send({ type: 'extension-ready', timestamp: Date.now() });
            };

            this.ws.onmessage = (event) => {
                try {
                    const data = JSON.parse(event.data);
                    this.handleMessage(data);
                } catch (error) {
                    console.error('❌ Invalid message from dev server:', error);
                }
            };

            this.ws.onclose = () => {
                console.log('🔌 Disconnected from dev server');
                this.scheduleReconnect();
            };

            this.ws.onerror = (error) => {
                console.error('❌ WebSocket error:', error);
            };

        } catch (error) {
            console.error('❌ Failed to connect to dev server:', error);
            this.scheduleReconnect();
        }
    }

    scheduleReconnect() {
        if (!this.isEnabled || this.reconnectAttempts >= this.maxReconnectAttempts) {
            return;
        }

        this.reconnectAttempts++;
        const delay = this.reconnectDelay * Math.pow(2, this.reconnectAttempts - 1);
        
        setTimeout(() => {
            console.log(`🔄 Reconnecting to dev server (attempt ${this.reconnectAttempts})...`);
            this.connect();
        }, delay);
    }

    handleMessage(data) {
        switch (data.type) {
            case 'reload':
                this.handleReload(data);
                break;

            case 'backup-storage':
                this.backupStorage();
                break;

            case 'restore-storage':
                this.restoreStorage(data.storage);
                break;

            case 'connected':
                console.log('✅ Dev server connection established');
                break;

            default:
                console.log('📨 Dev server message:', data);
        }
    }

    async handleReload(data) {
        console.log('🔄 Extension reload requested by dev server');
        
        try {
            // Backup storage before reload if requested
            if (data.hasStorageBackup) {
                await this.backupStorage();
            }

            // Small delay to ensure backup completes
            setTimeout(() => {
                chrome.runtime.reload();
            }, 100);

        } catch (error) {
            console.error('❌ Error during reload:', error);
        }
    }

    async backupStorage() {
        try {
            const syncData = await chrome.storage.sync.get();
            const localData = await chrome.storage.local.get();
            
            const storageBackup = {
                sync: syncData,
                local: localData,
                timestamp: Date.now()
            };

            this.send({
                type: 'storage-backup',
                storage: storageBackup,
                timestamp: Date.now()
            });

            console.log('💾 Storage backed up to dev server');

        } catch (error) {
            console.error('❌ Failed to backup storage:', error);
        }
    }

    async restoreStorage(backup) {
        if (!backup) {
            console.warn('⚠️ No storage backup to restore');
            return;
        }

        try {
            // Restore sync storage
            if (backup.sync && Object.keys(backup.sync).length > 0) {
                await chrome.storage.sync.set(backup.sync);
                console.log('🔄 Sync storage restored');
            }

            // Restore local storage
            if (backup.local && Object.keys(backup.local).length > 0) {
                await chrome.storage.local.set(backup.local);
                console.log('🔄 Local storage restored');
            }

            this.send({
                type: 'storage-restored',
                timestamp: Date.now()
            });

            console.log('✅ Storage state restored successfully');

        } catch (error) {
            console.error('❌ Failed to restore storage:', error);
        }
    }

    setupStorageMonitoring() {
        // Monitor storage changes and send to dev server
        chrome.storage.onChanged.addListener((changes, namespace) => {
            const changeInfo = {
                namespace,
                changes: Object.keys(changes).reduce((acc, key) => {
                    acc[key] = {
                        oldValue: changes[key].oldValue,
                        newValue: changes[key].newValue
                    };
                    return acc;
                }, {}),
                timestamp: Date.now()
            };

            this.send({
                type: 'storage-change',
                data: changeInfo
            });
        });
    }

    interceptConsole() {
        const originalLog = console.log;
        const originalError = console.error;
        const originalWarn = console.warn;
        const originalInfo = console.info;
        const originalDebug = console.debug;

        const createInterceptor = (level, originalMethod) => {
            return (...args) => {
                // Call original method
                originalMethod.apply(console, args);

                // Send to dev server
                if (this.isEnabled) {
                    const logEntry = {
                        type: 'log',
                        level,
                        message: args.map(arg => 
                            typeof arg === 'object' ? JSON.stringify(arg) : String(arg)
                        ).join(' '),
                        timestamp: Date.now(),
                        source: this.getLogSource(),
                        data: args.length === 1 && typeof args[0] === 'object' ? args[0] : null
                    };

                    this.addLog(logEntry);
                    this.send(logEntry);
                }
            };
        };

        console.log = createInterceptor('info', originalLog);
        console.error = createInterceptor('error', originalError);
        console.warn = createInterceptor('warn', originalWarn);
        console.info = createInterceptor('info', originalInfo);
        console.debug = createInterceptor('debug', originalDebug);

        // Capture unhandled errors
        window.addEventListener('error', (event) => {
            const errorLog = {
                type: 'log',
                level: 'error',
                message: `Unhandled error: ${event.message}`,
                timestamp: Date.now(),
                source: 'window',
                data: {
                    filename: event.filename,
                    lineno: event.lineno,
                    colno: event.colno,
                    error: event.error?.stack
                }
            };

            this.addLog(errorLog);
            this.send(errorLog);
        });

        // Capture unhandled promise rejections
        window.addEventListener('unhandledrejection', (event) => {
            const errorLog = {
                type: 'log',
                level: 'error',
                message: `Unhandled promise rejection: ${event.reason}`,
                timestamp: Date.now(),
                source: 'promise',
                data: { reason: event.reason }
            };

            this.addLog(errorLog);
            this.send(errorLog);
        });
    }

    getLogSource() {
        // Try to determine the source of the log
        if (typeof chrome !== 'undefined' && chrome.runtime) {
            const manifest = chrome.runtime.getManifest();
            if (window.location.href.includes('popup.html')) {
                return 'popup';
            } else if (window.location.href.includes('background')) {
                return 'background';
            } else if (document.contentType === 'text/html' && window.location.href.startsWith('http')) {
                return 'content';
            }
        }
        return 'extension';
    }

    addLog(logEntry) {
        this.logs.push(logEntry);
        if (this.logs.length > this.maxLogs) {
            this.logs.shift();
        }
    }

    getLogs() {
        return this.logs;
    }

    send(message) {
        if (this.ws && this.ws.readyState === WebSocket.OPEN) {
            try {
                this.ws.send(JSON.stringify(message));
            } catch (error) {
                console.error('❌ Failed to send message to dev server:', error);
            }
        }
    }

    sendExtensionId() {
        if (typeof chrome !== 'undefined' && chrome.runtime && chrome.runtime.id) {
            this.send({
                type: 'extension-id',
                id: chrome.runtime.id,
                timestamp: Date.now()
            });
        }
    }

    // Public API for manual debugging
    triggerReload() {
        chrome.runtime.reload();
    }

    downloadLogs() {
        const blob = new Blob([JSON.stringify(this.logs, null, 2)], { type: 'application/json' });
        const url = URL.createObjectURL(blob);
        const a = document.createElement('a');
        a.href = url;
        a.download = `extension-logs-${new Date().toISOString().split('T')[0]}.json`;
        a.click();
        URL.revokeObjectURL(url);
    }

    getStorageSnapshot() {
        return Promise.all([
            chrome.storage.sync.get(),
            chrome.storage.local.get()
        ]).then(([sync, local]) => ({ sync, local }));
    }
}

// Initialize dev client
const devClient = new DevClient();

// Make dev client available globally for debugging
if (typeof window !== 'undefined') {
    window.devClient = devClient;
}

// Export for use in other scripts
if (typeof module !== 'undefined' && module.exports) {
    module.exports = DevClient;
}