#!/bin/sh
# Local demonstration: unit tests plus a mock GitHub API and local feed.
# No network calls to GitHub or to the live patch-cloud registry.
set -e
cd "$(dirname "$0")/.."
node test/action.test.mjs
