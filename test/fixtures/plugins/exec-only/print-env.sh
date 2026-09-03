#!/bin/sh
# Fixture: prints the AIMUX_* variables the exec adapter injects, one per line.
env | grep '^AIMUX_' | sort
