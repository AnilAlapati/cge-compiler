package main

import (
	"encoding/json"
	"fmt"
	"log"
	"net/http"
	"sync"
)

type Product struct {
	ID    string  `json:"id"`
	Name  string  `json:"name"`
	Price float64 `json:"price"`
}

var (
	inventory = make(map[string]Product)
	mu        sync.RWMutex
)

func AuthMiddleware(next http.Handler) http.Handler {
	return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		token := r.Header.Get("Authorization")
		if token != "Bearer secret-go-token" {
			http.Error(w, "Forbidden", http.StatusForbidden)
			return
		}
		next.ServeHTTP(w, r)
	})
}

func handleGetProduct(w http.ResponseWriter, r *http.Request) {
	id := r.URL.Query().Get("id")
	if id == "" {
		http.Error(w, "Missing id", http.StatusBadRequest)
		return
	}

	mu.RLock()
	product, exists := inventory[id]
	mu.RUnlock()

	if !exists {
		http.Error(w, "Not found", http.StatusNotFound)
		return
	}

	json.NewEncoder(w).Encode(product)
}

func handleCreateProduct(w http.ResponseWriter, r *http.Request) {
	var p Product
	if err := json.NewDecoder(r.Body).Decode(&p); err != nil {
		http.Error(w, err.Error(), http.StatusBadRequest)
		return
	}
	if p.ID == "" || p.Name == "" {
		http.Error(w, "Invalid product", http.StatusBadRequest)
		return
	}

	mu.Lock()
	inventory[p.ID] = p
	mu.Unlock()

	w.WriteHeader(http.StatusCreated)
	json.NewEncoder(w).Encode(p)
}

func main() {
	mux := http.NewServeMux()
	mux.HandleFunc("/api/product", func(w http.ResponseWriter, r *http.Request) {
		if r.Method == http.MethodGet {
			handleGetProduct(w, r)
		} else {
			http.Error(w, "Method not allowed", http.StatusMethodNotAllowed)
		}
	})
	
	mux.Handle("/api/admin/product", AuthMiddleware(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if r.Method == http.MethodPost {
			handleCreateProduct(w, r)
		} else {
			http.Error(w, "Method not allowed", http.StatusMethodNotAllowed)
		}
	})))

	fmt.Println("Starting server on :8080")
	log.Fatal(http.ListenAndServe(":8080", mux))
}
