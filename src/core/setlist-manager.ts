import { Section, Song, SetlistState } from '../types.js';
import { parseSetlist } from './locator-parser.js';
import { calculateSetlistMetrics } from './setlist-metrics.js';

export type AutomationAction =
  | { type: 'stop' }
  | { type: 'next'; nextSongIndex: number }
  | { type: 'activate_loop'; start: number; duration: number }
  | { type: 'deactivate_loop' }
  | { type: 'change_bpm'; bpm: number }
  | { type: 'change_metronome'; value: boolean }
  | { type: 'skip'; targetCue: string };

export class SetlistManager {
  private songs: Song[] = [];
  private hidden: { name: string; time: number }[] = [];
  private activeSongIndex: number = -1;
  private activeSectionIndex: number = -1;
  private isPlaying: boolean = false;
  private tempo: number = 120;
  private currentSongTime: number = 0;
  private rawCues: { name: string; time: number; cueIndex?: number }[] = [];
  private appliedCuesFingerprint: string | null = null;
  private metronome: boolean = false;
  private signatureNumerator: number = 4;
  private signatureDenominator: number = 4;
  private clipTriggerQuantization: number = 4; // Default to 1 Bar (4)
  private arrangementEndTime: number | null = null;
  private chronologicalSongs: Array<{ song: Song; displayIndex: number }> = [];
  private derivedSongs: Song[] | null = null;
  private derivedTotalDurationSeconds: number | null = null;
  private setlistVersion: number = 1;

  private customOrder: string[] = [];

  // ShowState operational fields
  private stateVersion: number = 1;
  private abletonConnection: 'disconnected' | 'connecting' | 'synced' | 'degraded' = 'disconnected';
  private oscConnection: 'disconnected' | 'connecting' | 'synced' | 'degraded' = 'disconnected';
  private pendingCommands: string[] = [];
  private mode: 'rehearsal' | 'show' = 'rehearsal';
  private panicActive: boolean = false;
  private criticalCommandsLocked: boolean = false;

  // Track which automations have already fired to prevent re-triggering
  private firedAutomations: Set<string> = new Set();
  private lastSongIndex: number = -1;
  private lastSectionIndex: number = -1;
  
  // Loop iteration tracking
  private loopActive: boolean = false;
  private loopCount: number | null = null;
  private currentLoopIteration: number = 0;
  private loopStartBeat: number = 0;
  private loopEndBeat: number = 0;
  private pendingDeactivateLoop: boolean = false;

  constructor() {}

  public updateCues(cues: { name: string; time: number }[]): void {
    const cuesWithIndex = cues.map((c, idx) => ({ ...c, cueIndex: idx }));
    const sortedCues = [...cuesWithIndex].sort((a, b) => a.time - b.time);
    const fingerprint = JSON.stringify(sortedCues.map((cue) => [cue.name, cue.time]));
    if (fingerprint === this.appliedCuesFingerprint) return;

    this.appliedCuesFingerprint = fingerprint;
    this.rawCues = sortedCues;
    const parsed = parseSetlist(this.rawCues);
    this.songs = parsed.songs;
    this.hidden = parsed.hidden;
    this.sortSongs();
    this.firedAutomations.clear();
    this.clearLoop();
    this.updateActiveIndices();
    this.stateVersion++;
  }

  private sortSongs(): void {
    const chronological = [...this.songs].sort((a, b) => a.time - b.time);
    if (this.customOrder.length === 0) {
      this.rebuildChronologicalIndex();
      this.invalidateDerivedSongs();
      return;
    }
    const customRank = new Map(this.customOrder.map((title, index) => [title, index]));
    const orderedSongs = chronological
      .filter((song) => customRank.has(song.title))
      .sort((a, b) => {
        const orderDifference = customRank.get(a.title)! - customRank.get(b.title)!;
        return orderDifference || a.time - b.time;
      });
    const customSongs = new Set(orderedSongs);
    const leadingSongs: Song[] = [];
    const songsAfter = new Map<Song, Song[]>();
    let chronologicalAnchor: Song | null = null;
    let firstCustomSong: Song | null = null;

    for (const song of chronological) {
      if (customSongs.has(song)) {
        chronologicalAnchor = song;
        firstCustomSong ??= song;
      } else if (chronologicalAnchor) {
        const group = songsAfter.get(chronologicalAnchor) ?? [];
        group.push(song);
        songsAfter.set(chronologicalAnchor, group);
      } else {
        leadingSongs.push(song);
      }
    }

    const ordered: Song[] = [];
    for (const song of orderedSongs) {
      if (song === firstCustomSong) ordered.push(...leadingSongs);
      ordered.push(song, ...(songsAfter.get(song) ?? []));
    }
    this.songs = ordered.length > 0 ? ordered : chronological;
    this.rebuildChronologicalIndex();
    this.invalidateDerivedSongs();
  }

  private rebuildChronologicalIndex(): void {
    const displayIndex = new Map(this.songs.map((song, index) => [song, index]));
    this.chronologicalSongs = [...this.songs]
      .sort((a, b) => a.time - b.time)
      .map((song) => ({ song, displayIndex: displayIndex.get(song)! }));
  }

  private invalidateDerivedSongs(): void {
    this.derivedSongs = null;
    this.derivedTotalDurationSeconds = null;
    this.setlistVersion++;
  }

  private getDerivedSongs(): { songs: Song[]; totalDurationSeconds: number | null } {
    if (!this.derivedSongs) {
      const metrics = calculateSetlistMetrics(this.songs, this.arrangementEndTime, this.tempo);
      this.derivedSongs = this.songs.map((song) => ({
        ...song,
        durationSeconds: metrics.songDurationSecondsBySong.get(song) ?? null,
      }));
      this.derivedTotalDurationSeconds = metrics.totalDurationSeconds;
    }
    return {
      songs: this.derivedSongs,
      totalDurationSeconds: this.derivedTotalDurationSeconds,
    };
  }

  public updateTransport(time: number, isPlaying: boolean, tempo?: number): void {
    const prevTime = this.currentSongTime;
    this.currentSongTime = time;
    this.isPlaying = isPlaying;
    if (tempo !== undefined && tempo !== this.tempo) {
      this.tempo = tempo;
      this.invalidateDerivedSongs();
    }

    if (this.loopActive) {
      // If playhead jumped significantly outside the loop boundaries, reset loop state.
      // (Previously: wrap detection had a fixed 5-beat window from loopStart, which
      // missed wraps on long loops like 8 bars = 32 beats.)
      if (time < this.loopStartBeat - 2.0 || time > this.loopEndBeat + 2.0) {
        this.clearLoop();
      } else if (isPlaying && this.loopCount !== null && this.loopCount > 0) {
        // Detect playhead wrap-around: time jumped backwards within the loop bounds.
        // The wrap window covers the first half of the loop region — a true Live
        // wrap lands near loopStart (allowing for OSC polling drift up to half the
        // loop, which is far looser than the old fixed 5-beat window that missed
        // wraps on long loops like 8 bars = 32 beats).
        const loopMid = this.loopStartBeat + (this.loopEndBeat - this.loopStartBeat) / 2;
        if (time < prevTime && time >= this.loopStartBeat - 1.0 && time <= loopMid) {
          this.currentLoopIteration++;
          console.log(`[Loop] Loop wrapped around. Iteration ${this.currentLoopIteration} of ${this.loopCount}`);

          if (this.currentLoopIteration >= this.loopCount) {
            this.pendingDeactivateLoop = true;
          }
        }
      }
    }

    this.updateActiveIndices();
    this.stateVersion++;
  }

  public updateMetronome(metronome: boolean): void {
    this.metronome = metronome;
    this.stateVersion++;
  }

  public updateSignature(numerator: number, denominator: number): void {
    this.signatureNumerator = numerator;
    this.signatureDenominator = denominator;
    this.stateVersion++;
  }

  private updateActiveIndices(): void {
    let time = this.currentSongTime;
    if (this.loopActive && !this.pendingDeactivateLoop) {
      time = Math.min(time, this.loopEndBeat - 0.02);
    }
    
    let low = 0;
    let high = this.chronologicalSongs.length - 1;
    let activeEntry: { song: Song; displayIndex: number } | null = null;
    while (low <= high) {
      const middle = Math.floor((low + high) / 2);
      const candidate = this.chronologicalSongs[middle]!;
      if (candidate.song.time <= time) {
        activeEntry = candidate;
        low = middle + 1;
      } else {
        high = middle - 1;
      }
    }
    const activeSong = activeEntry?.song ?? null;
    this.activeSongIndex = activeEntry?.displayIndex ?? -1;

    let newSectionIndex = -1;
    if (activeSong) {
      for (let j = activeSong.sections.length - 1; j >= 0; j--) {
        const sec = activeSong.sections[j]!;
        if (time >= sec.time) {
          newSectionIndex = j;
          break;
        }
      }
    }

    // Reset fired automations when the active section changes
    if (this.activeSongIndex !== this.lastSongIndex || newSectionIndex !== this.lastSectionIndex) {
      this.firedAutomations.clear();
      this.lastSongIndex = this.activeSongIndex;
      this.lastSectionIndex = newSectionIndex;
    }

    this.activeSectionIndex = newSectionIndex;
  }

  /**
   * Check if any automations should fire based on the current playhead position.
   * Returns an array of actions to execute. Each action fires only once per section entry.
   */
  public checkAutomations(): AutomationAction[] {
    const actions: AutomationAction[] = [];

    if (this.pendingDeactivateLoop) {
      this.pendingDeactivateLoop = false;
      this.clearLoop();
      actions.push({ type: 'deactivate_loop' });
    }

    if (!this.isPlaying) return actions;

    const song = this.songs[this.activeSongIndex];
    if (!song) return actions;

    // Determine which tags to check — section-level if available, otherwise song-level
    const section = song.sections[this.activeSectionIndex];
    const target = section || song;
    const key = section
      ? `${this.activeSongIndex}:${this.activeSectionIndex}`
      : `song:${this.activeSongIndex}`;

    // Auto-stop: fire when we enter a region with [stop]
    if (target.autoStop && !this.firedAutomations.has(`stop:${key}`)) {
      this.firedAutomations.add(`stop:${key}`);
      actions.push({ type: 'stop' });
    }

    // Auto-next: fire when we enter a region with [next]
    if (target.autoNext && !this.firedAutomations.has(`next:${key}`)) {
      this.firedAutomations.add(`next:${key}`);
      // Find the next song in the setlist (custom order)
      const nextIdx = this.activeSongIndex + 1;
      if (nextIdx < this.songs.length) {
        actions.push({ type: 'next', nextSongIndex: nextIdx });
      } else {
        // No next song, just stop
        actions.push({ type: 'stop' });
      }
    }

    // Auto-loop: activate loop when entering a region with [loop]
    if (target.loopCount !== null && !this.loopActive && !this.firedAutomations.has(`loop:${key}`)) {
      this.firedAutomations.add(`loop:${key}`);
      if (section) {
        const region = this.getLoopRegion(this.activeSongIndex, this.activeSectionIndex);
        if (region) {
          this.loopActive = true;
          this.loopCount = target.loopCount;
          this.currentLoopIteration = 1;
          this.loopStartBeat = region.start;
          this.loopEndBeat = region.end;
          actions.push({ type: 'activate_loop', start: region.start, duration: region.duration });
        }
      } else {
        // Song-level loop — loop the entire song region
        const region = this.getSongRegion(this.activeSongIndex);
        if (region) {
          this.loopActive = true;
          this.loopCount = target.loopCount;
          this.currentLoopIteration = 1;
          this.loopStartBeat = region.start;
          this.loopEndBeat = region.end;
          actions.push({ type: 'activate_loop', start: region.start, duration: region.duration });
        }
      }
    }

    // Auto-bpm: change Ableton tempo when entering a region with [bpm N]
    if (target.bpm !== null && !this.firedAutomations.has(`bpm:${key}`)) {
      this.firedAutomations.add(`bpm:${key}`);
      actions.push({ type: 'change_bpm', bpm: target.bpm });
    }

    // Auto-click: change metronome state when entering a region with [click] or [click off]
    if (target.autoClick !== null && !this.firedAutomations.has(`click:${key}`)) {
      this.firedAutomations.add(`click:${key}`);
      actions.push({ type: 'change_metronome', value: target.autoClick });
    }

    // Auto-skip: skip the current song or section if [skip] is active
    if (target.skip && !this.firedAutomations.has(`skip:${key}`)) {
      this.firedAutomations.add(`skip:${key}`);
      const nextCue = this.getNextCueName(this.activeSongIndex, this.activeSectionIndex);
      if (nextCue) {
        actions.push({ type: 'skip', targetCue: nextCue });
      }
    }

    return actions;
  }

  public getNextCueName(songIndex: number, sectionIndex: number): string | null {
    const currentSong = this.songs[songIndex];
    if (!currentSong) return null;

    if (sectionIndex !== -1 && sectionIndex < currentSong.sections.length - 1) {
      // Next section in same song
      const nextSec = currentSong.sections[sectionIndex + 1];
      if (nextSec) {
        const matchingCue = this.rawCues.find(c => c.time === nextSec.time);
        return matchingCue ? matchingCue.name : null;
      }
    } else {
      // Next song
      const nextSongIdx = songIndex + 1;
      if (nextSongIdx < this.songs.length) {
        const nextSong = this.songs[nextSongIdx];
        if (nextSong) {
          const matchingCue = this.rawCues.find(c => c.time === nextSong.time);
          return matchingCue ? matchingCue.name : null;
        }
      }
    }
    return null;
  }

  /** Call when user manually jumps to a section (disables active loop) */
  public clearLoop(): void {
    this.loopActive = false;
    this.loopCount = null;
    this.currentLoopIteration = 0;
    this.loopStartBeat = 0;
    this.loopEndBeat = 0;
    this.pendingDeactivateLoop = false;
    this.stateVersion++;
  }

  public resetFiredAutomations(): void {
    this.firedAutomations.clear();
    this.lastSongIndex = -1;
    this.lastSectionIndex = -1;
  }

  public isLoopActive(): boolean {
    return this.loopActive;
  }

  public getState(): SetlistState {
    const activeSong = this.songs[this.activeSongIndex];
    const activeSection = activeSong?.sections[this.activeSectionIndex];
    const derived = this.getDerivedSongs();

    const state: any = {
      protocolVersion: 2,
      setlistVersion: this.setlistVersion,
      songs: derived.songs,
      hidden: this.hidden,
      activeSongIndex: this.activeSongIndex,
      activeSectionIndex: this.activeSectionIndex,
      isPlaying: this.isPlaying,
      tempo: this.tempo,
      currentSongTime: this.currentSongTime,
      metronome: this.metronome,
      signatureNumerator: this.signatureNumerator,
      signatureDenominator: this.signatureDenominator,
      loopIteration: this.loopActive && this.loopCount !== null && this.loopCount > 0
        ? { current: this.currentLoopIteration, total: this.loopCount }
        : null,
      loopActive: this.loopActive,
      loopCount: this.loopCount,
      currentLoopIteration: this.currentLoopIteration,
      clipTriggerQuantization: this.clipTriggerQuantization,
      totalDurationSeconds: derived.totalDurationSeconds,
      arrangementEndTime: this.arrangementEndTime,

      stateVersion: this.stateVersion,
      connection: {
        ableton: this.abletonConnection,
        osc: this.oscConnection,
      },
      transport: {
        isPlaying: this.isPlaying,
        position: this.currentSongTime,
        tempo: this.tempo,
      },
      pendingCommands: [...this.pendingCommands],
      mode: this.mode,
      safety: {
        panicActive: this.panicActive,
        criticalCommandsLocked: this.criticalCommandsLocked,
      },
    };

    if (activeSong) {
      state.currentSongId = `${activeSong.title}@${activeSong.time}`;
    }
    if (activeSection) {
      state.currentSectionId = `${activeSection.name}@${activeSection.time}`;
    }

    return state as SetlistState;
  }

  public setConnectionStatus(type: 'ableton' | 'osc', status: 'disconnected' | 'connecting' | 'synced' | 'degraded'): void {
    let changed = false;
    if (type === 'ableton' && this.abletonConnection !== status) {
      this.abletonConnection = status;
      changed = true;
    } else if (type === 'osc' && this.oscConnection !== status) {
      this.oscConnection = status;
      changed = true;
    }
    if (changed) {
      this.stateVersion++;
    }
  }

  public setMode(mode: 'rehearsal' | 'show'): void {
    if (this.mode !== mode) {
      this.mode = mode;
      this.stateVersion++;
    }
  }

  public setPanic(active: boolean): void {
    if (this.panicActive !== active) {
      this.panicActive = active;
      this.stateVersion++;
    }
  }

  public setCriticalCommandsLocked(locked: boolean): void {
    if (this.criticalCommandsLocked !== locked) {
      this.criticalCommandsLocked = locked;
      this.stateVersion++;
    }
  }

  public setPendingCommands(commands: string[]): void {
    this.pendingCommands = [...commands];
    this.stateVersion++;
  }

  public updateQuantization(val: number): void {
    this.clipTriggerQuantization = val;
    this.stateVersion++;
  }

  public updateArrangementEndTime(value: number | null): void {
    const normalized = typeof value === 'number' && Number.isFinite(value) ? value : null;
    if (normalized !== this.arrangementEndTime) {
      this.arrangementEndTime = normalized;
      this.invalidateDerivedSongs();
      this.stateVersion++;
    }
  }

  public getRawCues(): { name: string; time: number; cueIndex?: number }[] {
    return this.rawCues;
  }

  public getCustomOrder(): string[] {
    return this.customOrder;
  }

  public setCustomOrder(order: string[]): void {
    this.customOrder = Array.isArray(order) && order.every((title) => typeof title === 'string')
      ? [...order]
      : [];
    this.sortSongs();
    this.updateActiveIndices();
    this.stateVersion++;
  }

  public getActiveSection(): Section | null {
    if (this.activeSongIndex >= 0 && this.activeSectionIndex >= 0) {
      return this.songs[this.activeSongIndex]!.sections[this.activeSectionIndex] || null;
    }
    return null;
  }

  private getRegionFromStart(start: number): { start: number; end: number; duration: number } {
    // Find the cue with time == start. If multiple cues collide at the
    // same beat, pick the most specific one (a section beats a song at the
    // same beat — sections live in rawCues after their parent song).
    const matchingCues = this.rawCues
      .map((c, idx) => ({ c, idx }))
      .filter(({ c }) => c.time === start);
    if (matchingCues.length > 0) {
      const cueIdx = matchingCues[matchingCues.length - 1]!.idx;
      if (cueIdx >= 0 && cueIdx < this.rawCues.length - 1) {
        const end = this.rawCues[cueIdx + 1]!.time;
        return { start, end, duration: end - start };
      }
    }

    const end = start + 4;
    return { start, end, duration: 4 };
  }

  public getLoopRegion(songIndex: number, sectionIndex: number): { start: number; end: number; duration: number } | null {
    const song = this.songs[songIndex];
    if (!song) return null;
    
    const section = song.sections[sectionIndex];
    if (!section) return null;

    return this.getRegionFromStart(section.time);
  }

  public getSongRegion(songIndex: number): { start: number; end: number; duration: number } | null {
    const song = this.songs[songIndex];
    if (!song) return null;

    return this.getRegionFromStart(song.time);
  }
}
