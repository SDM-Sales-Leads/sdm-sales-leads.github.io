#!/bin/bash
# Run once. Asks for the Supabase access token (typing is hidden) and keeps it in a private file on this Mac only.
set -e
printf "Paste the Supabase access token (starts with sbp_), then press Enter: "
read -rs T; echo
case "$T" in sbp_*) ;; *) echo "That does not look like a Supabase access token (it starts with sbp_). Nothing saved."; exit 1;; esac
umask 077
printf "%s" "$T" > "$HOME/.sdm-supabase-token"
chmod 600 "$HOME/.sdm-supabase-token"
echo "Saved to ~/.sdm-supabase-token (only you can read it). You can close this window."
