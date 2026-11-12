# Dashboard polish

## Audit

- The toolbar breaks labels from their controls on phones; group controls by purpose.
- Generic system typography varies by device; self-host Geist and Geist Mono.
- Charts only show values in the footer; add a crosshair, a value tooltip, and keyboard inspection.
- Primary-window labels mix weekly and monthly accounts; keep the label explicit and preserve plan warnings.
- Missing history and stale observations must remain honest; never draw invented data to make the chart attractive.
- Minor spacing and control heights vary; align the shell, toolbars, and chart footers to a 4px rhythm.

## Direction

Product: a private view of the accounts and quotas powering coding agents on Batman.

Character: precise, quiet, watchful.

World: an always-on home hub with instruments that can be checked at a glance.

Moments: recorded quota curves and clearly differentiated reset projections; color belongs to provider data.

Signature: a fine “Now” marker connects the latest quota reading to the future reset timeline.

Theo's supplied reference defines the layout, black shell, sidebar, provider tabs,
and stacked quota panels. The polish keeps those decisions. Geist carries the
interface; Geist Mono is reserved for graph annotations and numeric meta. Provider
colors stay blue and apricot. The core proxy, account tokens, and original panel
are outside the dashboard deployment's file set.

## Sources

- Local `frontend-design` and UI/UX Pro Max skills.
- [Unslop](https://github.com/heydamir/unslop), by Damir Sokolovsky
  ([@heydamir](https://x.com/heydamir)), CC BY 4.0. Audit and craft guidance
  applied to the dashboard; this credit is retained for the adapted guidance.
- The starred `1weiho/skills` clean-ui-shot skill was inspected. Its framed
  marketing screenshots are outside this application-polish request.
- Geist fonts: Vercel, [geist](https://github.com/vercel/geist-font), with the
  distributed license retained in `assets/geist-license.txt`.
