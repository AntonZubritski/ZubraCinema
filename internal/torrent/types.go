package torrent

type FileInfo struct {
	Idx      int     `json:"idx"`
	Path     string  `json:"path"`
	Size     int64   `json:"size"`
	MimeType *string `json:"mimeType"`
	Progress float64 `json:"progress"`
}

type TorrentInfo struct {
	ID           string     `json:"id"`
	Name         string     `json:"name"`
	TotalSize    int64      `json:"totalSize"`
	Progress     float64    `json:"progress"`
	DownloadRate int64      `json:"downloadRate"`
	Peers        int        `json:"peers"`
	Mode         string     `json:"mode,omitempty"`
	Files        []FileInfo `json:"files,omitempty"`
}
