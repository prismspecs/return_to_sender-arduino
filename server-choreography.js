export class ServerChoreography {
    constructor(callbacks) {
        this.callbacks = callbacks; // { sendCommand, broadcast, getAudioTime, isAudioPlaying, pauseAudio, playAudio, seekAudio }
        
        this.choreography = [];
        this.motorMapping = [0, 1, 2, 3];
        this.reverseFlags = [false, false, false, false];
        
        this.isPlaying = false;
        this.playbackSpeed = 1.0;
        this.currentTime = 0;
        this.playbackStartTime = 0;
        
        this.timer = null;
        this.keyframeIndex = 0;
        
        this.fileName = 'Untitled';

        // Settings
        this.maxSpeed = 24000;
        this.acceleration = 24000;
        
        this.loopEnabled = true; // Default
        this.restEnabled = false;
        this.restDuration = 1; // minutes
        this.isResting = false;
        this.restStartTime = 0;
        
        this.frameDimensions = {}; // { width, length, height }
    }

    updateConfig(config) {
        if (config.fileName) this.fileName = config.fileName;
        if (config.motorMapping) this.motorMapping = config.motorMapping;
        if (config.reverseFlags) this.reverseFlags = config.reverseFlags;
        if (config.restEnabled !== undefined) {
             this.restEnabled = config.restEnabled;
             console.log(`[Choreo] Rest Enabled updated to: ${this.restEnabled}`);
        }
        if (config.restDuration !== undefined) {
             this.restDuration = config.restDuration;
             console.log(`[Choreo] Rest Duration updated to: ${this.restDuration}`);
        }
        if (config.loopEnabled !== undefined) {
             this.loopEnabled = config.loopEnabled;
             console.log(`[Choreo] Loop Enabled updated to: ${this.loopEnabled}`);
        }
        
        if (config.frameDimensions) {
            this.frameDimensions = config.frameDimensions;
        }
        
        if (config.settings) {
            if (config.settings.speed) this.maxSpeed = config.settings.speed;
            if (config.settings.accel) this.acceleration = config.settings.accel;
        }
        
        if (config.choreography) {
            this.choreography = config.choreography;
            // Ensure sorted
            this.choreography.sort((a, b) => a.time - b.time);
        }
        
        // Update shared state for new clients
        this.callbacks.broadcast({
            type: 'choreographySync',
            choreography: this.choreography,
            fileName: this.fileName,
            reverseFlags: this.reverseFlags,
            motorMapping: this.motorMapping,
            loopEnabled: this.loopEnabled,
            frameDimensions: this.frameDimensions,
            settings: {
                speed: this.maxSpeed,
                accel: this.acceleration
            }
        });
    }

    play(startTime = 0, speed = 1.0) {
        // If resuming (startTime is roughly equal to current time), don't reset index
        const isResuming = Math.abs(startTime - this.currentTime) < 0.1;
        
        if (this.isResting) {
            this.isResting = false;
            this.callbacks.sendCommand('E 1'); // Re-enable motors
            this.callbacks.broadcast({ type: 'restState', isResting: false });
        }

        if (this.isPlaying) this.pause();
        
        this.isPlaying = true;
        this.playbackSpeed = speed;
        this.currentTime = startTime;
        this.playbackStartTime = Date.now() - (startTime * 1000 / speed);
        
        if (!isResuming) {
             this.keyframeIndex = 0;
             // Advance index to current time
             while(this.keyframeIndex < this.choreography.length && this.choreography[this.keyframeIndex].time <= this.currentTime) {
                 this.keyframeIndex++;
             }
        }
        
        // Start Audio if available
        if (this.callbacks.hasAudio()) {
             this.callbacks.playAudio(startTime, speed);
        }

        this.callbacks.broadcast({
            type: 'playState',
            isPlaying: true,
            currentTime: this.currentTime,
            speed: this.playbackSpeed,
            startTime: Date.now(), // Client can use this to sync exact offset
            offsetTime: this.currentTime
        });

        this.timer = setInterval(() => this.tick(), 20);
    }

    pause() {
        const wasResting = this.isResting;
        this.isPlaying = false;
        if (this.timer) clearInterval(this.timer);
        this.timer = null;
        this.isResting = false;
        
        if (wasResting) {
            this.callbacks.broadcast({ type: 'restState', isResting: false });
        }

        if (this.callbacks.isAudioPlaying() || this.callbacks.hasAudio()) {
            this.callbacks.pauseAudio();
        }

        this.callbacks.sendCommand('Q'); // Quick stop motors

        this.callbacks.broadcast({
            type: 'playState',
            isPlaying: false,
            currentTime: this.currentTime
        });
    }

    stop() {
        const wasResting = this.isResting;
        this.isPlaying = false;
        if (this.timer) clearInterval(this.timer);
        this.timer = null;
        this.isResting = false;
        
        if (wasResting) {
            this.callbacks.broadcast({ type: 'restState', isResting: false });
        }

        // Stop Audio and Reset
        if (this.callbacks.isAudioPlaying() || this.callbacks.hasAudio()) {
            this.callbacks.pauseAudio();
            this.callbacks.seekAudio(0);
        }

        // Reset Time
        this.currentTime = 0;
        this.keyframeIndex = 0;

        // Stop Motors and Return to Zero
        this.callbacks.sendCommand('Q');
        // Allow a tiny delay for Q to process/interrupt before queuing the return to home
        setTimeout(() => {
             this.callbacks.sendCommand('M 0 0 0 0');
        }, 50);
        
        this.callbacks.broadcast({
            type: 'playState',
            isPlaying: false,
            currentTime: 0
        });
    }

    tick() {
        // Sync time with Audio if available
        if (this.callbacks.isAudioPlaying()) {
            this.currentTime = this.callbacks.getAudioTime();
        } else {
            // Local clock
            const now = Date.now();
            this.currentTime = ((now - this.playbackStartTime) / 1000) * this.playbackSpeed;
        }

        // Handle Rest State
        if (this.isResting) {
            const elapsedRest = Date.now() - this.restStartTime;
            const totalRest = this.restDuration * 60 * 1000;
            
            if (elapsedRest % 5000 < 50) console.log(`[Choreo] Resting... ${Math.round(elapsedRest/1000)}s / ${Math.round(totalRest/1000)}s`);

            if (elapsedRest >= totalRest) {
                // Wake up
                console.log('[Choreo] Waking up from Rest.');
                this.isResting = false;
                this.callbacks.sendCommand('E 1'); // Enable motors
                
                // Restart
                this.currentTime = 0;
                this.playbackStartTime = Date.now();
                this.keyframeIndex = 0;
                
                if (this.callbacks.hasAudio()) {
                    this.callbacks.playAudio(0, this.playbackSpeed);
                }
                
                this.callbacks.broadcast({
                    type: 'restState',
                    isResting: false
                });
                
                // Notify clients of restart
                this.callbacks.broadcast({
                    type: 'playState',
                    isPlaying: true,
                    currentTime: 0,
                    speed: this.playbackSpeed,
                    startTime: this.playbackStartTime
                });
            } else {
                return; // Still resting
            }
        }

        // Check Loop / End
        const lastTime = this.choreography.length > 0 ? this.choreography[this.choreography.length - 1].time : 0;
        
        if (this.currentTime > lastTime + 0.5) { // 0.5s buffer after end
            console.log(`[Choreo] End reached. Loop: ${this.loopEnabled}, Rest: ${this.restEnabled}`);
            if (this.restEnabled) {
                // Priority: Rest Mode (Loop with Pause)
                console.log('Entering Rest Mode logic...');
                this.isResting = true;
                this.restStartTime = Date.now();
                this.callbacks.sendCommand('E 0'); // Disable motors
                
                // Notify clients to stop UI
                this.callbacks.broadcast({
                    type: 'playState',
                    isPlaying: false,
                    currentTime: this.currentTime
                });
                this.callbacks.broadcast({ 
                    type: 'restState', 
                    isResting: true,
                    startTime: this.restStartTime,
                    duration: this.restDuration
                });

            } else if (this.loopEnabled) {
                // Immediate Loop
                console.log('Looping...');
                this.currentTime = 0;
                this.playbackStartTime = Date.now();
                this.keyframeIndex = 0;
                if (this.callbacks.hasAudio()) {
                    this.callbacks.playAudio(0, this.playbackSpeed);
                }
                
                // Notify clients of reset
                this.callbacks.broadcast({
                    type: 'playState',
                    isPlaying: true,
                    currentTime: 0,
                    speed: this.playbackSpeed,
                    startTime: this.playbackStartTime
                });

            } else {
                // Just Stop
                console.log('Playback Finished.');
                this.stop();
                return;
            }
        }

        // Execute Keyframes
        while (this.keyframeIndex < this.choreography.length &&
               this.choreography[this.keyframeIndex].time <= this.currentTime) {
            
            const kf = this.choreography[this.keyframeIndex];
            this.executeKeyframe(kf);
            this.keyframeIndex++;
        }
    }

    executeKeyframe(kf) {
         const physicalSteps = [0, 0, 0, 0];
         for (let i = 0; i < 4; i++) {
             const driverIndex = this.motorMapping[i];
             let s = kf.positions[i];
             // Software inversion removed
             physicalSteps[driverIndex] = s;
         }
         
         // Send Speed/Accel if changed
         if (kf.speed && kf.speed !== this.maxSpeed) {
             this.maxSpeed = kf.speed;
             this.callbacks.sendCommand(`S ${this.maxSpeed}`);
         }
         if (kf.accel && kf.accel !== this.acceleration) {
             this.acceleration = kf.accel;
             this.callbacks.sendCommand(`A ${this.acceleration}`);
         }

         this.callbacks.sendCommand(`M ${physicalSteps.join(' ')}`);
    }

    getStatus() {
        return {
            type: 'playState',
            isPlaying: this.isPlaying,
            currentTime: this.currentTime,
            speed: this.playbackSpeed,
            startTime: this.playbackStartTime,
            loopEnabled: this.loopEnabled
        };
    }
}