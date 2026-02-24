package main

import (
	"encoding/json"
	"fmt"
	"io"
	"log"
	"net/http"
	"os"
	"path/filepath"
)

// LoadManifest reads a manifest JSON file from disk.
func LoadManifest(path string) (*Manifest, error) {
	data, err := os.ReadFile(path)
	if err != nil {
		return nil, err
	}
	var m Manifest
	if err := json.Unmarshal(data, &m); err != nil {
		return nil, err
	}
	return &m, nil
}

// DownloadFromManifest downloads all images described in a manifest.
func DownloadFromManifest(manifest *Manifest) error {
	baseDir := filepath.Join("../newsletters", manifest.ID)
	pagesDir := filepath.Join(baseDir, "pages")

	if err := os.MkdirAll(pagesDir, 0755); err != nil {
		return fmt.Errorf("failed to create pages directory: %v", err)
	}

	// Download cover image
	if manifest.CoverImageURL != "" {
		coverPath := filepath.Join(baseDir, "cover-image.jpg")
		if err := downloadImage(manifest.CoverImageURL, coverPath); err != nil {
			log.Printf("[downloader] warning: cover image failed: %v", err)
		} else {
			log.Printf("[downloader] downloaded cover image")
		}
	}

	// Download each page
	for _, page := range manifest.Pages {
		filename := fmt.Sprintf("page-%03d.jpg", page.Number)
		dest := filepath.Join(pagesDir, filename)

		if err := downloadImage(page.ImageURL, dest); err != nil {
			log.Printf("[downloader] warning: page %d failed: %v", page.Number, err)
			continue
		}
		log.Printf("[downloader] downloaded page %d", page.Number)
	}

	log.Printf("[downloader] done — %d pages downloaded for %s", len(manifest.Pages), manifest.ID)
	return nil
}

// downloadImage downloads a file from a URL and saves it to disk.
func downloadImage(imageURL, filePath string) error {
	resp, err := http.Get(imageURL)
	if err != nil {
		return err
	}
	defer resp.Body.Close()

	if resp.StatusCode != http.StatusOK {
		return fmt.Errorf("HTTP %d: %s", resp.StatusCode, resp.Status)
	}

	out, err := os.Create(filePath)
	if err != nil {
		return err
	}
	defer out.Close()

	_, err = io.Copy(out, resp.Body)
	return err
}
