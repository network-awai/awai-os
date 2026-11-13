package main

import (
	"archive/zip"
	"bytes"
	"crypto/sha256"
	"encoding/hex"
	"fmt"
	"net/http"
	"net/http/httptest"
	"os"
	"path/filepath"
	"testing"
)

func TestRangesAndIdentity(t *testing.T) {
	image := make([]byte, 48*1024*1024)
	for i := range image {
		image[i] = byte(i/(1024*1024)) ^ byte(i)
	}
	copy(image[32769:], "CD001")
	var buf bytes.Buffer
	z := zip.NewWriter(&buf)
	w, _ := z.CreateHeader(&zip.FileHeader{Name: "test.iso", Method: zip.Store})
	w.Write(image)
	z.Close()
	body := buf.Bytes()
	ih := sha256.Sum256(image)
	zh := sha256.Sum256(body)
	mode := 0
	server := httptest.NewTLSServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if mode == 1 {
			w.WriteHeader(200)
			return
		}
		if mode == 2 {
			http.Redirect(w, r, "/escape", 302)
			return
		}
		var a, b int64
		if _, e := fmt.Sscanf(r.Header.Get("Range"), "bytes=%d-%d", &a, &b); e != nil || a < 0 || b >= int64(len(body)) {
			w.WriteHeader(416)
			return
		}
		w.Header().Set("Content-Range", fmt.Sprintf("bytes %d-%d/%d", a, b, len(body)))
		w.WriteHeader(206)
		w.Write(body[a : b+1])
	}))
	defer server.Close()
	c := server.Client()
	c.CheckRedirect = client().CheckRedirect
	r := &ranged{client: c, address: server.URL, size: int64(len(body)), artifactID: "local-fixture"}
	dir := t.TempDir()
	out := filepath.Join(dir, "good.iso")
	if e := copyISO(r, hex.EncodeToString(ih[:]), hex.EncodeToString(zh[:]), out); e != nil {
		t.Fatal(e)
	}
	got, _ := os.ReadFile(out)
	if !bytes.Equal(got, image) {
		t.Fatal("bytes changed")
	}
	if e := copyISO(r, hex.EncodeToString(ih[:]), hex.EncodeToString(zh[:]), out); e == nil {
		t.Fatal("existing file overwritten")
	}
	for _, m := range []int{1, 2} {
		mode = m
		if e := copyISO(r, hex.EncodeToString(ih[:]), hex.EncodeToString(zh[:]), filepath.Join(dir, fmt.Sprint(m))); e == nil {
			t.Fatal("unsafe response admitted")
		}
	}
	mode = 0
	bad := filepath.Join(dir, "bad")
	if e := copyISO(r, fmt.Sprintf("%064d", 0), hex.EncodeToString(zh[:]), bad); e == nil {
		t.Fatal("wrong digest admitted")
	}
	if _, e := os.Stat(bad + ".verified.json"); !os.IsNotExist(e) {
		t.Fatal("incorrect verification receipt")
	}
	if e := copyISO(r, hex.EncodeToString(ih[:]), fmt.Sprintf("%064d", 0), filepath.Join(dir, "badzip")); e == nil {
		t.Fatal("wrong ZIP digest admitted")
	}
}
func TestDeliveryOrigins(t *testing.T) {
	for _, s := range []string{"http://x.blob.core.windows.net/a", "https://evil.invalid/a", "https://u:p@x.blob.core.windows.net/a", "https://x.blob.core.windows.net:444/a"} {
		if deliveryURL(s) {
			t.Fatal("unsafe origin")
		}
	}
	if !deliveryURL("https://productionresultssa8.blob.core.windows.net/path?test=fixture") {
		t.Fatal("valid delivery refused")
	}
}
