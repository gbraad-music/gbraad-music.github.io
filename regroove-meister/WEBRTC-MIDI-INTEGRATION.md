# WebRTC-MIDI Integration for Meister

## Overview

Meister now supports **bidirectional MIDI over WebRTC**, enabling:
- **Receiving MIDI** from remote bridges (virtual MIDI inputs)
- **Sending MIDI** to remote destinations (virtual MIDI outputs)

## Architecture

```
┌─────────────────────────────────────────┐
│           Meister (Receiver)            │
├─────────────────────────────────────────┤
│                                         │
│  ┌─────────────────────────────────┐   │
│  │  WebRTC-MIDI Manager            │   │
│  ├─────────────────────────────────┤   │
│  │ • Virtual MIDI Inputs  (RX)     │   │
│  │ • Virtual MIDI Outputs (TX)     │   │
│  │ • Bidirectional Data Channels   │   │
│  └─────────────────────────────────┘   │
│              ↕                          │
│  ┌─────────────────────────────────┐   │
│  │  Meister MIDI System            │   │
│  ├─────────────────────────────────┤   │
│  │ • Device Manager                │   │
│  │ • Input Router                  │   │
│  │ • Piano Scene                   │   │
│  │ • Pad Scene                     │   │
│  └─────────────────────────────────┘   │
│                                         │
└─────────────────────────────────────────┘
              ↕  WebRTC
┌─────────────────────────────────────────┐
│      Remote MIDI Bridge (Sender)        │
│  • Physical MIDI Devices                │
│  • MIDI Controllers                     │
└─────────────────────────────────────────┘
```

## How It Works

### Receiving MIDI (Input)

1. WebRTC connection established between sender and Meister
2. When MIDI arrives over WebRTC:
   - `WebRTCMIDIManager.handleMIDIMessage()` is called
   - Virtual MIDI input created for the target (e.g., "control", "synth")
   - MIDI message forwarded to Meister's input handling
3. Virtual inputs appear in:
   - Settings → MIDI → MIDI Inputs list
   - Settings → MIDI → Input Routing
   - Can be enabled/disabled like physical devices

### Sending MIDI (Output)

1. When WebRTC connects, virtual MIDI outputs are created:
   - `WebRTC MIDI Out (default)`
   - `WebRTC MIDI Out (synth)`
   - `WebRTC MIDI Out (control)`
   - `WebRTC MIDI Out (feedback)`

2. These outputs appear in:
   - Settings → General → MIDI Output dropdown
   - Settings → Devices → Per-device MIDI output
   - Scene Editor → Output selection

3. When you play notes (piano scene) or trigger pads:
   - MIDI sent to the selected output
   - If it's a WebRTC virtual output:
     - `virtualOutput.send(data, timestamp)` called
     - `WebRTCMIDIManager.sendMIDI()` forwards to WebRTC
     - MIDI transmitted over WebRTC data channel to remote

## Usage Example

### Setup Connection

1. **Open Meister** → Settings → WebRTC tab

2. **On remote MIDI bridge** (sender):
   ```javascript
   const bridge = new BrowserMIDIRTC('sender');
   await bridge.initialize();
   const offer = await bridge.createOffer();
   // Copy the offer
   ```

3. **In Meister** (receiver):
   - Paste offer into "STEP 1" textarea
   - Click "PROCESS OFFER & GENERATE ANSWER"
   - Copy the answer from "STEP 2"

4. **On remote bridge**:
   ```javascript
   await bridge.handleAnswer(answer);
   // Connection established!
   ```

### Route Piano to Remote Synth

1. **Settings → General**:
   - MIDI Output: Select "🌐 WebRTC MIDI Out (synth)"

2. **Switch to Piano Scene**

3. **Play notes**:
   - Notes sent over WebRTC to remote synth
   - Remote synth receives MIDI and plays

### Receive MIDI from Remote Controller

1. **Remote sends MIDI with target "control"**

2. **In Meister**:
   - Virtual input "WebRTC MIDI (control)" appears
   - Settings → MIDI → Enable the input
   - Settings → MIDI → Input Routing → Set mode to DEVICE
   - Configure routing targets

3. **Remote MIDI triggers actions in Meister**

## Files Modified/Added

### New Files
- `webrtc-midi-manager.js` - Core WebRTC-MIDI integration
- `webrtc-midi-ui.js` - UI controller for WebRTC tab
- `external/midi-rtc/` - MIDI-RTC library files

### Modified Files
- `index.html` - Added WebRTC tab and initialization
- `settings-ui.js` - Added WebRTC virtual devices to MIDI lists
- `meister-controller.js` - Updated `populateMIDIOutputs()` to include virtual outputs
- `device-manager.js` - Updated to recognize and use virtual outputs

## API Reference

### WebRTCMIDIManager

```javascript
// Create and initialize
const manager = new WebRTCMIDIManager({ debug: true });
await manager.initialize();

// Handle connection setup
const answer = await manager.processOffer(offerJSON);

// Get virtual devices
manager.getVirtualInputs();  // Array of virtual input devices
manager.getVirtualOutputs(); // Array of virtual output devices

// Send MIDI manually
manager.sendMIDI([0x90, 0x3C, 0x7F], timestamp, 'synth');

// Event handlers
manager.onMIDIMessage = (message) => { /* ... */ };
manager.onConnectionStateChange = (state) => { /* ... */ };
manager.onTargetDiscovered = (target, virtualInput) => { /* ... */ };

// Get statistics
const stats = manager.getStats();
```

### Virtual MIDI Output API

Each virtual output has:
```javascript
{
  id: 'webrtc-midi-out-synth',
  name: 'WebRTC MIDI Out (synth)',
  manufacturer: 'WebRTC',
  type: 'output',
  target: 'synth',

  // Standard Web MIDI API methods
  send: (data, timestamp) => { /* sends over WebRTC */ },
  clear: () => { /* noop */ }
}
```

## Targets

MIDI messages are routed by "target":

| Target | Purpose |
|--------|---------|
| `default` | General MIDI (trunk mode) |
| `synth` | Musical notes, synthesizers |
| `control` | UI controls (faders, buttons) |
| `feedback` | Controller feedback (LEDs, motors) |

## Limitations

- **Manual signaling**: Requires copy/paste of SDP offer/answer
- **LAN only**: No STUN/TURN servers (direct P2P)
- **One connection at a time**: Single receiver mode
- **No encryption**: MIDI data sent unencrypted over WebRTC

## Future Enhancements

- [ ] Automatic signaling via WebSocket server
- [ ] Multiple concurrent connections
- [ ] Sender mode (bridge from Meister to remote)
- [ ] Target selection UI for outputs
- [ ] MIDI activity indicators per target
- [ ] Connection quality metrics
- [ ] Audio streaming integration (via meister-rtc)
