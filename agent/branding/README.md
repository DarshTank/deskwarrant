# Agent branding assets

Windows installer artwork for `installer.iss`. Inno Setup reads **BMP** for
wizard images and **ICO** for the setup icon — it has never understood SVG — so
the rasterised files are committed next to the vectors they came from and the
release workflow just compiles against them.

## Sources

| File | What it is |
|---|---|
| `logo.svg` | The full instrument seal. Mirrors `console/components/Logo.tsx` — change one, change the other. |
| `logo-mark.svg` | The same seal reduced to what still reads at 16px: no engraved legend, no hairline rings, heavier strokes. |
| `wizard-large.svg` | The installer's left banner, authored at Inno's 164×314. |

## Generated

| File | Used by |
|---|---|
| `deskwarrant.ico` | `SetupIconFile`, `UninstallDisplayIcon`, and both Start Menu shortcuts. 16–256px. |
| `WizardSmall-*.bmp` | `WizardSmallImageFile` — the header mark on every wizard page. |
| `WizardLarge-*.bmp` | `WizardImageFile` — the tall banner on the Finished page. |

## Regenerating

From the `agent` directory, after editing any SVG:

```powershell
.\.venv\Scripts\python.exe branding\make_assets.py
```

It needs Pillow (already in `requirements.txt`) and a Chromium browser to
rasterise with. Edge ships with Windows and is found automatically; pass
`--browser` to point at another one.

Two things the script handles that are easy to get wrong by hand:

- **Sizes 16–48 come from `logo-mark.svg`, not `logo.svg`.** Downscaling the
  full seal turns its legend and dashed rings into grey noise, and the result
  is unidentifiable in a taskbar.
- **The ICO is written with DIB frames, not PNG.** Pillow defaults to
  PNG-compressing every frame. That is legal in an `.ico` *file*, but
  `SetupIconFile` ends up as a Win32 `RT_ICON` resource on `Setup.exe`, where
  PNG frames below 256px are not reliably honoured.

## Not covered here

`DeskWarrantAgent.exe` itself still carries PyInstaller's default icon —
`deskwarrant.spec` passes no `icon=`. The installed shortcuts override it via
`IconFilename`, so the Start Menu looks right, but Task Manager and Alt-Tab do
not.
