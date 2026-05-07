//go:build !windows

package server

import "syscall"

// diskUsage reports free and total bytes for the filesystem hosting `path`.
// Uses statfs (Linux/macOS/BSD); on failure returns zeros + the error.
func diskUsage(path string) (free, total uint64, err error) {
	if path == "" {
		return 0, 0, nil
	}
	var st syscall.Statfs_t
	if err := syscall.Statfs(path, &st); err != nil {
		return 0, 0, err
	}
	// Bavail = blocks available to unprivileged users (matches what `df`
	// shows in its "Available" column). Multiply by Bsize for bytes.
	free = uint64(st.Bavail) * uint64(st.Bsize)
	total = uint64(st.Blocks) * uint64(st.Bsize)
	return free, total, nil
}
