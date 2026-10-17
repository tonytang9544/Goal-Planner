
#!/usr/bin/env bash

cd ~/Downloads/

# enables job control in Bash
set -m

./jira-tv-server &
server_pid=$!

cd Goal-Planner/frontend

npm run preview -- --host 0.0.0.0 &
preview_pid=$!

cleanup() {
    echo "Stopping services..."
    kill "$server_pid" "$preview_pid" 2>/dev/null
    wait
}

trap cleanup SIGINT SIGTERM EXIT

wait -n "$server_pid" "$preview_pid"