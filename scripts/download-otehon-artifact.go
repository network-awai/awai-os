// Operator-only GitHub artifact transport. It never boots an image or writes a device.
package main

import (
	"archive/zip"
	"crypto/sha256"
	"crypto/tls"
	"encoding/hex"
	"encoding/json"
	"errors"
	"flag"
	"fmt"
	"io"
	"net"
	"net/http"
	"net/url"
	"os"
	"os/exec"
	"strings"
	"sync"
	"sync/atomic"
	"time"
)

const repoAPI = "https://api.github.com/repos/network-awai/awai-os/actions/artifacts/"
const maxISO = int64(8 * 1024 * 1024 * 1024)

type ranged struct {
	client     *http.Client
	address    string
	size       int64
	artifactID string
}

func (r *ranged) ReadAt(p []byte, off int64) (int, error) {
	if off < 0 || off+int64(len(p)) > r.size {
		return 0, errors.New("range outside artifact")
	}
	req, e := http.NewRequest("GET", r.address, nil)
	if e != nil {
		return 0, errors.New("delivery request")
	}
	req.Header.Set("Range", fmt.Sprintf("bytes=%d-%d", off, off+int64(len(p))-1))
	resp, e := r.client.Do(req)
	if e != nil {
		return 0, errors.New("delivery connection failed")
	}
	defer resp.Body.Close()
	want := fmt.Sprintf("bytes %d-%d/%d", off, off+int64(len(p))-1, r.size)
	if resp.StatusCode != 206 || resp.Header.Get("Content-Range") != want {
		return 0, errors.New("delivery range refused")
	}
	return io.ReadFull(resp.Body, p)
}
func deliveryURL(s string) bool {
	u, e := url.Parse(s)
	return e == nil && u.Scheme == "https" && u.User == nil && (u.Port() == "" || u.Port() == "443") && strings.HasSuffix(u.Hostname(), ".blob.core.windows.net")
}
func client() *http.Client {
	return &http.Client{Timeout: 120 * time.Second, CheckRedirect: func(*http.Request, []*http.Request) error { return http.ErrUseLastResponse }, Transport: &http.Transport{
		Proxy: nil, DialContext: (&net.Dialer{Timeout: 10 * time.Second}).DialContext,
		TLSClientConfig: &tls.Config{MinVersion: tls.VersionTLS12}, TLSNextProto: map[string]func(string, *tls.Conn) http.RoundTripper{},
		MaxConnsPerHost: 8, MaxIdleConnsPerHost: 8, ResponseHeaderTimeout: 30 * time.Second,
	}}
}
func copyISO(r *ranged, expectedISO, expectedZIP, output string) error {
	started := time.Now().UTC()
	z, e := zip.NewReader(r, r.size)
	if e != nil {
		return errors.New("invalid artifact ZIP")
	}
	if len(z.File) != 1 {
		return errors.New("expected exactly one ISO")
	}
	f := z.File[0]
	if f.Method != zip.Store || f.Flags&1 != 0 || !strings.HasSuffix(f.Name, ".iso") || strings.ContainsAny(f.Name, "/\\") || f.UncompressedSize64 < 1048576 || f.UncompressedSize64 > uint64(maxISO) || f.CompressedSize64 != f.UncompressedSize64 || f.UncompressedSize64%512 != 0 {
		return errors.New("unsupported ISO entry")
	}
	offset, e := f.DataOffset()
	if e != nil {
		return errors.New("invalid ZIP data offset")
	}
	size := int64(f.UncompressedSize64)
	if offset < 0 || offset > 1048576 || r.size-offset-size < 0 || r.size-offset-size > 1048576 {
		return errors.New("artifact envelope bound")
	}
	out, e := os.OpenFile(output, os.O_CREATE|os.O_EXCL|os.O_RDWR, 0600)
	if e != nil {
		return e
	}
	defer out.Close()
	if e = out.Truncate(size); e != nil {
		return e
	}
	const chunk = int64(16 * 1024 * 1024)
	jobs := make(chan int64)
	var wg sync.WaitGroup
	var fail error
	var lock sync.Mutex
	var done atomic.Int64
	var mark atomic.Int64
	for i := 0; i < 8; i++ {
		wg.Add(1)
		go func() {
			defer wg.Done()
			for pos := range jobs {
				lock.Lock()
				failed := fail != nil
				lock.Unlock()
				if failed {
					continue
				}
				n := chunk
				if size-pos < n {
					n = size - pos
				}
				buf := make([]byte, n)
				var err error
				for attempt := 0; attempt < 3; attempt++ {
					_, err = r.ReadAt(buf, offset+pos)
					if err == nil {
						break
					}
					time.Sleep(time.Duration(attempt+1) * time.Second)
				}
				if err == nil {
					_, err = out.WriteAt(buf, pos)
				}
				if err != nil {
					lock.Lock()
					if fail == nil {
						fail = err
					}
					lock.Unlock()
					continue
				}
				total := done.Add(n)
				g := total / (1024 * 1024 * 1024)
				prev := mark.Load()
				if g > prev && mark.CompareAndSwap(prev, g) {
					fmt.Printf("artifact progress: %d GiB fetched\n", g)
				}
			}
		}()
	}
	for pos := int64(0); pos < size; pos += chunk {
		jobs <- pos
	}
	close(jobs)
	wg.Wait()
	if fail != nil {
		return fail
	}
	if e = out.Sync(); e != nil {
		return e
	}
	if _, e = out.Seek(32769, 0); e != nil {
		return e
	}
	magic := make([]byte, 5)
	if _, e = io.ReadFull(out, magic); e != nil || string(magic) != "CD001" {
		return errors.New("not ISO9660")
	}
	prefix := make([]byte, offset)
	suffix := make([]byte, r.size-offset-size)
	if _, e = r.ReadAt(prefix, 0); e != nil {
		return e
	}
	if _, e = r.ReadAt(suffix, offset+size); e != nil {
		return e
	}
	imageHash := sha256.New()
	archiveHash := sha256.New()
	archiveHash.Write(prefix)
	out.Seek(0, 0)
	if _, e = io.Copy(io.MultiWriter(imageHash, archiveHash), out); e != nil {
		return e
	}
	archiveHash.Write(suffix)
	if hex.EncodeToString(imageHash.Sum(nil)) != expectedISO || hex.EncodeToString(archiveHash.Sum(nil)) != expectedZIP {
		return errors.New("digest mismatch; output remains unqualified")
	}
	proof := map[string]any{"artifactID": r.artifactID, "isoSha256": expectedISO, "zipSha256": expectedZIP, "isoBytes": size, "isoDigestVerified": true, "zipDigestVerified": true, "parallelRequests": 8, "rangeBytes": chunk, "startedAt": started, "finishedAt": time.Now().UTC(), "elapsedSeconds": time.Since(started).Seconds()}
	data, _ := json.MarshalIndent(proof, "", "  ")
	return os.WriteFile(output+".verified.json", append(data, '\n'), 0600)
}
func run(id, sha, output string) error {
	if id == "" || strings.Trim(id, "0123456789") != "" || len(sha) != 64 {
		return errors.New("artifact ID and expected ISO digest required")
	}
	if _, e := hex.DecodeString(sha); e != nil {
		return errors.New("invalid ISO digest")
	}
	token, e := exec.Command("gh", "auth", "token").Output()
	if e != nil {
		return errors.New("GitHub authentication unavailable")
	}
	c := client()
	request := func(path string) (*http.Response, error) {
		req, _ := http.NewRequest("GET", repoAPI+path, nil)
		req.Header.Set("Authorization", "Bearer "+strings.TrimSpace(string(token)))
		resp, err := c.Do(req)
		if err != nil {
			return nil, errors.New("GitHub request failed")
		}
		return resp, nil
	}
	resp, e := request(id)
	if e != nil {
		return e
	}
	var meta struct {
		ID     int64  `json:"id"`
		Size   int64  `json:"size_in_bytes"`
		Digest string `json:"digest"`
	}
	if resp.StatusCode != 200 {
		resp.Body.Close()
		return errors.New("GitHub metadata refused")
	}
	e = json.NewDecoder(io.LimitReader(resp.Body, 1048576)).Decode(&meta)
	resp.Body.Close()
	if e != nil || fmt.Sprint(meta.ID) != id || meta.Size <= 0 || meta.Size > maxISO+2*1048576 || !strings.HasPrefix(meta.Digest, "sha256:") {
		return errors.New("artifact metadata bound")
	}
	resp, e = request(id + "/zip")
	if e != nil {
		return e
	}
	address := resp.Header.Get("Location")
	resp.Body.Close()
	if resp.StatusCode != 302 || !deliveryURL(address) {
		return errors.New("unapproved artifact delivery")
	}
	return copyISO(&ranged{client: c, address: address, size: meta.Size, artifactID: id}, sha, strings.TrimPrefix(meta.Digest, "sha256:"), output)
}
func main() {
	id := flag.String("artifact", "", "GitHub artifact ID")
	sha := flag.String("sha256", "", "independently observed expected ISO digest")
	out := flag.String("output", "", "new regular output file")
	flag.Parse()
	if *out == "" {
		fmt.Fprintln(os.Stderr, "output required")
		os.Exit(1)
	}
	if e := run(*id, *sha, *out); e != nil {
		fmt.Fprintln(os.Stderr, e)
		os.Exit(1)
	}
	fmt.Println("ISO_AND_ZIP_DIGESTS_VERIFIED")
}
