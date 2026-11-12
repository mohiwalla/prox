# Dashboard polish

## Audit

- The toolbar breaks labels from their controls on phones; group controls by purpose.
- Generic system typography varies by device; self-host Geist and Geist Mono.
- Charts only show values in the footer; add a crosshair, a value tooltip, and keyboard inspection.
- Primary-window labels mix weekly and monthly accounts; keep the label explicit and preserve plan warnings.
- Missing history and stale observations must remain honest; never draw invented data to make the chart attractive.
- Minor spacing and control heights vary; align the shell, toolbars, and chart footers to a 4px rhythm.

## Direction

Product: a private view of the accounts and quotas powering your coding agents.

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
- [Emil Kowalski's animation skill](https://github.com/emilkowalski/skills/tree/main/skills/animate):
  motion purpose, timing, interruption, native dialog/disclosure and reduced-motion guidance.
- Original Codex (dark) and Antigravity marks from [SVGL](https://svgl.app/),
  [source](https://github.com/pheralb/svgl/tree/main/static/library), embedded once
  as SVG symbols without external requests. License retained in `assets/svgl-license.txt`.

## Motion

Keep the approved layout and data honest. Pointer-driven navigation uses a 180ms
opacity/6px transition; chart selections use a short fade, without drawing or
interpolating invented values. Selection backgrounds slide with a clipped surface.
Native dialogs and the mobile drawer enter and exit over 240ms; account breakdowns
expand over 180ms. Buttons provide 120ms press feedback. No motion dependency is added.

Keyboard actions and reduced-motion preferences are immediate. Automatic snapshots
patch the existing DOM rather than replaying entrance motion: native selects, focused
buttons, disclosures, and chart inspection survive updates. Chart keyboard inspection
tracks timestamps across new samples. Rapid range changes discard stale responses and
queue the latest range before animating its actual data.

Browser checks cover interrupted selections and dialogs, quiet polling, focus when
siblings disappear or reorder, history changes, queued range requests, reduced motion,
and the original provider marks. Visual inspection uses Chrome at desktop/mobile sizes;
the final feel on the user's device remains a user check on the live dashboard.
