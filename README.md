# TiddlyWiki

A plugin for TiddlyWiki 5 (the current, actively-developed TiddlyWiki - see `plugin/`), plus a
small test wiki that builds it and lets you try it in a browser (`test-wiki/`).

(The old `twmath.html` - CodeCogs' integration for TiddlyWiki Classic, a different, unrelated
codebase discontinued in 2013, calling `codecogs.com/editor.js`/`gif.latex?...` endpoints that no
longer exist - has been removed; TW Classic isn't something the current EqEditor API or `plugin/`
here can plug into, so it couldn't be "updated" the way CKEditor 4/TinyMCE 4 were.)

## `plugin/`

A proper TiddlyWiki 5 plugin: an ''Equation'' button in the tiddler editor toolbar that opens the
CodeCogs Equation Editor in the same layout as every other adapter in this repo - toolbar and
maths view on top, then a bottom bar with the *Inline* and *LaTeX markup* toggles on the left and
*Insert as*, *Cancel* and *OK* on the right. It inserts the equation at the cursor as MathML (the
default - TiddlyWiki renders it natively) or as an SVG `<img>` from the rendering service.

- `eqneditor-widget.js` - a custom widget (TiddlyWiki's mechanism for embedding a third-party
  JS library's own live DOM, rather than something wikitext's own reactive model has state for)
  that mounts the shared `EqEditor` API, exactly like every other adapter in this repo.
- `toolbar-button.tid` / `dropdown.tid` - the toolbar button and the popup it opens, following the
  same `dropdown:` pattern TiddlyWiki's own core toolbar buttons use (e.g.
  `core/ui/EditorToolbar/picture.tid`).
- `styles.tid` - the dropdown's size (850px, capped to the window). Everything else the dialog
  needs - including undoing TiddlyWiki's `.tc-drop-down svg`/button rules, which would otherwise
  shrink the toolbar icons - is injected by `eqneditor-widget.js`, as in the other adapters.
- `icon.tid`, `readme.tid`, `plugin.info` - the plugin's icon, in-wiki description, and manifest.

Loads its UI from `fxeditor.codecogs.com` at runtime, same as CodeCogs' other editor plugins.
Set your fxTeX Pro licence key in `$:/config/codecogs/eqneditor/Licence`. Override the host with
`$:/config/codecogs/eqneditor/Server` - a host (https is assumed) or a full origin such as
`http://localhost:8010` for a local dev server - and the rendering host with
`$:/config/codecogs/eqneditor/RenderUrl`. `$:/config/codecogs/eqneditor/ScriptUrl` and
`$:/config/codecogs/eqneditor/CssUrl` still override the two URLs individually. See
`test-wiki/tiddlers/config-server.tid` and `config-licence.tid`; their `{{...}}` placeholders
are filled in by whatever serves the wiki (`.claude/dev-server.py` locally, the fxplugins
container in production).

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

Verified in a real browser against TiddlyWiki 5.4.1: the toolbar matches the reference editor,
the toggles swap views, and OK inserts at the cursor via a plain `tm-edit-text-operation`
message (the same one TiddlyWiki's own toolbar buttons send). An SVG insert renders once saved.
MathML is written with its `<annotation>` and inter-tag whitespace removed, since TiddlyWiki
would otherwise parse them as wikitext; the image's `alt` is quoted for wikitext, where
attribute values are not HTML-entity-decoded.
