// Package setup probes the host machine for the external tools ZubraCinema
// relies on (ffmpeg for in-browser remux; mpv/vlc as external players) and
// drives one-click installation through the OS package manager (winget on
// Windows, Homebrew on macOS, apt/dnf on Linux).
//
// The detection runs lazily on demand — process restarts pick up newly
// installed tools without baking the result into long-lived state. Install
// is a streaming operation: callers get line-buffered combined stdout/stderr
// so they can render a live install log to the user.
package setup

import (
	"bufio"
	"context"
	"errors"
	"fmt"
	"io"
	"os"
	"os/exec"
	"path/filepath"
	"runtime"
	"strings"
	"sync"
)

// Tool describes one external dependency: whether it's installed, where it
// lives on disk, and whether the app actually NEEDS it (vs. recommends it).
type Tool struct {
	Name      string `json:"name"`
	Installed bool   `json:"installed"`
	Path      string `json:"path,omitempty"`
	Required  bool   `json:"required"`
}

// Capabilities is the wire shape returned from /api/capabilities. It tells
// the frontend which tools are present and which package manager (if any)
// can drive a one-click install.
type Capabilities struct {
	Tools          []Tool `json:"tools"`
	PackageManager string `json:"packageManager"`
	OS             string `json:"os"`
}

// Errors surfaced by Install. Any other error returned is the underlying
// package manager exit error and should be shown verbatim to the user.
var (
	ErrUnknownTool      = errors.New("unknown tool")
	ErrNoPackageManager = errors.New("no package manager detected")
)

// toolSpec captures everything we need to know about a single tool: the
// binary name to look up in PATH, whether the app insists on it, and the
// per-package-manager install command + args. Keeping this in one table
// means adding a new tool is a single edit.
type toolSpec struct {
	name     string
	binary   string
	required bool
	// Install args per package manager. Maps "winget" -> ["install", "-e", "--id", "Gyan.FFmpeg"], etc.
	install map[string][]string
	// Optional: alternate binary names to try in PATH (e.g. "mpv.com" on Windows).
	altBinaries []string
	// Optional: per-OS fallback path templates probed when LookPath fails.
	// Templates use os.ExpandEnv ("${ProgramFiles}/...") and may include a
	// glob-friendly suffix that's resolved via filepath.Glob — needed for
	// winget's versioned package dirs. Keyed by runtime.GOOS.
	fallbackPaths map[string][]string
}

// knownTools is the canonical list. Order matters for UX (banner shows tools
// in this order), so keep ffmpeg first.
var knownTools = []toolSpec{
	{
		name:     "ffmpeg",
		binary:   "ffmpeg",
		required: true,
		install: map[string][]string{
			"winget": {"install", "-e", "--id", "Gyan.FFmpeg"},
			"brew":   {"install", "ffmpeg"},
			"apt":    {"install", "-y", "ffmpeg"},
			"dnf":    {"install", "-y", "ffmpeg"},
		},
		fallbackPaths: map[string][]string{
			"windows": {
				"${LOCALAPPDATA}/Microsoft/WinGet/Links/ffmpeg.exe",
				"${LOCALAPPDATA}/Microsoft/WinGet/Packages/Gyan.FFmpeg_*/*/bin/ffmpeg.exe",
			},
			"darwin": {
				"/opt/homebrew/bin/ffmpeg",
				"/usr/local/bin/ffmpeg",
			},
		},
	},
	{
		name:     "mpv",
		binary:   "mpv",
		required: false,
		// `winget install mpv.net` ships the binary as mpvnet.exe — different
		// name from upstream mpv. macOS Homebrew cask installs `mpv` under
		// /Applications/mpv.app/Contents/MacOS/mpv, but it also drops a `mpv`
		// symlink in /usr/local/bin so PATH lookup is fine there.
		altBinaries: []string{"mpvnet"},
		install: map[string][]string{
			"winget": {"install", "-e", "--id", "mpv.net"},
			"brew":   {"install", "--cask", "mpv"},
			"apt":    {"install", "-y", "mpv"},
			"dnf":    {"install", "-y", "mpv"},
		},
		// PATH fallbacks for the case where winget extended PATH after we
		// were launched (the running process's env is frozen at startup, so
		// LookPath can't see it). Wildcards are expanded via filepath.Glob.
		fallbackPaths: map[string][]string{
			"windows": {
				// `winget install mpv.net` drops the binary here for
				// per-user installs (the default for non-admin invocations).
				"${LOCALAPPDATA}/Programs/mpv.net/mpvnet.exe",
				"${ProgramFiles}/mpv.net/mpvnet.exe",
				"${LOCALAPPDATA}/Microsoft/WinGet/Links/mpvnet.exe",
				"${LOCALAPPDATA}/Microsoft/WinGet/Packages/mpv.net_*/mpvnet.exe",
			},
			"darwin": {
				"/Applications/mpv.app/Contents/MacOS/mpv",
				"/opt/homebrew/bin/mpv",
				"/usr/local/bin/mpv",
			},
		},
	},
	{
		name:     "vlc",
		binary:   "vlc",
		required: false,
		install: map[string][]string{
			"winget": {"install", "-e", "--id", "VideoLAN.VLC"},
			"brew":   {"install", "--cask", "vlc"},
			"apt":    {"install", "-y", "vlc"},
			"dnf":    {"install", "-y", "vlc"},
		},
		fallbackPaths: map[string][]string{
			"windows": {
				"${ProgramFiles}/VideoLAN/VLC/vlc.exe",
				"${ProgramFiles(x86)}/VideoLAN/VLC/vlc.exe",
				"${LOCALAPPDATA}/Microsoft/WinGet/Links/vlc.exe",
			},
			"darwin": {
				"/Applications/VLC.app/Contents/MacOS/VLC",
			},
		},
	},
}

// findTool returns the spec for `name` from the registry, or nil if unknown.
func findTool(name string) *toolSpec {
	for i := range knownTools {
		if knownTools[i].name == name {
			return &knownTools[i]
		}
	}
	return nil
}

// detectTool probes PATH for the tool's binary (and any alternates), then
// falls back to per-OS template paths from spec.fallbackPaths. The fallback
// matters when the user installs a tool AFTER ZubraCinema started — the
// running process's PATH is frozen at launch, so winget/brew updating the
// system PATH doesn't reach LookPath. Probing known install dirs directly
// closes that gap and lets the SetupBanner clear without forcing a binary
// restart.
func detectTool(spec toolSpec) Tool {
	candidates := append([]string{spec.binary}, spec.altBinaries...)
	for _, b := range candidates {
		if p, err := exec.LookPath(b); err == nil {
			return Tool{Name: spec.name, Installed: true, Path: p, Required: spec.required}
		}
	}
	for _, tmpl := range spec.fallbackPaths[runtime.GOOS] {
		if p := resolveFallback(tmpl); p != "" {
			return Tool{Name: spec.name, Installed: true, Path: p, Required: spec.required}
		}
	}
	return Tool{Name: spec.name, Installed: false, Required: spec.required}
}

// resolveFallback expands env vars in tmpl and, if the result contains a
// glob meta-character, returns the first match. Returns "" if nothing is
// found or the file isn't actually present. We also reject directories so
// a stray empty package folder doesn't pass for an executable.
func resolveFallback(tmpl string) string {
	expanded := os.ExpandEnv(tmpl)
	if expanded == "" {
		return ""
	}
	candidates := []string{expanded}
	if strings.ContainsAny(expanded, "*?[") {
		matches, err := filepath.Glob(expanded)
		if err != nil || len(matches) == 0 {
			return ""
		}
		candidates = matches
	}
	for _, c := range candidates {
		info, err := os.Stat(c)
		if err == nil && !info.IsDir() {
			return c
		}
	}
	return ""
}

// detectPackageManager picks the best PM for this host. Order is intentional:
// Windows always uses winget (no other realistic choice); macOS only ships
// with brew if the user installed it (check first); Linux prefers apt over
// dnf because Debian/Ubuntu cover the bulk of desktop users.
func detectPackageManager() string {
	switch runtime.GOOS {
	case "windows":
		if _, err := exec.LookPath("winget"); err == nil {
			return "winget"
		}
	case "darwin":
		if _, err := exec.LookPath("brew"); err == nil {
			return "brew"
		}
	case "linux":
		if _, err := exec.LookPath("apt-get"); err == nil {
			return "apt"
		}
		if _, err := exec.LookPath("dnf"); err == nil {
			return "dnf"
		}
	}
	return ""
}

// Detect runs the full probe: every known tool plus the package manager.
// Cheap (a handful of LookPath calls) so callers can re-invoke after an
// install completes to refresh the UI.
func Detect() Capabilities {
	tools := make([]Tool, 0, len(knownTools))
	for _, spec := range knownTools {
		tools = append(tools, detectTool(spec))
	}
	return Capabilities{
		Tools:          tools,
		PackageManager: detectPackageManager(),
		OS:             runtime.GOOS,
	}
}

// pmCommand returns the executable name for a package manager. apt uses
// `apt-get` (the scriptable, non-interactive variant — `apt` itself prints
// a "do not use in scripts" warning).
func pmCommand(pm string) string {
	switch pm {
	case "winget":
		return "winget"
	case "brew":
		return "brew"
	case "apt":
		return "apt-get"
	case "dnf":
		return "dnf"
	}
	return ""
}

// CommandFor returns the human-readable install command for `tool` on the
// detected package manager. Used by the frontend's "copy command" fallback
// when auto-install isn't possible (no PM, or apt needing sudo). Returns ""
// when there is nothing to suggest.
func CommandFor(tool string) string {
	spec := findTool(tool)
	if spec == nil {
		return ""
	}
	pm := detectPackageManager()
	if pm == "" {
		// No PM — fall back to a sensible per-OS suggestion so the user has
		// SOMETHING to copy. Pick the most common tool for the platform.
		switch runtime.GOOS {
		case "windows":
			return commandStringFor(spec, "winget")
		case "darwin":
			return commandStringFor(spec, "brew")
		case "linux":
			// Prefer apt because the debian-family share is huge.
			return "sudo " + commandStringFor(spec, "apt")
		}
		return ""
	}
	cmd := commandStringFor(spec, pm)
	if pm == "apt" || pm == "dnf" {
		// These need root; surface that in the copy-command UX.
		return "sudo " + cmd
	}
	return cmd
}

func commandStringFor(spec *toolSpec, pm string) string {
	args, ok := spec.install[pm]
	if !ok {
		return ""
	}
	return pmCommand(pm) + " " + strings.Join(args, " ")
}

// Install runs the package-manager command for `tool`, streaming combined
// stdout+stderr line-by-line into w. The provided context is forwarded to
// exec.CommandContext, so cancelling it kills the underlying process tree
// (or at least its top-level child — Windows job objects aren't wired in
// here; for our use the user can wait or close the app).
//
// On Linux we DO NOT wrap the apt-get invocation in `sudo` because that
// would prompt for a password the frontend can't satisfy. Instead, when
// the unprivileged invocation fails with a permissions error, the frontend
// falls back to its "copy command" UX (which surfaces the sudo-prefixed
// command for the user to run manually).
//
// Returns nil on success, ErrUnknownTool if the tool is not in the registry,
// ErrNoPackageManager if no PM is available, or the underlying command's
// exit error otherwise.
func Install(ctx context.Context, tool string, w io.Writer) error {
	spec := findTool(tool)
	if spec == nil {
		return ErrUnknownTool
	}
	pm := detectPackageManager()
	if pm == "" {
		return ErrNoPackageManager
	}
	args, ok := spec.install[pm]
	if !ok {
		return fmt.Errorf("no install recipe for %s on %s", tool, pm)
	}
	cmdName := pmCommand(pm)

	// Tee stdout and stderr into one line-buffered stream for w. Combining
	// at the scanner level (not via Stderr = Stdout) keeps each pipe's
	// scanner-end semantics clean and avoids a deadlock on Windows where
	// the buffer would fill before we read.
	cmd := exec.CommandContext(ctx, cmdName, args...)

	stdout, err := cmd.StdoutPipe()
	if err != nil {
		return fmt.Errorf("stdout pipe: %w", err)
	}
	stderr, err := cmd.StderrPipe()
	if err != nil {
		return fmt.Errorf("stderr pipe: %w", err)
	}

	// Echo the command itself so the user sees what's running. Helpful
	// debugging signal in the install log when something goes wrong.
	fmt.Fprintf(w, "$ %s %s\n", cmdName, strings.Join(args, " "))

	if err := cmd.Start(); err != nil {
		return fmt.Errorf("start %s: %w", cmdName, err)
	}

	var (
		mu sync.Mutex // serialises writes to w from both scanner goroutines
		wg sync.WaitGroup
	)
	wg.Add(2)
	go scanLines(stdout, w, &mu, &wg)
	go scanLines(stderr, w, &mu, &wg)
	wg.Wait()

	return cmd.Wait()
}

// scanLines reads `r` line-by-line and forwards each line + newline to `w`,
// holding `mu` so the two scanner goroutines don't interleave bytes mid-line.
func scanLines(r io.Reader, w io.Writer, mu *sync.Mutex, wg *sync.WaitGroup) {
	defer wg.Done()
	sc := bufio.NewScanner(r)
	// Some package managers (winget) can emit very long status lines for
	// progress bars. Bump the buffer ceiling so we don't bail on them.
	sc.Buffer(make([]byte, 64*1024), 1024*1024)
	for sc.Scan() {
		line := sc.Text()
		mu.Lock()
		fmt.Fprintln(w, line)
		mu.Unlock()
	}
}

// Manager is the dependency-injectable handle for the setup subsystem.
// Today it's a thin facade over the package-level functions, but threading
// it through Deps means future state (e.g. caching the last Detect result,
// or holding a single-flight install lock) can be added without touching
// every call site.
type Manager struct{}

// NewManager returns a fresh Manager. Cheap; safe to call from main.
func NewManager() *Manager { return &Manager{} }

// Detect proxies to the package-level Detect.
func (m *Manager) Detect() Capabilities { return Detect() }

// Install proxies to the package-level Install.
func (m *Manager) Install(ctx context.Context, tool string, w io.Writer) error {
	return Install(ctx, tool, w)
}

// CommandFor proxies to the package-level CommandFor.
func (m *Manager) CommandFor(tool string) string { return CommandFor(tool) }
