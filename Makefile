BINARY := zubracinema
ifeq ($(OS),Windows_NT)
	BINARY := zubracinema.exe
endif

BIN_DIR := bin
BIN := $(BIN_DIR)/$(BINARY)
WEB_DIR := web

.PHONY: build build-web build-go run dev clean install-web

build: build-web build-go

build-web:
	cd $(WEB_DIR) && npm run build

build-go:
	go build -o $(BIN) ./cmd/zubracinema

install-web:
	cd $(WEB_DIR) && npm install

run: build
	./$(BIN)

dev:
	@echo "In one terminal:  cd web && npm run dev"
	@echo "In another:       go run ./cmd/zubracinema --no-browser"

clean:
	go clean
	rm -rf $(BIN_DIR) $(WEB_DIR)/dist $(WEB_DIR)/node_modules
