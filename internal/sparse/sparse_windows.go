//go:build windows

// Package sparse marks files as NTFS sparse before the torrent client writes
// pieces into them. Without this the OS allocates (and zero-fills the
// metadata for) every byte between piece writes — so a partially downloaded
// 24 GB movie reserves the full 24 GB on disk even when only 100 MB has
// actually arrived. Marking sparse leaves the holes unallocated; the disk
// usage tracks the downloaded fraction.
//
// On non-Windows targets MarkSparse is a no-op: ext4/APFS already keep
// holes unallocated by default when you write at random offsets.
package sparse

import (
	"os"
	"path/filepath"
	"syscall"
)

// FSCTL_SET_SPARSE — Windows ioctl that flips the NTFS sparse bit on a
// file. Defined in winioctl.h; not exported by the syscall package, so we
// hard-code the value here.
const fsctlSetSparse uint32 = 0x000900C4

// MarkSparse creates the file (and any missing parent directories) if it
// doesn't exist, then issues FSCTL_SET_SPARSE. Best-effort by design:
//   - non-NTFS volumes (FAT32/exFAT, network shares) reject the ioctl —
//     we return that error so the caller can log it once
//   - existing data in the file is preserved; sparse only affects future
//     writes that land in unwritten regions
//
// The file is opened O_RDWR|O_CREATE without truncate so that calling this
// on a torrent that's already partially downloaded is safe — pieces stay
// where they are and only the holes ahead become true sparse holes.
func MarkSparse(path string) error {
	if err := os.MkdirAll(filepath.Dir(path), 0o755); err != nil {
		return err
	}
	f, err := os.OpenFile(path, os.O_RDWR|os.O_CREATE, 0o644)
	if err != nil {
		return err
	}
	defer f.Close()
	var bytesReturned uint32
	return syscall.DeviceIoControl(
		syscall.Handle(f.Fd()),
		fsctlSetSparse,
		nil, 0, // no input buffer
		nil, 0, // no output buffer
		&bytesReturned,
		nil, // not async
	)
}
