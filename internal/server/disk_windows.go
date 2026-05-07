//go:build windows

package server

import (
	"syscall"
	"unsafe"
)

// diskUsage reports free and total bytes for the volume hosting `path`.
// On any Windows API failure, returns zeros + the error — the caller
// (settings handler) treats unknown free/total as "don't show", so a
// failure here just degrades the UI gracefully.
func diskUsage(path string) (free, total uint64, err error) {
	if path == "" {
		return 0, 0, nil
	}
	kernel32 := syscall.NewLazyDLL("kernel32.dll")
	getDiskFreeSpaceEx := kernel32.NewProc("GetDiskFreeSpaceExW")

	pathPtr, err := syscall.UTF16PtrFromString(path)
	if err != nil {
		return 0, 0, err
	}
	var freeBytesAvailable, totalBytes, totalFreeBytes uint64
	r1, _, callErr := getDiskFreeSpaceEx.Call(
		uintptr(unsafe.Pointer(pathPtr)),
		uintptr(unsafe.Pointer(&freeBytesAvailable)),
		uintptr(unsafe.Pointer(&totalBytes)),
		uintptr(unsafe.Pointer(&totalFreeBytes)),
	)
	if r1 == 0 {
		// callErr is always non-nil on a Windows syscall failure.
		return 0, 0, callErr
	}
	return freeBytesAvailable, totalBytes, nil
}
