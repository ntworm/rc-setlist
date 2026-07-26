import dgram from 'node:dgram';
// @ts-ignore
import * as osc from 'osc-min';

export class MockOSCServer {
  private server: dgram.Socket;
  private client: dgram.Socket;
  private isPlaying: boolean = false;
  private tempo: number = 120;
  private currentSongTime: number = 0;
  private lastClientPort: number = 11001;
  private lastClientAddress: string = '127.0.0.1';
  
  // Mock cues corresponding to the unit test setup
  private cues = [
    { name: 'Song A', time: 0 },
    { name: 'Song A > Verse', time: 30 },
    { name: 'Song A > Chorus [loop 4x]', time: 60 },
    { name: 'Song B', time: 100 },
    { name: '_end', time: 150 }
  ];

  constructor() {
    this.server = dgram.createSocket('udp4');
    this.client = dgram.createSocket('udp4');
    
    this.server.on('message', (msg, rinfo) => {
      try {
        this.lastClientPort = rinfo.port;
        this.lastClientAddress = rinfo.address;
        const oscMsg = osc.fromBuffer(msg);
        this.handleMessage(oscMsg);
      } catch (err) {
        console.error('MockOSCServer: Erro ao processar mensagem OSC:', err);
      }
    });
  }

  private handleMessage(oscMsg: any): void {
    if (oscMsg.oscType !== 'message') return;
    
    const address = oscMsg.address;
    
    if (address === '/live/song/get/tempo') {
      this.sendReply('/live/song/get/tempo', [
        { type: 'float', value: this.tempo }
      ]);
    } else if (address === '/live/song/get/is_playing') {
      this.sendReply('/live/song/get/is_playing', [
        { type: 'integer', value: this.isPlaying ? 1 : 0 }
      ]);
    } else if (address === '/live/song/get/current_song_time') {
      this.sendReply('/live/song/get/current_song_time', [
        { type: 'float', value: this.currentSongTime }
      ]);
    } else if (address === '/live/song/get/cue_points') {
      // Return flat array: [name0, time0, name1, time1, ...]
      const args: any[] = [];
      for (const cue of this.cues) {
        args.push({ type: 'string', value: cue.name });
        args.push({ type: 'float', value: cue.time });
      }
      this.sendReply('/live/song/get/cue_points', args);
    } else if (address === '/live/song/start_playing') {
      this.isPlaying = true;
      this.sendReply('/live/song/get/is_playing', [
        { type: 'integer', value: 1 }
      ]);
    } else if (address === '/live/song/stop_playing') {
      this.isPlaying = false;
      this.sendReply('/live/song/get/is_playing', [
        { type: 'integer', value: 0 }
      ]);
    } else if (address === '/live/song/cue_point/jump') {
      const idxOrName = oscMsg.args[0]?.value;
      if (typeof idxOrName === 'number') {
        const cue = this.cues[idxOrName];
        if (cue) {
          this.currentSongTime = cue.time;
        }
      } else if (typeof idxOrName === 'string') {
        const cue = this.cues.find(c => c.name === idxOrName);
        if (cue) {
          this.currentSongTime = cue.time;
        }
      }
      // Notify client of the new time
      this.sendReply('/live/song/get/current_song_time', [
        { type: 'float', value: this.currentSongTime }
      ]);
    } else if (address === '/live/song/cue_point/add_or_delete') {
      // Mirrors AbletonOSC's `set_or_delete_cue` toggle semantics: if a
      // marker exists at the target beat, delete it; otherwise create one
      // there. Honors the float argument for the target beat.
      const target = oscMsg.args[0]?.value;
      if (typeof target !== 'number') return;
      const existing = this.cues.findIndex((c) => c.time === target);
      if (existing >= 0) {
        this.cues.splice(existing, 1);
      } else {
        this.cues.push({ name: `Marker ${this.cues.length + 1}`, time: target });
      }
      this.cues.sort((a, b) => a.time - b.time);
    } else if (address === '/live/song/cue_point/set/name') {
      const idx = oscMsg.args[0]?.value;
      const newName = oscMsg.args[1]?.value;
      if (typeof idx === 'number' && typeof newName === 'string') {
        // AbletonOSC indexes by chronological order, not creation order.
        const sorted = [...this.cues].sort((a, b) => a.time - b.time);
        if (idx >= 0 && idx < sorted.length) {
          const target = sorted[idx];
          if (!target) return;
          target.name = newName;
          const realIdx = this.cues.indexOf(target);
          if (realIdx >= 0) this.cues[realIdx] = target;
        }
      }
    } else if (address === '/live/song/set/current_song_time') {
      const t = oscMsg.args[0]?.value;
      if (typeof t === 'number') this.currentSongTime = t;
    } else if (address === '/live/song/set/loop') {
      // noop
    } else if (address.startsWith('/live/song/start_listen/')) {
      const prop = address.substring('/live/song/start_listen/'.length);
      if (prop === 'tempo') {
        this.sendReply('/live/song/get/tempo', [{ type: 'float', value: this.tempo }]);
      } else if (prop === 'is_playing') {
        this.sendReply('/live/song/get/is_playing', [{ type: 'integer', value: this.isPlaying ? 1 : 0 }]);
      } else if (prop === 'metronome') {
        this.sendReply('/live/song/get/metronome', [{ type: 'integer', value: 0 }]);
      } else if (prop === 'signature_numerator') {
        this.sendReply('/live/song/get/signature_numerator', [{ type: 'integer', value: 4 }]);
      } else if (prop === 'signature_denominator') {
        this.sendReply('/live/song/get/signature_denominator', [{ type: 'integer', value: 4 }]);
      } else if (prop === 'clip_trigger_quantization') {
        this.sendReply('/live/song/get/clip_trigger_quantization', [{ type: 'integer', value: 4 }]);
      }
    } else if (address.startsWith('/live/song/stop_listen/')) {
      // noop
    }
  }

  private sendReply(address: string, args: any[]): void {
    const oscMsg = {
      oscType: 'message',
      address,
      args
    };
    const buffer = osc.toBuffer(oscMsg);
    this.client.send(buffer, this.lastClientPort, this.lastClientAddress);
  }

  public start(): Promise<void> {
    return new Promise((resolve, reject) => {
      const onError = (err: any) => {
        this.server.off('error', onError);
        reject(err);
      };
      this.server.once('error', onError);
      this.server.bind(11000, '127.0.0.1', () => {
        this.server.off('error', onError);
        resolve();
      });
    });
  }

  public stop(): Promise<void> {
    try { this.server.close(); } catch {}
    try { this.client.close(); } catch {}
    return Promise.resolve();
  }
}
