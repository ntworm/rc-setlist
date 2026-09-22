import { expect, test } from '@playwright/test';

// The timecode was sized in vw inside a card that is a fraction of the screen,
// so the card clipped both ends of it at every desktop width, and the phone
// portrait view cut the timecode and two labels. Every size a stage display
// realistically has, from a small phone to a 1440p screen, in both languages.
const viewports = [
  { width: 390, height: 844 },
  { width: 412, height: 915 },
  { width: 430, height: 932 },
  { width: 844, height: 390 },
  { width: 1024, height: 768 },
  { width: 1280, height: 800 },
  { width: 1366, height: 768 },
  { width: 1440, height: 900 },
  { width: 1600, height: 900 },
  { width: 1920, height: 1080 },
  { width: 2560, height: 1440 },
];

const STAGE_FLOOR_PX = 12; // --t-stage-micro

// A set past the hour: the total gains its hours field and the elapsed time
// its second minute digit, the widest timecode a real show produces
// ("63:40 / 1:18:41").
async function emitLongShow(request) {
  const response = await request.get('/__test__/state?scenario=marketing');
  const message = await response.json();
  const songs = message.state.songs.map((song) => ({ ...song, durationSeconds: 944 }));
  await request.post('/__test__/emit', {
    data: {
      ...message,
      state: {
        ...message.state,
        songs,
        totalDurationSeconds: 4721,
        arrangementEndTime: 4721,
        activeSongIndex: 4,
        activeSectionIndex: 0,
        currentSongTime: 600,
        tempo: 120,
      },
    },
  });
}

async function measureTelemetry(page) {
  return page.evaluate(() => {
    const readings = [];
    for (const card of document.querySelectorAll('.telemetry-card')) {
      const style = getComputedStyle(card);
      const rect = card.getBoundingClientRect();
      const inner = {
        left: rect.left + parseFloat(style.borderLeftWidth),
        right: rect.right - parseFloat(style.borderRightWidth),
        top: rect.top + parseFloat(style.borderTopWidth),
        bottom: rect.bottom - parseFloat(style.borderBottomWidth),
      };
      const texts = card.querySelectorAll(
        '.card-label, #timecode, #barcode, #bpm, #songTimecode, #clickState',
      );
      for (const element of texts) {
        if (getComputedStyle(element).display === 'none' || !element.textContent.trim()) continue;
        const range = document.createRange();
        range.selectNodeContents(element);
        const boxes = [...range.getClientRects()].filter((box) => box.width > 0);
        const glyphs = boxes.reduce(
          (all, box) => ({
            left: Math.min(all.left, box.left),
            right: Math.max(all.right, box.right),
            top: Math.min(all.top, box.top),
            bottom: Math.max(all.bottom, box.bottom),
          }),
          { left: Infinity, right: -Infinity, top: Infinity, bottom: -Infinity },
        );
        readings.push({
          name: element.id || element.className,
          text: element.textContent.replace(/\s+/g, ' ').trim(),
          fontSize: parseFloat(getComputedStyle(element).fontSize),
          outsideCard:
            glyphs.left < inner.left - 0.5 ||
            glyphs.right > inner.right + 0.5 ||
            glyphs.top < inner.top - 0.5 ||
            glyphs.bottom > inner.bottom + 0.5,
          clippedInside: element.scrollWidth > element.clientWidth + 1,
        });
      }
    }
    return {
      readings,
      songTitleSize: parseFloat(getComputedStyle(document.getElementById('songTitle')).fontSize),
      timecodeSize: parseFloat(getComputedStyle(document.getElementById('timecode')).fontSize),
    };
  });
}

function expectReadable(result, where) {
  for (const reading of result.readings) {
    const label = `${where} ${reading.name} "${reading.text}"`;
    expect(reading.outsideCard, `${label} runs past its card`).toBe(false);
    expect(reading.clippedInside, `${label} is clipped inside its own box`).toBe(false);
    expect(reading.fontSize, `${label} is below the stage floor`).toBeGreaterThanOrEqual(
      STAGE_FLOOR_PX,
    );
  }
  // THEME_CONTRACT section 4: the song outranks the clock.
  expect(result.timecodeSize, `${where} timecode set larger than the song`).toBeLessThanOrEqual(
    result.songTitleSize,
  );
}

for (const viewport of viewports) {
  test(`Performance telemetry fits its cards at ${viewport.width}x${viewport.height}`, async ({
    page,
    request,
  }) => {
    await page.setViewportSize(viewport);
    for (const locale of ['en', 'pt-BR']) {
      await page.addInitScript((value) => {
        localStorage.setItem('rc-setlist.locale', value);
      }, locale);
      await page.goto('/performance/?scenario=marketing');
      await expect(page.locator('#songTitle')).toHaveText('SONG 03');
      await expect(page.locator('#timecode')).toContainText('/ 10:40');
      expectReadable(await measureTelemetry(page), `${locale} ${viewport.width}px short show`);

      await emitLongShow(request);
      await expect(page.locator('#timecode')).toContainText('/ 1:18:41');
      expectReadable(await measureTelemetry(page), `${locale} ${viewport.width}px long show`);
    }
  });
}

test('the timecode keeps one size while the elapsed time gains a digit', async ({ page }) => {
  await page.setViewportSize({ width: 1600, height: 900 });
  await page.goto('/performance/?scenario=marketing');
  await expect(page.locator('#timecode')).toContainText('/ 10:40');
  const budget = await page
    .locator('#timecode')
    .evaluate((element) => element.style.getPropertyValue('--glyphs'));
  // "10:40 / 10:40": sized for the end of the show from its first second.
  expect(budget).toBe('13');
});
