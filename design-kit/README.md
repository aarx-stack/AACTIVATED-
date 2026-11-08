# Obsidian Glass design kit

The AACTIVATED AI BRAIN look (Style A, "Obsidian Glass"), packaged so any other app can use it,
for example the engine being built on Replit. It has no dependencies.

| File                 | What it is                                                                               |
| -------------------- | ---------------------------------------------------------------------------------------- |
| `obsidian-glass.css` | The whole skin: colors, glass panels, glow, buttons, pills, tables, layout               |
| `preview.html`       | A sample page using only that CSS. Open it in a browser to see the skin                  |
| `REPLIT_PROMPT.md`   | Copy-paste instructions for Replit Agent to restyle an app                               |
| Reference PDF        | The approved 12-page concept PDF: in the zip, and in this repo under `design/reference/` |

## Use it on Replit (easiest)

1. Download this `design-kit` folder (or the `design-kit.zip` you were sent).
2. In your Replit project, drag the folder into the Files panel.
3. Open Replit Agent and paste the prompt from `REPLIT_PROMPT.md`.

Replit Agent then loads the stylesheet and swaps the app's classes for the `og-*` ones. The app's
logic is not touched.

## Use it by hand

- Add `<link rel="stylesheet" href="design-kit/obsidian-glass.css">` (or import it in your main
  CSS/JS file) after your other styles.
- Dark is the default. Add the class `light` to `<html>` for the light theme.
- Copy markup from `preview.html`. Every class starts with `og-`, so nothing clashes with
  existing styles.
- Use the `--og-*` variables for anything custom, for example
  `background: var(--og-panel-bg); color: var(--og-foreground)`.

## Already on React + Tailwind 4?

The AI Brain app in this repo uses the same tokens through Tailwind (`src/styles/globals.css`)
with ready-made React components in `src/components/ui` and `src/components/shell`. Those can be
copied instead, but the CSS file above is the quickest route for any stack.

## Rules that travel with the skin

- The app name is plain text "AACTIVATED AI BRAIN". No logo until one is supplied.
- No emojis anywhere in the UI.
- Text contrast meets WCAG AA in both themes; do not lower it.
