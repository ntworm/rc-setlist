import { Section, Song, Setlist } from '../types.js';

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
} {
  let loopCount: number | null = null;
  let autoStop = false;
  let autoNext = false;
  let bpm: number | null = null;
  let autoClick: boolean | null = null;
  let skip = false;
  let hidden = false;

  // Match all [...] blocks
  const tagPattern = /\[([^\]]+)\]/g;
  let match: RegExpExecArray | null;

  while ((match = tagPattern.exec(raw)) !== null) {
    const tag = match[1]!.trim().toLowerCase();

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
    }
  }

  // Remove all [...] blocks from display name
  const displayName = raw.replace(/\s*\[[^\]]+\]/g, '').trim();

  return { displayName, loopCount, autoStop, autoNext, bpm, autoClick, skip, hidden };
}

export function parseLocator(name: string): {
  kind: 'song' | 'section' | 'hidden';
  songName?: string;
  songTags?: { loopCount: number | null; autoStop: boolean; autoNext: boolean; bpm: number | null; autoClick: boolean | null; skip: boolean };
  section?: Section;
  hiddenName?: string;
} {
  const trimmed = name.trim();
  
  // Quick precheck for '_'-prefixed hidden name
  if (trimmed.startsWith('_')) {
    return { kind: 'hidden', hiddenName: trimmed };
  }

  const { displayName, hidden } = extractTags(trimmed);
  
  if (hidden) {
    return { kind: 'hidden', hiddenName: displayName };
  }
  
  const parts = trimmed.split('>').map(p => p.trim());
  if (parts.length === 0 || !parts[0]) {
    return { kind: 'hidden', hiddenName: '_empty' };
  }
  
  if (parts.length === 1) {
    const songInfo = extractTags(parts[0]);
    if (songInfo.hidden) {
      return { kind: 'hidden', hiddenName: songInfo.displayName };
    }
    return {
      kind: 'song',
      songName: songInfo.displayName,
      songTags: {
        loopCount: songInfo.loopCount,
        autoStop: songInfo.autoStop,
        autoNext: songInfo.autoNext,
        bpm: songInfo.bpm,
        autoClick: songInfo.autoClick,
        skip: songInfo.skip
      }
    };
  }
  
  const songName = parts[0];
  const cleanedSongName = extractTags(songName).displayName;
  
  const sectionPart = parts[parts.length - 1]!;
  const sectionInfo = extractTags(sectionPart);
  
  if (sectionInfo.hidden) {
    return { kind: 'hidden', hiddenName: sectionInfo.displayName };
  }
  
  return {
    kind: 'section',
    songName: cleanedSongName,
    section: {
      name: sectionInfo.displayName,
      time: 0,
      loopCount: sectionInfo.loopCount,
      autoStop: sectionInfo.autoStop,
      autoNext: sectionInfo.autoNext,
      bpm: sectionInfo.bpm,
      autoClick: sectionInfo.autoClick,
      skip: sectionInfo.skip
    }
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
        time: cue.time,
        sections: [],
        loopCount: parsed.songTags?.loopCount ?? null,
        autoStop: parsed.songTags?.autoStop ?? false,
        autoNext: parsed.songTags?.autoNext ?? false,
        bpm: parsed.songTags?.bpm ?? null,
        autoClick: parsed.songTags?.autoClick ?? null,
        skip: parsed.songTags?.skip ?? false
      };
      songs.push(currentSong);
      continue;
    }
    
    if (parsed.kind === 'section') {
      if (!currentSong || currentSong.title !== parsed.songName) {
        currentSong = {
          title: parsed.songName!,
          time: cue.time,
          sections: [],
          loopCount: null,
          autoStop: false,
          autoNext: false,
          bpm: null,
          autoClick: null,
          skip: false
        };
        songs.push(currentSong);
      }
      
      currentSong.sections.push({
        name: parsed.section!.name,
        time: cue.time,
        loopCount: parsed.section!.loopCount,
        autoStop: parsed.section!.autoStop,
        autoNext: parsed.section!.autoNext,
        bpm: parsed.section!.bpm,
        autoClick: parsed.section!.autoClick,
        skip: parsed.section!.skip
      });
    }
  }
  
  return { songs, hidden };
}
