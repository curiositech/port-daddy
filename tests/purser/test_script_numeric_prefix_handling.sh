#!/bin/bash
set -e

test_numeric_prefix_handling() {
  local test_dir=$(mktemp -d)
  local port_file="$test_dir/.port-daddy/daemon.port"
  
  mkdir -p "$(dirname "$port_file")"
  
  # Test valid numeric prefix
  echo "3174" > "$port_file"
  result=$(resolve_daemon_url "$test_dir")
  [ "$result" = "http://127.0.0.1:3174" ] || { echo "Failed for valid numeric prefix"; exit 1; }
  
  # Test numeric prefix with trailing text (should be rejected)
  echo "3174abc" > "$port_file"
  if resolve_daemon_url "$test_dir"; then
    echo "Failed to reject numeric prefix with trailing text";
    exit 1
  fi
  
  # Test non-numeric input
  echo "abc" > "$port_file"
  if resolve_daemon_url "$test_dir"; then
    echo "Failed to reject non-numeric input";
    exit 1
  fi
  
  # Test empty file
  echo "" > "$port_file"
  if resolve_daemon_url "$test_dir"; then
    echo "Failed to reject empty file";
    exit 1
  fi
  
  # Test file with leading whitespace
  echo "  3174  " > "$port_file"
  result=$(resolve_daemon_url "$test_dir")
  [ "$result" = "http://127.0.0.1:3174" ] || { echo "Failed for leading whitespace"; exit 1; }
}

test_numeric_prefix_handling
