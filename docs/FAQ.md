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

The local server creates a self-signed certificate so phone features and secure
WebSockets can work on the LAN. Accept it only for the expected Ableton RC Setlist host
on a trusted network.

## Where are lyrics stored?

Inside the Ableton Extensions storage directory, under the active Ableton RC Setlist
profile. Use the built-in lyrics editor rather than editing storage directly.

## Can I use my existing lyrics?

Only if you own them or have permission. The repository and demo kit contain
fictional text; Ableton RC Setlist does not provide commercial lyrics.

## Does macOS work?

The code is designed to be portable, but 0.3.0 marks macOS experimental until a
complete real-device matrix is recorded.

## Can I put Ableton RC Setlist on the public internet?

No. It is designed for a trusted local network. Use a professionally configured
private tunnel if remote access is unavoidable; never expose port `4444` directly.

## Can I sell Ableton RC Setlist or a modified version?

Not under PolyForm Noncommercial 1.0.0. Read [the license](../LICENSE); seek your
own legal advice for a specific use.
