
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

        // Settings
        this.maxSpeed = 24000;
        this.acceleration = 24000;
        
        this.restEnabled = false;
        this.restDuration = 1; // minutes
        this.isResting = false;
        this.restStartTime = 0;
    }

    updateConfig(config) {
        if (config.motorMapping) this.motorMapping = config.motorMapping;
        if (config.reverseFlags) this.reverseFlags = config.reverseFlags;
        if (config.restEnabled !== undefined) this.restEnabled = config.restEnabled;
        if (config.restDuration !== undefined) this.restDuration = config.restDuration;
        
        if (config.choreography) {
            this.choreography = config.choreography;
            // Ensure sorted
            this.choreography.sort((a, b) => a.time - b.time);
        }
        
        // Update shared state for new clients
        this.callbacks.broadcast({
            type: 'choreographySync',
            choreography: this.choreography,
            reverseFlags: this.reverseFlags,
            motorMapping: this.motorMapping
        });
    }

    play(startTime = 0, speed = 1.0) {
        if (this.isPlaying) this.stop();
        
        this.isPlaying = true;
        this.playbackSpeed = speed;
        this.currentTime = startTime;
        this.playbackStartTime = Date.now() - (startTime * 1000 / speed);
        this.keyframeIndex = 0;

        // Advance index to current time
        while(this.keyframeIndex < this.choreography.length && this.choreography[this.keyframeIndex].time <= this.currentTime) {
            this.keyframeIndex++;
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

    stop() {
        this.isPlaying = false;
        if (this.timer) clearInterval(this.timer);
        this.timer = null;
        this.isResting = false;
        
        // Stop Audio
        if (this.callbacks.isAudioPlaying()) {
            this.callbacks.pauseAudio();
        }
        
        this.callbacks.broadcast({
            type: 'playState',
            isPlaying: false,
            currentTime: this.currentTime
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

            if (elapsedRest >= totalRest) {
                // Wake up
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
            } else {
                return; // Still resting
            }
        }

        // Check Loop
        const lastTime = this.choreography.length > 0 ? this.choreography[this.choreography.length - 1].time : 0;
        // Basic loop logic - we need to know if "Loop" is enabled. 
        // Currently loop is a UI toggle. We need to sync that state too?
        // For now, let's assume if we run past the end + buffer, we stop, unless looped.
        // But the server doesn't know if loop is enabled yet. 
        // I should add loopEnabled to config.

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
             if (this.reverseFlags[i]) s = -s;
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
            startTime: this.playbackStartTime // roughly
        };
    }
}
