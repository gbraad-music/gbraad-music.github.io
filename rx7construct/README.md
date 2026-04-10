# RX7 Construct - DX7 Patch Editor

A web-based Yamaha DX7 patch editor inspired by [mmontag/dx7-synth-js](https://github.com/mmontag/dx7-synth-js).

## Features

- **6 Operator FM Synthesis** - Full DX7 operator controls
- **Algorithm Selection** - 32 DX7 algorithms
- **LFO & Pitch Envelope** - Global modulation controls
- **SysEx Import/Export** - Load and save .syx patch files
- **RX7 Patcher Color Scheme** - Matches the desktop tool aesthetic (#be3b65 pink, #5a979a teal)

## Operator Controls

Each of the 6 operators has:

- **Level Controls**
  - Output Level (0-99)
  - Velocity Sensitivity (0-7)
  - AM Sensitivity (0-3)

- **Frequency Controls**
  - Mode (Ratio/Fixed)
  - Coarse (0-31 for ratio, 0-3 for fixed)
  - Fine (0-99)
  - Detune (-7 to +7)

- **Envelope Generator**
  - 4 Rate controls (R1-R4)
  - 4 Level controls (L1-L4)

## Global Controls

- **Algorithm** - 1-32 (determines operator routing)
- **Feedback** - 0-7 (operator 6 feedback amount)
- **LFO** - Speed, Delay, PM Depth, AM Depth, PM Sens, Waveform, Sync
- **Pitch Envelope** - 4 rates, 4 levels

## DX7 Voice Format

This tool edits DX7 single voice patches in SysEx format:
- Format: `F0 43 00 00 01 1B [155 bytes] [checksum] F7`
- 155 bytes packed parameter data
- 10-character uppercase patch name

## Usage

1. **Edit Parameters** - Adjust operator and global controls
2. **Load Patch** - Click "Load .syx" to import a DX7 patch
3. **Save Patch** - Click "Save .syx" to export your patch
4. **Reset** - Click "Reset" to restore INIT VOICE

## Architecture

- **index.html** - Main UI structure
- **style.css** - RX7 color scheme and layout
- **app.js** - Patch editing logic and SysEx handling

## Color Scheme

Matches the RX7 Patcher desktop tool:
- **Pink** (#be3b65) - Primary actions, enabled states
- **Teal** (#5a979a) - Secondary actions, value displays
- **Purple** (#7a5a9a) - Tertiary actions

## TODO

- [ ] Complete SysEx parsing/generation
- [ ] Add preset template library
- [ ] Implement algorithm diagram visualization
- [ ] Add audio preview (Web Audio API)
- [ ] Keyboard scaling parameters
- [ ] Operator copy/paste
- [ ] Cartridge (32 voice) editing

## References

- [DX7 SysEx Format](http://homepages.abdn.ac.uk/mth192/pages/dx7/sysex-format.txt)
- [mmontag/dx7-synth-js](https://github.com/mmontag/dx7-synth-js)
- [Yamaha DX7 Manual](https://usa.yamaha.com/files/download/other_assets/9/333979/DX7E1.pdf)
