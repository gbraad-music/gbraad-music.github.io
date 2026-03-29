// Strudel Bundle - Uses @strudel/web package (single bundle, offline capable)
// Load strudel-web.js first, then call this

export async function initStrudel() {
    console.log('Initializing Strudel from @strudel/web bundle...');

    // @strudel/web exposes initStrudel() and makes Pattern, note(), etc. global
    if (typeof window.initStrudel === 'function') {
        await window.initStrudel();
    } else {
        throw new Error('strudel-web.js not loaded! Include it before this module.');
    }

    // Get or create AudioContext with 44100 Hz sample rate
    let audioContext = window.getAudioContext?.();
    if (!audioContext) {
        audioContext = new (window.AudioContext || window.webkitAudioContext)({
            sampleRate: 44100
        });
        console.log('Created new AudioContext with sampleRate:', audioContext.sampleRate);
    } else {
        console.log('Using existing AudioContext with sampleRate:', audioContext.sampleRate);
    }

    console.log('✅ Strudel initialized with AudioContext');

    // Debug: Check what's available
    console.log('Available globals:', {
        Pattern: typeof window.Pattern,
        note: typeof window.note,
        s: typeof window.s,
        samples: typeof window.samples,
        slider: typeof window.slider,
        getAudioContext: typeof window.getAudioContext
    });

    return {
        evaluate: async (code) => {
            // Transpile labeled patterns (r:, a:, $:) to stack()
            // This regex matches lines like "r: note(...)" or "$: s(...)"
            const hasLabels = /^\s*[\w$]+\s*:/m.test(code);

            if (hasLabels) {
                // Convert labeled patterns to stack() syntax
                const lines = code.split('\n');
                const patterns = [];
                const patternLabels = [];
                let currentPattern = '';
                let currentLabel = '';
                let stackModifiers = ''; // For .bpm(), .cpm(), etc. to apply to whole stack

                for (const line of lines) {
                    const labelMatch = line.match(/^\s*([\w$]+)\s*:\s*(.+)/);
                    if (labelMatch) {
                        // Save previous pattern
                        if (currentPattern) {
                            patterns.push(currentPattern);
                            patternLabels.push(currentLabel);
                        }
                        // Start new pattern
                        currentLabel = labelMatch[1];
                        currentPattern = labelMatch[2];
                    } else if (currentPattern && line.trim() && !line.trim().startsWith('//')) {
                        // Continuation of current pattern (skip comment lines)
                        currentPattern += '\n' + line;
                    }
                }
                // Save last pattern
                if (currentPattern) {
                    patterns.push(currentPattern);
                    patternLabels.push(currentLabel);
                }

                // Extract tempo modifiers (.bpm, .cpm) from patterns and apply to stack
                // Also inject pattern labels as metadata and expose as global variables
                const modifiedPatterns = patterns.map((p, i) => {
                    // Check for .bpm() or .cpm() at the end
                    const bpmMatch = p.match(/\.bpm\((\d+)\)\s*$/);
                    const cpmMatch = p.match(/\.cpm\((\d+)\)\s*$/);

                    if (bpmMatch && !stackModifiers) {
                        stackModifiers = `.bpm(${bpmMatch[1]})`;
                        p = p.replace(/\.bpm\(\d+\)\s*$/, ''); // Remove from pattern
                    } else if (cpmMatch && !stackModifiers) {
                        stackModifiers = `.cpm(${cpmMatch[1]})`;
                        p = p.replace(/\.cpm\(\d+\)\s*$/, ''); // Remove from pattern
                    }

                    // Inject label metadata
                    const label = patternLabels[i];
                    if (label) {
                        p = `(${p}).fmap(hap => ({...hap, _label: '${label}'}))`;
                    }

                    return p;
                });

                // Expose labeled patterns as global variables (for console access)
                // Use window assignment to avoid const redeclaration on re-evaluation
                const variableAssignments = patternLabels.map((label, i) => {
                    return `window.${label} = ${modifiedPatterns[i]};`;
                }).join('\n');

                // Build stack using the exposed variables
                const stackVars = patternLabels.map(label => `window.${label}`).join(',\n');

                // Wrap in stack() with variable assignments first
                if (modifiedPatterns.length > 0) {
                    code = `${variableAssignments}\nstack(\n${stackVars}\n)${stackModifiers}`;
                }
            }

            console.log('📜 Transpiled code:', code);

            // Evaluate the code
            const pattern = eval(code);
            console.log('📝 Pattern evaluated:', pattern);
            if (pattern && typeof pattern.play === 'function') {
                console.log('▶️ Calling pattern.play()...');
                await pattern.play();
                console.log('✅ pattern.play() completed');
            } else {
                console.warn('⚠️ No pattern or no play method:', pattern);
            }
        },
        start: () => {
            // Already handled by .play()
        },
        stop: () => {
            if (window.hush) {
                window.hush();
            }
        },
        audioContext
    };
}
