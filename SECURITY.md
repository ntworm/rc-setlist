# Security policy

## Supported versions

| Version line                               | Status      |
| ------------------------------------------ | ----------- |
| `1.0.x`                                    | Supported   |
| `0.x`                                      | Unsupported |
| Private dev builds (`0.7.x` private, etc.) | Unsupported |

Security fixes are provided for the latest published release of the
`1.0.x` line. Older `1.x` and the `0.x` lineage are unsupported. The
private `0.7.x` development builds that pre-date the public release are
not covered by this policy either; users running them must upgrade to
`1.0.0` to receive security fixes.

## Report privately

Do not open a public issue for a vulnerability. Use GitHub's private reporting
form:

<https://github.com/ntworm/rc-setlist/security/advisories/new>

Include the RC Setlist version, Live version, operating system, reproduction
steps, impact and any proof of concept. Remove tokens, private keys, local paths
and personal setlist content from logs.

## Threat model

- RC Setlist is intended for a trusted local network.
- TCP `4444` exposes browser pages and a WebSocket endpoint to reachable clients.
- Controller actions require a token, but read-only state can still reveal song
  titles, lyrics and timing to clients that can reach the service.
- The certificate is self-signed. Verify the host address before accepting it.
- RC Bridge, the bundled Remote Script, accepts OSC commands on local UDP port
  `11020` and replies to the socket that asked; a stock AbletonOSC, if you keep
  one, does the same on `11000`. Keep the host machine protected.
- Do not port-forward RC Setlist or use it on guest/public Wi-Fi.

## Secrets and sensitive material

Runtime controller tokens, `.env` files, generated keys and certificates must
never be committed or attached to an issue. Release packages are checked to
exclude private keys, SDK archives, source maps and local paths.

## Out of scope

Social engineering and denial of service requiring physical access to the host.
Vulnerabilities in RC Bridge (the fork of AbletonOSC shipped in `bridge/`) are
in scope here; vulnerabilities in unmodified Ableton Live or in a stock
AbletonOSC installation should be reported to their respective maintainers.
