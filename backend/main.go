package main

import (
	"encoding/json"
	"fmt"
	"log"
	"net/http"

	"github.com/gorilla/mux"
)

func main() {
	// Create router
	r := mux.NewRouter()

	// API routes
	api := r.PathPrefix("/api").Subrouter()
	api.HandleFunc("/newsletters", getNewsletters).Methods("GET")
	api.HandleFunc("/newsletters/{id}", getNewsletter).Methods("GET")
	api.HandleFunc("/scrape/{store}", scrapeStore).Methods("POST")
	api.HandleFunc("/stores", getStores).Methods("GET")

	// Serve newsletter images
	r.PathPrefix("/newsletters/").Handler(http.StripPrefix("/newsletters/", http.FileServer(http.Dir("../newsletters"))))

	// Serve static files (frontend)
	r.PathPrefix("/").Handler(http.FileServer(http.Dir("../frontend")))

	// Enable CORS for development
	handler := enableCORS(r)

	// Start server
	port := ":8080"
	log.Printf("Server starting on http://localhost%s", port)
	log.Fatal(http.ListenAndServe(port, handler))
}

// API Handlers
func getNewsletters(w http.ResponseWriter, r *http.Request) {
	w.Header().Set("Content-Type", "application/json")
	json.NewEncoder(w).Encode([]struct{}{})
}

func getNewsletter(w http.ResponseWriter, r *http.Request) {
	http.Error(w, "Newsletter not found", http.StatusNotFound)
}

func scrapeStore(w http.ResponseWriter, r *http.Request) {
	vars := mux.Vars(r)
	configName := vars["store"]

	log.Printf("Starting scrape for config: %s", configName)

	// Run resolver + downloader in a goroutine since it takes a while
	go func() {
		configPath := fmt.Sprintf("configs/%s.json", configName)

		manifest, err := ResolveManifest(configPath)
		if err != nil {
			log.Printf("Error resolving manifest for %s: %v", configName, err)
			return
		}

		if err := DownloadFromManifest(manifest); err != nil {
			log.Printf("Error downloading images for %s: %v", configName, err)
			return
		}

		log.Printf("Successfully scraped %s", configName)
	}()

	// Return immediately to avoid timeout
	response := map[string]interface{}{
		"message": fmt.Sprintf("Scraping with config %s started in background. This may take a few minutes.", configName),
		"status":  "processing",
	}

	w.Header().Set("Content-Type", "application/json")
	json.NewEncoder(w).Encode(response)
}

func getStores(w http.ResponseWriter, r *http.Request) {
	configs, err := ListAvailableConfigs()
	if err != nil {
		http.Error(w, "Error loading configs", http.StatusInternalServerError)
		return
	}

	w.Header().Set("Content-Type", "application/json")
	json.NewEncoder(w).Encode(map[string]interface{}{
		"configs": configs,
	})
}

// CORS middleware
func enableCORS(next http.Handler) http.Handler {
	return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		w.Header().Set("Access-Control-Allow-Origin", "*")
		w.Header().Set("Access-Control-Allow-Methods", "GET, POST, OPTIONS")
		w.Header().Set("Access-Control-Allow-Headers", "Content-Type")

		if r.Method == "OPTIONS" {
			w.WriteHeader(http.StatusOK)
			return
		}

		next.ServeHTTP(w, r)
	})
}
