# TiddlyWiki

A plugin for TiddlyWiki 5 (the current, actively-developed TiddlyWiki - see `plugin/`), plus a
small test wiki that builds it and lets you try it in a browser (`test-wiki/`).

(The old `twmath.html` - CodeCogs' integration for TiddlyWiki Classic, a different, unrelated
codebase discontinued in 2013, calling `codecogs.com/editor.js`/`gif.latex?...` endpoints that no
longer exist - has been removed; TW Classic isn't something the current EqEditor API or `plugin/`
here can plug into, so it couldn't be "updated" the way CKEditor 4/TinyMCE 4 were.)

## `plugin/`

A proper TiddlyWiki 5 plugin: an ''Equation'' button in the tiddler editor toolbar that opens the
CodeCogs Equation Editor (maths view by default, with a toggle to LaTeX markup - the state is
remembered in a cookie, shared with every other adapter in `eqneditor-v5-plugins`) and inserts the
equation as an `<img>` tag at the cursor.

- `eqneditor-widget.js` - a custom widget (TiddlyWiki's mechanism for embedding a third-party
  JS library's own live DOM, rather than something wikitext's own reactive model has state for)
  that mounts the shared `EqEditor` API, exactly like every other adapter in this repo.
- `toolbar-button.tid` / `dropdown.tid` - the toolbar button and the popup it opens, following the
  same `dropdown:` pattern TiddlyWiki's own core toolbar buttons use (e.g.
  `core/ui/EditorToolbar/picture.tid`).
- `styles.tid` - layout for the dropdown, plus one rule the shared `eqneditor.css` (loaded at
  runtime from `editor.codecogs.com`) doesn't itself provide: hiding the maths view when the
  toggle switches to LaTeX markup. Without it the shared stylesheet only hides the LaTeX box when
  the toggle is off, leaving both views stacked instead of one replacing the other.
- `icon.tid`, `readme.tid`, `plugin.info` - the plugin's icon, in-wiki description, and manifest.

Loads its UI from `editor.codecogs.com` at runtime, same as CodeCogs' other editor plugins.
Override the host with `$:/config/codecogs/eqneditor/Server` and the rendering host with
`$:/config/codecogs/eqneditor/RenderUrl`; for a plain-HTTP local dev server (where the default
`https://` assumption breaks), set the full URLs instead with
`$:/config/codecogs/eqneditor/ScriptUrl` and `$:/config/codecogs/eqneditor/CssUrl` (see
`test-wiki/tiddlers/config-script-url.tid` for an example).

## `test-wiki/`

A minimal wiki (`tiddlywiki.info` + one starter tiddler) used to build and try the plugin. Needs
the `tiddlywiki` npm package - nothing to install ahead of time, `build.sh` fetches it with `npx`.

```bash
./build.sh
```

This produces (git-ignored, regenerated each run - see `../.gitignore`):

- `output/index.html` - a self-contained single-file wiki with the plugin installed. Open it,
  edit (or create) a tiddler, and use the **Equation** button in the editor toolbar.
- `output/codecogs-eqneditor.json` - the plugin packaged as a single importable file. Drag this
  onto *any* other TiddlyWiki 5 (including a plain `empty.html` from tiddlywiki.com) to install it
  there via TiddlyWiki's own built-in import - no server or CLI needed on the receiving end.

Verified end-to-end in a real browser against TiddlyWiki 5.4.1 (the current release as of this
writing): the toolbar button opens the dropdown, typing into the maths view renders MathML live
and updates the preview image, the toggle correctly swaps to/from the LaTeX markup box, Insert
places the `<img>` at the cursor via a plain `tm-edit-text-operation` message (the same one
TiddlyWiki's own toolbar buttons send), and the equation renders inline once saved.
