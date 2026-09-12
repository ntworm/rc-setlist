import { Section, Song, SetlistState } from '../types.js';
import { computeCuesFingerprint, parseSetlist } from './locator-parser.js';
import { calculateSetlistMetrics } from './setlist-metrics.js';

/**
 * `next` and `skip` carry the beat the playhead must be moved to. Both hand
 * playback over the moment their marker is crossed, and the executor relocates
 * the playhead there directly rather than asking Live for a cue jump, because
 * Live launch-quantizes cue jumps: the jump would land on the bar line after
 * the marker, one full quantization period late. See executor.ts.
 */
export type AutomationAction =
  | { type: 'stop' }
  | { type: 'next'; nextSongIndex: number; targetTime: number }
  | { type: 'activate_loop'; start: number; duration: number }
  | { type: 'deactivate_loop' }
  | { type: 'change_bpm'; bpm: number }
  | { type: 'change_metronome'; value: boolean }
  | { type: 'skip'; targetCue: string; targetTime: number };

export class SetlistManager {
  private songs: Song[] = [];
  private hidden: { name: string; time: number }[] = [];
  private activeSongIndex: number = -1;
  private activeSectionIndex: number = -1;
  private isPlaying: boolean = false;
  private tempo: number = 120;
  private hasObservedTempo: boolean = false;
  /**
   * Sticky evidence that something other than this setlist moves the tempo.
   *
   * The Live Object Model does not expose the tempo envelope, so the only
   * signal available is divergence: the tempo Live reports while sitting on a
   * tagged song is not the tempo that tag declares. One observation is enough
   * and it is never cleared, because the cost of a false negative is a show
   * whose tempo automation got flattened by a jump, and the cost of a false
   * positive is only that a jump stops setting the tempo.
   */
  private tempoAutomationSuspected: boolean = false;
  // Tempo used to convert arrangement beats into seconds. Declared [bpm] tags
  // always win. This is only the floor for a set that declares nothing, and it
  // settles at most once — see adoptInitialTempoForDuration.
  private durationFallbackBpm: number = 120;
  private durationFallbackIsProvisional: boolean = true;
  private currentSongTime: number = 0;
  /**
   * Where the transport came to rest, or null while it plays. Live's
   * `continue_playing` resumes from exactly this beat, whatever was done to the
   * playhead since; see shouldContinuePlayback.
   */
  private restingAt: number | null = null;
  /** Forward movement a stop may still show while the last samples settle. */
  private static readonly REST_SETTLE_BEATS = 2;
  private rawCues: { name: string; time: number; cueIndex?: number }[] = [];
  private appliedCuesFingerprint: string | null = null;
  private metronome: boolean = false;
  private preRollEnabled: boolean = false;
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
    /*
     * The same fingerprint the callers use, quantized to 1/100 of a beat.
     *
     * Cues arrive from two places at two rates — the SDK every 100ms and
     * AbletonOSC every two seconds — and they do not agree to the last decimal.
     * Comparing exact floats here meant each source looked like a change to the
     * other, so the setlist was reparsed and its version bumped on every OSC
     * poll, and the whole song list was rebuilt from scratch twice a second's
     * worth of beats apart. On screen that is the page flickering.
     *
     * A difference below 1/100 of a beat cannot change how a locator parses.
     */
    const fingerprint = computeCuesFingerprint(sortedCues);
    if (fingerprint === this.appliedCuesFingerprint) return;

    this.appliedCuesFingerprint = fingerprint;
    this.rawCues = sortedCues;
    const parsed = parseSetlist(this.rawCues);
    this.songs = parsed.songs;
    this.hidden = parsed.hidden;

    // Recalculate the duration fallback BPM from the new song list.
    // This is the first declared BPM in chronological order, or the current
    // live tempo if no song has a [bpm] tag — it stays fixed for the entire
    // show so that changing tempo automations don't reshuffle durations.
    const resolved = this.computeDurationFallbackBpm();
    this.durationFallbackBpm = resolved.bpm;
    this.durationFallbackIsProvisional = resolved.provisional;
    this.sortSongs();
    this.firedAutomations.clear();
    this.clearLoop();
    this.updateActiveIndices();
    this.stateVersion++;
  }

  /** Tolerance in BPM: Live reports a float, a tag is typed by hand. */
  private static readonly TEMPO_DIVERGENCE_BPM = 0.51;

  private noteTempoDivergence(observed: number): void {
    if (this.tempoAutomationSuspected) return;
    if (!(Number.isFinite(observed) && observed > 0)) return;
    const declared = this.declaredTempoAtPlayhead();
    if (declared === null) return;
    if (Math.abs(observed - declared) > SetlistManager.TEMPO_DIVERGENCE_BPM) {
      this.tempoAutomationSuspected = true;
    }
  }

  /**
   * The tempo the setlist declares for wherever the playhead is sitting.
   *
   * Public because the count-in needs it: the count has to be heard at the
   * tempo of the bar the transport is about to play, and that is the last
   * `[bpm]` declared at or before the playhead, not Live's current tempo —
   * which, in a set with arrangement automation, is whatever the previous song
   * left behind.
   */
  public declaredTempoAtPlayhead(): number | null {
    const usable = (v: unknown): number | null =>
      typeof v === 'number' && Number.isFinite(v) && v > 0 ? v : null;
    let declared: number | null = null;
    let bestTime = -Infinity;
    for (const song of this.songs) {
      if (!Number.isFinite(song.time) || song.time > this.currentSongTime) continue;
      const songBpm = usable(song.bpm);
      if (songBpm !== null && song.time >= bestTime) {
        declared = songBpm;
        bestTime = song.time;
      }
      for (const section of song.sections) {
        const sectionBpm = usable(section.bpm);
        if (sectionBpm !== null && Number.isFinite(section.time)
          && section.time <= this.currentSongTime && section.time >= bestTime) {
          declared = sectionBpm;
          bestTime = section.time;
        }
      }
    }
    return declared;
  }

  /**
   * True when the arrangement appears to own its own tempo. Consumers must not
   * write Live's tempo while this holds — doing so overrides the automation and
   * the arrangement stops following its envelope until the user presses
   * Re-Enable Automation in Live.
   */
  public isTempoAutomationSuspected(): boolean {
    return this.tempoAutomationSuspected;
  }

  private computeDurationFallbackBpm(): { bpm: number; provisional: boolean } {
    // A declared [bpm] tag is authoritative and never provisional: the set's
    // duration is then a pure function of the arrangement and the user's tags.
    const chronological = [...this.songs].sort((a, b) => a.time - b.time);
    for (const song of chronological) {
      if (typeof song.bpm === 'number' && Number.isFinite(song.bpm) && song.bpm > 0) {
        return { bpm: song.bpm, provisional: false };
      }
      for (const section of song.sections) {
        if (typeof section.bpm === 'number' && Number.isFinite(section.bpm) && section.bpm > 0) {
          return { bpm: section.bpm, provisional: false };
        }
      }
    }
    // Nothing declared anywhere. Take the tempo Live reports, once, and freeze.
    // A tempo Live has not reported yet is not an observation: 120 is merely
    // this class's default, and adopting it would silently lock the wrong number.
    return this.hasObservedTempo && this.tempo > 0
      ? { bpm: this.tempo, provisional: false }
      : { bpm: 120, provisional: true };
  }

  // Called on the first transport message when the set declares no tempo at all
  // and cues loaded before Live reported one. It settles the number a single
  // time; every later tempo change is ignored, so the set total never moves
  // again during the show.
  private adoptInitialTempoForDuration(observed: number): void {
    if (!this.durationFallbackIsProvisional) return;
    if (!(typeof observed === 'number' && Number.isFinite(observed) && observed > 0)) return;
    this.durationFallbackIsProvisional = false;
    if (observed === this.durationFallbackBpm) return;
    this.durationFallbackBpm = observed;
    this.derivedSongs = null;
    this.derivedTotalDurationSeconds = null;
    this.setlistVersion++;
  }

  private computeDurationConfidence(): 'declared' | 'estimated' {
    for (const song of this.songs) {
      if (typeof song.bpm === 'number' && Number.isFinite(song.bpm) && song.bpm > 0) {
        return 'declared';
      }
      for (const section of song.sections) {
        if (typeof section.bpm === 'number' && Number.isFinite(section.bpm) && section.bpm > 0) {
          return 'declared';
        }
      }
    }
    return 'estimated';
  }

  private sortSongs(): void {
    const chronological = [...this.songs].sort((a, b) => a.time - b.time);
    if (this.customOrder.length === 0) {
      this.songs = chronological;
      this.rebuildChronologicalIndex();
      this.invalidateDerivedSongs();
      return;
    }

    const ranksByTitle = new Map<string, number[]>();
    for (let rank = 0; rank < this.customOrder.length; rank++) {
      const title = this.customOrder[rank]!;
      const ranks = ranksByTitle.get(title) ?? [];
      ranks.push(rank);
      ranksByTitle.set(title, ranks);
    }

    const nextOccurrenceByTitle = new Map<string, number>();
    const rankedSongs: Array<{ song: Song; rank: number }> = [];
    for (const song of chronological) {
      const ranks = ranksByTitle.get(song.title);
      const occurrence = nextOccurrenceByTitle.get(song.title) ?? 0;
      const rank = ranks?.[occurrence];
      if (rank !== undefined) {
        rankedSongs.push({ song, rank });
        nextOccurrenceByTitle.set(song.title, occurrence + 1);
      }
    }
    rankedSongs.sort((a, b) => a.rank - b.rank || a.song.time - b.song.time);

    const orderedSongs = rankedSongs.map(({ song }) => song);
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
    const displayIndexBySong = new Map(this.songs.map((song, index) => [song, index]));
    this.chronologicalSongs = [...this.songs]
      .sort((a, b) => a.time - b.time)
      .map((song) => ({ song, displayIndex: displayIndexBySong.get(song)! }));
  }

  private invalidateDerivedSongs(): void {
    this.derivedSongs = null;
    this.derivedTotalDurationSeconds = null;
    this.setlistVersion++;
  }

  private getDerivedSongs(): { songs: Song[]; totalDurationSeconds: number | null } {
    if (!this.derivedSongs) {
      const metrics = calculateSetlistMetrics(this.songs, this.arrangementEndTime, this.durationFallbackBpm);
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

  /**
   * A tempo report on its own. Tempo arrives from the SDK every 100ms and from
   * AbletonOSC's listener without a position, and it must not pass through
   * updateTransport: that would present the current position and playing
   * state as a fresh observation — before Live's position has ever been seen,
   * a resting beat of zero.
   */
  public updateTempo(tempo: number): void {
    this.hasObservedTempo = true;
    this.noteTempoDivergence(tempo);
    // Settle on the FIRST tempo Live reports, even when it happens to equal
    // this class's default. Waiting for a *change* would settle on the second
    // tempo instead, which is the very coupling this removes.
    this.adoptInitialTempoForDuration(tempo);
    if (tempo !== this.tempo) {
      this.tempo = tempo;
      // NOTE: we deliberately do NOT invalidate derived songs here.
      // Song durations use `durationFallbackBpm` which is frozen at cue-load
      // time, so live BPM automation does not reshuffle the show clock.
    }
    this.stateVersion++;
  }

  /** A position and playing-state observation, with the tempo seen alongside it. */
  public updateTransport(time: number, isPlaying: boolean, tempo?: number): void {
    const prevTime = this.currentSongTime;
    this.trackRestingPosition(time, isPlaying);
    this.currentSongTime = time;
    this.isPlaying = isPlaying;
    if (tempo !== undefined) this.updateTempo(tempo);

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

    // Durations are deliberately NOT touched here. Capturing the live transport
    // tempo for an untagged song made every duration — and therefore the set
    // total — depend on the tempo the song happened to be played at. Untagged
    // songs inherit the last declared [bpm] in chronological order instead, so
    // the set total is a planning number that never moves during a show.

    this.stateVersion++;
  }

  /**
   * Live keeps the beat the transport last stopped at, and `continue_playing`
   * resumes from it no matter where the playhead was put afterwards: a cue jump
   * or an Arrangement click while stopped moves the playhead and the start
   * marker, not that resting beat. So the resting beat is remembered here from
   * the moment the transport stops (or from the first stopped sample, when the
   * transport was never seen running), and any later movement of the stopped
   * playhead is a relocation.
   *
   * A stop is reported with the last position sample, up to a poll behind
   * where Live actually came to rest, so a short forward drift right after
   * stopping follows the resting beat instead of counting as a relocation.
   * Relocating forward by less than that while stopped is therefore read as
   * drift too: Play then resumes from the resting beat, at most two beats
   * behind the playhead. Backward movement is always a relocation.
   */
  private trackRestingPosition(time: number, isPlaying: boolean): void {
    if (isPlaying) {
      this.restingAt = null;
      return;
    }
    if (this.isPlaying || this.restingAt === null) {
      this.restingAt = time;
      return;
    }
    const drift = time - this.restingAt;
    if (drift >= 0 && drift <= SetlistManager.REST_SETTLE_BEATS) {
      this.restingAt = time;
    }
  }

  /**
   * True when Play should resume where the transport stopped
   * (`continue_playing`); false when the playhead was relocated while stopped
   * and Play must start from the start marker (`start_playing`). A running
   * transport always continues: `start_playing` would restart it.
   */
  public shouldContinuePlayback(): boolean {
    if (this.isPlaying) return true;
    if (this.restingAt === null) return true;
    return Math.abs(this.currentSongTime - this.restingAt) < 0.01;
  }

  public updateMetronome(metronome: boolean): void {
    this.metronome = metronome;
    this.stateVersion++;
  }

  public setPreRollEnabled(value: boolean): void {
    if (this.preRollEnabled === value) return;
    this.preRollEnabled = value;
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

    /*
     * Crossing into a new section makes that section's tags fresh again. It
     * must not make the song's tags fresh: a song-level [next] fires once when
     * the song is entered, not once per section boundary inside it. Only a new
     * song clears everything.
     *
     * Song keys are `<tag>:song:<index>`; section keys are `<tag>:<song>:<section>`.
     */
    if (this.activeSongIndex !== this.lastSongIndex) {
      this.firedAutomations.clear();
      this.lastSongIndex = this.activeSongIndex;
      this.lastSectionIndex = newSectionIndex;
    } else if (newSectionIndex !== this.lastSectionIndex) {
      for (const fired of [...this.firedAutomations]) {
        if (!fired.includes(':song:')) this.firedAutomations.delete(fired);
      }
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

    /*
     * A song's tags and its sections' tags are evaluated separately, and both.
     *
     * This used to pick one target — `section || song` — so once the playhead
     * was inside any section the song's own tags were never looked at again.
     * A song-level tag therefore only fired in the gap between the song's
     * locator and its first section, and when a section began on the song's own
     * beat, which is the ordinary case, it never fired at all. The marker
     * editor offers STOP, NEXT and SKIP on the song panel, so that silence was
     * a control the user could set and watch do nothing.
     *
     * The song is evaluated first so that a section declaring the same tag is
     * applied after it and wins, which is what "more specific" should mean.
     */
    const section = song.sections[this.activeSectionIndex];
    this.collectAutomations(actions, song, `song:${this.activeSongIndex}`, null);
    if (section) {
      this.collectAutomations(
        actions,
        section,
        `${this.activeSongIndex}:${this.activeSectionIndex}`,
        this.activeSectionIndex,
      );
    }

    return actions;
  }

  /**
   * Fire the tags on one marker, once per entry.
   *
   * `sectionIndex` is the section this marker is, or null when the marker is
   * the song itself. It decides what "the next thing" means: a section skips to
   * the section after it, a song skips to the song after it.
   */
  private collectAutomations(
    actions: AutomationAction[],
    target: Song | Section,
    key: string,
    sectionIndex: number | null,
  ): void {
    const isSection = sectionIndex !== null;

    if (target.autoStop && !this.firedAutomations.has(`stop:${key}`)) {
      this.firedAutomations.add(`stop:${key}`);
      actions.push({ type: 'stop' });
    }

    if (target.autoNext && !this.firedAutomations.has(`next:${key}`)) {
      this.firedAutomations.add(`next:${key}`);
      const nextIdx = this.activeSongIndex + 1;
      const nextSong = this.songs[nextIdx];
      if (nextSong) {
        // Always the song's first beat. The marker is seen a fraction of a beat
        // after it was crossed, and that overshoot must not be carried into the
        // next song: its intro starts from the top.
        actions.push({ type: 'next', nextSongIndex: nextIdx, targetTime: nextSong.time });
      } else {
        actions.push({ type: 'stop' });
      }
    }

    if (target.loopCount !== null && !this.loopActive && !this.firedAutomations.has(`loop:${key}`)) {
      this.firedAutomations.add(`loop:${key}`);
      const region = isSection
        ? this.getLoopRegion(this.activeSongIndex, sectionIndex!)
        : this.getSongRegion(this.activeSongIndex);
      if (region) {
        this.loopActive = true;
        this.loopCount = target.loopCount;
        this.currentLoopIteration = 1;
        this.loopStartBeat = region.start;
        this.loopEndBeat = region.end;
        actions.push({ type: 'activate_loop', start: region.start, duration: region.duration });
      }
    }

    if (target.bpm !== null && !this.firedAutomations.has(`bpm:${key}`)) {
      this.firedAutomations.add(`bpm:${key}`);
      actions.push({ type: 'change_bpm', bpm: target.bpm });
    }

    if (target.autoClick !== null && !this.firedAutomations.has(`click:${key}`)) {
      this.firedAutomations.add(`click:${key}`);
      actions.push({ type: 'change_metronome', value: target.autoClick });
    }

    if (target.skip && !this.firedAutomations.has(`skip:${key}`)) {
      this.firedAutomations.add(`skip:${key}`);
      // A song-level skip leaves the song, so it asks for the next song rather
      // than the next section of the song it is skipping.
      const nextCue = this.getNextCue(this.activeSongIndex, isSection ? sectionIndex! : -1);
      if (nextCue) {
        actions.push({ type: 'skip', targetCue: nextCue.name, targetTime: nextCue.time });
      }
    }
  }

  /**
   * The cue a [skip] hands over to: the section after the given one, or the
   * song after the given song when the skip is song-level or on a last section.
   */
  public getNextCue(songIndex: number, sectionIndex: number): { name: string; time: number } | null {
    const currentSong = this.songs[songIndex];
    if (!currentSong) return null;

    let targetTime: number | null = null;
    if (sectionIndex !== -1 && sectionIndex < currentSong.sections.length - 1) {
      targetTime = currentSong.sections[sectionIndex + 1]?.time ?? null;
    } else {
      targetTime = this.songs[songIndex + 1]?.time ?? null;
    }
    if (targetTime === null) return null;
    const matchingCue = this.rawCues.find(c => c.time === targetTime);
    return matchingCue ? { name: matchingCue.name, time: matchingCue.time } : null;
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
      protocolVersion: 3,
      setlistVersion: this.setlistVersion,
      songs: derived.songs,
      hidden: this.hidden,
      activeSongIndex: this.activeSongIndex,
      activeSectionIndex: this.activeSectionIndex,
      isPlaying: this.isPlaying,
      tempo: this.tempo,
      currentSongTime: this.currentSongTime,
      metronome: this.metronome,
      preRollEnabled: this.preRollEnabled,
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
      // The tempo base every duration on screen was measured with. The clients
      // must use THIS to turn elapsed beats into elapsed seconds; using the live
      // transport tempo instead put the elapsed clock and the duration beside it
      // on different time bases, so at 180 bpm the clock never reached the end
      // and at 60 bpm it sat at "1:00 / 1:00" from halfway through.
      durationBpm: this.durationFallbackBpm,
      durationConfidence: this.computeDurationConfidence(),
      declaredTempo: this.declaredTempoAtPlayhead(),
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
