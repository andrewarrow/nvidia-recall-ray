#!/bin/sh
set -u

cd "$(dirname "$0")" || exit 1

if [ ! -f .env ]; then
    cp .env.example .env || exit 1
fi

if [ -z "${API_KEY:-}" ] && grep -q '^API_KEY=your_nebius_token_factory_key$' .env; then
    if [ -t 0 ]; then
        if ! stty -echo; then
            printf '\nCould not hide terminal input. Add API_KEY to .env and start RecallRay again.\n'
            read -r _ || true
            exit 1
        fi
        trap 'stty echo' HUP INT TERM
        printf 'Nebius Token Factory API key (input hidden): '
        IFS= read -r API_KEY
        read_status=$?
        stty echo
        trap - HUP INT TERM
        printf '\n'
        if [ "$read_status" -ne 0 ] || [ -z "$API_KEY" ]; then
            printf 'An API key is required. Add it to .env and start RecallRay again.\n'
            printf 'Press Return to close... '
            read -r _ || true
            exit 1
        fi
        export API_KEY
    else
        printf 'Set API_KEY in .env before starting RecallRay.\n'
        exit 1
    fi
fi

if [ -z "${API_KEY:-}" ] && grep -q '^API_KEY=your_nebius_token_factory_key$' .env; then
    printf 'Set API_KEY in .env before starting RecallRay.\n'
    exit 1
fi

./recallray "$@"
status=$?
if [ "$status" -ne 0 ]; then
    printf '\nRecallRay stopped with an error (exit %s).\n' "$status"
    if [ -t 0 ]; then
        printf 'Press Return to close... '
        read -r _ || true
    fi
fi
exit "$status"
