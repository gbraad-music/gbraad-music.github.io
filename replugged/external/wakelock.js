/**
 * Wake Lock Utility for Regroove Audio Tools
 * Prevents screen from sleeping during playback/performance
 *
 * Based on controller-midi-web implementation
 * Handles Page Visibility API and Screen Wake Lock API
 *
 * Usage:
 *   import { WakeLockManager } from './utils/wakelock.js';
 *   const wakeLock = new WakeLockManager();
 *
 *   // Request wake lock when playback starts
 *   await wakeLock.request();
 *
 *   // Release when stopped
 *   wakeLock.release();
 *
 * Copyright (C) 2025
 * SPDX-License-Identifier: ISC
 */

export class WakeLockManager {
    constructor() {
        this.wakeLock = null;
        this.isSupported = 'wakeLock' in navigator;

        // Automatically re-request wake lock when page becomes visible again
        if (this.isSupported) {
            document.addEventListener('visibilitychange', async () => {
                if (this.wakeLock !== null && document.visibilityState === 'visible') {
                    console.log('[WakeLock] Page visible again, re-requesting wake lock');
                    await this.request();
                }
            });
        }
    }

    /**
     * Request screen wake lock
     * @returns {Promise<boolean>} true if successful, false otherwise
     */
    async request() {
        if (!this.isSupported) {
            console.warn('[WakeLock] Screen Wake Lock API not supported');
            return false;
        }

        try {
            this.wakeLock = await navigator.wakeLock.request('screen');
            console.log('[WakeLock] Screen wake lock acquired');

            // Handle wake lock release (e.g., when tab is hidden)
            this.wakeLock.addEventListener('release', () => {
                console.log('[WakeLock] Screen wake lock released');
            });

            return true;
        } catch (err) {
            console.error('[WakeLock] Failed to acquire wake lock:', err.name, err.message);
            this.wakeLock = null;
            return false;
        }
    }

    /**
     * Release screen wake lock
     */
    async release() {
        if (this.wakeLock) {
            try {
                await this.wakeLock.release();
                this.wakeLock = null;
                console.log('[WakeLock] Screen wake lock released manually');
            } catch (err) {
                console.error('[WakeLock] Failed to release wake lock:', err);
            }
        }
    }

    /**
     * Check if wake lock is currently active
     * @returns {boolean}
     */
    isActive() {
        return this.wakeLock !== null;
    }

    /**
     * Get support status
     * @returns {boolean}
     */
    isWakeLockSupported() {
        return this.isSupported;
    }
}

/**
 * Page Visibility Manager
 * Detects when tab is hidden/visible to optimize animations
 *
 * Usage:
 *   const visibilityManager = new PageVisibilityManager();
 *   visibilityManager.onVisibilityChange((isVisible) => {
 *       console.log('Page visible:', isVisible);
 *   });
 */
export class PageVisibilityManager {
    constructor() {
        this.callbacks = [];
        this.isVisible = !document.hidden;

        document.addEventListener('visibilitychange', () => {
            this.isVisible = !document.hidden;
            console.log('[Visibility] Page is now', this.isVisible ? 'visible' : 'hidden');

            // Notify all callbacks
            this.callbacks.forEach(callback => callback(this.isVisible));
        });
    }

    /**
     * Register callback for visibility changes
     * @param {Function} callback - Called with (isVisible) parameter
     */
    onVisibilityChange(callback) {
        this.callbacks.push(callback);
    }

    /**
     * Check if page is currently visible
     * @returns {boolean}
     */
    isPageVisible() {
        return this.isVisible;
    }
}

// Create default singleton instances
export const wakeLockManager = new WakeLockManager();
export const visibilityManager = new PageVisibilityManager();
