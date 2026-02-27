/**
 * Device Loader
 * Loads and manages MIDI device definitions
 */

class DeviceLoader {
    constructor() {
        this.devices = new Map();
        this.currentDevice = null;
    }

    /**
     * Load all device definitions from the devices directory
     */
    async loadAllDevices() {
        try {
            // Load the devices manifest
            const manifestResponse = await fetch('./devices.json');
            if (!manifestResponse.ok) {
                throw new Error(`Failed to load devices manifest: ${manifestResponse.status}`);
            }

            const manifest = await manifestResponse.json();
            const deviceFiles = manifest.devices.map(d => d.file);

            console.log(`[DeviceLoader] Found ${deviceFiles.length} device(s) in manifest`);

            const loadPromises = deviceFiles.map(file => this.loadDevice(file));
            await Promise.all(loadPromises);

            console.log(`[DeviceLoader] Loaded ${this.devices.size} device definition(s)`);
            return Array.from(this.devices.values());
        } catch (error) {
            console.error('[DeviceLoader] Failed to load devices:', error);
            return [];
        }
    }

    /**
     * Load a single device definition
     */
    async loadDevice(filename) {
        try {
            const response = await fetch(`./devices/${filename}`, {
                cache: 'no-cache'
            });
            if (!response.ok) {
                throw new Error(`HTTP error! status: ${response.status}`);
            }

            const deviceDef = await response.json();
            this.devices.set(deviceDef.id, deviceDef);
            console.log(`[DeviceLoader] Loaded: ${deviceDef.name}`);
            return deviceDef;
        } catch (error) {
            console.error(`[DeviceLoader] Failed to load ${filename}:`, error);
            return null;
        }
    }

    /**
     * Get device definition by ID
     */
    getDevice(id) {
        return this.devices.get(id);
    }

    /**
     * Get all device definitions
     */
    getAllDevices() {
        return Array.from(this.devices.values());
    }

    /**
     * Find device by MIDI device inquiry response
     */
    findDeviceByInquiry(manufacturerId, familyId, memberId) {
        for (const device of this.devices.values()) {
            if (!device.deviceInquiry) continue;

            const mfrMatch = parseInt(device.deviceInquiry.manufacturerId) === manufacturerId;

            let familyMatch = false;
            if (Array.isArray(device.deviceInquiry.familyId)) {
                const familyLSB = parseInt(device.deviceInquiry.familyId[0]);
                const familyMSB = parseInt(device.deviceInquiry.familyId[1]);
                familyMatch = (familyLSB === familyId[0] && familyMSB === familyId[1]);
            } else {
                familyMatch = parseInt(device.deviceInquiry.familyId) === familyId;
            }

            const memberMatch = parseInt(device.deviceInquiry.memberId) === memberId;

            if (mfrMatch && familyMatch && memberMatch) {
                return device;
            }
        }
        return null;
    }

    /**
     * Set current active device
     */
    setCurrentDevice(deviceId) {
        const device = this.getDevice(deviceId);
        if (device) {
            this.currentDevice = device;
            console.log(`[DeviceLoader] Set current device: ${device.name}`);
            return true;
        }
        return false;
    }

    /**
     * Get current active device
     */
    getCurrentDevice() {
        return this.currentDevice;
    }
}

// Export for use in other modules
if (typeof module !== 'undefined' && module.exports) {
    module.exports = DeviceLoader;
}
