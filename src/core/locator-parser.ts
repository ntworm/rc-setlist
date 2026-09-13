import { Section, Song, Setlist } from '../types.js';

export { computeCuesFingerprint, type RawCue } from './cue-fingerprint.js';

/**
 * Extract all [tag] or [tag value] tokens from a string and return
 * the cleaned display name plus the parsed tags.
 */
export function extractTags(raw: string): {
  displayName: string;
  loopCount: number | null;
  autoStop: boolean;
  autoNext: boolean;
  bpm: number | null;
  autoClick: boolean | null;
  skip: boolean;
  hidden: boolean;
  ignore: boolean;
  jumpTarget: string | null;
} {
  let loopCount: number | null = null;
  let autoStop = false;
  let autoNext = false;
  let bpm: number | null = null;
  let autoClick: boolean | null = null;
  let skip = false;
  let hidden = false;
  let ignore = false;
  let jumpTarget: string | null = null;

  // Match all [...] blocks
  const tagPattern = /\[([^\]]+)\]/g;
  let match: RegExpExecArray | null;

  while ((match = tagPattern.exec(raw)) !== null) {
    const tag = match[1]!.trim().toLowerCase();

    // The keyword is case-insensitive like every tag; the target is a marker
    // name and keeps its spelling. Matching against it is case-insensitive
    // too (see SetlistManager.resolveJumpTarget), so the spelling only matters
    // for what the badge shows.
    const jump = /^jump\s+(.+)$/i.exec(match[1]!.trim());
    if (jump) {
      jumpTarget = jump[1]!.trim();
      continue;
    }

    if (tag === 'loop') {
      loopCount = -1; // -1 = infinite loop (Infinity breaks JSON serialization)
    } else if (/^loop\s+(\d+)x?$/.test(tag)) {
      const m = tag.match(/^loop\s+(\d+)x?$/);
      loopCount = parseInt(m![1]!, 10);
    } else if (tag === 'stop') {
      autoStop = true;
    } else if (tag === 'next') {
      autoNext = true;
    } else if (/^bpm\s+(\d+(?:\.\d+)?)$/.test(tag)) {
      const m = tag.match(/^bpm\s+(\d+(?:\.\d+)?)$/);
      bpm = parseFloat(m![1]!);
    } else if (tag === 'click') {
      autoClick = true;
    } else if (tag === 'click off' || tag === 'click-off') {
      autoClick = false;
    } else if (tag === 'skip') {
      skip = true;
    } else if (tag === 'hidden') {
      hidden = true;
    } else if (tag === 'ignore') {
      ignore = true;
    }
  }

  // Remove all [...] blocks from display name
  const displayName = raw.replace(/\s*\[[^\]]+\]/g, '').trim();

  return { displayName, loopCount, autoStop, autoNext, bpm, autoClick, skip, hidden, ignore, jumpTarget };
}

/** The optional `jumpTarget` key, present only when the tag was written. */
function jumpOf(info: { jumpTarget: string | null }): { jumpTarget?: string } {
  return info.jumpTarget ? { jumpTarget: info.jumpTarget } : {};
}

type TagInfo = ReturnType<typeof extractTags>;

/** Whether any tag on this marker does something when the playhead reaches it. */
function hasAnyAutomation(info: TagInfo): boolean {
  return info.loopCount !== null
    || info.autoStop
    || info.autoNext
    || info.bpm !== null
    || info.autoClick !== null
    || info.skip
    || info.jumpTarget !== null;
}

/** The tag fields a song or a section carries, in the shape both share. */
function tagFields(info: TagInfo): Pick<Section, 'loopCount' | 'autoStop' | 'autoNext' | 'bpm' | 'autoClick' | 'skip' | 'jumpTarget'> {
  return {
    loopCount: info.loopCount,
    autoStop: info.autoStop,
    autoNext: info.autoNext,
    bpm: info.bpm,
    autoClick: info.autoClick,
    skip: info.skip,
    ...jumpOf(info),
  };
}

/** A section from its parsed tags; `time` is filled in by parseSetlist. */
function sectionFromTags(info: TagInfo, automationOnly = false): Section {
  return {
    name: automationOnly ? '' : info.displayName,
    time: 0,
    ...tagFields(info),
    ...(automationOnly ? { automationOnly: true } : {}),
  };
}

/**
 * Split on `>` outside brackets. A `>` inside a tag ([jump B > Chorus]) is
 * part of that tag's value; a tag anywhere else — `Song A [bpm 120] > Chorus`
 * — does not stop the split, so the section still belongs to Song A.
 */
function splitOutsideTags(text: string): string[] {
  const parts: string[] = [];
  let depth = 0;
  let current = '';
  for (const char of text) {
    if (char === '[') depth++;
    else if (char === ']') depth = Math.max(0, depth - 1);
    if (char === '>' && depth === 0) {
      parts.push(current.trim());
      current = '';
      continue;
    }
    current += char;
  }
  parts.push(current.trim());
  return parts;
}

export const PLACEHOLDER_SONG_TITLE = '_Sem Música_';

export function parseLocator(name: string): {
  kind: 'song' | 'section' | 'automation' | 'hidden' | 'relative-section' | 'relative-automation';
  songName?: string;
  songTags?: { loopCount: number | null; autoStop: boolean; autoNext: boolean; bpm: number | null; autoClick: boolean | null; skip: boolean; jumpTarget?: string };
  section?: Section;
  hiddenName?: string;
} {
  const trimmed = name.trim();

  // Quick precheck for '_'-prefixed hidden name
  if (trimmed.startsWith('_')) {
    return { kind: 'hidden', hiddenName: trimmed };
  }

  // Relative section/automation syntax: starts with '>'
  if (trimmed.startsWith('>')) {
    const relativeContent = trimmed.slice(1).trim();
    if (relativeContent.startsWith('_')) {
      return { kind: 'hidden', hiddenName: relativeContent };
    }
    const info = extractTags(relativeContent);
    if (info.hidden || info.ignore) {
      return { kind: 'hidden', hiddenName: info.displayName };
    }
    if (!info.displayName) {
      if (!hasAnyAutomation(info)) {
        return { kind: 'hidden', hiddenName: '_empty' };
      }
      return { kind: 'relative-automation', section: sectionFromTags(info, true) };
    }
    return { kind: 'relative-section', section: sectionFromTags(info) };
  }

  const info = extractTags(trimmed);
  if (info.hidden || info.ignore) {
    return { kind: 'hidden', hiddenName: info.displayName };
  }

  const parts = splitOutsideTags(trimmed);
  if (parts.length === 1) {
    if (!trimmed) {
      return { kind: 'hidden', hiddenName: '_empty' };
    }
    if (!info.displayName) {
      if (!hasAnyAutomation(info)) {
        return { kind: 'hidden', hiddenName: trimmed };
      }
      return { kind: 'automation', section: sectionFromTags(info, true) };
    }
    return { kind: 'song', songName: info.displayName, songTags: tagFields(info) };
  }

  // `Song > Section`: the song half only names the song (tags written there
  // belong to no marker); the last part is the section with its tags.
  const cleanedSongName = extractTags(parts[0]!).displayName;
  const sectionInfo = extractTags(parts[parts.length - 1]!);
  if (sectionInfo.hidden || sectionInfo.ignore) {
    return { kind: 'hidden', hiddenName: sectionInfo.displayName };
  }
  return { kind: 'section', songName: cleanedSongName, section: sectionFromTags(sectionInfo) };
}

/** The song a section or automation marker belongs to when none was declared. */
function placeholderSong(time: number): Song {
  return {
    title: PLACEHOLDER_SONG_TITLE,
    time,
    sections: [],
    loopCount: null,
    autoStop: false,
    autoNext: false,
    bpm: null,
    autoClick: null,
    skip: false,
  };
}

export function parseSetlist(cues: { name: string; time: number }[]): Setlist {
  const songs: Song[] = [];
  const hidden: { name: string; time: number }[] = [];

  const sortedCues = [...cues].sort((a, b) => a.time - b.time);
  let currentSong: Song | null = null;

  for (const cue of sortedCues) {
    const parsed = parseLocator(cue.name);

    if (parsed.kind === 'hidden') {
      hidden.push({ name: parsed.hiddenName!, time: cue.time });
      continue;
    }

    if (parsed.kind === 'song') {
      currentSong = {
        title: parsed.songName!,
        rawName: cue.name,
        time: cue.time,
        sections: [],
        ...parsed.songTags!,
      };
      songs.push(currentSong);
      continue;
    }

    if (parsed.kind === 'section') {
      if (!currentSong || currentSong.title !== parsed.songName) {
        currentSong = { ...placeholderSong(cue.time), title: parsed.songName!, bpm: parsed.section?.bpm ?? null };
        songs.push(currentSong);
      } else if (
        currentSong.bpm === null
        && typeof parsed.section?.bpm === 'number'
        && cue.time === currentSong.time
      ) {
        // Only a section that starts exactly where the song starts may stand in
        // for a missing song tag. Promoting a tag from a chorus in the middle
        // applied that tempo backwards over the intro, inflating the song's
        // duration and mislabelling its BPM badge. A later section tag is a
        // tempo EVENT at its own position; the metrics timeline handles it.
        currentSong.bpm = parsed.section.bpm;
      }
    } else if (!currentSong) {
      // relative-section, relative-automation, automation: a section before
      // any song gets a placeholder song to hang from.
      currentSong = placeholderSong(cue.time);
      songs.push(currentSong);
    }

    currentSong.sections.push({
      ...parsed.section!,
      rawName: cue.name,
      time: cue.time,
    });
  }

  return { songs, hidden };
}
