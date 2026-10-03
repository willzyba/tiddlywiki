/*\
title: $:/plugins/codecogs/eqneditor/eqneditor-widget.js
type: application/javascript
module-type: widget

Renders the CodeCogs equation editor inside the toolbar dropdown (see dropdown.tid/
toolbar-button.tid) - the same maths-view-only layout as CodeCogs' other editor plugins, with the
LaTeX and Inline toggles bottom-left and "Insert as", Cancel and OK bottom-right - and on OK
dispatches a plain tm-edit-text-operation - the same message <$action-sendmessage> would send -
carrying the equation as MathML or an <img>. Built as a widget rather than a plain wikitext dropdown (the
way most core toolbar buttons work, e.g. core/ui/EditorToolbar/picture-dropdown.tid) because the
CodeCogs UI is only ever the current state of a third-party script's live DOM, not something
TiddlyWiki's own reactive tiddler/transclusion model has any state for. Insert/Cancel are part of
this widget's own DOM instead of separate wikitext <$button>s so the click handler can read that
state - eqTextArea.getTextArea().textContent, eqOutput.exportAs() - synchronously, the same
way every other adapter in fxPlugins does it (see tinymce/v6/eqneditor.js), rather
than needing a bridge tiddler kept in sync by polling.

The shared EqEditor API (TextArea/Toolbar/Output/History/MathView) is loaded at runtime from
fxtex.codecogs.com, same host and API surface as every other adapter here - override with
$:/config/codecogs/eqneditor/Server (a host, or a full origin such as "http://localhost:8010" for local development against
eqneditor-v5-www) and $:/config/codecogs/eqneditor/RenderUrl.

\*/
"use strict";

var Widget = require( "$:/core/modules/widgets/widget.js" ).widget;

var DEFAULT_SERVER = "fxtex.codecogs.com";
var DEFAULT_RENDER_URL = "https://latex.codecogs.com";

var scriptPromises = {};

function loadScriptOnce( url ) {
	if ( scriptPromises[ url ] ) return scriptPromises[ url ];

	scriptPromises[ url ] = new Promise( function ( resolve, reject ) {
		if ( typeof window.EqEditor !== "undefined" ) {
			resolve();
			return;
		}

		var existing = document.querySelector( 'script[src="' + url + '"]' );
		var script = existing || document.createElement( "script" );

		script.addEventListener( "load", function () { resolve(); } );
		script.addEventListener( "error", function () {
			reject( new Error( "CodeCogs Equation Editor: could not load " + url ) );
		} );

		if ( !existing ) {
			script.src = url;
			document.head.appendChild( script );
		}
	} );

	return scriptPromises[ url ];
}

// EqEditor.init() switches the converter every TextArea/MathView/Toolbar construction takes on
// to fxTeX Pro - skip it and they keep the placeholder converter for their whole lifetime, even
// once fxeditor.api.min.js itself has loaded. Called once per page; an empty licence is the
// normal, expected state until a real one is configured.
var initPromise = null;

function ensureInit( licence ) {
	if ( initPromise ) return initPromise;
	initPromise = ( typeof EqEditor.init === "function" )
		? EqEditor.init( { licence: licence || "" } ).catch( function ( err ) {
			window.console && console.warn( "fxTeX Pro: " + ( err && err.message || err ) );
		} )
		: Promise.resolve();
	return initPromise;
}

function loadCssOnce( url ) {
	if ( document.querySelector( 'link[href="' + url + '"]' ) ) return;
	var link = document.createElement( "link" );
	link.rel = "stylesheet";
	link.href = url;
	document.head.appendChild( link );
}

// The API's own @font-face for "Latin Modern Math" only carries local(), so it falls back to a
// generic serif unless the font happens to be installed; redeclaring it here adds a real url().
// The rest lays the editor out to fill the dropdown and gives it the same bottom bar as the
// other plugins, !important where TiddlyWiki's own dropdown/button styles would otherwise win.
function injectStyleOverridesOnce( fontUrl ) {
	if ( document.getElementById( "cc-eqneditor-style-overrides" ) ) return;
	var style = document.createElement( "style" );
	style.id = "cc-eqneditor-style-overrides";
	style.textContent = '@font-face { font-family: "Latin Modern Math"; font-display: swap; ' +
		'src: local("Latin Modern Math"), url("' + fontUrl.replace( /prototypes\/latinmodern-math\.otf$/, 'fonts/LatinModernMath-Regular.woff2' ) + '") format("woff2"), url("' + fontUrl + '") format("opentype"); }' +
		// Undo host resets (e.g. .cke_reset_all *) inside the toolbar icons and the maths view's MathML.
		'.CCToolbar svg:has(g[font-family]), .CCToolbar svg:has(g[font-family]) * { font: revert-layer !important; }' +
		// Icons drawn as <text>: the svg gets the API's own .cc_panel font (fxTeX Toolbar, 16px) back over host resets, and each <text> its own font-size attribute (revert-layer lets attributes win).
		'.CCToolbar svg:not(:has(g[font-family])) { font: normal normal 16px "fxTeX Toolbar" !important; }' +
		'.CCToolbar svg:not(:has(g[font-family])) * { font: revert-layer !important; }' +
		'.CCToolbar svg, .CCToolbar svg * { width: revert-layer !important; height: revert-layer !important; max-width: revert-layer !important; }' +
		'.CCToolbar svg g[font-family="fxTeX Toolbar"] { color: #000 !important; }' +
		'.CCMathView math, .CCMathView math * { font: revert-layer !important; ' +
			'width: revert-layer !important; height: revert-layer !important; padding: revert-layer !important; ' +
			'margin: revert-layer !important; text-transform: revert-layer !important; text-align: revert-layer !important; ' +
			'box-sizing: revert-layer !important; white-space: revert-layer !important; }' +
		apiMathRules() +
		'.CCEqnEditor { display: flex !important; flex-direction: column !important; height: 480px !important; }' +
		'.CCEqnEditor .CCEditorBar, .CCEqnEditor .CCToolbarHost { flex: 0 0 auto; }' +
		// The toolbar as wide as the dialog, no wider: sized to its own content instead (width: auto)
		// it kept the toolbar's whole row and ran past a narrow dialog (`design.width`); at 100% the
		// toolbar scrolls.
		'.CCEqnEditor .CCToolbarHost { align-self: flex-start; width: 100%; }' +
		'.CCEqnEditor .CCMathViewHost { flex: 1 1 auto; min-height: 0; display: flex; align-items: center; ' +
			'justify-content: center; overflow: auto; }' +
		'.CCEqnEditor[data-inline="on"] .CCMathViewHost { justify-content: flex-start; }' +
		'.CCEqnEditor[data-latex="on"] .CCMathViewHost { display: none !important; }' +
		'.CCEqnEditor .CCLatexInput { flex: 1 1 auto; min-height: 0; overflow: auto; }' +
		'.CCEqnEditor[data-latex="off"] .CCLatexInput { display: none !important; }' +
		'.CCEqnEditor .CCEqnOutput-hidden { display: none !important; }' +
		// TiddlyWiki styles every button in a dropdown as a full-width block, which stacked the history buttons.
		'.tc-drop-down .CCEqnEditor .CCHistory button { display: inline-block !important; width: auto !important; padding: revert-layer !important; margin: revert-layer !important; ' +
			'text-align: center !important; line-height: normal !important; vertical-align: middle !important; }' +
		// The bottom bar: toggles left, Insert-as and the dialog's buttons right, one type size. All !important - host dialog resets otherwise restyle it.
		'.cc-eqn-bar { display: flex !important; flex-wrap: wrap !important; align-items: center !important; gap: 16px !important; flex: 0 0 auto !important; ' +
			'margin: 8px 0 0 !important; padding: 10px 0 0 !important; border: 0 !important; border-top: 1px solid #e2e8f0 !important; ' +
			'background: none !important; font: 13px/1.3 system-ui, -apple-system, "Segoe UI", Arial, sans-serif !important; color: #1c2530 !important; }' +
		'.cc-eqn-bar-right { display: flex !important; align-items: center !important; gap: 8px !important; margin: 0 0 0 auto !important; padding: 0 !important; font: inherit !important; color: inherit !important; }' +
		'.cc-eqn-bar .cc-switch { display: inline-flex !important; align-items: center !important; gap: 6px !important; margin: 0 !important; ' +
			'padding: 0 !important; font: inherit !important; color: #54647c !important; cursor: pointer !important; user-select: none !important; white-space: nowrap !important; }' +
		'.cc-eqn-bar .cc-switch input { position: absolute !important; width: 1px !important; height: 1px !important; margin: -1px !important; ' +
			'padding: 0 !important; border: 0 !important; overflow: hidden !important; clip: rect(0, 0, 0, 0) !important; opacity: 0 !important; }' +
		'.cc-eqn-bar .cc-switch-track { position: relative !important; display: inline-block !important; flex: 0 0 auto !important; width: 28px !important; ' +
			'height: 16px !important; margin: 0 !important; padding: 0 !important; border: 0 !important; border-radius: 8px !important; ' +
			'background: #ccc !important; transition: background .2s !important; }' +
		'.cc-eqn-bar .cc-switch-knob { position: absolute !important; display: block !important; top: 2px !important; left: 2px !important; ' +
			'width: 12px !important; height: 12px !important; margin: 0 !important; border-radius: 50% !important; background: #fff !important; transition: left .2s !important; }' +
		'.cc-eqn-bar .cc-switch input:checked + .cc-switch-track { background: #4caf50 !important; }' +
		'.cc-eqn-bar .cc-switch input:checked + .cc-switch-track .cc-switch-knob { left: 14px !important; }' +
		'.cc-eqn-bar .cc-switch input:focus-visible + .cc-switch-track { outline: 2px solid #003794 !important; outline-offset: 2px !important; }' +
		'.cc-eqn-bar .cc-switch input:disabled ~ * { opacity: .5 !important; cursor: default !important; }' +
		'.cc-eqn-bar .cc-switch-label { font: inherit !important; color: inherit !important; }' +
		'.cc-eqn-bar .cc-switch input:checked ~ .cc-switch-label { color: #003794 !important; font-weight: 600 !important; }' +
		'.cc-eqn-bar .cc-eqn-select { width: auto !important; height: 30px !important; margin: 0 !important; padding: 0 8px !important; ' +
			'border: 1px solid #cbd5e0 !important; border-radius: 4px !important; background: #fff !important; font: inherit !important; color: #1c2530 !important; cursor: pointer !important; }' +
		'.cc-eqn-bar .cc-eqn-btn { display: inline-flex !important; align-items: center !important; height: 30px !important; margin: 0 !important; ' +
			'padding: 0 16px !important; border: 1px solid #cbd5e0 !important; border-radius: 4px !important; background: #fff !important; ' +
			'font: inherit !important; color: #1c2530 !important; cursor: pointer !important; box-shadow: none !important; }' +
		'.cc-eqn-bar .cc-eqn-btn * { font: inherit !important; color: inherit !important; }' +
		'.cc-eqn-bar .cc-eqn-btn.cc-eqn-primary { background: #2c7a4b !important; border-color: #2c7a4b !important; color: #fff !important; }';
	document.head.appendChild( style );
}

// Re-asserts the API's own .CCMathView/.fxtex rules, which host resets and revert-layer override.
// The `design` option (see the README): how the editor looks, set by the site rather than the
// author. The toolbar"s rows and scale go to Toolbar.link() itself; everything else is applied
// here, once the editor is mounted - CSS scoped to this editor"s root, then the starting state of
// the LaTeX toggle and the "Insert as" menu.
var designCount = 0;
function applyDesign( root, design, latexToggle, insertSelect ) {
	if ( !root || !design ) return;
	if ( !root.id ) root.id = "cc-eqn-design-" + ( ++designCount );
	var sel = "#" + root.id, css = "";
	var colour = String( design.colour || "" );
	if ( /^(#[0-9a-f]{3,8}|[a-z]+)$/i.test( colour ) ) {
		css += sel + " { --cc-accent: " + colour + ";" +
			" --cc-accent-soft: color-mix(in srgb, " + colour + " 11%, #fff);" +
			" --cc-accent-soft-ring: color-mix(in srgb, " + colour + " 28%, #fff);" +
			" --cc-accent-mid: color-mix(in srgb, " + colour + " 22%, #fff);" +
			" --cc-accent-mid-ring: color-mix(in srgb, " + colour + " 43%, #fff); }";
	}
	if ( Number( design.mathSize ) > 0 ) css += sel + " .CCMathView { font-size: " + Number( design.mathSize ) + "px !important; }";
	if ( Number( design.latexSize ) > 0 ) css += sel + " .CCLatexInput { font-size: " + Number( design.latexSize ) + "px !important; }";
	if ( design.toolbar === false ) css += sel + " .CCToolbar { display: none !important; }";
	if ( design.history === false ) css += sel + " .CCEditorBar { display: none !important; }";
	if ( css ) {
		var style = document.createElement( "style" );
		style.textContent = css;
		root.appendChild( style );
	}
	// The dialog's width and height (`width`, `height`), before any scaling: the box takes the width,
	// and the editing area whatever height makes the whole dialog the height asked for - measured,
	// since everything else in it (toolbar rows, the bottom bar) varies with the design. Hosts that
	// size their dialogs themselves (TinyMCE 4, CKEditor 4) are given both when they open it instead.
	var sizedBox = root.closest( '.tox-dialog, .mce-window, .cke_dialog, .ck-balloon-panel, .cc-eqneditor-modal, .tc-drop-down' ) || root;
	if ( !sizedBox.matches( '.mce-window, .cke_dialog' ) ) {
		if ( Number( design.width ) > 0 ) sizedBox.style.setProperty( 'width', Number( design.width ) + 'px', 'important' );
		var area = root.querySelector( '.CCMathViewHost' );
		if ( Number( design.height ) > 0 && area ) {
			// Measured, then measured again as the dialog settles - the toolbar fits itself to its row
			// after the dialog first lays out, and the fonts arrive - correcting by the difference each time.
			// A box with a height of its own (Froala's and Tiptap's modals) sizes to its contents instead.
			sizedBox.style.setProperty( 'height', 'auto', 'important' );
			var sizing = document.createElement( 'style' );
			root.appendChild( sizing );
			var h = 0;
			var fit = function () {
				var shown = root.querySelector( '.CCLatexInput' ) && getComputedStyle( area ).display === 'none'
					? root.querySelector( '.CCLatexInput' ) : area;
				// Scale may already be applied (see below), and on-screen sizes include it.
				var applied = parseFloat( sizedBox.style.zoom ) || parseFloat( ( sizedBox.style.transform.match( /scale\(([\d.]+)\)/ ) || [] )[ 1 ] ) || 1;
				var now = h || shown.getBoundingClientRect().height / applied;
				h = Math.max( 120, Math.round( now + Number( design.height ) - sizedBox.getBoundingClientRect().height / applied ) );
				// Never taller than the whole dialog asked for: a host that caps its dialog (and scrolls the
				// rest) would otherwise be chased upwards on every pass.
				h = Math.min( h, Number( design.height ) );
				sizing.textContent = '#' + root.id + ' { height: auto !important; } #' + root.id + ' .CCMathViewHost, #' + root.id + ' .CCLatexInput { height: ' + h + 'px !important; min-height: ' + h + 'px !important; }';
			};
			fit();
			[ 150, 500, 1200 ].forEach( function ( t ) { setTimeout( fit, t ); } );
		}
	}
	// The whole dialog, box and contents together - see `dialogSize` in the README. Zoomed where
	// the host lays the dialog out (it grows in place); scaled where the host positions it itself
	// (CKEditor, TinyMCE 4, a TiddlyWiki drop-down), so that placement still holds.
	var size = Number( design.dialogSize );
	if ( size > 0 && size !== 1 ) {
		var box = root.closest( '.tox-dialog, .mce-window, .cke_dialog, .ck-balloon-panel, .cc-eqneditor-modal, .tc-drop-down' ) || root;
		var position = getComputedStyle( box ).position;
		if ( position === 'absolute' || position === 'fixed' ) {
			box.style.transform = 'scale(' + size + ')';
			box.style.transformOrigin = box.matches( '.ck-balloon-panel' ) ? 'top center'
				: box.matches( '.tc-drop-down' ) ? 'top left' : 'center center';
			// A cap on the box's width (CKEditor 5's balloon: 96vw) holds before the scale - divided by it,
			// as for zoom below, or a scaled-down box is squeezed narrower than its own contents.
			box.style.removeProperty( 'max-width' );   // a host that reuses the box (CKEditor 5) would otherwise divide it again
			var cap = getComputedStyle( box ).maxWidth;
			if ( cap !== 'none' ) box.style.setProperty( 'max-width', 'calc(' + cap + ' / ' + size + ')', 'important' );
		} else {
			box.style.zoom = String( size );
			box.style.setProperty( 'max-width', 'calc(96vw / ' + size + ')', 'important' );   // still no wider than the window
		}
	}
	if ( insertSelect && design.insertAs && insertSelect.querySelector( 'option[value="' + design.insertAs + '"]' ) ) {
		insertSelect.value = design.insertAs;
	}
	if ( latexToggle && design.latex && !latexToggle.checked && !latexToggle.disabled ) {
		latexToggle.checked = true;
		latexToggle.dispatchEvent( new Event( "change", { bubbles: true } ) );
	}
}

function apiMathRules() {
	var out = '';
	for ( var i = 0; i < document.styleSheets.length; i++ ) {
		var rules;
		try { rules = document.styleSheets[ i ].cssRules; } catch ( e ) { continue; }
		for ( var j = 0; j < rules.length; j++ ) {
			var r = rules[ j ], decls = '';
			if ( !r.selectorText || !/(^|,)\s*(:where\(\.fxEditor\)\s*)?\.(fxtex|CCMathView)\b/.test( r.selectorText ) ) continue;
			for ( var k = 0; k < r.style.length; k++ ) {
				decls += r.style[ k ] + ':' + r.style.getPropertyValue( r.style[ k ] ) + ' !important;';
			}
			if ( decls ) {
				out += r.selectorText.replace( /:where\(\.fxEditor\)\s*/g, '' ).split( ',' ).map( function ( s ) {
					s = s.trim();
					return /^\.CCMathView\b/.test( s ) ? s : '.CCMathView ' + s;
				} ).join( ',' ) + '{' + decls + '}';
			}
		}
	}
	return out;
}

// A wikitext attribute value, quoted with whichever of TiddlyWiki's quote forms the value
// doesn't itself contain.
function wikitextAttr( value ) {
	if ( value.indexOf( '"' ) === -1 ) return '"' + value + '"';
	if ( value.indexOf( "'" ) === -1 ) return "'" + value + "'";
	return '"""' + value.replace( /"""/g, '""' ) + '"""';
}

function switchHtml( id, label, title ) {
	return '<label class="cc-switch" title="' + title + '">' +
		'<input type="checkbox" id="' + id + '">' +
		'<span class="cc-switch-track"><span class="cc-switch-knob"></span></span>' +
		'<span class="cc-switch-label">' + label + '</span>' +
	'</label>';
}

// TiddlyWiki parses the text inside HTML elements as wikitext, so the LaTeX source the
// converter keeps in <annotation> (where "--", "''" or "^^" would become formatting) is dropped.
// The <math> element's title still carries it, and attribute values aren't parsed.
function mathmlForWikitext( mathml ) {
	return mathml
		.replace( /<annotation(-xml)?\b[^>]*>[\s\S]*?<\/annotation(-xml)?>/g, "" )
		.replace( />\s+</g, "><" );
}

var instanceCount = 0;

var EqNEditorWidget = function ( parseTreeNode, options ) {
	this.initialise( parseTreeNode, options );
};

EqNEditorWidget.prototype = new Widget();

EqNEditorWidget.prototype.render = function ( parent, nextSibling ) {
	var self = this;
	this.parentDomNode = parent;
	this.computeAttributes();
	this.execute();

	instanceCount++;
	var n = instanceCount;
	var ids = {
		root: "cc-eqn-tw-" + n,
		history: "cc-eqn-tw-history-" + n,
		toolbar: "cc-eqn-tw-toolbar-" + n,
		mathview: "cc-eqn-tw-mathview-" + n,
		latexInput: "cc-eqn-tw-latex-" + n,
		output: "cc-eqn-tw-output-" + n,
		toggleInline: "cc-eqn-tw-toggle-inline-" + n,
		toggleLatex: "cc-eqn-tw-toggle-latex-" + n,
		insertMode: "cc-eqn-tw-insert-mode-" + n
	};

	// .trim() because a config tiddler's text commonly carries a trailing newline (any .tid
	// file with a body written the ordinary way does) - left in, that newline lands inside the
	// script src/CSS href built below and inside the querySelector() dedupe check in
	// loadScriptOnce/loadCssOnce, breaking both silently for the URL and throwing for the
	// selector.
	var host = this.wiki.getTiddlerText( "$:/config/codecogs/eqneditor/Server", DEFAULT_SERVER ).trim();
	// A bare host means https; a full origin (e.g. http://localhost:8010 for local development) is used as it is.
	var origin = /^https?:\/\//.test( host ) ? host.replace( /\/+$/, "" ) : "https://" + host;
	var renderUrl = this.wiki.getTiddlerText( "$:/config/codecogs/eqneditor/RenderUrl", DEFAULT_RENDER_URL ).trim();
	var licence = this.wiki.getTiddlerText( "$:/config/codecogs/eqneditor/Licence", "" ).trim();
	// The look of the editor, as JSON - see the `design` option in the README.
	var design = {};
	try { design = JSON.parse( this.wiki.getTiddlerText( "$:/config/codecogs/eqneditor/Design", "{}" ) || "{}" ) || {}; } catch ( e ) { design = {}; }
	// Full-URL overrides, not just the host - the default assumes https, which a local dev
	// server (see other/tiddlywiki/test-wiki's config tiddlers) generally isn't.
	var scriptUrl = this.wiki.getTiddlerText( "$:/config/codecogs/eqneditor/ScriptUrl",
		origin + "/fxeditor.api.min.js" ).trim();
	var cssUrl = this.wiki.getTiddlerText( "$:/config/codecogs/eqneditor/CssUrl",
		origin + "/fxeditor.css" ).trim();

	var domNode = this.document.createElement( "div" );
	domNode.id = ids.root;
	domNode.className = "CCEqnEditor";
	domNode.setAttribute( "data-latex", "off" );
	domNode.setAttribute( "data-inline", "off" );
	domNode.innerHTML =
		'<div class="CCEditorBar"><div id="' + ids.history + '" class="CCHistory"></div></div>' +
		'<div id="' + ids.toolbar + '" class="CCToolbarHost"></div>' +
		'<div id="' + ids.mathview + '" class="CCMathViewHost"></div>' +
		'<div id="' + ids.latexInput + '" class="CCLatexInput" autocorrect="off" ' +
			'placeholder="Write LaTeX here..."></div>' +
		// Not shown: eqOutput needs an element to bind to, to build the SVG URL.
		'<img id="' + ids.output + '" class="CCEqnOutput-hidden" alt="">' +
		'<div class="cc-eqn-bar">' +
			switchHtml( ids.toggleInline, "Inline", "Left-align the equation instead of centring it" ) +
			switchHtml( ids.toggleLatex, "LaTeX markup", "Show or hide the LaTeX markup" ) +
			'<div class="cc-eqn-bar-right">' +
				'<select class="cc-eqn-select" id="' + ids.insertMode + '" title="How to insert the equation">' +
					'<option value="mathml" selected>Insert MathML</option>' +
					'<option value="svg">Insert SVG</option>' +
				'</select>' +
				'<button type="button" class="cc-eqn-btn cc-cancel">Cancel</button>' +
				'<button type="button" class="cc-eqn-btn cc-eqn-primary cc-ok" disabled>OK</button>' +
			'</div>' +
		'</div>';

	parent.insertBefore( domNode, nextSibling );
	this.domNodes.push( domNode );

	function closeDropdown() {
		var stateTitle = self.getVariable( "dropdown-state" );
		if ( stateTitle ) self.wiki.deleteTiddler( stateTitle );
	}

	domNode.querySelector( ".cc-cancel" ).addEventListener( "click", closeDropdown );

	loadCssOnce( cssUrl );

	var eqOutput = null, eqTextArea = null, eqMathView = null, eqToolbar = null;

	loadScriptOnce( scriptUrl ).then( function () { return ensureInit( licence ); } ).then( function () {
		injectStyleOverridesOnce( cssUrl.slice( 0, cssUrl.lastIndexOf( "/" ) + 1 ) + "prototypes/latinmodern-math.otf" );

		eqOutput = new window.EqEditor.Output( ids.output );
		eqOutput.setRenderURL( renderUrl );

		eqTextArea = window.EqEditor.TextArea.link( ids.latexInput )
			.addOutput( eqOutput )
			.addHistoryMenu( new window.EqEditor.History( ids.history ) );

		eqToolbar = window.EqEditor.Toolbar.link( ids.toolbar, design.toolbar || "default", design.toolbarScale || 1 ).addTextArea( eqTextArea );

		var latexToggle = domNode.querySelector( "#" + ids.toggleLatex );

		if ( typeof window.EqEditor.MathView !== "undefined" ) {
			eqMathView = window.EqEditor.MathView.link( ids.mathview ).addTextArea( eqTextArea );
			eqToolbar.addMathView( eqMathView );
		} else {
			// Without a maths view the markup is the only thing to edit in - force it visible
			// and lock the toggle so it cannot be switched to an empty pane.
			domNode.setAttribute( "data-latex", "on" );
			latexToggle.checked = true;
			latexToggle.disabled = true;
		}

		latexToggle.addEventListener( "change", function ( e ) {
			var visible = e.target.checked;
			domNode.setAttribute( "data-latex", visible ? "on" : "off" );
			// Hiding a pane moves the toolbar's target to the other one, so a button pressed
			// straight afterwards doesn't insert into something the author can't see.
			eqToolbar.setActiveTextArea( visible ? eqTextArea : ( eqMathView || eqTextArea ) );
		} );

		domNode.querySelector( "#" + ids.toggleInline ).addEventListener( "change", function ( e ) {
			var inline = e.target.checked;
			domNode.setAttribute( "data-inline", inline ? "on" : "off" );
			if ( eqMathView ) eqMathView.setInline( inline );
			eqOutput.setInline( inline );
		} );

		applyDesign( domNode, design, latexToggle, domNode.querySelector( "#" + ids.insertMode ) );

		var okBtn = domNode.querySelector( ".cc-ok" );
		okBtn.disabled = false;
		okBtn.addEventListener( "click", function () {
			var latex = eqTextArea.getTextArea().textContent.trim();
			if ( !latex ) return;

			var mode = domNode.querySelector( "#" + ids.insertMode ).value;
			// Wikitext attribute values are taken literally - no entity decoding - so they are
			// written raw rather than HTML-escaped: "&amp;" would reach latex.codecogs.com as-is.
			// referrerpolicy explicitly: latex.codecogs.com identifies the calling site by referer,
			// and a stricter page policy would otherwise send none.
			var text = mode === "svg"
				? '<img src="' + eqOutput.exportAs( "url" ) + '" alt=' + wikitextAttr( latex ) +
					' referrerpolicy="origin">'
				: mathmlForWikitext( eqOutput.exportAs( "mathml" ) );

			// The same message <$action-sendmessage $message="tm-edit-text-operation"
			// $param="insert-text" text="..."/> would send - inserting at the cursor (replacing
			// any selection) in whichever text editor widget is an ancestor of this one, exactly
			// like core/ui/EditorToolbar/picture-dropdown.tid's image-picker insert action.
			self.dispatchEvent( {
				type: "tm-edit-text-operation",
				param: "insert-text",
				paramObject: { text: text }
			} );

			eqTextArea.pushToHistory();
			closeDropdown();
		} );
	} ).catch( function ( err ) {
		domNode.textContent = err.message;
	} );

	this._eqTextArea = function () { return eqTextArea; };
};

EqNEditorWidget.prototype.execute = function () {
};

EqNEditorWidget.prototype.refresh = function ( changedTiddlers ) {
	return false;
};

EqNEditorWidget.prototype.destroy = function () {
	var ta = this._eqTextArea && this._eqTextArea();
	if ( ta ) ta.close();
};

exports.eqneditor = EqNEditorWidget;
