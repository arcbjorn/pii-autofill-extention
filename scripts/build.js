#!/usr/bin/env node

// Production build script for PII Autofill Extension
const fs = require('fs').promises;
const path = require('path');
const { execSync } = require('child_process');

class ExtensionBuilder {
    constructor() {
        this.sourceDir = path.join(__dirname, '..');
        this.buildDir = path.join(this.sourceDir, 'dist');
        this.version = null;
    }

    async build() {
        console.log('🏗️  Building PII Autofill Extension...\n');

        try {
            // Clean build directory
            await this.cleanBuildDir();

            // Compile TypeScript
            await this.compileTypeScript();

            // Read manifest and get version
            await this.loadManifest();

            // Copy source files
            await this.copySourceFiles();

            // Process and optimize files
            await this.processFiles();

            // Copy assets
            await this.copyAssets();

            // Copy libraries
            await this.copyLibraries();

            // Generate production manifest
            await this.generateProductionManifest();

            // Create build info
            await this.createBuildInfo();

            console.log('✅ Build completed successfully!');
            console.log(`📦 Extension v${this.version} ready in: ${this.buildDir}`);
            
            // Show build statistics
            await this.showBuildStats();

        } catch (error) {
            console.error('❌ Build failed:', error);
            process.exit(1);
        }
    }

    async cleanBuildDir() {
        console.log('🧹 Cleaning build directory...');
        
        try {
            await fs.rm(this.buildDir, { recursive: true, force: true });
            await fs.mkdir(this.buildDir, { recursive: true });
        } catch (error) {
            console.error('Failed to clean build directory:', error);
            throw error;
        }
    }

    async compileTypeScript() {
        console.log('🔧 Compiling TypeScript...');
        
        try {
            // Check if TypeScript files exist
            const tsFiles = [
                'src/content-optimized.ts',
                'src/background.ts', 
                'src/popup.ts'
            ];

            let hasTypeScript = false;
            for (const file of tsFiles) {
                try {
                    await fs.access(path.join(this.sourceDir, file));
                    hasTypeScript = true;
                    break;
                } catch {
                    continue;
                }
            }

            if (!hasTypeScript) {
                console.log('  ! No TypeScript files found, skipping compilation');
                return;
            }

            // Compile TypeScript
            console.log('  📝 Running tsc...');
            execSync('npx tsc --outDir dist/temp', { 
                cwd: this.sourceDir,
                stdio: 'inherit'
            });

            // Move compiled JS files to correct locations
            const tempDir = path.join(this.buildDir, 'temp');
            const srcDir = path.join(tempDir, 'src');
            
            if (await this.pathExists(srcDir)) {
                const compiledFiles = await fs.readdir(srcDir);
                
                for (const file of compiledFiles) {
                    if (file.endsWith('.js')) {
                        const srcPath = path.join(srcDir, file);
                        const destPath = path.join(this.sourceDir, 'src', file);
                        await fs.copyFile(srcPath, destPath);
                        console.log(`  ✓ ${file}`);
                    }
                }
            }

            // Clean up temp directory
            await fs.rm(tempDir, { recursive: true, force: true });
            
            console.log('  ✅ TypeScript compilation completed');
            
        } catch (error) {
            console.error('TypeScript compilation failed:', error.message);
            throw error;
        }
    }

    async pathExists(path) {
        try {
            await fs.access(path);
            return true;
        } catch {
            return false;
        }
    }

    async loadManifest() {
        const manifestPath = path.join(this.sourceDir, 'manifest.json');
        const manifestContent = await fs.readFile(manifestPath, 'utf8');
        const manifest = JSON.parse(manifestContent);
        this.version = manifest.version;
        
        console.log(`📋 Building version: ${this.version}`);
    }

    async copySourceFiles() {
        console.log('📁 Copying source files...');
        
        const srcDir = path.join(this.sourceDir, 'src');
        const destSrcDir = path.join(this.buildDir, 'src');
        
        await fs.mkdir(destSrcDir, { recursive: true });
        
        const files = await fs.readdir(srcDir);
        
        for (const file of files) {
            const srcPath = path.join(srcDir, file);
            const destPath = path.join(destSrcDir, file);
            
            const stat = await fs.stat(srcPath);
            if (stat.isFile()) {
                await fs.copyFile(srcPath, destPath);
                console.log(`  ✓ ${file}`);
            }
        }
    }

    async processFiles() {
        console.log('⚙️  Processing files...');
        
        // Remove development-only code
        await this.removeDevelopmentCode();
        
        // Update CSS references
        await this.updateStyleReferences();
        
        // Update script references in HTML
        await this.updateScriptReferences();
        
        console.log('  ✓ File processing completed');
    }

    async removeDevelopmentCode() {
        const devClientPath = path.join(this.buildDir, 'src', 'dev-client.js');
        
        try {
            await fs.unlink(devClientPath);
            console.log('  ✓ Removed development client');
        } catch (error) {
            // File might not exist, ignore
        }

        // Remove dev tools from popup HTML
        const popupPath = path.join(this.buildDir, 'src', 'popup.html');
        let popupContent = await fs.readFile(popupPath, 'utf8');
        
        // Remove dev tools tab
        popupContent = popupContent.replace(
            /<button class="tab-button"[^>]*data-tab="dev"[^>]*>.*?<\/button>/gs,
            ''
        );
        
        // Remove dev tools tab content
        popupContent = popupContent.replace(
            /<div class="tab-content"[^>]*id="dev-tab"[^>]*>.*?<\/div>\s*(?=<div class="tab-content"|<div class="footer-actions">)/gs,
            ''
        );

        await fs.writeFile(popupPath, popupContent);
        console.log('  ✓ Removed development UI elements');
    }

    async updateStyleReferences() {
        const popupPath = path.join(this.buildDir, 'src', 'popup.html');
        let content = await fs.readFile(popupPath, 'utf8');
        
        // Update CSS reference
        content = content.replace(
            'href="popup.css"',
            'href="styles.css"'
        );
        
        await fs.writeFile(popupPath, content);
        console.log('  ✓ Updated CSS references');
    }

    async updateScriptReferences() {
        // Update any script references that might have changed
        const popupPath = path.join(this.buildDir, 'src', 'popup.html');
        let content = await fs.readFile(popupPath, 'utf8');
        
        // Remove dev-client script reference if exists
        content = content.replace(
            /<script[^>]*src="[^"]*dev-client\.js"[^>]*><\/script>/g,
            ''
        );
        
        await fs.writeFile(popupPath, content);
        console.log('  ✓ Updated script references');
    }

    async copyAssets() {
        console.log('🖼️  Copying assets...');
        
        const assetsDir = path.join(this.sourceDir, 'assets');
        const destAssetsDir = path.join(this.buildDir, 'assets');
        
        try {
            await fs.mkdir(destAssetsDir, { recursive: true });
            const files = await fs.readdir(assetsDir);
            
            for (const file of files) {
                const srcPath = path.join(assetsDir, file);
                const destPath = path.join(destAssetsDir, file);
                await fs.copyFile(srcPath, destPath);
                console.log(`  ✓ ${file}`);
            }
        } catch (error) {
            console.log('  ! No assets directory found, skipping');
        }
    }

    async copyLibraries() {
        console.log('📚 Copying libraries...');
        
        const libDir = path.join(this.sourceDir, 'lib');
        const destLibDir = path.join(this.buildDir, 'lib');
        
        try {
            await fs.mkdir(destLibDir, { recursive: true });
            const files = await fs.readdir(libDir);
            
            for (const file of files) {
                const srcPath = path.join(libDir, file);
                const destPath = path.join(destLibDir, file);
                await fs.copyFile(srcPath, destPath);
                console.log(`  ✓ ${file}`);
            }
        } catch (error) {
            console.log('  ! No lib directory found, skipping');
        }
    }

    async generateProductionManifest() {
        console.log('📜 Generating production manifest...');
        
        const manifestPath = path.join(this.sourceDir, 'manifest.json');
        const manifestContent = await fs.readFile(manifestPath, 'utf8');
        const manifest = JSON.parse(manifestContent);

        // Update web accessible resources paths
        if (manifest.web_accessible_resources) {
            manifest.web_accessible_resources.forEach(resource => {
                if (resource.resources) {
                    resource.resources = resource.resources.map(path => {
                        return path
                            .replace('src/enhanced-detection.js', 'src/detector.js')
                            .replace('src/site-rules.js', 'src/rules.js')
                            .replace('src/update-manager.js', 'scripts/update.js');
                    });
                }
            });
        }

        // Remove development permissions in production if needed
        // manifest.permissions = manifest.permissions.filter(p => p !== 'development');

        const destManifestPath = path.join(this.buildDir, 'manifest.json');
        await fs.writeFile(destManifestPath, JSON.stringify(manifest, null, 2));
        
        console.log('  ✓ Production manifest generated');
    }

    async createBuildInfo() {
        const buildInfo = {
            version: this.version,
            buildTime: new Date().toISOString(),
            buildType: 'production',
            nodeVersion: process.version,
            builder: 'extension-build-script'
        };

        const buildInfoPath = path.join(this.buildDir, 'build-info.json');
        await fs.writeFile(buildInfoPath, JSON.stringify(buildInfo, null, 2));
        
        console.log('  ✓ Build info created');
    }

    async showBuildStats() {
        console.log('\n📊 Build Statistics:');
        
        const stats = await this.getBuildStats(this.buildDir);
        
        console.log(`   Files: ${stats.fileCount}`);
        console.log(`   Total size: ${this.formatBytes(stats.totalSize)}`);
        console.log(`   Largest file: ${stats.largestFile.name} (${this.formatBytes(stats.largestFile.size)})`);
    }

    async getBuildStats(dir, stats = { fileCount: 0, totalSize: 0, largestFile: { name: '', size: 0 } }) {
        const items = await fs.readdir(dir);
        
        for (const item of items) {
            const itemPath = path.join(dir, item);
            const stat = await fs.stat(itemPath);
            
            if (stat.isDirectory()) {
                await this.getBuildStats(itemPath, stats);
            } else {
                stats.fileCount++;
                stats.totalSize += stat.size;
                
                if (stat.size > stats.largestFile.size) {
                    stats.largestFile = {
                        name: path.relative(this.buildDir, itemPath),
                        size: stat.size
                    };
                }
            }
        }
        
        return stats;
    }

    formatBytes(bytes) {
        if (bytes === 0) return '0 Bytes';
        
        const k = 1024;
        const sizes = ['Bytes', 'KB', 'MB', 'GB'];
        const i = Math.floor(Math.log(bytes) / Math.log(k));
        
        return parseFloat((bytes / Math.pow(k, i)).toFixed(2)) + ' ' + sizes[i];
    }
}

// Run build if called directly
if (require.main === module) {
    const builder = new ExtensionBuilder();
    builder.build();
}

module.exports = ExtensionBuilder;