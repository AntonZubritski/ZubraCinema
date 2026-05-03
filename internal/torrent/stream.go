package torrent

import (
	"fmt"
	"mime"
	"net/http"
	"path/filepath"

	atorrent "github.com/anacrolix/torrent"
)

func StreamHandler(m *Manager) http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		id := r.PathValue("id")
		fileIdxStr := r.PathValue("fileIdx")
		item, ok := m.Get(id)
		if !ok {
			http.NotFound(w, r)
			return
		}
		var fileIdx int
		if _, err := fmt.Sscanf(fileIdxStr, "%d", &fileIdx); err != nil {
			http.Error(w, "bad fileIdx", http.StatusBadRequest)
			return
		}
		files := item.T.Files()
		if fileIdx < 0 || fileIdx >= len(files) {
			http.NotFound(w, r)
			return
		}
		f := files[fileIdx]

		// Focus the swarm on the file we're actually streaming. Other files in
		// the same torrent get de-prioritized so peer slots are spent on pieces
		// we need now. This rebinds whenever a different file is opened.
		for i, other := range files {
			if i == fileIdx {
				continue
			}
			other.SetPriority(atorrent.PiecePriorityNone)
		}
		f.SetPriority(atorrent.PiecePriorityHigh)
		f.Download()

		reader := f.NewReader()
		defer reader.Close()
		// 64 MiB readahead keeps more pieces queued ahead of the read position
		// so the browser doesn't starve as easily on slow swarms.
		reader.SetReadahead(64 << 20)
		reader.SetResponsive()
		reader.SetContext(r.Context())

		display := f.DisplayPath()
		ctype := mime.TypeByExtension(filepath.Ext(display))
		if ctype == "" {
			ctype = "application/octet-stream"
		}
		w.Header().Set("Content-Type", ctype)
		w.Header().Set("Content-Disposition", fmt.Sprintf(`inline; filename=%q`, filepath.Base(display)))
		w.Header().Set("Accept-Ranges", "bytes")
		http.ServeContent(w, r, filepath.Base(display), item.AddedAt, reader)
	}
}
