/*\
title: $:/plugins/codecogs/eqneditor/eqneditor-widget.js
type: application/javascript
module-type: widget

Renders the CodeCogs equation editor (maths view by default, LaTeX markup as a toggle) inside
the toolbar dropdown (see dropdown.tid/toolbar-button.tid) and, on Insert, dispatches a plain
tm-edit-text-operation - the same message <$action-sendmessage> would send - carrying the <img>
markup for the equation just built. Built as a widget rather than a plain wikitext dropdown (the
way most core toolbar buttons work, e.g. core/ui/EditorToolbar/picture-dropdown.tid) because the
CodeCogs UI is only ever the current state of a third-party script's live DOM, not something
TiddlyWiki's own reactive tiddler/transclusion model has any state for. Insert/Cancel are part of
this widget's own DOM instead of separate wikitext <$button>s so the click handler can read that
state - eqTextArea.getTextArea().textContent, eqOutput.exportAs('url') - synchronously, the same
way every other adapter in eqneditor-v5-plugins does it (see tinymce/v6/eqneditor.js), rather
than needing a bridge tiddler kept in sync by polling.

The shared EqEditor API (TextArea/Toolbar/Output/History/MathView) is loaded at runtime from
editor.codecogs.com, same host and API surface as every other adapter here - override with
$:/config/codecogs/eqneditor/Server (e.g. "localhost:8010" for local development against
eqneditor-v5-www) and $:/config/codecogs/eqneditor/RenderUrl.

\*/
"use strict";

var Widget = require( "$:/core/modules/widgets/widget.js" ).widget;

var DEFAULT_SERVER = "editor.codecogs.com";
var DEFAULT_RENDER_URL = "https://latex.codecogs.com";

// Remembers which view (maths or LaTeX markup) the author last chose, across dropdown opens and
// page loads - the same cookie name every other eqneditor-v5-plugins adapter uses, so the choice
// carries across editors too, not just across opens of this one.
var LATEX_COOKIE = "cc_eqneditor_show_latex";

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

function loadCssOnce( url ) {
	if ( document.querySelector( 'link[href="' + url + '"]' ) ) return;
	var link = document.createElement( "link" );
	link.rel = "stylesheet";
	link.href = url;
	document.head.appendChild( link );
}

function getShowLatexPreference( fallback ) {
	var match = document.cookie.match( /(?:^|; )cc_eqneditor_show_latex=([^;]*)/ );
	return match ? match[ 1 ] === "1" : fallback;
}

function setShowLatexPreference( visible ) {
	document.cookie = LATEX_COOKIE + "=" + ( visible ? "1" : "0" ) + "; path=/; max-age=31536000; SameSite=Lax";
}

// Roughly 50% taller than the shared eqneditor.css's own default for either view, so the maths
// view in particular reads as the main event rather than a strip above the toolbar.
function injectSizeOverrideOnce() {
	if ( document.getElementById( "cc-eqneditor-size-override" ) ) return;
	var style = document.createElement( "style" );
	style.id = "cc-eqneditor-size-override";
	style.textContent = ".CCMathViewHost, .CCLatexInput { min-height: 220px !important; }";
	document.head.appendChild( style );
}

function escapeHtml( s ) {
	return String( s )
		.replace( /&/g, "&amp;" ).replace( /</g, "&lt;" )
		.replace( />/g, "&gt;" ).replace( /"/g, "&quot;" );
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
		preview: "cc-eqn-tw-preview-" + n,
		output: "cc-eqn-tw-output-" + n,
		toggle: "cc-eqn-tw-toggle-" + n
	};

	// .trim() because a config tiddler's text commonly carries a trailing newline (any .tid
	// file with a body written the ordinary way does) - left in, that newline lands inside the
	// script src/CSS href built below and inside the querySelector() dedupe check in
	// loadScriptOnce/loadCssOnce, breaking both silently for the URL and throwing for the
	// selector.
	var host = this.wiki.getTiddlerText( "$:/config/codecogs/eqneditor/Server", DEFAULT_SERVER ).trim();
	var renderUrl = this.wiki.getTiddlerText( "$:/config/codecogs/eqneditor/RenderUrl", DEFAULT_RENDER_URL ).trim();
	// Full-URL overrides, not just the host - the default assumes https, which a local dev
	// server (see other/tiddlywiki/test-wiki's config tiddlers) generally isn't. Same pair of
	// options every other adapter in eqneditor-v5-plugins exposes (eqneditor_script_url/
	// eqneditor_css_url).
	var scriptUrl = this.wiki.getTiddlerText( "$:/config/codecogs/eqneditor/ScriptUrl",
		"https://" + host + "/eqneditor.api.min.js" ).trim();
	var cssUrl = this.wiki.getTiddlerText( "$:/config/codecogs/eqneditor/CssUrl",
		"https://" + host + "/eqneditor.css" ).trim();
	var showLatex = getShowLatexPreference( false );

	var domNode = this.document.createElement( "div" );
	domNode.id = ids.root;
	domNode.className = "CCEqnEditor";
	domNode.setAttribute( "data-latex", showLatex ? "on" : "off" );
	domNode.innerHTML =
		'<div class="CCEditorBar"><div id="' + ids.history + '" class="CCHistory"></div></div>' +
		'<div id="' + ids.toolbar + '"></div>' +
		'<div id="' + ids.latexInput + '" class="CCLatexInput" autocorrect="off" ' +
			'placeholder="Write LaTeX here..."></div>' +
		'<div id="' + ids.mathview + '" class="CCMathViewHost"></div>' +
		'<div id="' + ids.toggle + '" class="CCViewToggle">' +
			'<label class="cc-switch" title="Show or hide the LaTeX markup above the equation">' +
				'<input type="checkbox" data-latex-toggle' + ( showLatex ? " checked" : "" ) + '>' +
				'<span class="cc-switch-track"><span class="cc-switch-knob"></span></span>' +
				'<span class="cc-switch-label">LaTeX markup</span>' +
			'</label>' +
		'</div>' +
		'<div id="' + ids.preview + '" class="CCEqnOutput"><img id="' + ids.output + '" alt=""></div>' +
		'<div class="cc-eqneditor-actions">' +
			'<button type="button" class="cc-eqneditor-cancel">Cancel</button>' +
			'<button type="button" class="cc-eqneditor-insert" disabled>Insert</button>' +
		'</div>';

	parent.insertBefore( domNode, nextSibling );
	this.domNodes.push( domNode );

	function closeDropdown() {
		var stateTitle = self.getVariable( "dropdown-state" );
		if ( stateTitle ) self.wiki.deleteTiddler( stateTitle );
	}

	domNode.querySelector( ".cc-eqneditor-cancel" ).addEventListener( "click", closeDropdown );

	loadCssOnce( cssUrl );

	var eqOutput = null, eqTextArea = null, eqMathView = null, eqToolbar = null;

	function applyLatexVisible( visible ) {
		showLatex = visible;
		setShowLatexPreference( visible );

		domNode.setAttribute( "data-latex", visible ? "on" : "off" );

		var box = domNode.querySelector( "#" + ids.toggle + " input[data-latex-toggle]" );
		if ( box ) box.checked = visible;

		if ( eqToolbar && !visible ) eqToolbar.setActiveTextArea( eqMathView || eqTextArea );
	}

	loadScriptOnce( scriptUrl ).then( function () {
		injectSizeOverrideOnce();

		eqOutput = new window.EqEditor.Output( ids.output );
		eqOutput.setRenderURL( renderUrl );

		eqTextArea = window.EqEditor.TextArea.link( ids.latexInput )
			.addOutput( eqOutput )
			.addHistoryMenu( new window.EqEditor.History( ids.history ) );

		eqToolbar = window.EqEditor.Toolbar.link( ids.toolbar, 'default', 1.4 ).addTextArea( eqTextArea );

		if ( typeof window.EqEditor.MathView !== "undefined" ) {
			eqMathView = window.EqEditor.MathView.link( ids.mathview ).addTextArea( eqTextArea );
			eqToolbar.addMathView( eqMathView );
		} else {
			showLatex = true;
		}

		applyLatexVisible( showLatex );

		var toggle = domNode.querySelector( "#" + ids.toggle );
		toggle.addEventListener( "change", function ( e ) {
			if ( e.target.matches( "input[data-latex-toggle]" ) ) applyLatexVisible( e.target.checked );
		} );

		var insertBtn = domNode.querySelector( ".cc-eqneditor-insert" );
		insertBtn.disabled = false;
		insertBtn.addEventListener( "click", function () {
			var latex = eqTextArea.getTextArea().textContent.trim();
			if ( !latex ) return;

			var html = '<img src="' + escapeHtml( eqOutput.exportAs( "url" ) ) + '" alt="' +
				escapeHtml( latex ) + '">';

			// The same message <$action-sendmessage $message="tm-edit-text-operation"
			// $param="insert-text" text="..."/> would send - inserting at the cursor (replacing
			// any selection) in whichever text editor widget is an ancestor of this one, exactly
			// like core/ui/EditorToolbar/picture-dropdown.tid's image-picker insert action.
			self.dispatchEvent( {
				type: "tm-edit-text-operation",
				param: "insert-text",
				paramObject: { text: html }
			} );

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
