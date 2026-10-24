package logging

import (
	"context"
	"sync"
)

type contentPreviewKey struct{}

// ContentPreviewHolder stores truncated first-N-bytes previews of the downstream
// request body and downstream response stream for async consumers (e.g. the
// request database). The holder is created synchronously by middleware before
// the handler runs and read asynchronously after usage records are published,
// so all access is mutex-guarded and the holder never references gin state.
type ContentPreviewHolder struct {
	mu       sync.Mutex
	limit    int
	request  []byte
	response []byte
}

// WithContentPreviewHolder attaches a preview holder with the given per-stream
// byte limit to ctx. A limit <= 0 attaches nothing.
func WithContentPreviewHolder(ctx context.Context, limit int) context.Context {
	if ctx == nil || limit <= 0 {
		return ctx
	}
	if existing := contentPreviewFromContext(ctx); existing != nil {
		return ctx
	}
	return context.WithValue(ctx, contentPreviewKey{}, &ContentPreviewHolder{limit: limit})
}

// GetContentPreviewHolder returns the preview holder stored in ctx, nil when absent.
func GetContentPreviewHolder(ctx context.Context) *ContentPreviewHolder {
	return contentPreviewFromContext(ctx)
}

func contentPreviewFromContext(ctx context.Context) *ContentPreviewHolder {
	if ctx == nil {
		return nil
	}
	if holder, ok := ctx.Value(contentPreviewKey{}).(*ContentPreviewHolder); ok {
		return holder
	}
	return nil
}

// SetRequestPreview records the first limit bytes of the decoded request body.
func (h *ContentPreviewHolder) SetRequestPreview(payload []byte) {
	if h == nil || len(payload) == 0 {
		return
	}
	h.mu.Lock()
	defer h.mu.Unlock()
	h.request = truncatePreview(payload, h.limit)
}

// AppendResponsePreview accumulates the first limit bytes of the response stream.
// Later chunks are ignored once the limit is reached, so the per-request cost is
// bounded and O(1) amortized after the cap.
func (h *ContentPreviewHolder) AppendResponsePreview(payload []byte) {
	if h == nil || len(payload) == 0 {
		return
	}
	h.mu.Lock()
	defer h.mu.Unlock()
	if h.limit <= 0 || len(h.response) >= h.limit {
		return
	}
	remaining := h.limit - len(h.response)
	if remaining < len(payload) {
		h.response = append(h.response, payload[:remaining]...)
		return
	}
	h.response = append(h.response, payload...)
}

// Previews returns copies of the captured request and response previews.
func (h *ContentPreviewHolder) Previews() (request []byte, response []byte) {
	if h == nil {
		return nil, nil
	}
	h.mu.Lock()
	defer h.mu.Unlock()
	return cloneBytes(h.request), cloneBytes(h.response)
}

func truncatePreview(payload []byte, limit int) []byte {
	if limit <= 0 || len(payload) <= limit {
		return cloneBytes(payload)
	}
	return cloneBytes(payload[:limit])
}

func cloneBytes(payload []byte) []byte {
	if len(payload) == 0 {
		return nil
	}
	out := make([]byte, len(payload))
	copy(out, payload)
	return out
}
