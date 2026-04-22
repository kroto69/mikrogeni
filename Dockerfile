FROM golang:1.21-bookworm AS builder

RUN apt-get update && apt-get install -y --no-install-recommends build-essential libsqlite3-dev ca-certificates && rm -rf /var/lib/apt/lists/*

WORKDIR /src

COPY go.mod go.sum* ./
RUN go mod download

COPY . .

RUN CGO_ENABLED=1 GOOS=linux GOARCH=amd64 go build -o /out/genieacs-backend ./cmd/server

FROM debian:bookworm-slim

RUN apt-get update && apt-get install -y --no-install-recommends ca-certificates libsqlite3-0 && rm -rf /var/lib/apt/lists/*

WORKDIR /data

COPY --from=builder /out/genieacs-backend /usr/local/bin/genieacs-backend

EXPOSE 1997

CMD ["/usr/local/bin/genieacs-backend"]
