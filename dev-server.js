#!/usr/bin/env node

const fs = require('fs');
const path = require('path');
const http = require('http');
const WebSocket = require('ws');
const chokidar = require('chokidar');
const { execSync } = require('child_process');

class ExtensionDevServer {
    constructor() {
        this.port = 3000;
        this.wsPort = 3001;
        this.clients = new Set();
        this.storageBackup = null;
        this.reloadTimeout = null;
        this.extensionId = null;
        this.isReloading = false;
        
        this.watchPaths = [
            'src/**/*.js',
            'src/**/*.css',
            'src/**/*.html',
            'manifest.json'
        ];

        this.init();
    }

    async init() {
        try {
            // Check for required dependencies
            this.checkDependencies();
            
            console.log('🚀 Starting PII Autofill Extension Dev Server...\n');
            
            // Start WebSocket server for communication
            this.startWebSocketServer();
            
            // Start HTTP server for dev tools
            this.startHttpServer();
            
            // Set up file watching
            this.setupFileWatcher();
            
            // Load extension ID if available
            this.loadExtensionId();
            
            console.log('✅ Dev server ready!');
            console.log(`📡 WebSocket server: ws://localhost:${this.wsPort}`);
            console.log(`🌐 Dev tools: http://localhost:${this.port}`);
            console.log('👀 Watching files for changes...\n');
            
            // Handle graceful shutdown
            process.on('SIGINT', () => this.shutdown());
            process.on('SIGTERM', () => this.shutdown());
            
        } catch (error) {
            console.error('❌ Failed to start dev server:', error.message);
            process.exit(1);
        }
    }

    checkDependencies() {
        const requiredPackages = ['chokidar', 'ws'];
        const missing = [];

        for (const pkg of requiredPackages) {
            try {
                require(pkg);
            } catch (error) {
                missing.push(pkg);
            }
        }

        if (missing.length > 0) {
            console.log('📦 Installing missing dependencies...');
            try {
                execSync(`npm install ${missing.join(' ')}`, { stdio: 'inherit' });
                console.log('✅ Dependencies installed successfully\n');
            } catch (error) {
                throw new Error(`Failed to install dependencies: ${missing.join(', ')}`);
            }
        }
    }

    startWebSocketServer() {
        this.wss = new WebSocket.Server({ 
            port: this.wsPort,
            clientTracking: true 
        });

        this.wss.on('connection', (ws, req) => {
            console.log('🔗 Extension connected to dev server');
            this.clients.add(ws);

            ws.on('message', (message) => {
                try {
                    const data = JSON.parse(message);
                    this.handleExtensionMessage(data, ws);
                } catch (error) {
                    console.error('❌ Invalid message from extension:', error);
                }
            });

            ws.on('close', () => {
                this.clients.delete(ws);
                console.log('🔌 Extension disconnected');
            });

            ws.on('error', (error) => {
                console.error('❌ WebSocket error:', error);
                this.clients.delete(ws);
            });

            // Send initial connection confirmation
            this.sendToExtension(ws, { type: 'connected', timestamp: Date.now() });
        });

        console.log(`📡 WebSocket server started on port ${this.wsPort}`);
    }

    startHttpServer() {
        this.server = http.createServer((req, res) => {
            if (req.url === '/') {
                this.serveDevTools(res);
            } else if (req.url === '/api/status') {
                this.serveStatus(res);
            } else if (req.url === '/api/logs') {
                this.serveLogs(res);
            } else if (req.url === '/api/storage') {
                this.serveStorage(res);
            } else if (req.url === '/api/reload' && req.method === 'POST') {
                this.handleManualReload(res);
            } else {
                res.writeHead(404);
                res.end('Not found');
            }
        });

        this.server.listen(this.port, () => {
            console.log(`🌐 HTTP server started on port ${this.port}`);
        });
    }

    setupFileWatcher() {
        this.watcher = chokidar.watch(this.watchPaths, {
            ignored: [
                'node_modules/**',
                'dist/**',
                '.git/**',
                '**/*.log'
            ],
            persistent: true,
            ignoreInitial: true
        });

        this.watcher.on('change', (filePath) => {
            console.log(`📝 File changed: ${filePath}`);
            this.scheduleReload(filePath);
        });

        this.watcher.on('add', (filePath) => {
            console.log(`➕ File added: ${filePath}`);
            this.scheduleReload(filePath);
        });

        this.watcher.on('unlink', (filePath) => {
            console.log(`🗑️  File removed: ${filePath}`);
            this.scheduleReload(filePath);
        });

        console.log('👀 File watcher initialized');
    }

    scheduleReload(filePath) {
        if (this.isReloading) {
            console.log('⏳ Reload already in progress, skipping...');
            return;
        }

        // Clear existing timeout
        if (this.reloadTimeout) {
            clearTimeout(this.reloadTimeout);
        }

        // Debounce reloads by 500ms
        this.reloadTimeout = setTimeout(() => {
            this.reloadExtension(filePath);
        }, 500);
    }

    async reloadExtension(changedFile) {
        if (this.isReloading) return;
        
        this.isReloading = true;
        console.log('\n🔄 Reloading extension...');

        try {
            // Backup storage state
            await this.backupStorageState();

            // Notify all connected clients
            this.broadcast({
                type: 'reload',
                timestamp: Date.now(),
                changedFile,
                hasStorageBackup: !!this.storageBackup
            });

            console.log('✅ Extension reload initiated');
            
            // Reset flag after a delay
            setTimeout(() => {
                this.isReloading = false;
            }, 2000);

        } catch (error) {
            console.error('❌ Error during reload:', error);
            this.isReloading = false;
        }
    }

    async backupStorageState() {
        return new Promise((resolve) => {
            if (this.clients.size === 0) {
                resolve();
                return;
            }

            // Request storage backup from extension
            this.broadcast({
                type: 'backup-storage',
                timestamp: Date.now()
            });

            // Set timeout in case extension doesn't respond
            setTimeout(resolve, 1000);
        });
    }

    handleExtensionMessage(data, ws) {
        switch (data.type) {
            case 'storage-backup':
                this.storageBackup = data.storage;
                console.log('💾 Storage state backed up');
                break;

            case 'storage-restored':
                console.log('🔄 Storage state restored');
                break;

            case 'extension-ready':
                console.log('✅ Extension reloaded and ready');
                if (this.storageBackup) {
                    this.sendToExtension(ws, {
                        type: 'restore-storage',
                        storage: this.storageBackup,
                        timestamp: Date.now()
                    });
                }
                break;

            case 'log':
                this.handleLog(data);
                break;

            case 'error':
                console.error('❌ Extension error:', data.message, data.stack);
                break;

            case 'extension-id':
                this.extensionId = data.id;
                console.log(`🆔 Extension ID: ${this.extensionId}`);
                break;

            default:
                console.log('📨 Extension message:', data);
        }
    }

    handleLog(logData) {
        const timestamp = new Date(logData.timestamp).toLocaleTimeString();
        const level = logData.level.toUpperCase();
        const source = logData.source || 'unknown';
        
        let emoji = '📝';
        switch (logData.level) {
            case 'error': emoji = '❌'; break;
            case 'warn': emoji = '⚠️'; break;
            case 'info': emoji = 'ℹ️'; break;
            case 'debug': emoji = '🐛'; break;
        }

        console.log(`${emoji} [${timestamp}] [${source}] ${logData.message}`);
        
        if (logData.data) {
            console.log('   Data:', logData.data);
        }
    }

    sendToExtension(ws, message) {
        if (ws.readyState === WebSocket.OPEN) {
            ws.send(JSON.stringify(message));
        }
    }

    broadcast(message) {
        const messageStr = JSON.stringify(message);
        this.clients.forEach(ws => {
            if (ws.readyState === WebSocket.OPEN) {
                ws.send(messageStr);
            }
        });
    }

    loadExtensionId() {
        try {
            const manifestPath = path.join(__dirname, 'manifest.json');
            if (fs.existsSync(manifestPath)) {
                const manifest = JSON.parse(fs.readFileSync(manifestPath, 'utf8'));
                console.log(`📋 Extension: ${manifest.name} v${manifest.version}`);
            }
        } catch (error) {
            console.warn('⚠️ Could not read manifest.json');
        }
    }

    serveDevTools(res) {
        const html = `
<!DOCTYPE html>
<html lang="en">
<head>
    <meta charset="UTF-8">
    <meta name="viewport" content="width=device-width, initial-scale=1.0">
    <title>PII Autofill Extension - Dev Tools</title>
    <style>
        * { margin: 0; padding: 0; box-sizing: border-box; }
        body {
            font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif;
            background: #1a1a1a;
            color: #e0e0e0;
            line-height: 1.6;
        }
        .container { max-width: 1200px; margin: 0 auto; padding: 20px; }
        h1 { color: #4fc3f7; margin-bottom: 20px; }
        h2 { color: #81c784; margin: 20px 0 10px; }
        .status { padding: 15px; border-radius: 8px; margin-bottom: 20px; }
        .status.connected { background: #2e7d32; }
        .status.disconnected { background: #c62828; }
        .card {
            background: #2d2d2d;
            border-radius: 8px;
            padding: 20px;
            margin-bottom: 20px;
            border: 1px solid #404040;
        }
        .btn {
            background: #1976d2;
            color: white;
            border: none;
            padding: 10px 20px;
            border-radius: 4px;
            cursor: pointer;
            margin-right: 10px;
        }
        .btn:hover { background: #1565c0; }
        .log-container {
            background: #1e1e1e;
            border: 1px solid #404040;
            border-radius: 4px;
            height: 300px;
            overflow-y: auto;
            padding: 10px;
            font-family: 'Courier New', monospace;
            font-size: 14px;
        }
        .log-entry {
            margin-bottom: 5px;
            padding: 5px;
            border-radius: 3px;
        }
        .log-error { background: rgba(244, 67, 54, 0.1); color: #f44336; }
        .log-warn { background: rgba(255, 152, 0, 0.1); color: #ff9800; }
        .log-info { background: rgba(33, 150, 243, 0.1); color: #2196f3; }
        .log-debug { background: rgba(156, 39, 176, 0.1); color: #9c27b0; }
        .storage-viewer {
            background: #1e1e1e;
            border: 1px solid #404040;
            border-radius: 4px;
            height: 200px;
            overflow: auto;
            padding: 10px;
            font-family: 'Courier New', monospace;
            font-size: 12px;
        }
        pre { white-space: pre-wrap; word-break: break-word; }
    </style>
</head>
<body>
    <div class="container">
        <h1>🚀 PII Autofill Extension - Dev Tools</h1>
        
        <div id="status" class="status disconnected">
            <strong>Status:</strong> <span id="status-text">Disconnected</span>
        </div>

        <div class="card">
            <h2>🔄 Extension Control</h2>
            <button class="btn" onclick="reloadExtension()">Reload Extension</button>
            <button class="btn" onclick="clearLogs()">Clear Logs</button>
            <button class="btn" onclick="downloadStorage()">Download Storage</button>
        </div>

        <div class="card">
            <h2>📝 Console Logs</h2>
            <div id="logs" class="log-container"></div>
        </div>

        <div class="card">
            <h2>💾 Storage State</h2>
            <div id="storage" class="storage-viewer">
                <pre>No storage data available</pre>
            </div>
        </div>

        <div class="card">
            <h2>📊 Statistics</h2>
            <p><strong>Connected Clients:</strong> <span id="client-count">0</span></p>
            <p><strong>Last Reload:</strong> <span id="last-reload">Never</span></p>
            <p><strong>Extension ID:</strong> <span id="extension-id">Unknown</span></p>
        </div>
    </div>

    <script>
        const ws = new WebSocket('ws://localhost:3001');
        const logsContainer = document.getElementById('logs');
        const storageContainer = document.getElementById('storage');
        const statusElement = document.getElementById('status');
        const statusText = document.getElementById('status-text');
        
        let logs = [];

        ws.onopen = function() {
            updateStatus(true);
        };

        ws.onclose = function() {
            updateStatus(false);
        };

        ws.onmessage = function(event) {
            const data = JSON.parse(event.data);
            handleMessage(data);
        };

        function updateStatus(connected) {
            statusElement.className = connected ? 'status connected' : 'status disconnected';
            statusText.textContent = connected ? 'Connected' : 'Disconnected';
        }

        function handleMessage(data) {
            switch (data.type) {
                case 'log':
                    addLog(data);
                    break;
                case 'storage-update':
                    updateStorage(data.storage);
                    break;
                case 'reload':
                    document.getElementById('last-reload').textContent = new Date().toLocaleString();
                    break;
                case 'extension-id':
                    document.getElementById('extension-id').textContent = data.id;
                    break;
            }
        }

        function addLog(logData) {
            logs.push(logData);
            if (logs.length > 100) logs.shift(); // Keep only last 100 logs
            
            const logElement = document.createElement('div');
            logElement.className = \`log-entry log-\${logData.level}\`;
            
            const timestamp = new Date(logData.timestamp).toLocaleTimeString();
            const source = logData.source || 'unknown';
            
            logElement.innerHTML = \`
                <strong>[\${timestamp}] [\${source}]</strong> \${logData.message}
                \${logData.data ? '<br><small>' + JSON.stringify(logData.data, null, 2) + '</small>' : ''}
            \`;
            
            logsContainer.appendChild(logElement);
            logsContainer.scrollTop = logsContainer.scrollHeight;
        }

        function updateStorage(storage) {
            storageContainer.innerHTML = '<pre>' + JSON.stringify(storage, null, 2) + '</pre>';
        }

        function reloadExtension() {
            fetch('/api/reload', { method: 'POST' })
                .then(response => response.json())
                .then(data => console.log('Reload triggered:', data));
        }

        function clearLogs() {
            logs = [];
            logsContainer.innerHTML = '';
        }

        function downloadStorage() {
            fetch('/api/storage')
                .then(response => response.json())
                .then(data => {
                    const blob = new Blob([JSON.stringify(data, null, 2)], { type: 'application/json' });
                    const url = URL.createObjectURL(blob);
                    const a = document.createElement('a');
                    a.href = url;
                    a.download = \`extension-storage-\${new Date().toISOString().split('T')[0]}.json\`;
                    a.click();
                    URL.revokeObjectURL(url);
                });
        }

        // Auto-refresh status every 5 seconds
        setInterval(() => {
            fetch('/api/status')
                .then(response => response.json())
                .then(data => {
                    document.getElementById('client-count').textContent = data.clients;
                })
                .catch(() => {});
        }, 5000);
    </script>
</body>
</html>`;

        res.writeHead(200, { 'Content-Type': 'text/html' });
        res.end(html);
    }

    serveStatus(res) {
        const status = {
            connected: this.clients.size > 0,
            clients: this.clients.size,
            extensionId: this.extensionId,
            lastReload: this.lastReload || null,
            isReloading: this.isReloading
        };

        res.writeHead(200, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify(status));
    }

    serveLogs(res) {
        // This would serve recent logs if we were storing them
        res.writeHead(200, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ logs: [] }));
    }

    serveStorage(res) {
        res.writeHead(200, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify(this.storageBackup || {}));
    }

    handleManualReload(res) {
        this.reloadExtension('manual');
        res.writeHead(200, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ success: true, message: 'Reload triggered' }));
    }

    shutdown() {
        console.log('\n🛑 Shutting down dev server...');
        
        if (this.watcher) {
            this.watcher.close();
        }
        
        if (this.wss) {
            this.wss.close();
        }
        
        if (this.server) {
            this.server.close();
        }
        
        console.log('✅ Dev server stopped');
        process.exit(0);
    }
}

// Start the dev server
new ExtensionDevServer();