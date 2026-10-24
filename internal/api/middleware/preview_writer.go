package middleware

import (
	"github.com/gin-gonic/gin"
	"github.com/router-for-me/CLIProxyAPI/v8/internal/logging"
)

// previewResponseWriter delegates to the wrapped gin.ResponseWriter while
// forwarding the first N bytes written to the client into the request-scoped
// preview holder. Interface embedding keeps status, flush, hijack and other
// gin.ResponseWriter semantics of the wrapped writer unchanged.
type previewResponseWriter struct {
	gin.ResponseWriter
	holder *logging.ContentPreviewHolder
}

func (w *previewResponseWriter) Write(payload []byte) (int, error) {
	w.holder.AppendResponsePreview(payload)
	return w.ResponseWriter.Write(payload)
}

func (w *previewResponseWriter) WriteString(s string) (int, error) {
	w.holder.AppendResponsePreview([]byte(s))
	return w.ResponseWriter.WriteString(s)
}

// attachContentPreviewHolder ensures the request context carries a preview
// holder with the given byte limit and returns it.
func attachContentPreviewHolder(c *gin.Context, limit int) *logging.ContentPreviewHolder {
	if c == nil || c.Request == nil {
		return nil
	}
	holder := logging.GetContentPreviewHolder(c.Request.Context())
	if holder != nil {
		return holder
	}
	c.Request = c.Request.WithContext(logging.WithContentPreviewHolder(c.Request.Context(), limit))
	return logging.GetContentPreviewHolder(c.Request.Context())
}
