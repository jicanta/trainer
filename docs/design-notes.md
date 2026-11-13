# Design notes

- **Look**: warm monochrome, flat cards with hairline borders, one serif (Newsreader) for titles, Geist for
  everything else including numbers, Geist Mono for clocks and tabular figures. Color is used only for meaning.
- **Charts** (`ui/lib/charts.js`): thin marks, rounded data ends, hairline grid, hover tooltip on every mark,
  a legend whenever there is more than one series, and a table twin for every chart.
- **Palette**: categorical blue `#2a78d6` and orange `#eb6834` pass the lightness, chroma, color-vision and
  contrast checks on the white card surface. Outcome stacks use the fixed status colors (good `#0ca30c`,
  warning `#fab219`, critical `#d03b3b`); the warning yellow is below 3:1 contrast on white by design, so those
  charts always carry a labeled legend and the table view.
- **Security**: the UI is built with `createElement` and `textContent` only, so text from Codeforces or from the
  model cannot inject markup. The renderer has no Node access; it talks to the main process through one
  `call(method, params)` bridge. The embedded view may only navigate on codeforces.com.
