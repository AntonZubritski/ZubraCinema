package rutracker

import (
	"context"
	"fmt"
	"log"
	"net/http"
	"net/http/cookiejar"
	"net/url"
	"strconv"
	"strings"
	"sync"
	"time"

	"github.com/PuerkitoBio/goquery"

	"github.com/AntonZubritski/ZubraCinema/internal/sources"
)

const (
	name             = "rutracker"
	baseURL          = "https://rutracker.org"
	loginURL         = baseURL + "/forum/login.php"
	searchURL        = baseURL + "/forum/tracker.php"
	topicURL         = baseURL + "/forum/viewtopic.php"
	maxDetailFetches = 8
	// URL-encoded "Вход" — rutracker requires this submit-button value.
	loginSubmit = "%D0%92%D1%85%D0%BE%D0%B4"
)

type Source struct {
	login    string
	password string

	http *http.Client

	once     sync.Once
	mu       sync.Mutex
	loggedIn bool
	failed   bool
}

func New(login, password string) *Source {
	jar, _ := cookiejar.New(nil)
	return &Source{
		login:    login,
		password: password,
		http: &http.Client{
			Timeout: 10 * time.Second,
			Jar:     jar,
		},
	}
}

func (s *Source) Name() string { return name }

func (s *Source) Search(ctx context.Context, query string) ([]sources.Torrent, error) {
	if s.login == "" || s.password == "" {
		return nil, nil
	}
	if !s.ensureLoggedIn(ctx) {
		return nil, nil
	}

	q := url.Values{}
	q.Set("nm", query)
	u := searchURL + "?" + q.Encode()
	req, err := http.NewRequestWithContext(ctx, http.MethodGet, u, nil)
	if err != nil {
		return nil, err
	}
	req.Header.Set("User-Agent", sources.UserAgent)
	resp, err := s.http.Do(req)
	if err != nil {
		return nil, err
	}
	defer resp.Body.Close()
	if resp.StatusCode < 200 || resp.StatusCode >= 300 {
		return nil, fmt.Errorf("rutracker http %d", resp.StatusCode)
	}
	doc, err := goquery.NewDocumentFromReader(resp.Body)
	if err != nil {
		return nil, err
	}

	type entry struct {
		topicID  string
		title    string
		size     int64
		seeders  int
		leechers int
	}
	var entries []entry

	doc.Find("tr.tCenter, tr.hl-tr").Each(func(_ int, tr *goquery.Selection) {
		link := tr.Find("a.tLink, a.med.tLink").First()
		if link.Length() == 0 {
			return
		}
		href, _ := link.Attr("href")
		title := strings.TrimSpace(link.Text())
		if title == "" || !strings.Contains(href, "viewtopic.php") {
			return
		}
		topicID := extractTopicID(href)
		if topicID == "" {
			return
		}
		var size int64
		if u := tr.Find("td.tor-size u").First(); u.Length() > 0 {
			if v, err := strconv.ParseInt(strings.TrimSpace(u.Text()), 10, 64); err == nil {
				size = v
			}
		}
		if size == 0 {
			size = sources.ParseSize(strings.TrimSpace(tr.Find("td.tor-size").Text()))
		}
		seeders := parseInt(tr.Find("td.seedmed b").First().Text())
		if seeders == 0 {
			seeders = parseInt(tr.Find(".seedmed").First().Text())
		}
		leechers := parseInt(tr.Find("td.leechmed b").First().Text())
		if leechers == 0 {
			leechers = parseInt(tr.Find(".leechmed").First().Text())
		}
		entries = append(entries, entry{
			topicID:  topicID,
			title:    title,
			size:     size,
			seeders:  seeders,
			leechers: leechers,
		})
	})

	if len(entries) > maxDetailFetches {
		entries = entries[:maxDetailFetches]
	}

	out := make([]sources.Torrent, len(entries))
	var wg sync.WaitGroup
	for i := range entries {
		wg.Add(1)
		go func(i int) {
			defer wg.Done()
			e := entries[i]
			magnet, err := s.fetchMagnet(ctx, e.topicID)
			if err != nil || magnet == "" {
				return
			}
			out[i] = sources.Torrent{
				ID:       sources.MagnetInfoHash(magnet),
				Title:    e.title,
				Size:     e.size,
				Seeders:  e.seeders,
				Leechers: e.leechers,
				Quality:  sources.DetectQuality(e.title),
				Source:   name,
				Magnet:   magnet,
				Language: sources.DetectLanguage(e.title),
			}
		}(i)
	}
	wg.Wait()

	filtered := out[:0]
	for _, t := range out {
		if t.Magnet != "" {
			filtered = append(filtered, t)
		}
	}
	return filtered, nil
}

func (s *Source) ensureLoggedIn(ctx context.Context) bool {
	s.mu.Lock()
	if s.failed {
		s.mu.Unlock()
		return false
	}
	if s.loggedIn {
		s.mu.Unlock()
		return true
	}
	s.mu.Unlock()

	var ok bool
	s.once.Do(func() {
		ok = s.doLogin(ctx)
		s.mu.Lock()
		if ok {
			s.loggedIn = true
		} else {
			s.failed = true
			log.Printf("rutracker: login failed; source disabled for this session")
		}
		s.mu.Unlock()
	})
	if ok {
		return true
	}
	s.mu.Lock()
	defer s.mu.Unlock()
	return s.loggedIn
}

func (s *Source) doLogin(ctx context.Context) bool {
	body := fmt.Sprintf(
		"login_username=%s&login_password=%s&login=%s",
		url.QueryEscape(s.login),
		url.QueryEscape(s.password),
		loginSubmit,
	)
	req, err := http.NewRequestWithContext(ctx, http.MethodPost, loginURL, strings.NewReader(body))
	if err != nil {
		return false
	}
	req.Header.Set("User-Agent", sources.UserAgent)
	req.Header.Set("Content-Type", "application/x-www-form-urlencoded")
	resp, err := s.http.Do(req)
	if err != nil {
		return false
	}
	defer resp.Body.Close()
	_, _ = goquery.NewDocumentFromReader(resp.Body) // drain

	u, _ := url.Parse(baseURL)
	for _, c := range s.http.Jar.Cookies(u) {
		if c.Name == "bb_session" && c.Value != "" {
			return true
		}
	}
	return false
}

func (s *Source) fetchMagnet(ctx context.Context, topicID string) (string, error) {
	u := topicURL + "?t=" + url.QueryEscape(topicID)
	req, err := http.NewRequestWithContext(ctx, http.MethodGet, u, nil)
	if err != nil {
		return "", err
	}
	req.Header.Set("User-Agent", sources.UserAgent)
	resp, err := s.http.Do(req)
	if err != nil {
		return "", err
	}
	defer resp.Body.Close()
	if resp.StatusCode < 200 || resp.StatusCode >= 300 {
		return "", fmt.Errorf("rutracker topic http %d", resp.StatusCode)
	}
	doc, err := goquery.NewDocumentFromReader(resp.Body)
	if err != nil {
		return "", err
	}
	var magnet string
	doc.Find("a").EachWithBreak(func(_ int, a *goquery.Selection) bool {
		href, _ := a.Attr("href")
		if strings.HasPrefix(href, "magnet:") {
			magnet = href
			return false
		}
		return true
	})
	return magnet, nil
}

func extractTopicID(href string) string {
	if i := strings.Index(href, "t="); i >= 0 {
		rest := href[i+2:]
		end := len(rest)
		for j, r := range rest {
			if !(r >= '0' && r <= '9') {
				end = j
				break
			}
		}
		return rest[:end]
	}
	return ""
}

func parseInt(s string) int {
	s = strings.TrimSpace(s)
	var b strings.Builder
	for _, r := range s {
		if r >= '0' && r <= '9' {
			b.WriteRune(r)
		}
	}
	if b.Len() == 0 {
		return 0
	}
	n, _ := strconv.Atoi(b.String())
	return n
}
