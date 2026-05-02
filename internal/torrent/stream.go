package torrent

import (
	"fmt"
	"mime"
	"net/http"
	"path/filepath"
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
		reader := f.NewReader()
		defer reader.Close()
		reader.SetReadahead(16 << 20)
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
