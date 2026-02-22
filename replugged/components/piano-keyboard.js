/**
 * Piano Keyboard Component
 * Reusable SVG-based piano keyboard with proper black key alignment
 */

class PianoKeyboard extends EventTarget {
    constructor(container, options = {}) {
        super();

        this.container = typeof container === 'string'
            ? document.getElementById(container)
            : container;

        this.options = {
            octaves: options.octaves || 2,
            baseOctave: options.baseOctave || 3,
            showLabels: options.showLabels !== false,
            enableTouch: options.enableTouch !== false,
            enableMouse: options.enableMouse !== false,
            ...options
        };

        this.activeNotes = new Set();
        this.activeTouches = new Map();
        this.mouseNote = null;

        this.build();
    }

    build() {
        this.container.innerHTML = '';

        const svg = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
        const svgWidth = 700 * this.options.octaves;
        const svgHeight = 600;

        svg.setAttribute('viewBox', `0 0 ${svgWidth} ${svgHeight}`);
        svg.setAttribute('preserveAspectRatio', 'xMidYMid meet');
        svg.style.width = '100%';
        svg.style.height = '100%';

        // Key dimensions
        const whiteKeyWidth = 100;
        const whiteKeyHeight = 580;
        const blackKeyWidth = 60;
        const blackKeyHeight = 380;
        const keyRadius = 8;

        // Piano layout
        const whiteKeyPattern = [
            { note: 'C', semitone: 0 },
            { note: 'D', semitone: 2 },
            { note: 'E', semitone: 4 },
            { note: 'F', semitone: 5 },
            { note: 'G', semitone: 7 },
            { note: 'A', semitone: 9 },
            { note: 'B', semitone: 11 }
        ];

        // Black keys with realistic piano positioning (asymmetric between white keys)
        // Position is calculated as offset from left edge of octave
        const blackKeyPattern = [
            { note: 'C#', semitone: 1, xOffset: 90 },   // Between C(0-100) and D(100-200)
            { note: 'D#', semitone: 3, xOffset: 210 },  // Between D(100-200) and E(200-300)
            { note: 'F#', semitone: 6, xOffset: 390 },  // Between F(300-400) and G(400-500)
            { note: 'G#', semitone: 8, xOffset: 500 },  // Between G(400-500) and A(500-600)
            { note: 'A#', semitone: 10, xOffset: 610 }  // Between A(500-600) and B(600-700)
        ];

        // Create white keys
        for (let octave = 0; octave < this.options.octaves; octave++) {
            const octaveOffset = octave * 700;
            const octaveNoteBase = (this.options.baseOctave + octave) * 12;

            whiteKeyPattern.forEach((key, index) => {
                const noteNumber = octaveNoteBase + key.semitone;
                const x = octaveOffset + (index * whiteKeyWidth);

                const keyGroup = this.createKey(
                    x, 0, whiteKeyWidth, whiteKeyHeight,
                    keyRadius, '#f0f0f0', noteNumber, key.note, true
                );

                svg.appendChild(keyGroup);
            });
        }

        // Create black keys (render on top)
        for (let octave = 0; octave < this.options.octaves; octave++) {
            const octaveOffset = octave * 700;
            const octaveNoteBase = (this.options.baseOctave + octave) * 12;

            blackKeyPattern.forEach((key) => {
                const noteNumber = octaveNoteBase + key.semitone;
                const x = octaveOffset + key.xOffset - (blackKeyWidth / 2);

                const keyGroup = this.createKey(
                    x, 0, blackKeyWidth, blackKeyHeight,
                    keyRadius, '#1a1a1a', noteNumber, key.note, false
                );

                svg.appendChild(keyGroup);
            });
        }

        this.svg = svg;
        this.container.appendChild(svg);

        // Setup global handlers for mouse/touch release outside keys
        if (this.options.enableMouse) {
            document.addEventListener('mouseup', this.handleGlobalMouseUp.bind(this));
        }
        if (this.options.enableTouch) {
            document.addEventListener('touchend', this.handleGlobalTouchEnd.bind(this));
        }
    }

    createKey(x, y, width, height, radius, fillColor, noteNumber, noteName, isWhite) {
        const keyGroup = document.createElementNS('http://www.w3.org/2000/svg', 'g');
        keyGroup.style.cursor = 'pointer';

        // Create rounded rectangle path
        const path = document.createElementNS('http://www.w3.org/2000/svg', 'path');
        const pathData = `
            M ${x},${y}
            L ${x+width},${y}
            L ${x+width},${height-radius}
            Q ${x+width},${height} ${x+width-radius},${height}
            L ${x+radius},${height}
            Q ${x},${height} ${x},${height-radius}
            Z
        `;
        path.setAttribute('d', pathData);
        path.setAttribute('fill', fillColor);
        path.setAttribute('stroke', '#000');
        path.setAttribute('stroke-width', '2');
        path.dataset.noteNumber = noteNumber;
        path.dataset.keyY = y;
        path.dataset.keyHeight = height;
        path.dataset.isWhiteKey = isWhite;

        keyGroup.appendChild(path);

        // Add label if enabled
        if (this.options.showLabels) {
            const text = document.createElementNS('http://www.w3.org/2000/svg', 'text');
            text.setAttribute('x', x + width / 2);
            text.setAttribute('y', isWhite ? height - 20 : height - 10);
            text.setAttribute('text-anchor', 'middle');
            text.setAttribute('fill', isWhite ? '#666' : '#aaa');
            text.setAttribute('font-size', isWhite ? '14' : '10');
            text.setAttribute('font-family', 'Arial, sans-serif');
            text.setAttribute('pointer-events', 'none');
            text.textContent = noteName;

            keyGroup.appendChild(text);
        }

        // Event handlers
        if (this.options.enableMouse) {
            keyGroup.addEventListener('mousedown', (e) => this.handleKeyPress(e, noteNumber, y, height));
            keyGroup.addEventListener('mouseenter', (e) => {
                if (e.buttons === 1 && this.mouseNote !== noteNumber) {
                    this.handleKeyPress(e, noteNumber, y, height);
                }
            });
        }

        if (this.options.enableTouch) {
            keyGroup.addEventListener('touchstart', (e) => this.handleTouchStart(e, noteNumber, y, height));
            keyGroup.addEventListener('touchmove', (e) => this.handleTouchMove(e, noteNumber, y, height));
            keyGroup.addEventListener('touchend', (e) => this.handleTouchEnd(e, noteNumber));
            keyGroup.addEventListener('touchcancel', (e) => this.handleTouchEnd(e, noteNumber));
        }

        return keyGroup;
    }

    calculateVelocity(event, keyY, keyHeight) {
        const rect = this.svg.getBoundingClientRect();
        const clientY = event.clientY || (event.touches && event.touches[0].clientY);
        const svgY = ((clientY - rect.top) / rect.height) * 600; // 600 is viewBox height
        const relativeY = (svgY - keyY) / keyHeight;
        const clampedY = Math.max(0, Math.min(1, relativeY));
        const velocity = Math.round(10 + (clampedY * 117));
        return Math.max(10, Math.min(127, velocity));
    }

    handleKeyPress(e, noteNumber, keyY, keyHeight) {
        e.preventDefault();

        const velocity = this.calculateVelocity(e, keyY, keyHeight);

        // Release previous note if different
        if (this.mouseNote !== null && this.mouseNote !== noteNumber) {
            this.releaseNote(this.mouseNote);
        }

        this.pressNote(noteNumber, velocity);
        this.mouseNote = noteNumber;
    }

    handleTouchStart(e, noteNumber, keyY, keyHeight) {
        e.preventDefault();

        for (let i = 0; i < e.changedTouches.length; i++) {
            const touch = e.changedTouches[i];
            const velocity = this.calculateVelocity(touch, keyY, keyHeight);

            // Release previous note for this touch
            const prevNote = this.activeTouches.get(touch.identifier);
            if (prevNote !== undefined && prevNote !== noteNumber) {
                this.releaseNote(prevNote);
            }

            this.pressNote(noteNumber, velocity);
            this.activeTouches.set(touch.identifier, noteNumber);
        }
    }

    handleTouchMove(e, noteNumber, keyY, keyHeight) {
        e.preventDefault();
        // Touch moves are handled by touchstart on the new key
    }

    handleTouchEnd(e, noteNumber) {
        e.preventDefault();

        for (let i = 0; i < e.changedTouches.length; i++) {
            const touch = e.changedTouches[i];
            const touchNote = this.activeTouches.get(touch.identifier);

            if (touchNote !== undefined) {
                this.releaseNote(touchNote);
                this.activeTouches.delete(touch.identifier);
            }
        }
    }

    handleGlobalMouseUp() {
        if (this.mouseNote !== null) {
            this.releaseNote(this.mouseNote);
            this.mouseNote = null;
        }
    }

    handleGlobalTouchEnd(e) {
        for (let i = 0; i < e.changedTouches.length; i++) {
            const touch = e.changedTouches[i];
            const touchNote = this.activeTouches.get(touch.identifier);

            if (touchNote !== undefined) {
                this.releaseNote(touchNote);
                this.activeTouches.delete(touch.identifier);
            }
        }
    }

    pressNote(noteNumber, velocity) {
        if (this.activeNotes.has(noteNumber)) return;

        this.activeNotes.add(noteNumber);
        this.highlightKey(noteNumber, true);

        this.dispatchEvent(new CustomEvent('noteon', {
            detail: { note: noteNumber, velocity }
        }));
    }

    releaseNote(noteNumber) {
        if (!this.activeNotes.has(noteNumber)) return;

        this.activeNotes.delete(noteNumber);
        this.highlightKey(noteNumber, false);

        this.dispatchEvent(new CustomEvent('noteoff', {
            detail: { note: noteNumber }
        }));
    }

    highlightKey(noteNumber, active) {
        const path = this.svg.querySelector(`[data-note-number="${noteNumber}"]`);
        if (!path) return;

        const isWhite = path.dataset.isWhiteKey === 'true';

        if (active) {
            path.setAttribute('fill', '#CF1A37');
        } else {
            path.setAttribute('fill', isWhite ? '#f0f0f0' : '#1a1a1a');
        }
    }

    setBaseOctave(octave) {
        this.options.baseOctave = octave;
        this.build();
    }

    destroy() {
        document.removeEventListener('mouseup', this.handleGlobalMouseUp);
        document.removeEventListener('touchend', this.handleGlobalTouchEnd);
        this.container.innerHTML = '';
    }
}

// Export for use in other scripts
if (typeof module !== 'undefined' && module.exports) {
    module.exports = PianoKeyboard;
}
