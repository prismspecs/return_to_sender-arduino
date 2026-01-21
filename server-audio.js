import fs from 'fs';
import { spawn } from 'child_process';
import net from 'net';
import { join } from 'path';

const MPV_SOCKET = '/tmp/mpv-socket';
const AUDIO_CONFIG_FILE = 'audio-config.json';

export class ServerAudio {
    constructor(uploadsDir) {
        this.uploadsDir = uploadsDir;
        this.configPath = join(uploadsDir, AUDIO_CONFIG_FILE);
        
        this.audioProcess = null;
        this.filePath = null;
        this.state = {
            isPlaying: false,
            currentTime: 0,
            duration: 0,
            fileName: null,
            playbackSpeed: 1.0,
            volume: 100
        };
        
        this.startTime = 0;
        this.startOffset = 0;
        
        // Initial load
        this.loadConfig();
    }

    loadConfig() {
        try {
            if (fs.existsSync(this.configPath)) {
                const config = JSON.parse(fs.readFileSync(this.configPath, 'utf8'));
                if (config.filePath && fs.existsSync(config.filePath)) {
                    this.filePath = config.filePath;
                    this.state.fileName = config.fileName;
                    this.state.duration = config.duration || 0;
                    console.log(`[Audio] Loaded config: ${config.fileName}`);
                }
            }
        } catch (e) {
            console.error('[Audio] Error loading config:', e.message);
        }
    }

    saveConfig() {
        try {
            if (!fs.existsSync(this.uploadsDir)) {
                fs.mkdirSync(this.uploadsDir, { recursive: true });
            }
            fs.writeFileSync(this.configPath, JSON.stringify({
                filePath: this.filePath,
                fileName: this.state.fileName,
                duration: this.state.duration
            }, null, 2));
        } catch (e) {
            console.error('[Audio] Error saving config:', e.message);
        }
    }

    hasAudio() {
        return !!this.filePath && fs.existsSync(this.filePath);
    }

    getCurrentTime() {
        if (this.state.isPlaying) {
            const elapsed = (Date.now() - this.startTime) / 1000 * this.state.playbackSpeed;
            return this.startOffset + elapsed;
        }
        return this.state.currentTime;
    }

    getStatus() {
        return {
            type: 'audioState',
            isPlaying: this.state.isPlaying,
            currentTime: this.getCurrentTime(),
            fileName: this.state.fileName,
            duration: this.state.duration,
            playbackSpeed: this.state.playbackSpeed,
            volume: this.state.volume,
            hasAudio: this.hasAudio()
        };
    }

    // --- Playback Control ---

    play(startTime = 0, speed = 1.0) {
        console.log(`[Audio] play: startTime=${startTime}, speed=${speed}`);
        
        if (!this.hasAudio()) {
            console.error('[Audio] No valid audio file');
            return false;
        }

        this.stopProcess();

        this.state.playbackSpeed = speed;
        this.startOffset = startTime;
        this.startTime = Date.now();

        // Cleanup socket
        if (fs.existsSync(MPV_SOCKET)) {
            try { fs.unlinkSync(MPV_SOCKET); } catch (e) { }
        }

        const mpvArgs = [
            '--no-video',
            '--no-terminal',
            `--input-ipc-server=${MPV_SOCKET}`,
            `--start=${startTime}`,
            `--speed=${speed}`,
            `--volume=${this.state.volume}`,
            this.filePath
        ];

        console.log('[Audio] Spawning mpv:', mpvArgs.join(' '));
        
        this.audioProcess = spawn('mpv', mpvArgs, { stdio: ['ignore', 'pipe', 'pipe'] });
        
        // Listeners
        if (this.audioProcess.stdout) {
            this.audioProcess.stdout.on('data', d => console.log('[Audio] mpv stdout:', d.toString().trim()));
        }
        if (this.audioProcess.stderr) {
            this.audioProcess.stderr.on('data', d => {
                const msg = d.toString().trim();
                if (msg) console.error('[Audio] mpv stderr:', msg);
            });
        }

        this.audioProcess.on('error', (err) => {
            console.error('[Audio] mpv error:', err.message);
            if (err.code === 'ENOENT') {
                this.fallbackToFfplay(startTime, speed);
            } else {
                this.state.isPlaying = false;
            }
        });

        this.audioProcess.on('exit', (code, signal) => {
            console.log(`[Audio] mpv exited: code=${code}, signal=${signal}`);
            this.state.isPlaying = false;
        });

        this.state.isPlaying = true;
        return true;
    }

    fallbackToFfplay(startTime, speed) {
        console.log('[Audio] Fallback to ffplay');
        const args = [
            '-nodisp',
            '-autoexit',
            '-ss', String(startTime),
            '-af', `atempo=${speed}`,
            '-loglevel', 'error',
            this.filePath
        ];
        
        this.audioProcess = spawn('ffplay', args, { stdio: ['ignore', 'pipe', 'pipe'] });
        
        this.audioProcess.on('exit', () => {
             this.state.isPlaying = false; 
        });
    }

    pause() {
        if (this.state.isPlaying) {
            const elapsed = (Date.now() - this.startTime) / 1000 * this.state.playbackSpeed;
            this.state.currentTime = this.startOffset + elapsed;
            this.stopProcess();
        }
    }

    seek(time) {
        this.state.currentTime = time;
        if (this.state.isPlaying) {
            this.play(time, this.state.playbackSpeed);
        } else {
            this.startOffset = time;
        }
    }

    setVolume(vol) {
        this.state.volume = Math.max(0, Math.min(150, vol));
        if (this.state.isPlaying) {
            this.sendIpcCommand(['set_property', 'volume', this.state.volume]);
        }
    }

    stopProcess() {
        if (this.audioProcess) {
            this.audioProcess.kill('SIGTERM');
            this.audioProcess = null;
        }
        this.state.isPlaying = false;
        if (fs.existsSync(MPV_SOCKET)) {
            try { fs.unlinkSync(MPV_SOCKET); } catch (e) { }
        }
    }

    sendIpcCommand(command) {
        return new Promise((resolve, reject) => {
            if (!fs.existsSync(MPV_SOCKET)) return reject(new Error('No socket'));
            
            const client = net.createConnection(MPV_SOCKET);
            client.on('connect', () => {
                client.write(JSON.stringify({ command }) + '\n');
                client.end();
                resolve();
            });
            client.on('error', reject);
        });
    }

    // --- Handling Uploads ---
    handleUpload(file) {
        // Clean old files
        const files = fs.readdirSync(this.uploadsDir);
        files.forEach(f => {
            if (f.startsWith('current-audio') && f !== file.filename) {
                fs.unlinkSync(join(this.uploadsDir, f));
            }
        });

        this.filePath = file.path;
        this.state.fileName = file.originalname;
        this.state.currentTime = 0;
        this.state.isPlaying = false;
        
        this.saveConfig();
        
        return { success: true, fileName: file.originalname };
    }
}
