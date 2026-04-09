.PHONY: build run dev clean deps fmt help

BINARY_NAME=genieacs-backend
GO=go

build:
	@echo "Building $(BINARY_NAME)..."
	$(GO) build -o bin/$(BINARY_NAME) ./cmd/server

run: build
	@echo "Running $(BINARY_NAME)..."
	./bin/$(BINARY_NAME)

dev:
	@echo "Running in development mode..."
	$(GO) run ./cmd/server

clean:
	@echo "Cleaning..."
	rm -rf bin/
	$(GO) clean

deps:
	@echo "Downloading dependencies..."
	$(GO) mod download
	$(GO) mod tidy

fmt:
	@echo "Formatting code..."
	$(GO) fmt ./...

help:
	@echo "Available targets:"
	@echo "  build   - Build the application"
	@echo "  run     - Build and run the application"
	@echo "  dev     - Run in development mode"
	@echo "  clean   - Clean build artifacts"
	@echo "  deps    - Download dependencies"
	@echo "  fmt     - Format code"
	@echo "  help    - Show this help message"
