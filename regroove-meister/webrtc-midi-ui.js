/**
 * WebRTC-MIDI UI Controller
 * Manages the WebRTC-MIDI tab and integrates with Meister's MIDI system
 */

import { WebRTCMIDIManager } from './webrtc-midi-manager.js';

export class WebRTCMIDIUI {
    constructor(meisterController) {
        this.controller = meisterController;
        this.webrtcManager = null;

        // UI Elements
        this.offerInput = document.getElementById('webrtc-offer-input');
        this.answerOutput = document.getElementById('webrtc-answer-output');
        this.processOfferBtn = document.getElementById('webrtc-process-offer');
        this.copyAnswerBtn = document.getElementById('webrtc-copy-answer');
        this.clearFieldsBtn = document.getElementById('webrtc-clear-fields');
        this.disconnectBtn = document.getElementById('webrtc-disconnect');

        // Status elements
        this.statusIndicator = document.getElementById('webrtc-status-indicator');
        this.statusText = document.getElementById('webrtc-status-text');
        this.targetsCount = document.getElementById('webrtc-targets-count');
        this.statsPanel = document.getElementById('webrtc-stats-panel');
        this.devicesPanel = document.getElementById('webrtc-devices-panel');
        this.devicesList = document.getElementById('webrtc-devices-list');

        // Stats elements
        this.messagesEl = document.getElementById('webrtc-messages');
        this.latencyEl = document.getElementById('webrtc-latency');
        this.bytesEl = document.getElementById('webrtc-bytes');

        // Stats update interval
        this.statsInterval = null;

        this.init();
    }

    async init() {
        console.log('[WebRTC-MIDI UI] Initializing...');

        // Create WebRTC-MIDI manager
        this.webrtcManager = new WebRTCMIDIManager({ debug: true });

        // Setup event handlers
        this.webrtcManager.onMIDIMessage = (message) => {
            this.handleMIDIMessage(message);
        };

        this.webrtcManager.onConnectionStateChange = (state) => {
            this.updateConnectionStatus(state);
        };

        this.webrtcManager.onTargetDiscovered = (target, virtualInput) => {
            this.onTargetDiscovered(target, virtualInput);
        };

        // Initialize the manager
        await this.webrtcManager.initialize();

        // Setup UI event listeners
        this.setupEventListeners();

        console.log('[WebRTC-MIDI UI] Initialized successfully');
    }

    setupEventListeners() {
        // Process Offer button
        this.processOfferBtn.addEventListener('click', () => {
            this.processOffer();
        });

        // Copy Answer button
        this.copyAnswerBtn.addEventListener('click', () => {
            this.copyAnswer();
        });

        // Clear Fields button
        this.clearFieldsBtn.addEventListener('click', () => {
            this.clearFields();
        });

        // Disconnect button
        this.disconnectBtn.addEventListener('click', () => {
            this.disconnect();
        });
    }

    async processOffer() {
        const offerText = this.offerInput.value.trim();

        if (!offerText) {
            alert('Please paste an SDP offer from the sender first');
            return;
        }

        try {
            this.processOfferBtn.disabled = true;
            this.processOfferBtn.textContent = '⏳ PROCESSING...';

            // Process the offer and generate answer
            const answerJSON = await this.webrtcManager.processOffer(offerText);

            // Display the answer
            this.answerOutput.value = answerJSON;
            this.copyAnswerBtn.disabled = false;

            // Auto-select the answer for easy copying
            this.answerOutput.select();

            console.log('[WebRTC-MIDI UI] Answer generated successfully');
        } catch (error) {
            console.error('[WebRTC-MIDI UI] Error processing offer:', error);
            alert(`Error processing offer: ${error.message}`);
            this.answerOutput.value = `Error: ${error.message}`;
        } finally {
            this.processOfferBtn.disabled = false;
            this.processOfferBtn.textContent = '🔄 PROCESS OFFER & GENERATE ANSWER';
        }
    }

    copyAnswer() {
        this.answerOutput.select();
        document.execCommand('copy');

        // Visual feedback
        const originalText = this.copyAnswerBtn.textContent;
        this.copyAnswerBtn.textContent = '✓ COPIED!';
        this.copyAnswerBtn.style.background = '#2a4a2a';

        setTimeout(() => {
            this.copyAnswerBtn.textContent = originalText;
            this.copyAnswerBtn.style.background = '';
        }, 2000);
    }

    clearFields() {
        this.offerInput.value = '';
        this.answerOutput.value = '';
        this.copyAnswerBtn.disabled = true;
    }

    disconnect() {
        if (confirm('Are you sure you want to disconnect from the WebRTC-MIDI bridge?')) {
            this.webrtcManager.disconnect();
            this.clearFields();
            this.updateDevicesList([]);
        }
    }

    updateConnectionStatus(state) {
        console.log('[WebRTC-MIDI UI] Connection state:', state);

        // Update status indicator
        switch (state) {
            case 'connected':
                this.statusIndicator.style.background = '#4a9e4a';
                this.statusText.textContent = 'Connected';
                this.statusText.style.color = '#4a9e4a';
                this.disconnectBtn.disabled = false;
                this.statsPanel.hidden = false;
                this.devicesPanel.hidden = false;

                // Refresh MIDI outputs dropdown to show virtual devices
                if (this.controller && this.controller.populateMIDIOutputs) {
                    this.controller.populateMIDIOutputs();
                }

                // Start stats update
                this.startStatsUpdate();
                break;

            case 'connecting':
                this.statusIndicator.style.background = '#4a9eff';
                this.statusText.textContent = 'Connecting...';
                this.statusText.style.color = '#4a9eff';
                this.disconnectBtn.disabled = true;
                break;

            case 'disconnected':
            case 'failed':
                this.statusIndicator.style.background = '#555';
                this.statusText.textContent = 'Disconnected';
                this.statusText.style.color = '#888';
                this.disconnectBtn.disabled = true;
                this.statsPanel.hidden = true;
                this.devicesPanel.hidden = true;

                // Refresh MIDI outputs dropdown to remove virtual devices
                if (this.controller && this.controller.populateMIDIOutputs) {
                    this.controller.populateMIDIOutputs();
                }

                // Stop stats update
                this.stopStatsUpdate();
                break;
        }
    }

    startStatsUpdate() {
        if (this.statsInterval) return;

        this.statsInterval = setInterval(() => {
            this.updateStats();
        }, 1000); // Update every second

        // Initial update
        this.updateStats();
    }

    stopStatsUpdate() {
        if (this.statsInterval) {
            clearInterval(this.statsInterval);
            this.statsInterval = null;
        }
    }

    updateStats() {
        const stats = this.webrtcManager.getStats();

        this.messagesEl.textContent = stats.messagesReceived || 0;
        this.latencyEl.textContent = `${(stats.latency || 0).toFixed(1)}ms`;
        this.bytesEl.textContent = this.formatBytes(stats.bytesReceived || 0);
        this.targetsCount.textContent = stats.virtualInputs || 0;

        // Update devices list
        if (stats.targets) {
            this.updateDevicesList(stats.targets);
        }
    }

    updateDevicesList(targets) {
        if (!targets || targets.length === 0) {
            this.devicesList.innerHTML = '<div style="color: #666;">No virtual devices</div>';
            return;
        }

        const html = targets.map(target => `
            <div style="padding: 8px; background: #1a1a1a; border-radius: 3px; margin-bottom: 5px; display: flex; justify-content: space-between; align-items: center;">
                <div style="display: flex; align-items: center; gap: 8px;">
                    <span style="display: inline-block; width: 6px; height: 6px; border-radius: 50%; background: #4a9eff;"></span>
                    <span style="color: #ddd; font-weight: bold;">WebRTC MIDI (${target})</span>
                </div>
                <span style="color: #666; font-size: 0.75em;">Target: ${target}</span>
            </div>
        `).join('');

        this.devicesList.innerHTML = html;
    }

    handleMIDIMessage(message) {
        const { data, timeStamp, target, latency } = message;

        // Forward to Meister's MIDI handling system
        if (this.controller && this.controller.handleMIDIInput) {
            // Create a MIDI event-like object
            const midiEvent = {
                data: data,
                timeStamp: timeStamp,
                target: {
                    id: `webrtc-midi-${target}`,
                    name: `WebRTC MIDI (${target})`,
                    manufacturer: 'WebRTC'
                }
            };

            this.controller.handleMIDIInput(midiEvent);
        }
    }

    onTargetDiscovered(target, virtualInput) {
        console.log('[WebRTC-MIDI UI] New target discovered:', target, virtualInput);

        // Show notification to user
        const notification = document.createElement('div');
        notification.style.cssText = `
            position: fixed;
            bottom: 20px;
            right: 20px;
            background: #1a3a1a;
            color: #4a9e4a;
            padding: 15px 20px;
            border-radius: 4px;
            border: 1px solid #2a4a2a;
            z-index: 10000;
            font-size: 0.9em;
        `;
        notification.textContent = `✓ WebRTC MIDI device connected: ${target}`;

        document.body.appendChild(notification);

        setTimeout(() => {
            notification.remove();
        }, 3000);
    }

    formatBytes(bytes) {
        if (bytes < 1024) return bytes + 'B';
        if (bytes < 1024 * 1024) return (bytes / 1024).toFixed(1) + 'KB';
        return (bytes / (1024 * 1024)).toFixed(1) + 'MB';
    }

    /**
     * Get the WebRTC-MIDI manager instance
     */
    getManager() {
        return this.webrtcManager;
    }
}

export default WebRTCMIDIUI;
