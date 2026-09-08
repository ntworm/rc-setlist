# Frequently asked questions

## Is Ableton RC Setlist open source?

It is source-available under PolyForm Noncommercial 1.0.0. Noncommercial use,
modification and redistribution are allowed under the license; commercial use
is not allowed. PolyForm Noncommercial is not an OSI-approved open-source license.

## Does an end user need Node.js?

No. Install the release `.ablx`. Node.js 24.16.0 is for source development.

## Why is AbletonOSC required?

Ableton RC Setlist uses AbletonOSC for transport and Live Object Model operations that
form part of its setlist workflow. Install it from
<https://github.com/ideoforms/AbletonOSC>. It is not included here.

## Why does the browser show a certificate warning?

On the first connection the browser may show `ERR_CERT_AUTHORITY_INVALID`
because RC Setlist creates a local self-signed certificate for secure WebSockets.
Continue only when the address exactly matches the IP shown in the Live panel
and you are on a trusted LAN. Each browser/device may require this once.

## Where are lyrics stored?

Inside the Ableton Extensions storage directory, under the active Ableton RC Setlist
profile. Use the built-in lyrics editor rather than editing storage directly.

## Can I use my existing lyrics?

Only if you own them or have permission. The repository and demo kit contain
fictional text; Ableton RC Setlist does not provide commercial lyrics.

## Does macOS work?

The code is designed to be portable, but 0.5.0 marks macOS experimental until a
complete real-device matrix is recorded.

## Can I put Ableton RC Setlist on the public internet?

No. It is designed for a trusted local network. Use a professionally configured
private tunnel if remote access is unavoidable; never expose port `4444` directly.

## Can I sell Ableton RC Setlist or a modified version?

Not under PolyForm Noncommercial 1.0.0. Read [the license](../LICENSE); seek your
own legal advice for a specific use.

## Why is my setlist total duration different from what I expected?

If your Ableton Live arrangement contains tempo automations (songs at different BPMs) drawn directly on the master track timeline without bracketed `[bpm N]` locator tags, the extension cannot inspect the automation curve. The Live Object Model and Extensions SDK do not expose arrangement tempo breakpoints remotely.

Without tags, RC Setlist calculates duration using Live's current tempo as a uniform estimate and displays an `EST.` badge. In a 21-song set with tempos varying between 93 and 166 BPM, single-tempo estimation caused a 16:59 discrepancy (95:40 vs actual 78:41).

To obtain exact timings, add `[bpm N]` to each song's locator name (e.g. `Song Title [bpm 120]`). RC Setlist will immediately switch from estimated to declared confidence, calculate exact piecewise durations, and remove the `EST.` badge.

## Tempo automation drawn in Live

If your Arrangement has its own tempo automation, keep **Set Live tempo on jump**
switched **off** in the Live panel. It ships off, and this is why.

An explicit jump can write the destination tempo into Live before it moves the
playhead. Writing `song.tempo` overrides Live's tempo automation: the arrangement
stops following its own envelope until you press **Re-Enable Automation** in the
transport bar. One jump mid-show would flatten the tempo for the rest of the set.

RC Setlist also watches for this on its own. When the tempo Live reports differs
from the `[bpm N]` tag declared at that point in the setlist, the extension
concludes that something other than the setlist owns the tempo and refuses to
write it, even if the setting is on.

A `[bpm N]` tag means "measure the duration with this". It does not mean "impose
this on Live". Tagging your songs is safe with tempo automation, and it is what
turns an estimated set duration into an exact one.

Turn the setting on only when the tags are your source of truth for tempo and the
Arrangement has no tempo automation.
