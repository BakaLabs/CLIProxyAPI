.PHONY: web build build-server-only test lint clean

# Build the management dashboard (embedded into the binary at compile time).
web:
	pnpm -C web install
	pnpm -C web build

# Full build: dashboard first, then the server binary.
build: web
	go build -o cli-proxy-api ./cmd/server

# Server only (embeds whatever is currently in web/dist).
build-server-only:
	go build -o cli-proxy-api ./cmd/server

test:
	go test ./...

lint:
	cd web && pnpm lint
	gofmt -l internal/ cmd/ sdk/

clean:
	rm -f cli-proxy-api
