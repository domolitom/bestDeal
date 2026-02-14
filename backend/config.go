package main

import (
	"encoding/json"
	"os"
	"path/filepath"
)

// ScraperConfig defines the configuration for a store scraper
type ScraperConfig struct {
	ID         string `json:"id"`
	CoverImage string `json:"cover_image"`
	FirstPage  string `json:"first_page"`
	LastPage   string `json:"last_page"`
}

// LoadScraperConfig loads the scraper configuration from a specific config file
func LoadScraperConfig(configPath string) (*ScraperConfig, error) {
	data, err := os.ReadFile(configPath)
	if err != nil {
		return nil, err
	}

	var config ScraperConfig
	if err := json.Unmarshal(data, &config); err != nil {
		return nil, err
	}

	return &config, nil
}

// ListAvailableConfigs returns all available config files
func ListAvailableConfigs() ([]string, error) {
	files, err := os.ReadDir("configs")
	if err != nil {
		return nil, err
	}

	var configs []string
	for _, file := range files {
		if !file.IsDir() && filepath.Ext(file.Name()) == ".json" {
			configs = append(configs, file.Name())
		}
	}

	return configs, nil
}
