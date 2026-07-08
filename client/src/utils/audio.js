let audioCtx = null;

const getContext = () => {
    if (!audioCtx) {
        audioCtx = new (window.AudioContext || window.webkitAudioContext)();
    }
    if (audioCtx.state === 'suspended') {
        audioCtx.resume();
    }
    return audioCtx;
};

// Play a short UI click (e.g. tool selection, color pick)
export const playClick = () => {
    try {
        const ctx = getContext();
        const osc = ctx.createOscillator();
        const gain = ctx.createGain();
        osc.type = 'sine';
        osc.frequency.setValueAtTime(600, ctx.currentTime);
        osc.frequency.exponentialRampToValueAtTime(800, ctx.currentTime + 0.05);
        
        gain.gain.setValueAtTime(0, ctx.currentTime);
        gain.gain.linearRampToValueAtTime(0.1, ctx.currentTime + 0.01);
        gain.gain.exponentialRampToValueAtTime(0.001, ctx.currentTime + 0.05);
        
        osc.connect(gain);
        gain.connect(ctx.destination);
        osc.start();
        osc.stop(ctx.currentTime + 0.05);
    } catch(e) { console.error(e); }
};

// Tick for the last 10 seconds of the timer
export const playTick = () => {
    try {
        const ctx = getContext();
        const osc = ctx.createOscillator();
        const gain = ctx.createGain();
        osc.type = 'triangle';
        osc.frequency.setValueAtTime(800, ctx.currentTime);
        osc.frequency.exponentialRampToValueAtTime(400, ctx.currentTime + 0.05);
        
        gain.gain.setValueAtTime(0, ctx.currentTime);
        gain.gain.linearRampToValueAtTime(0.2, ctx.currentTime + 0.01);
        gain.gain.exponentialRampToValueAtTime(0.001, ctx.currentTime + 0.05);
        
        osc.connect(gain);
        gain.connect(ctx.destination);
        osc.start();
        osc.stop(ctx.currentTime + 0.05);
    } catch(e) { console.error(e); }
};

// Victory chime
export const playWin = () => {
    try {
        const ctx = getContext();
        const playNote = (freq, startTime, duration) => {
            const osc = ctx.createOscillator();
            const gain = ctx.createGain();
            osc.type = 'square';
            osc.frequency.value = freq;
            gain.gain.setValueAtTime(0.1, startTime);
            gain.gain.exponentialRampToValueAtTime(0.001, startTime + duration);
            osc.connect(gain);
            gain.connect(ctx.destination);
            osc.start(startTime);
            osc.stop(startTime + duration);
        };
        const now = ctx.currentTime;
        playNote(440, now, 0.1); // A4
        playNote(554.37, now + 0.15, 0.1); // C#5
        playNote(659.25, now + 0.3, 0.4); // E5
    } catch(e) { console.error(e); }
};

// Defeat sound
export const playLose = () => {
    try {
        const ctx = getContext();
        const playNote = (freq, startTime, duration) => {
            const osc = ctx.createOscillator();
            const gain = ctx.createGain();
            osc.type = 'sawtooth';
            osc.frequency.value = freq;
            gain.gain.setValueAtTime(0.1, startTime);
            gain.gain.exponentialRampToValueAtTime(0.001, startTime + duration);
            osc.connect(gain);
            gain.connect(ctx.destination);
            osc.start(startTime);
            osc.stop(startTime + duration);
        };
        const now = ctx.currentTime;
        playNote(300, now, 0.2); 
        playNote(280, now + 0.25, 0.2);
        playNote(250, now + 0.5, 0.6); 
    } catch(e) { console.error(e); }
};

// Drawing loop logic
let drawingOsc = null;
let drawingGain = null;

export const startDrawingSound = () => {
    // Disabled based on user feedback
};

export const stopDrawingSound = () => {
    // Disabled based on user feedback
};

// Quick hover blip
export const playHover = () => {
    try {
        const ctx = getContext();
        const osc = ctx.createOscillator();
        const gain = ctx.createGain();
        osc.type = 'sine';
        osc.frequency.setValueAtTime(400, ctx.currentTime);
        
        gain.gain.setValueAtTime(0, ctx.currentTime);
        gain.gain.linearRampToValueAtTime(0.02, ctx.currentTime + 0.005);
        gain.gain.exponentialRampToValueAtTime(0.001, ctx.currentTime + 0.03);
        
        osc.connect(gain);
        gain.connect(ctx.destination);
        osc.start();
        osc.stop(ctx.currentTime + 0.03);
    } catch(e) {}
};

// Rapid ticking for score
export const playScoreTick = (pitchMultiplier = 1) => {
    try {
        const ctx = getContext();
        const osc = ctx.createOscillator();
        const gain = ctx.createGain();
        osc.type = 'square';
        osc.frequency.setValueAtTime(400 * pitchMultiplier, ctx.currentTime);
        
        gain.gain.setValueAtTime(0, ctx.currentTime);
        gain.gain.linearRampToValueAtTime(0.015, ctx.currentTime + 0.005);
        gain.gain.exponentialRampToValueAtTime(0.001, ctx.currentTime + 0.03);
        
        osc.connect(gain);
        gain.connect(ctx.destination);
        osc.start();
        osc.stop(ctx.currentTime + 0.03);
    } catch(e) {}
};

// Game start sound (DRAW!)
export const playStart = () => {
    try {
        const ctx = getContext();
        const now = ctx.currentTime;
        
        const playNote = (freq, startTime, duration) => {
            const osc = ctx.createOscillator();
            const gain = ctx.createGain();
            osc.type = 'square';
            osc.frequency.value = freq;
            
            gain.gain.setValueAtTime(0, startTime);
            gain.gain.linearRampToValueAtTime(0.1, startTime + 0.02);
            gain.gain.exponentialRampToValueAtTime(0.001, startTime + duration);
            
            osc.connect(gain);
            gain.connect(ctx.destination);
            osc.start(startTime);
            osc.stop(startTime + duration);
        };

        // Energetic arcade start arpeggio (C5 -> E5 -> G5 -> C6)
        playNote(523.25, now, 0.1);       // C5
        playNote(659.25, now + 0.08, 0.1); // E5
        playNote(783.99, now + 0.16, 0.1); // G5
        playNote(1046.50, now + 0.24, 0.4); // C6 (held slightly longer)
        
    } catch(e) {}
};

// Combo / Hype sound
export const playCombo = () => {
    try {
        const ctx = getContext();
        const now = ctx.currentTime;
        
        const playNote = (freq, startTime, duration) => {
            const osc = ctx.createOscillator();
            const gain = ctx.createGain();
            osc.type = 'square';
            osc.frequency.value = freq;
            
            gain.gain.setValueAtTime(0, startTime);
            gain.gain.linearRampToValueAtTime(0.05, startTime + 0.02);
            gain.gain.exponentialRampToValueAtTime(0.001, startTime + duration);
            
            osc.connect(gain);
            gain.connect(ctx.destination);
            osc.start(startTime);
            osc.stop(startTime + duration);
        };

        // Quick major third ping
        playNote(880, now, 0.15); // A5
        playNote(1108.73, now + 0.05, 0.2); // C#6
    } catch(e) {}
};

// Retro Background Music Sequencer
let bgmInterval = null;
let isBgmPlaying = false;

export const toggleBGM = (shouldPlay) => {
    if (shouldPlay && !isBgmPlaying) {
        isBgmPlaying = true;
        let step = 0;
        // Classic 8-bit bassline loop: C2, C2, E2, G2, A2, G2, E2, D2
        const notes = [65.41, 65.41, 82.41, 98.00, 110.00, 98.00, 82.41, 73.42]; 
        
        bgmInterval = setInterval(() => {
            try {
                const ctx = getContext();
                const osc = ctx.createOscillator();
                const gain = ctx.createGain();
                osc.type = 'triangle'; // Deep retro sound
                osc.frequency.value = notes[step % notes.length];
                
                gain.gain.setValueAtTime(0, ctx.currentTime);
                gain.gain.linearRampToValueAtTime(0.04, ctx.currentTime + 0.02);
                gain.gain.exponentialRampToValueAtTime(0.001, ctx.currentTime + 0.2);
                
                osc.connect(gain);
                gain.connect(ctx.destination);
                osc.start();
                osc.stop(ctx.currentTime + 0.2);
            } catch(e) {}
            step++;
        }, 200); // Fast tempo loop
    } else if (!shouldPlay && isBgmPlaying) {
        isBgmPlaying = false;
        clearInterval(bgmInterval);
    }
};
