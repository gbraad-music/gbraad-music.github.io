/**
 * Touch-friendly Fill Dialog for Sequencer
 * Prevents keyboard conflicts by using button selectors
 */

export function showFillDialog(sequencer, track, cursorRow, cursorTrack, engine, updateCallback) {
    if (!window.nbDialog) {
        console.error('[Fill] nbDialog not available');
        return;
    }

    // Get cursor note as default
    const cursorEntry = engine.pattern.getEntry(cursorRow, cursorTrack);
    const defaultNote = cursorEntry?.note || 'C';
    const defaultOctave = cursorEntry?.octave || 3;

    // Create touch-friendly fill dialog
    const notes = ['C', 'C#', 'D', 'D#', 'E', 'F', 'F#', 'G', 'G#', 'A', 'A#', 'B'];
    const intervals = [1, 2, 4, 6, 8, 10, 12, 14, 16];
    const velocities = [64, 80, 100, 120, 127];

    const content = `
        <div style="
            background: #1a1a1a;
            border: 2px solid #4a4a4a;
            border-radius: 8px;
            padding: 20px;
            min-width: 400px;
            max-width: 500px;
            color: #fff;
            font-family: 'Arial', sans-serif;
        ">
            <h3 style="margin: 0 0 15px 0; text-align: center;">Fill Track ${track}</h3>

            <div style="margin-bottom: 15px;">
                <div style="margin-bottom: 5px; font-weight: bold;">Note:</div>
                <div id="fill-note-buttons" style="display: grid; grid-template-columns: repeat(6, 1fr); gap: 5px;">
                    ${notes.map(note => `
                        <button class="fill-note-btn" data-note="${note}" style="
                            padding: 10px;
                            background: ${note === defaultNote ? '#4a9eff' : '#333'};
                            color: #fff;
                            border: 1px solid #555;
                            border-radius: 4px;
                            cursor: pointer;
                            font-weight: bold;
                        ">${note}</button>
                    `).join('')}
                </div>
            </div>

            <div style="margin-bottom: 15px;">
                <div style="margin-bottom: 5px; font-weight: bold;">Octave:</div>
                <div id="fill-octave-buttons" style="display: grid; grid-template-columns: repeat(5, 1fr); gap: 5px;">
                    ${[0, 1, 2, 3, 4, 5, 6, 7, 8].map(oct => `
                        <button class="fill-octave-btn" data-octave="${oct}" style="
                            padding: 10px;
                            background: ${oct === defaultOctave ? '#4a9eff' : '#333'};
                            color: #fff;
                            border: 1px solid #555;
                            border-radius: 4px;
                            cursor: pointer;
                            font-weight: bold;
                        ">${oct}</button>
                    `).join('')}
                </div>
            </div>

            <div style="margin-bottom: 15px;">
                <div style="margin-bottom: 5px; font-weight: bold;">Interval (every N rows):</div>
                <div id="fill-interval-buttons" style="display: grid; grid-template-columns: repeat(5, 1fr); gap: 5px;">
                    ${intervals.map(int => `
                        <button class="fill-interval-btn" data-interval="${int}" style="
                            padding: 10px;
                            background: ${int === 4 ? '#4a9eff' : '#333'};
                            color: #fff;
                            border: 1px solid #555;
                            border-radius: 4px;
                            cursor: pointer;
                            font-weight: bold;
                        ">${int}</button>
                    `).join('')}
                </div>
            </div>

            <div style="margin-bottom: 20px;">
                <div style="margin-bottom: 5px; font-weight: bold;">Velocity:</div>
                <div id="fill-velocity-buttons" style="display: grid; grid-template-columns: repeat(5, 1fr); gap: 5px;">
                    ${velocities.map(vel => `
                        <button class="fill-velocity-btn" data-velocity="${vel}" style="
                            padding: 10px;
                            background: ${vel === 100 ? '#4a9eff' : '#333'};
                            color: #fff;
                            border: 1px solid #555;
                            border-radius: 4px;
                            cursor: pointer;
                            font-weight: bold;
                        ">${vel}</button>
                    `).join('')}
                </div>
            </div>

            <div style="text-align: right; display: flex; gap: 10px; justify-content: flex-end;">
                <button id="fill-cancel" style="
                    padding: 10px 20px;
                    background: #4a4a4a;
                    color: #fff;
                    border: none;
                    border-radius: 4px;
                    cursor: pointer;
                    font-weight: bold;
                ">Cancel</button>
                <button id="fill-ok" style="
                    padding: 10px 20px;
                    background: #4a9eff;
                    color: #fff;
                    border: none;
                    border-radius: 4px;
                    cursor: pointer;
                    font-weight: bold;
                ">Fill</button>
            </div>
        </div>
    `;

    window.nbDialog.show(content);

    // Track selected values
    let selectedNote = defaultNote;
    let selectedOctave = defaultOctave;
    let selectedInterval = 4;
    let selectedVelocity = 100;

    // Use setTimeout to ensure DOM is ready after nbDialog.show()
    setTimeout(() => {
        // Get dialog container
        const dialogContainer = document.getElementById('nb-dialog-container');
        if (!dialogContainer) {
            console.error('[Fill] Dialog container not found!');
            return;
        }

    // Helper function to preview the currently selected note
    const previewNote = () => {
        const noteNames = ['C', 'C#', 'D', 'D#', 'E', 'F', 'F#', 'G', 'G#', 'A', 'A#', 'B'];
        const noteIndex = noteNames.indexOf(selectedNote);
        if (noteIndex === -1) {
            console.error('[Fill Preview] Invalid note:', selectedNote);
            return;
        }

        const midiNote = (selectedOctave * 12) + noteIndex;
        if (midiNote < 0 || midiNote > 127) {
            console.error('[Fill Preview] MIDI note out of range:', midiNote);
            return;
        }

        const program = engine.trackPrograms[cursorTrack] || 0;
        engine.playNote(cursorTrack, midiNote, selectedVelocity, program);
    };

    // Note button handlers - query from dialog container
    const noteButtons = dialogContainer.querySelectorAll('.fill-note-btn');
    noteButtons.forEach(btn => {
        btn.addEventListener('click', (e) => {
            e.stopPropagation();
            selectedNote = btn.dataset.note;
            dialogContainer.querySelectorAll('.fill-note-btn').forEach(b => b.style.background = '#333');
            btn.style.background = '#4a9eff';
            previewNote(); // Preview the note
        });
    });

    // Octave button handlers
    dialogContainer.querySelectorAll('.fill-octave-btn').forEach(btn => {
        btn.addEventListener('click', (e) => {
            e.stopPropagation();
            selectedOctave = parseInt(btn.dataset.octave);
            dialogContainer.querySelectorAll('.fill-octave-btn').forEach(b => b.style.background = '#333');
            btn.style.background = '#4a9eff';
            previewNote(); // Preview the note
        });
    });

    // Interval button handlers
    dialogContainer.querySelectorAll('.fill-interval-btn').forEach(btn => {
        btn.addEventListener('click', (e) => {
            e.stopPropagation();
            selectedInterval = parseInt(btn.dataset.interval);
            dialogContainer.querySelectorAll('.fill-interval-btn').forEach(b => b.style.background = '#333');
            btn.style.background = '#4a9eff';
        });
    });

    // Velocity button handlers
    dialogContainer.querySelectorAll('.fill-velocity-btn').forEach(btn => {
        btn.addEventListener('click', (e) => {
            e.stopPropagation();
            selectedVelocity = parseInt(btn.dataset.velocity);
            dialogContainer.querySelectorAll('.fill-velocity-btn').forEach(b => b.style.background = '#333');
            btn.style.background = '#4a9eff';
            previewNote(); // Preview the note with new velocity
        });
    });

    // OK button
    dialogContainer.querySelector('#fill-ok').addEventListener('click', (e) => {
        e.stopPropagation();
        window.nbDialog.hide();
        updateCallback(selectedNote, selectedOctave, selectedInterval, selectedVelocity);
    });

    // Cancel button
    dialogContainer.querySelector('#fill-cancel').addEventListener('click', (e) => {
        e.stopPropagation();
        window.nbDialog.hide();
    });

    // Escape key to cancel
    const handleEscape = (e) => {
        if (e.key === 'Escape') {
            e.preventDefault();
            e.stopPropagation();
            window.nbDialog.hide();
            document.removeEventListener('keydown', handleEscape);
        }
    };
    document.addEventListener('keydown', handleEscape);

    }, 0); // End setTimeout - ensure DOM is ready
}
