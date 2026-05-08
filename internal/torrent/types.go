package torrent

type FileInfo struct {
	Idx      int     `json:"idx"`
	Path     string  `json:"path"`
	Size     int64   `json:"size"`
	MimeType *string `json:"mimeType"`
	Progress float64 `json:"progress"`
}

type TorrentInfo struct {
	ID           string  `json:"id"`
	Name         string  `json:"name"`
	TotalSize    int64   `json:"totalSize"`
	Progress     float64 `json:"progress"`
	DownloadRate int64   `json:"downloadRate"`
	// Peers is the actively-connected peer count (handshake done, exchanging
	// data). Smaller than the swarm size advertised by source trackers
	// because (a) most discovered peers are unreachable behind NAT and (b)
	// private trackers like rintor refuse our anonymous announce.
	Peers int `json:"peers"`
	// TotalPeers is everyone the client knows about — active + half-open +
	// pending. Closer to "swarm size from our perspective" than Peers, and
	// the better number to surface when the user asks "why are there only
	// N peers?". Still independent of source-tracker counts.
	TotalPeers int        `json:"totalPeers"`
	Mode       string     `json:"mode,omitempty"`
	Files      []FileInfo `json:"files,omitempty"`
}
