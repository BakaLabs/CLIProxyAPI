// Package requestdb stores per-request usage metadata in a local SQLite
// database. It is a fork-local observability subsystem, independent of the
// file-based request log in internal/logging: it keeps structured metadata
// (tokens, models, tiers, headers, latency) instead of full request/response
// bodies, so later analytics and live-log features can query it cheaply.
package requestdb

import (
	"github.com/klauspost/compress/zstd"
)

// zstd codec singletons. All compression happens on the single writer
// goroutine (Encoder is not safe for concurrent use); the Decoder is safe for
// concurrent use, which the management detail endpoint relies on.
var (
	zstdEncoder, _ = zstd.NewWriter(nil,
		zstd.WithEncoderLevel(zstd.SpeedFastest),
		zstd.WithEncoderConcurrency(1),
	)
	zstdDecoder, _ = zstd.NewReader(nil, zstd.WithDecoderConcurrency(1))
)

// compressBlob zstd-compresses a payload; empty payloads stay nil so columns
// distinguish "absent" from "empty".
func compressBlob(payload []byte) []byte {
	if len(payload) == 0 {
		return nil
	}
	return zstdEncoder.EncodeAll(payload, nil)
}

// decompressBlob reverses compressBlob.
func decompressBlob(payload []byte) ([]byte, error) {
	if len(payload) == 0 {
		return nil, nil
	}
	return zstdDecoder.DecodeAll(payload, nil)
}
