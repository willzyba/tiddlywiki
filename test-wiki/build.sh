#!/usr/bin/env bash
# Builds this wiki with the CodeCogs plugin (../plugin) installed, for local testing, and
# separately exports the plugin itself as a single JSON tiddler that can be installed into any
# other TiddlyWiki 5 by dragging it onto the wiki in a browser (TW5's own import flow - no
# server or CLI needed on the receiving end).
#
# plugins/ isn't committed (see ../.gitignore) - TiddlyWiki's plugin loader only finds a local,
# unpublished plugin like this one via TIDDLYWIKI_PLUGIN_PATH pointing at a directory laid out as
# <publisher>/<name>/plugin.info, so this copies ../plugin into that shape fresh each run rather
# than keeping a second, driftable copy in git.
set -euo pipefail
cd "$(dirname "$0")"

rm -rf plugins/codecogs/eqneditor
mkdir -p plugins/codecogs
cp -R ../plugin plugins/codecogs/eqneditor

TIDDLYWIKI_PLUGIN_PATH="$(pwd)/plugins" npx --yes tiddlywiki@5.4.1 . --build index --build plugin

# The wiki in fxplugins.codecogs.com's TiddlyWiki downloads: the same plugin, with placeholders
# for the visitor's licence, design and starting tiddler - see ../bundle-wiki/README.md.
TIDDLYWIKI_PLUGIN_PATH="$(pwd)/plugins" npx --yes tiddlywiki@5.4.1 ../bundle-wiki --build index

echo ""
echo "Built output/index.html - open it, edit (or create) a tiddler, and use the Equation"
echo "button in the editor toolbar."
echo "Built output/codecogs-eqneditor.json - drag this onto any other TiddlyWiki 5 to install"
echo "the plugin there."
