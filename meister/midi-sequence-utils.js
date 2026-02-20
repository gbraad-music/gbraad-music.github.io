/**
 * MIDI Sequence Upload/Download Utilities for Samplecrate
 * Handles 7-bit encoding and chunked SysEx transmission for bidirectional sequence transfer
 */

/**
 * Encode 8-bit binary data to 7-bit for MIDI SysEx
 * For every 7 bytes of input, produces 8 bytes of output:
 *   Byte 0:   MSBs (top bit of each of the 7 input bytes)
 *   Bytes 1-7: Lower 7 bits of each input byte
 *
 * @param {Uint8Array} data - Raw 8-bit data
 * @returns {Uint8Array} - 7-bit encoded data
 */
export function encode7bit(data) {
    const inputLen = data.length;
    const numBlocks = Math.ceil(inputLen / 7);
    const outputLen = numBlocks * 8;
    const output = new Uint8Array(outputLen);

    for (let i = 0; i < numBlocks; i++) {
        const blockStart = i * 7;
        const blockEnd = Math.min(blockStart + 7, inputLen);
        const blockSize = blockEnd - blockStart;

        // Collect MSBs
        let msbs = 0;
        for (let j = 0; j < blockSize; j++) {
            const byte = data[blockStart + j];
            if (byte & 0x80) {
                msbs |= (1 << j);
            }
        }

        // Write MSBs byte
        output[i * 8] = msbs;

        // Write lower 7 bits of each byte
        for (let j = 0; j < blockSize; j++) {
            output[i * 8 + 1 + j] = data[blockStart + j] & 0x7F;
        }

        // Pad remaining bytes with 0 if last block is short
        for (let j = blockSize; j < 7; j++) {
            output[i * 8 + 1 + j] = 0;
        }
    }

    return output;
}

/**
 * Decode 7-bit MIDI SysEx data back to 8-bit
 *
 * @param {Uint8Array} encoded - 7-bit encoded data
 * @returns {Uint8Array} - Original 8-bit data
 */
export function decode7bit(encoded) {
    const numBlocks = Math.floor(encoded.length / 8);
    const output = new Uint8Array(numBlocks * 7);

    for (let i = 0; i < numBlocks; i++) {
        const msbs = encoded[i * 8];

        for (let j = 0; j < 7; j++) {
            const lsb = encoded[i * 8 + 1 + j];
            const msb = (msbs & (1 << j)) ? 0x80 : 0;
            output[i * 7 + j] = lsb | msb;
        }
    }

    return output;
}

/**
 * Split binary data into chunks suitable for SysEx transmission
 *
 * @param {Uint8Array} data - Raw data to chunk
 * @param {number} chunkSize - Size of each chunk in bytes (default: 256)
 * @returns {Array<Uint8Array>} - Array of chunks
 */
export function chunkData(data, chunkSize = 256) {
    const chunks = [];
    for (let i = 0; i < data.length; i += chunkSize) {
        chunks.push(data.slice(i, i + chunkSize));
    }
    return chunks;
}

/**
 * Build SysEx message for sequence upload start
 * Command: 0x42, Subcommand: 0x00 (START)
 *
 * @param {number} deviceId - Target device ID (0-127)
 * @param {number} slot - Sequence slot number (0-15)
 * @param {number} program - Program/pad number (0-31=PROG 1-32, 127=NO PROG)
 *                           NOTE: For Samplecrate, 127 is stored as -1 (follow UI behavior)
 * @param {number} totalChunks - Total number of chunks
 * @param {number} fileSize - Total file size in bytes
 * @returns {Uint8Array} - SysEx message
 */
export function buildUploadStartMessage(deviceId, slot, program, totalChunks, fileSize) {
    const message = new Uint8Array([
        0xF0,                           // SysEx start
        0x7D,                           // Manufacturer ID (Educational/Research)
        deviceId & 0x7F,                // Device ID
        0x42,                           // Command: SEQUENCE_TRACK_UPLOAD (FIXED: was 0x80)
        0x00,                           // Subcommand: START
        slot & 0x0F,                    // Slot (0-15)
        program & 0x7F,                 // Program/pad (0-31 or 127)
        totalChunks & 0x7F,             // Total chunks (lower 7 bits)
        fileSize & 0x7F,                // File size LSB
        (fileSize >> 7) & 0x7F,         // File size MSB
        0xF7                            // SysEx end
    ]);

    console.log(`[MIDI Upload] START message: deviceId=${deviceId}, slot=${slot}, program=${program}, chunks=${totalChunks}, size=${fileSize}`);
    console.log(`[MIDI Upload] START SysEx bytes: ${Array.from(message).map(b => '0x' + b.toString(16).padStart(2, '0')).join(' ')}`);

    return message;
}

/**
 * Build SysEx message for uploading a chunk
 * Command: 0x42, Subcommand: 0x01 (CHUNK)
 *
 * @param {number} deviceId - Target device ID (0-127)
 * @param {number} slot - Sequence slot number (0-15)
 * @param {number} chunkNum - Chunk number (0-based)
 * @param {Uint8Array} chunkData - Raw chunk data (will be 7-bit encoded)
 * @returns {Uint8Array} - SysEx message
 */
export function buildUploadChunkMessage(deviceId, slot, chunkNum, chunkData) {
    // 7-bit encode the chunk data
    const encoded = encode7bit(chunkData);

    // Build SysEx message
    const message = new Uint8Array(7 + encoded.length + 1);
    message[0] = 0xF0;                  // SysEx start
    message[1] = 0x7D;                  // Manufacturer ID
    message[2] = deviceId & 0x7F;       // Device ID
    message[3] = 0x42;                  // Command: SEQUENCE_TRACK_UPLOAD
    message[4] = 0x01;                  // Subcommand: CHUNK
    message[5] = slot & 0x0F;           // Slot
    message[6] = chunkNum & 0x7F;       // Chunk number

    // Copy encoded data
    message.set(encoded, 7);

    message[message.length - 1] = 0xF7; // SysEx end

    return message;
}

/**
 * Build SysEx message for upload complete
 * Command: 0x42, Subcommand: 0x02 (COMPLETE)
 *
 * @param {number} deviceId - Target device ID (0-127)
 * @param {number} slot - Sequence slot number (0-15)
 * @returns {Uint8Array} - SysEx message
 */
export function buildUploadCompleteMessage(deviceId, slot) {
    return new Uint8Array([
        0xF0,                           // SysEx start
        0x7D,                           // Manufacturer ID
        deviceId & 0x7F,                // Device ID
        0x42,                           // Command: SEQUENCE_TRACK_UPLOAD (FIXED: was 0x80)
        0x02,                           // Subcommand: COMPLETE
        slot & 0x0F,                    // Slot
        0xF7                            // SysEx end
    ]);
}

/**
 * Build SysEx message for sequence playback control
 *
 * @param {number} deviceId - Target device ID (0-127)
 * @param {number} slot - Sequence slot number (0-15)
 * @param {string} action - 'play' or 'stop'
 * @param {boolean} loop - Loop mode (true=LOOP, false=ONESHOT) - only used for 'play'
 * @returns {Uint8Array} - SysEx message
 */
export function buildPlaybackControlMessage(deviceId, slot, action, loop = true) {
    if (action === 'play') {
        // SEQUENCE_TRACK_PLAY: F0 7D <dev> 0x44 <slot> <loop_mode> F7
        return new Uint8Array([
            0xF0,                           // SysEx start
            0x7D,                           // Manufacturer ID
            deviceId & 0x7F,                // Device ID
            0x44,                           // Command: SEQUENCE_TRACK_PLAY (FIXED: was 0x82)
            slot & 0x0F,                    // Slot (0-15 per spec)
            loop ? 0x01 : 0x00,             // Loop mode: 0=ONESHOT, 1=LOOP
            0xF7                            // SysEx end
        ]);
    } else if (action === 'stop') {
        // SEQUENCE_TRACK_STOP: F0 7D <dev> 0x45 <slot> F7
        return new Uint8Array([
            0xF0,                           // SysEx start
            0x7D,                           // Manufacturer ID
            deviceId & 0x7F,                // Device ID
            0x45,                           // Command: SEQUENCE_TRACK_STOP (FIXED: was 0x83)
            slot & 0x0F,                    // Slot (0-15 per spec)
            0xF7                            // SysEx end
        ]);
    } else {
        throw new Error(`Unknown playback action: ${action}`);
    }
}

/**
 * Build SysEx message for sequence track mute control
 * Command: 0x46
 *
 * @param {number} deviceId - Target device ID (0-127)
 * @param {number} slot - Sequence slot number (0-15)
 * @param {boolean} mute - Mute state (true=MUTE, false=UNMUTE)
 * @returns {Uint8Array} - SysEx message
 */
export function buildMuteMessage(deviceId, slot, mute) {
    return new Uint8Array([
        0xF0,                           // SysEx start
        0x7D,                           // Manufacturer ID
        deviceId & 0x7F,                // Device ID
        0x46,                           // Command: SEQUENCE_TRACK_MUTE (FIXED: was 0x84)
        slot & 0x0F,                    // Slot (0-15 per spec)
        mute ? 0x01 : 0x00,             // Mute: 0=UNMUTE, 1=MUTE
        0xF7                            // SysEx end
    ]);
}

/**
 * Build SysEx message for sequence track solo control
 * Command: 0x47
 *
 * @param {number} deviceId - Target device ID (0-127)
 * @param {number} slot - Sequence slot number (0-15)
 * @param {boolean} solo - Solo state (true=SOLO, false=UNSOLO)
 * @returns {Uint8Array} - SysEx message
 */
export function buildSoloMessage(deviceId, slot, solo) {
    return new Uint8Array([
        0xF0,                           // SysEx start
        0x7D,                           // Manufacturer ID
        deviceId & 0x7F,                // Device ID
        0x47,                           // Command: SEQUENCE_TRACK_SOLO (FIXED: was 0x85)
        slot & 0x0F,                    // Slot (0-15 per spec)
        solo ? 0x01 : 0x00,             // Solo: 0=UNSOLO, 1=SOLO
        0xF7                            // SysEx end
    ]);
}

/**
 * Build SysEx message for querying sequence state
 * Command: 0x48
 *
 * @param {number} deviceId - Target device ID (0-127)
 * @param {number} slot - Sequence slot number (0-15)
 * @returns {Uint8Array} - SysEx message
 */
export function buildGetStateMessage(deviceId, slot) {
    return new Uint8Array([
        0xF0,                           // SysEx start
        0x7D,                           // Manufacturer ID
        deviceId & 0x7F,                // Device ID
        0x48,                           // Command: SEQUENCE_TRACK_GET_STATE (FIXED: was 0x86)
        slot & 0x0F,                    // Slot
        0xF7                            // SysEx end
    ]);
}

/**
 * Build SysEx message for clearing a sequence slot
 * Command: 0x4A
 *
 * @param {number} deviceId - Target device ID (0-127)
 * @param {number} slot - Sequence slot number (0-15)
 * @returns {Uint8Array} - SysEx message
 */
export function buildClearSlotMessage(deviceId, slot) {
    return new Uint8Array([
        0xF0,                           // SysEx start
        0x7D,                           // Manufacturer ID
        deviceId & 0x7F,                // Device ID
        0x4A,                           // Command: SEQUENCE_TRACK_CLEAR (FIXED: was 0x88)
        slot & 0x0F,                    // Slot
        0xF7                            // SysEx end
    ]);
}

/**
 * Build SysEx message for listing all sequence slots
 * Command: 0x4B
 *
 * @param {number} deviceId - Target device ID (0-127)
 * @returns {Uint8Array} - SysEx message
 */
export function buildListSlotsMessage(deviceId) {
    return new Uint8Array([
        0xF0,                           // SysEx start
        0x7D,                           // Manufacturer ID
        deviceId & 0x7F,                // Device ID
        0x4B,                           // Command: SEQUENCE_TRACK_LIST (FIXED: was 0x89)
        0xF7                            // SysEx end
    ]);
}

/**
 * Build SysEx message for getting complete sequence state
 * Command: 0x62 (GET_SEQUENCE_STATE)
 *
 * @param {number} deviceId - Target device ID (0-127)
 * @returns {Uint8Array} - SysEx message
 */
export function buildGetSequenceStateMessage(deviceId) {
    return new Uint8Array([
        0xF0,                           // SysEx start
        0x7D,                           // Manufacturer ID
        deviceId & 0x7F,                // Device ID
        0x62,                           // Command: GET_SEQUENCE_STATE
        0xF7                            // SysEx end
    ]);
}

/**
 * Build SysEx message for getting program state (Samplecrate mixer)
 * Command: 0x64 (GET_PROGRAM_STATE)
 *
 * @param {number} deviceId - Target device ID (0-127)
 * @returns {Uint8Array} - SysEx message
 */
export function buildGetProgramStateMessage(deviceId) {
    return new Uint8Array([
        0xF0,                           // SysEx start
        0x7D,                           // Manufacturer ID
        deviceId & 0x7F,                // Device ID
        0x64,                           // Command: GET_PROGRAM_STATE
        0xF7                            // SysEx end
    ]);
}

/**
 * Parse SEQUENCE_STATE_RESPONSE (0x63) from Samplecrate
 * Returns state for all 16 sequence slots
 *
 * @param {Uint8Array} data - SysEx message data
 * @returns {Object|null} - Parsed sequence state or null if invalid
 */
export function parseSequenceStateResponse(data) {
    // Format: F0 7D <dev> 63 <70 bytes of state> F7
    // Total: 4 header + 70 data + 1 end = 75 bytes

    if (data.length < 75) {
        console.warn(`[SequenceState] Message too short: ${data.length} bytes (expected 75)`);
        return null;
    }

    if (data[0] !== 0xF0 || data[1] !== 0x7D || data[3] !== 0x63) {
        return null; // Not a sequence state response
    }

    // State data starts at byte 4
    const version = data[4];
    const numSlots = data[5];
    const startMode = data[6];
    // data[7] is reserved

    // Mute bits (bytes 8-9, 2 bytes for 16 slots)
    const muteByte0 = data[8];
    const muteByte1 = data[9];

    // Parse slot states
    const slots = [];
    for (let i = 0; i < 16; i++) {
        const flagsByte = data[10 + i];  // Bytes 10-25 (slot flags, 16 bytes)
        const program = data[26 + i];     // Bytes 26-41 (program assignments, 16 bytes)
        const phrase = data[42 + i];      // Bytes 42-57 (current phrase, 16 bytes)
        const totalPhrases = data[58 + i]; // Bytes 58-73 (total phrases, 16 bytes)

        // Extract mute state from mute bits
        const muteByteIndex = i < 8 ? muteByte0 : muteByte1;
        const muteBitIndex = i % 8;
        const muted = (muteByteIndex & (1 << muteBitIndex)) !== 0;

        const slotState = {
            slot: i,
            loaded: (flagsByte & 0x01) !== 0,
            playing: (flagsByte & 0x02) !== 0,
            looping: (flagsByte & 0x10) !== 0,
            muted: muted,
            program: program === 0x7F ? null : program,
            phrase: phrase === 0x7F ? null : phrase,
            totalPhrases: totalPhrases === 0 || totalPhrases === 0x7F ? null : totalPhrases
        };


        slots.push(slotState);
    }

    return {
        version,
        numSlots,
        startMode,
        slots
    };
}

/**
 * Parse PROGRAM_STATE_RESPONSE (0x65) from Samplecrate
 * Returns mixer state for all 32 programs plus master
 *
 * @param {Uint8Array} data - SysEx message data
 * @returns {Object|null} - Parsed program state or null if invalid
 */
export function parseProgramStateResponse(data) {
    // Format: F0 7D <dev> 65 <80 bytes of state> F7
    // Total: 4 header + 80 data + 1 end = 85 bytes

    if (data.length < 85) {
        console.warn(`[ProgramState] Message too short: ${data.length} bytes (expected 85)`);
        return null;
    }

    if (data[0] !== 0xF0 || data[1] !== 0x7D || data[3] !== 0x65) {
        return null; // Not a program state response
    }

    // Check version - must be Samplecrate format (0x20-0x3F)
    const version = data[4];
    if (version < 0x20 || version >= 0x40) {
        console.warn(`[ProgramState] Invalid version: 0x${version.toString(16)} (expected 0x20-0x3F for Samplecrate)`);
        return null;
    }

    // Header (4 bytes)
    const masterVolume = data[5];
    const masterFlags = data[6];
    const masterMute = (masterFlags & 0x01) !== 0;
    const masterPan = data[7];

    // Program state
    const numPrograms = data[8];

    // Program mute bits (4 bytes for 32 programs, bytes 5-8 of state)
    const muteByte0 = data[9];
    const muteByte1 = data[10];
    const muteByte2 = data[11];
    const muteByte3 = data[12];

    // Program FX enable bits (4 bytes for 32 programs, bytes 9-12 of state)
    const fxByte0 = data[13];
    const fxByte1 = data[14];
    const fxByte2 = data[15];
    const fxByte3 = data[16];

    // Parse program volumes (32 bytes, bytes 13-44 of state)
    const programVolumes = [];
    for (let i = 0; i < numPrograms; i++) {
        programVolumes.push(data[17 + i]);
    }

    // Parse program panning (32 bytes, bytes 45-76 of state)
    const programPans = [];
    for (let i = 0; i < numPrograms; i++) {
        programPans.push(data[49 + i]);
    }

    // Parse mute states for each program
    const programMutes = [];
    for (let i = 0; i < numPrograms; i++) {
        const byteIndex = Math.floor(i / 8);
        const bitIndex = i % 8;
        const muteByte = [muteByte0, muteByte1, muteByte2, muteByte3][byteIndex];
        const muted = (muteByte & (1 << bitIndex)) !== 0;
        programMutes.push(muted);
    }

    // Parse FX enable states for each program
    const programFxEnabled = [];
    for (let i = 0; i < numPrograms; i++) {
        const byteIndex = Math.floor(i / 8);
        const bitIndex = i % 8;
        const fxByte = [fxByte0, fxByte1, fxByte2, fxByte3][byteIndex];
        const fxEnabled = (fxByte & (1 << bitIndex)) !== 0;
        programFxEnabled.push(fxEnabled);
    }

    // Build program array with FX enable status
    const programs = [];
    for (let i = 0; i < numPrograms; i++) {
        programs.push({
            program: i,
            volume: programVolumes[i],
            pan: programPans[i],
            muted: programMutes[i],
            fxEnabled: programFxEnabled[i]
        });
    }

    return {
        version,
        master: {
            volume: masterVolume,
            mute: masterMute,
            pan: masterPan
        },
        numPrograms,
        programs
    };
}

/**
 * Parse DECKS_STATE_RESPONSE (0x67) from Mixxx
 * Returns state for up to 4 DJ decks plus master
 *
 * @param {Uint8Array} data - SysEx message data
 * @returns {Object|null} - Parsed deck state or null if invalid
 */
export function parseDeckStateResponse(data) {
    // Format: F0 7D <dev> 67 <56 bytes of state> F7
    // Total: 4 header + 56 data (4 decks × 13 bytes + 4 master) + 1 end = 61 bytes

    if (data.length < 61) {
        console.warn(`[DeckState] Message too short: ${data.length} bytes (expected 61)`);
        return null;
    }

    if (data[0] !== 0xF0 || data[1] !== 0x7D || data[3] !== 0x67) {
        return null; // Not a deck state response
    }

    const decks = [];

    // Parse 4 decks
    for (let i = 0; i < 4; i++) {
        const offset = 4 + (i * 13); // Start at byte 4, 13 bytes per deck

        const flags = data[offset];
        const fx = data[offset + 1]; // FX enabled states
        const bpmMsb = data[offset + 2]; // BPM high 7 bits
        const bpmLsb = data[offset + 3]; // BPM low 7 bits
        const bpmFrac = data[offset + 4]; // BPM fractional part
        const volume = data[offset + 5];
        const posMsb = data[offset + 6];
        const posLsb = data[offset + 7];
        const rate = data[offset + 8]; // Rate: 0-127 (center at 64)
        const duration = data[offset + 9]; // Duration in 10-second increments
        const eqHigh = data[offset + 10]; // EQ High: 0-127
        const eqMid = data[offset + 11]; // EQ Mid: 0-127
        const eqLow = data[offset + 12]; // EQ Low: 0-127

        // Calculate BPM with decimal precision (reconstruct from MSB/LSB)
        const bpmInt = (bpmMsb << 7) | bpmLsb;
        const bpm = bpmInt + (bpmFrac / 100);

        // Calculate position percentage (0-100)
        const position = ((posMsb << 7) | posLsb) / 163.83; // Max 16383 / 163.83 ≈ 100%

        // Calculate duration in seconds
        const durationSeconds = duration * 10;

        decks.push({
            deck: i + 1, // Deck 1-4
            playing: (flags & 0x01) !== 0,
            looping: (flags & 0x02) !== 0,
            sync: (flags & 0x04) !== 0,
            cue: (flags & 0x08) !== 0,
            pfl: (flags & 0x10) !== 0, // PFL (headphone cue)
            mute: (flags & 0x20) !== 0, // Mute
            fx1: (fx & 0x01) !== 0, // Effect Unit 1 enabled
            fx2: (fx & 0x02) !== 0, // Effect Unit 2 enabled
            fx3: (fx & 0x04) !== 0, // Effect Unit 3 enabled
            fx4: (fx & 0x08) !== 0, // Effect Unit 4 enabled
            bpm: bpm,
            volume: volume,
            position: position,
            rate: rate, // Pitch rate: 0-127 (64 = center/normal)
            duration: durationSeconds, // Track duration in seconds
            eqHigh: eqHigh, // EQ High: 0-127
            eqMid: eqMid, // EQ Mid: 0-127
            eqLow: eqLow // EQ Low: 0-127
        });
    }

    // Parse master state (bytes 56-59 of message, after 4 header + 52 deck data)
    const crossfader = data[56];
    const headphoneMix = data[57];

    return {
        decks: decks,
        master: {
            crossfader: crossfader,
            headphoneMix: headphoneMix
        }
    };
}

/**
 * Build SysEx message for getting Mixxx deck state
 * Command: 0x66 (GET_DECKS_STATE)
 *
 * @param {number} deviceId - Target device ID (0-127)
 * @returns {Uint8Array} - SysEx message
 */
export function buildGetDeckStateMessage(deviceId) {
    return new Uint8Array([
        0xF0,                           // SysEx start
        0x7D,                           // Manufacturer ID
        deviceId & 0x7F,                // Device ID
        0x66,                           // Command: GET_DECKS_STATE
        0xF7                            // SysEx end
    ]);
}

/**
 * Parse upload response message from Samplecrate
 * @param {Uint8Array} data - SysEx message data
 * @returns {Object|null} - {subcommand, slot, status} or null if not a response
 */
function parseAckMessage(data) {
    // Response format: F0 7D <dev> 0x43 <subcommand> <slot> <status> F7

    // Debug: Log all SysEx messages
    if (data[0] === 0xF0 && data[1] === 0x7D) {
        const hex = Array.from(data).map(b => '0x' + b.toString(16).padStart(2, '0').toUpperCase()).join(' ');
        console.log(`[MIDI Upload] Received SysEx: ${hex}`);
    }

    if (data.length < 8) {
        console.log(`[MIDI Upload] Message too short: ${data.length} bytes`);
        return null;
    }
    if (data[0] !== 0xF0 || data[1] !== 0x7D) return null;

    if (data[3] !== 0x43) {
        console.log(`[MIDI Upload] Not an upload response: command=0x${data[3].toString(16)} (expected 0x43)`);
        return null;
    }

    if (data[7] !== 0xF7) {
        console.log(`[MIDI Upload] Missing SysEx end byte at position 7`);
        return null;
    }

    const response = {
        deviceId: data[2],
        subcommand: data[4],  // 0x00=START, 0x01=CHUNK, 0x02=COMPLETE
        slot: data[5],
        status: data[6]  // 0x00=success, 0x01=error, 0x02=chunk received
    };

    console.log(`[MIDI Upload] Parsed ACK: deviceId=${response.deviceId}, subcommand=0x${response.subcommand.toString(16)}, slot=${response.slot}, status=0x${response.status.toString(16)}`);

    return response;
}

/**
 * Wait for upload response message with timeout
 * @param {MeisterController} controller - Controller instance to register handler with
 * @param {number} expectedSubcommand - Expected subcommand (0x00=START, 0x01=CHUNK, 0x02=COMPLETE)
 * @param {number} expectedSlot - Expected slot number
 * @param {number} timeoutMs - Timeout in milliseconds
 * @returns {Promise<Object>} - Resolves with response data or rejects on timeout/error
 */
function waitForAck(controller, expectedSubcommand, expectedSlot, timeoutMs = 2000) {
    console.log(`[MIDI Upload] Waiting for ACK: subcommand=0x${expectedSubcommand.toString(16)}, slot=${expectedSlot}, timeout=${timeoutMs}ms`);

    return new Promise((resolve, reject) => {
        let timeoutId;
        let messageCount = 0;

        const handler = (data) => {
            messageCount++;
            const ack = parseAckMessage(data);
            if (ack && ack.subcommand === expectedSubcommand && ack.slot === expectedSlot) {
                clearTimeout(timeoutId);
                controller.unregisterSysExHandler(0x43);

                if (ack.status === 0x00 || ack.status === 0x02) {
                    // 0x00 = success, 0x02 = chunk received
                    resolve(ack);
                } else {
                    // 0x01 = error/NACK
                    let errorMsg = 'Device rejected the upload';
                    if (expectedSubcommand === 0x00) {
                        errorMsg = 'Device rejected upload request. Slot may be in use or device is busy';
                    } else if (expectedSubcommand === 0x01) {
                        errorMsg = 'Device rejected data chunk. Upload interrupted';
                    } else if (expectedSubcommand === 0x02) {
                        errorMsg = 'Device rejected upload completion. File may be corrupted';
                    }
                    reject(new Error(errorMsg));
                }
            }
        };

        controller.registerSysExHandler(0x43, handler);

        timeoutId = setTimeout(() => {
            controller.unregisterSysExHandler(0x43);

            console.log(`[MIDI Upload] TIMEOUT after ${timeoutMs}ms - received ${messageCount} MIDI messages but no matching ACK`);

            // User-friendly timeout messages
            let timeoutMsg = 'Device is not responding. Please check the connection';
            if (expectedSubcommand === 0x00) {
                timeoutMsg = 'Device did not respond to upload request. Please check the device is connected and powered on';
            } else if (expectedSubcommand === 0x01) {
                timeoutMsg = 'Device stopped responding during upload. Please check the connection and try again';
            } else if (expectedSubcommand === 0x02) {
                timeoutMsg = 'Device did not confirm upload completion. The file may not have been saved correctly';
            }

            reject(new Error(timeoutMsg));
        }, timeoutMs);
    });
}

/**
 * Upload a MIDI file to Samplecrate device with ACK protocol
 *
 * @param {MIDIOutput} midiOutput - MIDI output port
 * @param {MeisterController} controller - Controller instance (for receiving ACKs via SysEx handlers)
 * @param {number} deviceId - Target device ID (0-127)
 * @param {number} slot - Sequence slot number (0-15)
 * @param {number} program - Program/pad number (0-31=PROG 1-32, 127=NO PROG)
 *                           NOTE: For Samplecrate, 127 is stored as -1 (follow UI behavior)
 * @param {Uint8Array} midiFileData - Complete MIDI file data
 * @param {Object} callbacks - Progress callbacks
 * @param {Function} callbacks.onProgress - Called with (currentChunk, totalChunks)
 * @param {Function} callbacks.onComplete - Called when upload succeeds
 * @param {Function} callbacks.onError - Called with error message
 * @returns {Promise<void>}
 */
export async function uploadMidiFile(midiOutput, controller, deviceId, slot, program, midiFileData, callbacks = {}) {
    const { onProgress, onComplete, onError } = callbacks;

    try {
        // Split into chunks
        const CHUNK_SIZE = 256;
        const chunks = chunkData(midiFileData, CHUNK_SIZE);
        const totalChunks = chunks.length;

        console.log(`[MIDI Upload] Starting upload: ${midiFileData.length} bytes, ${totalChunks} chunks, program ${program}`);

        // Clear slot first to clean up any stale state from previous failed uploads
        console.log(`[MIDI Upload] Clearing slot ${slot} before upload...`);
        const clearMsg = buildClearSlotMessage(deviceId, slot);
        midiOutput.send(clearMsg);

        // Small delay to let device process clear
        await sleep(100);

        // Send upload start message (subcommand 0x00)
        const startMsg = buildUploadStartMessage(deviceId, slot, program, totalChunks, midiFileData.length);
        midiOutput.send(startMsg);

        // Wait for START response (subcommand 0x00)
        console.log('[MIDI Upload] Waiting for START response...');
        await waitForAck(controller, 0x00, slot, 3000);
        console.log('[MIDI Upload] Received START response');

        // Send each chunk and wait for response
        for (let i = 0; i < totalChunks; i++) {
            const chunkMsg = buildUploadChunkMessage(deviceId, slot, i, chunks[i]);
            midiOutput.send(chunkMsg);

            // Wait for CHUNK response (subcommand 0x01)
            await waitForAck(controller, 0x01, slot, 2000);

            if (onProgress) {
                onProgress(i + 1, totalChunks);
            }
        }

        console.log('[MIDI Upload] All chunks uploaded, sending COMPLETE...');

        // Send upload complete message (subcommand 0x02)
        const completeMsg = buildUploadCompleteMessage(deviceId, slot);
        midiOutput.send(completeMsg);

        // Wait for COMPLETE response (subcommand 0x02)
        console.log('[MIDI Upload] Waiting for COMPLETE response...');
        await waitForAck(controller, 0x02, slot, 3000);

        console.log(`[MIDI Upload] Upload complete: slot ${slot}, program ${program}`);

        if (onComplete) {
            onComplete();
        }
    } catch (error) {
        console.error('[MIDI Upload] Error:', error);
        if (onError) {
            onError(error.message);
        }
    }
}

/**
 * Helper: Sleep for specified milliseconds
 */
function sleep(ms) {
    return new Promise(resolve => setTimeout(resolve, ms));
}

// ============================================================================
// DOWNLOAD MESSAGE BUILDERS
// ============================================================================

/**
 * Build SysEx message for download start request
 * Command: 0x4C, Subcommand: 0x00 (START)
 *
 * @param {number} deviceId - Target device ID (0-127)
 * @param {number} slot - Sequence slot number (0-15)
 * @returns {Uint8Array} - SysEx message
 */
export function buildDownloadStartMessage(deviceId, slot) {
    return new Uint8Array([
        0xF0,                           // SysEx start
        0x7D,                           // Manufacturer ID
        deviceId & 0x7F,                // Device ID
        0x4C,                           // Command: SEQUENCE_TRACK_DOWNLOAD (FIXED: was 0x8A)
        0x00,                           // Subcommand: START
        slot & 0x0F,                    // Slot
        0xF7                            // SysEx end
    ]);
}

/**
 * Build SysEx message for requesting a download chunk
 * Command: 0x4C, Subcommand: 0x01 (GET_CHUNK)
 *
 * @param {number} deviceId - Target device ID (0-127)
 * @param {number} slot - Sequence slot number (0-15)
 * @param {number} chunkNum - Chunk number to request (0-based)
 * @returns {Uint8Array} - SysEx message
 */
export function buildDownloadChunkRequestMessage(deviceId, slot, chunkNum) {
    return new Uint8Array([
        0xF0,                           // SysEx start
        0x7D,                           // Manufacturer ID
        deviceId & 0x7F,                // Device ID
        0x4C,                           // Command: SEQUENCE_TRACK_DOWNLOAD (FIXED: was 0x8A)
        0x01,                           // Subcommand: GET_CHUNK
        slot & 0x0F,                    // Slot
        chunkNum & 0x7F,                // Chunk number
        0xF7                            // SysEx end
    ]);
}

/**
 * Build SysEx message for download complete
 * Command: 0x4C, Subcommand: 0x02 (COMPLETE)
 *
 * @param {number} deviceId - Target device ID (0-127)
 * @param {number} slot - Sequence slot number (0-15)
 * @returns {Uint8Array} - SysEx message
 */
export function buildDownloadCompleteMessage(deviceId, slot) {
    return new Uint8Array([
        0xF0,                           // SysEx start
        0x7D,                           // Manufacturer ID
        deviceId & 0x7F,                // Device ID
        0x4C,                           // Command: SEQUENCE_TRACK_DOWNLOAD (FIXED: was 0x8A)
        0x02,                           // Subcommand: COMPLETE
        slot & 0x0F,                    // Slot
        0xF7                            // SysEx end
    ]);
}

/**
 * Parse download response message from Samplecrate
 * @param {Uint8Array} data - SysEx message data
 * @returns {Object|null} - Parsed response or null if invalid
 */
function parseDownloadResponse(data) {
    if (data.length < 6) return null;
    if (data[0] !== 0xF0 || data[1] !== 0x7D) return null;
    if (data[3] !== 0x4D) return null; // Not SEQUENCE_TRACK_DOWNLOAD_RESPONSE (FIXED: was 0x8B)

    const subcommand = data[4];
    const slot = data[5];

    if (subcommand === 0x00) {
        // START response: F0 7D <dev> 8B 00 <slot> <program> <chunks> <size_lsb> <size_msb> F7
        if (data.length < 11) return null;
        if (data[10] !== 0xF7) return null;

        return {
            type: 'start',
            slot: slot,
            program: data[6],
            totalChunks: data[7],
            fileSize: data[8] | (data[9] << 7)
        };
    } else if (subcommand === 0x01) {
        // CHUNK response: F0 7D <dev> 8B 01 <slot> <chunk#> <encoded_data...> F7
        if (data.length < 9) return null;
        if (data[data.length - 1] !== 0xF7) return null;

        const chunkNum = data[6];
        const encodedData = data.slice(7, data.length - 1);

        return {
            type: 'chunk',
            slot: slot,
            chunkNum: chunkNum,
            data: encodedData
        };
    } else if (subcommand === 0x02) {
        // COMPLETE response: F0 7D <dev> 8B 02 <slot> <status> F7
        if (data.length < 8) return null;
        if (data[7] !== 0xF7) return null;

        return {
            type: 'complete',
            slot: slot,
            status: data[6]  // 0x00 = OK
        };
    }

    return null;
}

/**
 * Download a MIDI file from Samplecrate device
 *
 * @param {MIDIOutput} midiOutput - MIDI output port
 * @param {MIDIInput} midiInput - MIDI input port (for receiving responses)
 * @param {number} deviceId - Target device ID (0-127)
 * @param {number} slot - Sequence slot number (0-15)
 * @param {Object} callbacks - Progress callbacks
 * @param {Function} callbacks.onProgress - Called with (currentChunk, totalChunks)
 * @param {Function} callbacks.onComplete - Called with downloaded MIDI file data (Uint8Array)
 * @param {Function} callbacks.onError - Called with error message
 * @returns {Promise<Uint8Array>} - Downloaded MIDI file data
 */
export async function downloadMidiFile(midiOutput, midiInput, deviceId, slot, callbacks = {}) {
    const { onProgress, onComplete, onError } = callbacks;

    return new Promise((resolve, reject) => {
        let downloadBuffer = null;
        let totalChunks = 0;
        let fileSize = 0;
        let program = 0;
        let chunksReceived = 0;

        const handler = async (event) => {
            const response = parseDownloadResponse(event.data);
            if (!response || response.slot !== slot) return;

            try {
                if (response.type === 'start') {
                    // Received metadata
                    totalChunks = response.totalChunks;
                    fileSize = response.fileSize;
                    program = response.program;
                    downloadBuffer = new Uint8Array(fileSize);
                    chunksReceived = 0;

                    console.log(`[MIDI Download] Started: ${fileSize} bytes, ${totalChunks} chunks, program ${program}`);

                    // Request first chunk
                    const chunkMsg = buildDownloadChunkRequestMessage(deviceId, slot, 0);
                    midiOutput.send(chunkMsg);

                } else if (response.type === 'chunk') {
                    // Received chunk data
                    const chunkNum = response.chunkNum;
                    const encodedData = response.data;

                    // Decode 7-bit to 8-bit
                    const decoded = decode7bit(encodedData);

                    // Calculate write position
                    const CHUNK_SIZE = 256;
                    const writePos = chunkNum * CHUNK_SIZE;
                    const writeLen = Math.min(decoded.length, fileSize - writePos);

                    // Copy decoded data to buffer
                    downloadBuffer.set(decoded.slice(0, writeLen), writePos);
                    chunksReceived++;

                    console.log(`[MIDI Download] Received chunk ${chunksReceived}/${totalChunks}`);

                    if (onProgress) {
                        onProgress(chunksReceived, totalChunks);
                    }

                    // Request next chunk or complete
                    if (chunksReceived < totalChunks) {
                        const nextChunkMsg = buildDownloadChunkRequestMessage(deviceId, slot, chunksReceived);
                        midiOutput.send(nextChunkMsg);
                    } else {
                        // All chunks received, send COMPLETE
                        const completeMsg = buildDownloadCompleteMessage(deviceId, slot);
                        midiOutput.send(completeMsg);
                    }

                } else if (response.type === 'complete') {
                    // Download finished
                    midiInput.removeEventListener('midimessage', handler);

                    if (response.status === 0x00) {
                        console.log(`[MIDI Download] Complete: slot ${slot}, ${fileSize} bytes`);

                        if (onComplete) {
                            onComplete(downloadBuffer);
                        }
                        resolve(downloadBuffer);
                    } else {
                        const error = new Error('Device reported download error. The file may not exist in this slot');
                        if (onError) onError(error.message);
                        reject(error);
                    }
                }
            } catch (error) {
                midiInput.removeEventListener('midimessage', handler);
                console.error('[MIDI Download] Error:', error);
                if (onError) onError(error.message);
                reject(error);
            }
        };

        midiInput.addEventListener('midimessage', handler);

        // Send START request
        const startMsg = buildDownloadStartMessage(deviceId, slot);
        midiOutput.send(startMsg);
        console.log(`[MIDI Download] Requesting download from slot ${slot}`);

        // Set timeout
        setTimeout(() => {
            midiInput.removeEventListener('midimessage', handler);
            const error = new Error('Device did not respond to download request. Please check the device is connected and the slot contains data');
            if (onError) onError(error.message);
            reject(error);
        }, 30000);  // 30 second timeout
    });
}
