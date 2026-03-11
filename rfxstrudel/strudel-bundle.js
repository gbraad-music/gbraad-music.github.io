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
            // Use eval to run Strudel code in global context
            const pattern = eval(code);
            if (pattern && typeof pattern.play === 'function') {
                await pattern.play();
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
