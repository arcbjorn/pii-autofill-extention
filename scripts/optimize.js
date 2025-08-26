#!/usr/bin/env node

// Extension optimization script
const fs = require('fs').promises;
const path = require('path');

class ExtensionOptimizer {
    constructor() {
        this.sourceDir = path.join(__dirname, '..');
        this.optimizations = {
            minifyContent: true,
            bundleModules: true,
            removeComments: true,
            optimizeImages: false,
            analyzeBundles: true
        };
    }

    async optimize() {
        console.log('🔧 Starting extension optimization...\n');

        try {
            await this.analyzeCurrentSize();
            await this.optimizeContentScript();
            await this.createOptimizedBuild();
            await this.analyzeOptimizedSize();
            await this.generateReport();

            console.log('✅ Optimization completed successfully!');

        } catch (error) {
            console.error('❌ Optimization failed:', error);
            process.exit(1);
        }
    }

    async analyzeCurrentSize() {
        console.log('📊 Analyzing current bundle sizes...');
        
        const files = [
            'src/content.js',
            'src/detector.js',
            'src/rules.js',
            'src/popup.js',
            'src/background.js'
        ];

        let totalSize = 0;
        const sizes = {};

        for (const file of files) {
            try {
                const filePath = path.join(this.sourceDir, file);
                const content = await fs.readFile(filePath, 'utf8');
                const size = Buffer.byteLength(content, 'utf8');
                sizes[file] = size;
                totalSize += size;
                console.log(`  ${file}: ${this.formatBytes(size)}`);
            } catch (error) {
                console.warn(`  ${file}: Not found`);
            }
        }

        console.log(`  Total: ${this.formatBytes(totalSize)}\n`);
        this.originalSizes = sizes;
        this.originalTotal = totalSize;
    }

    async optimizeContentScript() {
        console.log('⚡ Creating optimized content script...');

        // Use the minimal content script for production
        const minimalPath = path.join(this.sourceDir, 'src/content-minimal.js');
        const originalPath = path.join(this.sourceDir, 'src/content.js');
        
        try {
            const minimalContent = await fs.readFile(minimalPath, 'utf8');
            const originalContent = await fs.readFile(originalPath, 'utf8');

            const minimalSize = Buffer.byteLength(minimalContent, 'utf8');
            const originalSize = Buffer.byteLength(originalContent, 'utf8');

            console.log(`  Original content.js: ${this.formatBytes(originalSize)}`);
            console.log(`  Optimized content.js: ${this.formatBytes(minimalSize)}`);
            console.log(`  Size reduction: ${this.formatBytes(originalSize - minimalSize)} (${Math.round(((originalSize - minimalSize) / originalSize) * 100)}%)`);

        } catch (error) {
            console.warn('Could not compare content script sizes:', error.message);
        }
    }

    async createOptimizedBuild() {
        console.log('🏗️ Creating optimized build...');

        const distDir = path.join(this.sourceDir, 'dist-optimized');
        
        // Clean and create dist directory
        await fs.rm(distDir, { recursive: true, force: true });
        await fs.mkdir(distDir, { recursive: true });

        // Copy and optimize files
        await this.copyOptimizedFiles(distDir);
        await this.createOptimizedManifest(distDir);
        
        console.log(`  Optimized build created in: ${distDir}`);
    }

    async copyOptimizedFiles(distDir) {
        const srcDir = path.join(distDir, 'src');
        await fs.mkdir(srcDir, { recursive: true });

        // Copy core files with optimizations
        const filesToCopy = [
            { from: 'src/content-minimal.js', to: 'src/content.js' },
            { from: 'src/background.js', to: 'src/background.js' },
            { from: 'src/popup.html', to: 'src/popup.html' },
            { from: 'src/popup.js', to: 'src/popup.js' },
            { from: 'src/styles.css', to: 'src/styles.css' },
            { from: 'src/storage-optimized.js', to: 'src/storage.js' },
            { from: 'src/cache-manager.js', to: 'src/cache-manager.js' }
        ];

        // Copy lib directory
        const libSrcDir = path.join(this.sourceDir, 'lib');
        const libDistDir = path.join(distDir, 'lib');
        
        try {
            await fs.mkdir(libDistDir, { recursive: true });
            const libFiles = await fs.readdir(libSrcDir);
            
            for (const file of libFiles) {
                await fs.copyFile(
                    path.join(libSrcDir, file),
                    path.join(libDistDir, file)
                );
            }
        } catch (error) {
            console.warn('Could not copy lib directory:', error.message);
        }

        // Copy and optimize each file
        for (const { from, to } of filesToCopy) {
            try {
                const sourcePath = path.join(this.sourceDir, from);
                const destPath = path.join(distDir, to);
                
                let content = await fs.readFile(sourcePath, 'utf8');
                
                // Apply optimizations
                if (this.optimizations.removeComments) {
                    content = this.removeComments(content);
                }
                
                if (this.optimizations.minifyContent && (from.endsWith('.js') || from.endsWith('.css'))) {
                    content = this.minifyContent(content);
                }

                await fs.writeFile(destPath, content);
                
            } catch (error) {
                console.warn(`Could not optimize ${from}:`, error.message);
                
                // Fallback: try to copy original
                try {
                    await fs.copyFile(
                        path.join(this.sourceDir, from),
                        path.join(distDir, to)
                    );
                } catch (fallbackError) {
                    console.warn(`Fallback copy also failed for ${from}`);
                }
            }
        }

        // Copy lazy-loaded modules (for dynamic loading)
        const lazyModules = [
            { from: 'src/detector.js', to: 'src/detector.js' },
            { from: 'src/rules.js', to: 'src/rules.js' }
        ];

        for (const { from, to } of lazyModules) {
            try {
                await fs.copyFile(
                    path.join(this.sourceDir, from),
                    path.join(distDir, to)
                );
            } catch (error) {
                console.warn(`Could not copy lazy module ${from}:`, error.message);
            }
        }
    }

    async createOptimizedManifest(distDir) {
        const manifestPath = path.join(this.sourceDir, 'manifest.json');
        const manifest = JSON.parse(await fs.readFile(manifestPath, 'utf8'));

        // Update web accessible resources for optimized build
        if (manifest.web_accessible_resources) {
            manifest.web_accessible_resources.forEach(resource => {
                if (resource.resources) {
                    resource.resources = resource.resources.filter(res => 
                        !res.includes('content-optimized') && 
                        !res.includes('storage-optimized') &&
                        !res.includes('cache-manager')
                    );
                }
            });
        }

        await fs.writeFile(
            path.join(distDir, 'manifest.json'),
            JSON.stringify(manifest, null, 2)
        );
    }

    removeComments(content) {
        // Remove single-line comments
        content = content.replace(/^\s*\/\/.*$/gm, '');
        
        // Remove multi-line comments (simple approach)
        content = content.replace(/\/\*[\s\S]*?\*\//g, '');
        
        // Remove empty lines
        content = content.replace(/^\s*\n/gm, '');
        
        return content;
    }

    minifyContent(content) {
        // Simple minification
        return content
            .replace(/\s+/g, ' ')  // Collapse whitespace
            .replace(/;\s*}/g, '}')  // Remove semicolons before closing braces
            .replace(/\s*{\s*/g, '{')  // Clean up braces
            .replace(/\s*}\s*/g, '}')
            .replace(/\s*,\s*/g, ',')  // Clean up commas
            .replace(/\s*;\s*/g, ';')  // Clean up semicolons
            .trim();
    }

    async analyzeOptimizedSize() {
        console.log('📊 Analyzing optimized bundle sizes...');

        const distDir = path.join(this.sourceDir, 'dist-optimized');
        const files = [
            'src/content.js',
            'src/popup.js',
            'src/background.js'
        ];

        let totalSize = 0;
        const sizes = {};

        for (const file of files) {
            try {
                const filePath = path.join(distDir, file);
                const content = await fs.readFile(filePath, 'utf8');
                const size = Buffer.byteLength(content, 'utf8');
                sizes[file] = size;
                totalSize += size;
                console.log(`  ${file}: ${this.formatBytes(size)}`);
            } catch (error) {
                console.warn(`  ${file}: Not found`);
            }
        }

        console.log(`  Total: ${this.formatBytes(totalSize)}\n`);
        this.optimizedSizes = sizes;
        this.optimizedTotal = totalSize;
    }

    async generateReport() {
        console.log('📋 Optimization Report:');
        
        const savings = this.originalTotal - this.optimizedTotal;
        const percentage = Math.round((savings / this.originalTotal) * 100);
        
        console.log(`  Original size: ${this.formatBytes(this.originalTotal)}`);
        console.log(`  Optimized size: ${this.formatBytes(this.optimizedTotal)}`);
        console.log(`  Space saved: ${this.formatBytes(savings)} (${percentage}%)`);
        
        console.log('\n🔧 Optimizations applied:');
        console.log('  ✓ Minimal content script (lazy loading)');
        console.log('  ✓ Field detection caching');
        console.log('  ✓ Debounced DOM observation');
        console.log('  ✓ Optimized Chrome storage usage');
        console.log('  ✓ Comment and whitespace removal');
        
        // Performance recommendations
        console.log('\n💡 Performance recommendations:');
        if (this.optimizedTotal > 100000) {
            console.log('  • Consider code splitting for large modules');
        }
        if (percentage < 20) {
            console.log('  • Enable advanced minification for better compression');
        }
        console.log('  • Test extension performance with Chrome DevTools');
        console.log('  • Monitor memory usage in background pages');
        console.log('  • Use content script caching for repeated operations');

        // Save report to file
        const report = {
            timestamp: new Date().toISOString(),
            original: {
                totalSize: this.originalTotal,
                files: this.originalSizes
            },
            optimized: {
                totalSize: this.optimizedTotal,
                files: this.optimizedSizes
            },
            savings: {
                bytes: savings,
                percentage
            },
            optimizations: [
                'Minimal content script',
                'Field detection caching',
                'Debounced DOM observation',
                'Optimized storage usage',
                'Code minification'
            ]
        };

        await fs.writeFile(
            path.join(this.sourceDir, 'optimization-report.json'),
            JSON.stringify(report, null, 2)
        );
    }

    formatBytes(bytes) {
        if (bytes === 0) return '0 B';
        
        const k = 1024;
        const sizes = ['B', 'KB', 'MB'];
        const i = Math.floor(Math.log(bytes) / Math.log(k));
        
        return parseFloat((bytes / Math.pow(k, i)).toFixed(1)) + ' ' + sizes[i];
    }
}

// Run optimization if called directly
if (require.main === module) {
    const optimizer = new ExtensionOptimizer();
    optimizer.optimize();
}

module.exports = ExtensionOptimizer;