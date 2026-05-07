// Package folderpicker spawns a native OS folder-chooser dialog and returns
// the user's selection as a path string. The web UI calls this through an
// HTTP endpoint so the user gets a real OS picker (with mounted-drive,
// network-share, and "create new folder" support) instead of typing a path.
//
// The browser does have window.showDirectoryPicker, but it returns an opaque
// FileSystemDirectoryHandle, not a filesystem path — useless to a Go server
// that needs to pass the path to a torrent client.
package folderpicker

import (
	"context"
	"errors"
	"fmt"
	"os/exec"
	"runtime"
	"strings"
)

// ErrCancelled is returned when the user closed the dialog without picking
// a folder. Callers should treat this as a no-op, not an error to surface.
var ErrCancelled = errors.New("folderpicker: user cancelled")

// ErrUnsupported is returned on platforms where we don't have a picker
// implementation (anything other than windows/darwin today).
var ErrUnsupported = errors.New("folderpicker: not supported on this OS")

// Pick opens a native folder dialog with the given title and returns the
// absolute path the user chose. If the user cancelled, ErrCancelled is
// returned. Any other failure (PowerShell missing, osascript missing,
// dialog crashed) is wrapped and returned.
//
// Implementation notes:
//   - Windows: PowerShell + System.Windows.Forms.FolderBrowserDialog. The
//     STA apartment is required for WinForms — `-Sta` enforces it.
//   - macOS: osascript + `choose folder`. We catch the user-cancelled
//     `error number -128` and turn it into ErrCancelled.
//   - Linux: not implemented (zenity/kdialog availability is too variable
//     to rely on for v1; user types the path manually).
func Pick(ctx context.Context, title string) (string, error) {
	switch runtime.GOOS {
	case "windows":
		return pickWindows(ctx, title)
	case "darwin":
		return pickDarwin(ctx, title)
	default:
		return "", ErrUnsupported
	}
}

func pickWindows(ctx context.Context, title string) (string, error) {
	// PowerShell embedded script. Runs in STA so WinForms is happy. We
	// echo the selected path on stdout (or nothing if the dialog was
	// cancelled), and return exit code 0 either way — distinguishing
	// cancel-vs-pick by stdout being empty.
	script := fmt.Sprintf(`Add-Type -AssemblyName System.Windows.Forms | Out-Null
$f = New-Object System.Windows.Forms.FolderBrowserDialog
$f.Description = %q
$f.ShowNewFolderButton = $true
$f.UseDescriptionForTitle = $true
if ($f.ShowDialog() -eq [System.Windows.Forms.DialogResult]::OK) { Write-Output $f.SelectedPath }`, title)
	cmd := exec.CommandContext(ctx, "powershell", "-NoProfile", "-NonInteractive", "-Sta", "-Command", script)
	out, err := cmd.Output()
	if err != nil {
		return "", fmt.Errorf("folderpicker: powershell: %w", err)
	}
	picked := strings.TrimSpace(string(out))
	if picked == "" {
		return "", ErrCancelled
	}
	return picked, nil
}

func pickDarwin(ctx context.Context, title string) (string, error) {
	// `choose folder` returns an alias; coerce to POSIX path string so we
	// get something Go's filepath understands. On user cancel, osascript
	// exits with code 1 and stderr "User canceled. (-128)".
	script := fmt.Sprintf(`POSIX path of (choose folder with prompt %q)`, title)
	cmd := exec.CommandContext(ctx, "osascript", "-e", script)
	out, err := cmd.Output()
	if err != nil {
		var exitErr *exec.ExitError
		if errors.As(err, &exitErr) && strings.Contains(string(exitErr.Stderr), "-128") {
			return "", ErrCancelled
		}
		return "", fmt.Errorf("folderpicker: osascript: %w", err)
	}
	picked := strings.TrimSpace(string(out))
	if picked == "" {
		return "", ErrCancelled
	}
	return picked, nil
}

// Available reports whether the current OS has a working picker. Used by the
// frontend to hide the "Browse..." button on platforms where typing is the
// only option.
func Available() bool {
	return runtime.GOOS == "windows" || runtime.GOOS == "darwin"
}
