export interface LyricLine {
  time: number; // in seconds
  text: string;
}

export function parseLrc(content: string): LyricLine[] {
  const lines = content.split(/\r?\n/);
  const result: LyricLine[] = [];

  for (const line of lines) {
    const trimmed = line.trim();
    const match = trimmed.match(/^\[(\d+):(\d+)(?:[.:](\d+))?\](.*)$/);
    if (match) {
      const minutes = parseInt(match[1]!, 10);
      const seconds = parseInt(match[2]!, 10);
      const centiseconds = match[3] ? parseInt(match[3]!, 10) : 0;
      
      let frac = 0;
      if (match[3]) {
        const len = match[3].length;
        frac = centiseconds / Math.pow(10, len);
      }
      
      const timeInSecs = minutes * 60 + seconds + frac;
      const text = match[4] ? match[4].trim() : '';
      result.push({ time: timeInSecs, text });
    }
  }

  return result.sort((a, b) => a.time - b.time);
}

export function parseTxt(content: string): LyricLine[] {
  return content.split(/\r?\n/)
    .map(line => line.trim())
    .filter(line => line.length > 0)
    .map((line, idx) => ({ time: idx * 1000000, text: line }));
}
