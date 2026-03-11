# RFXStrudel

Live coding environment built on Strudel with integrated RFX effects, synths, and MIDI control.

## Features

- **Strudel Integration**: Full Strudel live coding environment with CodeMirror editor
- **RFX Effects**: Integrated filter, reverb, delay, and more
- **RFX Synths**: Access to RFX synth engines
- **MIDI Control**: Full MIDI input support with CC mapping
- **MIDI Learn**: Click-to-learn MIDI mapping for all knobs
- **SVG Knobs**: Interactive pad-knob components with visual feedback
- **Audio Output Selection**: Choose your output device
- **Debug Console**: Built-in debug logging in the menu

## Usage

### Code Editor

Write Strudel code in the editor. Press **Ctrl+Enter** (or **Cmd+Enter** on Mac) to evaluate.

Example:
```javascript
note("c3 eb3 g3 bb3")
  .s("sawtooth")
  .lpf(1000)
  .room(0.5)
```

### MIDI Learn

1. Open Menu → MIDI Setup
2. Select your MIDI input device
3. Click "Start MIDI Learn"
4. Click a knob
5. Move a MIDI controller (CC message)
6. The knob is now mapped!

Mappings are saved to localStorage and persist across sessions.

### Effects

Use the knobs in the effects panel to control:
- **Filter**: Frequency cutoff
- **Reverb**: Room size
- **Delay**: Delay time
- **Master**: Output volume

## Keyboard Shortcuts

- `Ctrl+Enter` / `Cmd+Enter`: Evaluate code
- Click knobs when MIDI Learn is active to map them

## Development

Built with:
- Strudel (live coding engine)
- CodeMirror (code editor)
- Web Audio API
- Web MIDI API
- RFX component library

## Credits

- Developed by Gerard Braad
- Built on Strudel by Felix Roos
- Part of the RFX Suite
