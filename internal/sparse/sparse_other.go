//go:build !windows

package sparse

// MarkSparse is a no-op on non-Windows targets. ext4 / APFS / btrfs all
// keep holes unallocated by default when you write at offsets past EOF,
// so there's nothing to flip — the file is sparse the moment it exists.
func MarkSparse(path string) error { return nil }
