# Prompt for Replit Agent

Upload the `design-kit` folder to your Replit project (drag it into the Files panel), then paste
everything between the lines below into Replit Agent.

---

Restyle this app with the "Obsidian Glass" skin in the `design-kit` folder. Change only how it
looks. Do not change any logic, data, routes, API calls or permissions.

1. Load `design-kit/obsidian-glass.css` once, globally, after all other CSS. Dark is the default
   theme. If the app has a light/dark toggle, toggle the class `light` on `<html>` for light mode.
2. Open `design-kit/preview.html` and copy its structure and classes exactly. It shows every piece.
3. Layout: wrap the app in `og-app`. Put the navigation in a floating glass sidebar
   (`og-sidebar` > `og-sidebar-inner`) with the app name as plain text in `og-brand`, and each link
   as `og-nav-item` (add `active` or `aria-current="page"` for the current page, `og-nav-badge`
   for counts). Put the rest in `og-main`, with the top bar in `og-header` and the page in
   `og-content`.
4. Every card or panel becomes `og-panel` (featured/hero ones also get `og-panel-hero`). Items
   inside a panel become `og-tile`. KPI cards use `og-kpi`, `og-kpi-label`, `og-kpi-value`.
5. Buttons: `og-btn` plus `og-btn-primary` (main action), `og-btn-secondary`, `og-btn-danger` or
   `og-btn-ghost`; `og-btn-sm` for small ones. Inputs, selects and textareas: `og-input`,
   `og-select`, `og-textarea`, with labels as `og-label`. Search bars use `og-search`.
6. Status labels become pills: `og-badge` plus `og-badge-success`, `-warning`, `-danger`, `-info`
   or `-violet`. Progress bars: `og-meter` with an `og-meter-fill` child (add `warning` or
   `danger` near limits). Tables: `og-table`. Tabs: `og-tabs` with `og-tab` buttons.
7. Charts: use the CSS variables `--og-chart-1` to `--og-chart-4` for series colors and
   `--og-chart-grid` for grid lines, with area fills fading from the line color.
8. Remove old background colors, card borders and shadows that fight the skin. Never hard-code
   colors: use the `--og-*` variables.
9. Rules: the app name in the sidebar is plain text "AACTIVATED AI BRAIN". No logo. No emojis
   anywhere in the UI. Keep text readable (do not lower contrast).
10. On screens narrower than 1024px the sidebar hides: keep or add a menu button that opens the
    navigation.

When finished, show me the main dashboard, one list page and one form page side by side with
`design-kit/preview.html` so I can compare.

---
