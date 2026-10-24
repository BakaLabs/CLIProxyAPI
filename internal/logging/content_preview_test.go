package logging

import (
	"bytes"
	"context"
	"sync"
	"testing"
)

func TestContentPreviewHolderTruncatesToLimit(t *testing.T) {
	ctx := WithContentPreviewHolder(context.Background(), 8)
	holder := GetContentPreviewHolder(ctx)
	if holder == nil {
		t.Fatal("GetContentPreviewHolder() = nil, want holder")
	}

	holder.SetRequestPreview([]byte("0123456789"))
	holder.AppendResponsePreview([]byte("ab"))
	holder.AppendResponsePreview([]byte("cdefghijk"))

	request, response := holder.Previews()
	if string(request) != "01234567" {
		t.Fatalf("request preview = %q, want 01234567", request)
	}
	if string(response) != "abcdefgh" {
		t.Fatalf("response preview = %q, want abcdefgh", response)
	}

	// Copies, not live slices: mutating the returned value must not corrupt state.
	request[0] = 'X'
	again, _ := holder.Previews()
	if again[0] != '0' {
		t.Fatal("Previews() returned the internal buffer")
	}
}

func TestContentPreviewHolderDisabledWithoutLimit(t *testing.T) {
	if holder := GetContentPreviewHolder(context.Background()); holder != nil {
		t.Fatalf("holder on plain context = %v, want nil", holder)
	}
	// A zero/negative limit attaches nothing so disabled captures cost nothing.
	if holder := GetContentPreviewHolder(WithContentPreviewHolder(context.Background(), 0)); holder != nil {
		t.Fatalf("holder with zero limit = %v, want nil", holder)
	}
}

func TestContentPreviewHolderIdempotent(t *testing.T) {
	ctx := WithContentPreviewHolder(context.Background(), 4)
	ctx = WithContentPreviewHolder(ctx, 100)
	holder := GetContentPreviewHolder(ctx)
	holder.AppendResponsePreview([]byte("12345678"))
	// The first limit (4) wins; a second attach must not replace the holder.
	_, response := holder.Previews()
	if len(response) != 4 {
		t.Fatalf("response preview length = %d, want 4", len(response))
	}
}

func TestContentPreviewHolderConcurrentAppend(t *testing.T) {
	ctx := WithContentPreviewHolder(context.Background(), 64)
	holder := GetContentPreviewHolder(ctx)
	var wg sync.WaitGroup
	for i := 0; i < 8; i++ {
		wg.Add(1)
		go func() {
			defer wg.Done()
			holder.AppendResponsePreview(bytes.Repeat([]byte("x"), 16))
		}()
	}
	wg.Wait()
	_, response := holder.Previews()
	if len(response) != 64 {
		t.Fatalf("response preview length = %d, want capped at 64", len(response))
	}
}
