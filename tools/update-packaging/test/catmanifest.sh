#!/bin/bash
# helper tool for testing.  Cats the manifest out of a mar file

mar="$1"
workdir="/tmp/catmanifest"

rm -rf "$workdir"
mkdir -p "$workdir"
cp "$1" "$workdir"
cd "$workdir"
mar -x "$1"
cat updatev2.manifest
