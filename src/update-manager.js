// Auto-update system for PII Autofill Extension
class UpdateManager {
    constructor() {
        this.updateCheckInterval = 24 * 60 * 60 * 1000; // 24 hours
        this.githubRepo = 'user/pii-autofill-extension'; // Configure this
        this.currentVersion = null;
        this.updateInProgress = false;
        this.userDataBackup = null;
        this.notificationShown = false;
        
        this.init();
    }

    async init() {
        console.log('🔄 Update Manager initializing...');
        
        // Get current version
        this.currentVersion = chrome.runtime.getManifest().version;
        console.log(`📦 Current version: ${this.currentVersion}`);
        
        // Check for updates on startup
        setTimeout(() => this.checkForUpdates(), 5000);
        
        // Set up periodic update checks
        this.scheduleUpdateChecks();
        
        // Listen for manual update requests
        this.setupMessageHandlers();
        
        // Listen for extension updates
        this.setupUpdateListeners();
    }

    scheduleUpdateChecks() {
        // Check for updates every 24 hours
        setInterval(() => {
            this.checkForUpdates();
        }, this.updateCheckInterval);
        
        console.log('⏰ Scheduled automatic update checks');
    }

    async checkForUpdates() {
        if (this.updateInProgress) {
            console.log('⏸️ Update already in progress, skipping check');
            return;
        }

        try {
            console.log('🔍 Checking for updates...');
            
            const latestRelease = await this.fetchLatestRelease();
            if (!latestRelease) {
                console.log('❌ Failed to fetch latest release');
                return;
            }

            const latestVersion = latestRelease.tag_name.replace(/^v/, '');
            console.log(`🆕 Latest version: ${latestVersion}`);

            if (this.isNewerVersion(latestVersion, this.currentVersion)) {
                console.log('🎉 Update available!');
                await this.handleUpdateAvailable(latestRelease);
            } else {
                console.log('✅ Extension is up to date');
            }

        } catch (error) {
            console.error('❌ Update check failed:', error);
        }
    }

    async fetchLatestRelease() {
        try {
            const response = await fetch(`https://api.github.com/repos/${this.githubRepo}/releases/latest`);
            
            if (!response.ok) {
                throw new Error(`GitHub API error: ${response.status}`);
            }

            return await response.json();

        } catch (error) {
            console.error('❌ Failed to fetch release info:', error);
            return null;
        }
    }

    isNewerVersion(latest, current) {
        // Simple version comparison (assumes semantic versioning)
        const parseVersion = (version) => {
            return version.split('.').map(num => parseInt(num, 10));
        };

        const latestParts = parseVersion(latest);
        const currentParts = parseVersion(current);

        for (let i = 0; i < Math.max(latestParts.length, currentParts.length); i++) {
            const latestPart = latestParts[i] || 0;
            const currentPart = currentParts[i] || 0;

            if (latestPart > currentPart) return true;
            if (latestPart < currentPart) return false;
        }

        return false;
    }

    async handleUpdateAvailable(release) {
        // Store update info
        await chrome.storage.local.set({
            pendingUpdate: {
                version: release.tag_name.replace(/^v/, ''),
                downloadUrl: release.zipball_url,
                releaseNotes: release.body,
                publishedAt: release.published_at
            }
        });

        // Show notification
        this.showUpdateNotification(release);

        // Send message to popup if open
        this.notifyPopup('updateAvailable', {
            version: release.tag_name.replace(/^v/, ''),
            releaseNotes: release.body
        });
    }

    showUpdateNotification(release) {
        if (this.notificationShown) return;

        chrome.notifications.create('update-available', {
            type: 'basic',
            iconUrl: '/assets/icon48.png',
            title: 'PII Autofill Extension Update',
            message: `Version ${release.tag_name.replace(/^v/, '')} is available. Click to update.`,
            buttons: [
                { title: 'Update Now' },
                { title: 'Later' }
            ]
        });

        this.notificationShown = true;

        // Handle notification clicks
        chrome.notifications.onButtonClicked.addListener((notificationId, buttonIndex) => {
            if (notificationId === 'update-available') {
                if (buttonIndex === 0) {
                    this.startUpdate();
                }
                chrome.notifications.clear(notificationId);
                this.notificationShown = false;
            }
        });
    }

    async startUpdate() {
        if (this.updateInProgress) return;

        console.log('🚀 Starting update process...');
        this.updateInProgress = true;

        try {
            // Step 1: Backup user data
            await this.backupUserData();

            // Step 2: Download new version
            const updateInfo = await this.getUpdateInfo();
            if (!updateInfo) {
                throw new Error('No pending update found');
            }

            const newFiles = await this.downloadUpdate(updateInfo.downloadUrl);

            // Step 3: Hot-swap files
            await this.hotSwapFiles(newFiles);

            // Step 4: Update manifest version
            await this.updateVersion(updateInfo.version);

            // Step 5: Restore user data
            await this.restoreUserData();

            // Step 6: Cleanup
            await this.cleanupUpdate();

            console.log('✅ Update completed successfully!');
            this.notifyPopup('updateCompleted', { version: updateInfo.version });

        } catch (error) {
            console.error('❌ Update failed:', error);
            await this.rollbackUpdate();
            this.notifyPopup('updateFailed', { error: error.message });
        } finally {
            this.updateInProgress = false;
        }
    }

    async backupUserData() {
        console.log('💾 Backing up user data...');

        // Get all user data from storage
        const syncData = await chrome.storage.sync.get();
        const localData = await chrome.storage.local.get();

        this.userDataBackup = {
            sync: syncData,
            local: localData,
            timestamp: Date.now()
        };

        console.log('✅ User data backed up');
    }

    async downloadUpdate(downloadUrl) {
        console.log('⬇️ Downloading update...');

        try {
            const response = await fetch(downloadUrl);
            if (!response.ok) {
                throw new Error(`Download failed: ${response.status}`);
            }

            // In a real implementation, you would:
            // 1. Download and extract the ZIP
            // 2. Parse the files
            // 3. Return the file contents
            
            // For now, simulate the download
            console.log('📦 Update downloaded (simulated)');
            
            return {
                'manifest.json': '{"version": "1.1.0", ...}', // New manifest
                'src/content.js': '// Updated content script',
                'src/background.js': '// Updated background script',
                // ... other files
            };

        } catch (error) {
            throw new Error(`Failed to download update: ${error.message}`);
        }
    }

    async hotSwapFiles(newFiles) {
        console.log('🔄 Hot-swapping files...');

        try {
            // In Chrome extensions, we can't directly replace files
            // Instead, we need to use a different approach:
            
            // 1. Store new code in storage
            await chrome.storage.local.set({
                hotSwapCode: {
                    files: newFiles,
                    timestamp: Date.now(),
                    version: await this.getUpdateInfo().version
                }
            });

            // 2. Inject update handler into existing scripts
            await this.injectUpdateHandlers();

            // 3. Reload specific components
            await this.reloadComponents();

            console.log('✅ Files hot-swapped');

        } catch (error) {
            throw new Error(`Hot-swap failed: ${error.message}`);
        }
    }

    async injectUpdateHandlers() {
        // Inject update handlers into content scripts and popup
        const updateHandlerCode = `
            // Hot-swap update handler
            (function() {
                if (window.hotSwapHandler) return;
                
                window.hotSwapHandler = {
                    async applyUpdate() {
                        const { hotSwapCode } = await chrome.storage.local.get('hotSwapCode');
                        if (!hotSwapCode) return;
                        
                        // Apply new code dynamically
                        for (const [filename, code] of Object.entries(hotSwapCode.files)) {
                            if (filename.endsWith('.js')) {
                                try {
                                    eval(code);
                                    console.log(\`📝 Applied update to \${filename}\`);
                                } catch (error) {
                                    console.error(\`❌ Failed to apply \${filename}:\`, error);
                                }
                            }
                        }
                    }
                };
                
                // Auto-apply updates
                window.hotSwapHandler.applyUpdate();
            })();
        `;

        // Inject into all tabs
        const tabs = await chrome.tabs.query({});
        for (const tab of tabs) {
            try {
                await chrome.scripting.executeScript({
                    target: { tabId: tab.id },
                    func: () => eval(updateHandlerCode)
                });
            } catch (error) {
                // Ignore errors for tabs we can't access
            }
        }
    }

    async reloadComponents() {
        console.log('🔄 Reloading components...');

        // Reload popup if open
        this.notifyPopup('reloadPopup');

        // Refresh content scripts
        const tabs = await chrome.tabs.query({});
        for (const tab of tabs) {
            try {
                await chrome.tabs.reload(tab.id);
            } catch (error) {
                // Ignore errors
            }
        }
    }

    async updateVersion(newVersion) {
        // Update stored version info
        await chrome.storage.local.set({
            extensionVersion: newVersion,
            lastUpdated: Date.now()
        });

        console.log(`📝 Version updated to ${newVersion}`);
    }

    async restoreUserData() {
        if (!this.userDataBackup) return;

        console.log('🔄 Restoring user data...');

        // Restore sync and local storage
        await chrome.storage.sync.set(this.userDataBackup.sync);
        await chrome.storage.local.set(this.userDataBackup.local);

        console.log('✅ User data restored');
    }

    async cleanupUpdate() {
        // Remove update-related data
        await chrome.storage.local.remove(['pendingUpdate', 'hotSwapCode']);
        this.userDataBackup = null;
        
        console.log('🧹 Update cleanup completed');
    }

    async rollbackUpdate() {
        console.log('↩️ Rolling back update...');

        try {
            // Restore user data if backed up
            if (this.userDataBackup) {
                await this.restoreUserData();
            }

            // Remove failed update data
            await chrome.storage.local.remove(['pendingUpdate', 'hotSwapCode']);

            console.log('✅ Rollback completed');

        } catch (error) {
            console.error('❌ Rollback failed:', error);
        }
    }

    async getUpdateInfo() {
        const result = await chrome.storage.local.get('pendingUpdate');
        return result.pendingUpdate;
    }

    setupMessageHandlers() {
        chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
            switch (message.type) {
                case 'checkForUpdates':
                    this.checkForUpdates().then(() => sendResponse({ success: true }));
                    return true;

                case 'startUpdate':
                    this.startUpdate().then(() => sendResponse({ success: true }));
                    return true;

                case 'getUpdateInfo':
                    this.getUpdateInfo().then(info => sendResponse({ updateInfo: info }));
                    return true;
            }
        });
    }

    setupUpdateListeners() {
        // Listen for extension updates from Chrome Web Store
        chrome.runtime.onUpdateAvailable.addListener((details) => {
            console.log('🏪 Chrome Web Store update available:', details.version);
            
            // Show notification about store update
            chrome.notifications.create('store-update', {
                type: 'basic',
                iconUrl: '/assets/icon48.png',
                title: 'Extension Update from Chrome Web Store',
                message: `Version ${details.version} is available from the Chrome Web Store.`
            });
        });
    }

    notifyPopup(type, data = {}) {
        // Send message to popup if it's open
        chrome.runtime.sendMessage({
            type: `update-${type}`,
            data
        }).catch(() => {
            // Popup not open, ignore error
        });
    }

    // Public API methods
    async manualUpdateCheck() {
        return await this.checkForUpdates();
    }

    async getUpdateStatus() {
        const updateInfo = await this.getUpdateInfo();
        return {
            updateAvailable: !!updateInfo,
            currentVersion: this.currentVersion,
            latestVersion: updateInfo?.version,
            updateInProgress: this.updateInProgress
        };
    }
}

// Initialize update manager
const updateManager = new UpdateManager();

// Make available globally for debugging
if (typeof window !== 'undefined') {
    window.updateManager = updateManager;
}

// Export for use in other scripts
if (typeof module !== 'undefined' && module.exports) {
    module.exports = UpdateManager;
}