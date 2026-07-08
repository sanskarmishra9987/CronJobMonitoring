package api

import (
	"embed"
	"io/fs"
	"net/http"

	"github.com/go-chi/chi/v5"
	"github.com/go-chi/chi/v5/middleware"
	"github.com/jackc/pgx/v5/pgxpool"

	vaultpkg "monitoring/vault"
)

func NewRouter(pool *pgxpool.Pool, vc *vaultpkg.Client, runner RunnerNotifier, hub AlertBroadcaster, frontendFS embed.FS) http.Handler {
	r := chi.NewRouter()
	r.Use(middleware.Recoverer)
	r.Use(corsMiddleware)
	r.Use(loggerMiddleware)

	r.Get("/api/health", func(w http.ResponseWriter, r *http.Request) {
		writeJSON(w, http.StatusOK, map[string]string{"status": "ok"})
	})

	r.Group(func(r chi.Router) {
		r.Use(bearerAuth(pool))

		mh := &monitorHandlers{pool: pool, vault: vc, runner: runner, hub: hub}
		r.Get("/api/monitors", mh.list)
		r.Post("/api/monitors", mh.create)
		r.Get("/api/monitors/{id}", mh.get)
		r.Put("/api/monitors/{id}", mh.update)
		r.Delete("/api/monitors/{id}", mh.delete)
		r.Patch("/api/monitors/{id}/toggle", mh.toggle)
		r.Post("/api/monitors/{id}/check-now", mh.checkNow)
		r.Post("/api/monitors/{id}/heartbeat", mh.heartbeat)

		sh := &statusHandlers{pool: pool}
		r.Get("/api/status", sh.all)
		r.Get("/api/monitors/{id}/status", sh.one)
		r.Get("/api/monitors/{id}/results", sh.results)

		th := &tokenHandlers{pool: pool}
		r.Get("/api/tokens", th.list)
		r.Post("/api/tokens", th.create)
		r.Delete("/api/tokens/{id}", th.revoke)
	})

	// Serve embedded React SPA for all non-API routes.
	dist, _ := fs.Sub(frontendFS, "frontend/dist")
	r.Handle("/*", spaHandler(http.FS(dist)))

	return r
}

// spaHandler serves static files, falling back to index.html for unknown paths (SPA routing).
func spaHandler(fsys http.FileSystem) http.Handler {
	fileServer := http.FileServer(fsys)
	return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		f, err := fsys.Open(r.URL.Path)
		if err != nil {
			r.URL.Path = "/"
		} else {
			f.Close()
		}
		fileServer.ServeHTTP(w, r)
	})
}