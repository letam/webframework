#!/usr/bin/env bash

# Launch app
yes n | fly launch --vm-memory 512 --now --copy-config
