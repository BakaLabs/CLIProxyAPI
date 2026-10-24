package management

import (
	"net/http"
	"net/http/httptest"
	"testing"

	"github.com/gin-gonic/gin"
)

func TestParseRequestDBQueryDefaults(t *testing.T) {
	gin.SetMode(gin.TestMode)
	c, _ := gin.CreateTestContext(httptest.NewRecorder())
	c.Request = httptest.NewRequest(http.MethodGet, "/records", nil)

	query, page, pageSize, err := parseRequestDBQuery(c)
	if err != nil {
		t.Fatalf("parseRequestDBQuery() error = %v", err)
	}
	if page != 1 || pageSize != defaultRequestDBPageSize {
		t.Fatalf("pagination = %d/%d, want 1/%d", page, pageSize, defaultRequestDBPageSize)
	}
	if query.Limit != defaultRequestDBPageSize || query.Offset != 0 {
		t.Fatalf("query paging = limit %d offset %d", query.Limit, query.Offset)
	}
	if query.Model != "" || query.Failed != nil || query.FromMS != 0 {
		t.Fatalf("empty query should produce zero filters: %+v", query)
	}
}

func TestParseRequestDBQueryFilters(t *testing.T) {
	gin.SetMode(gin.TestMode)
	c, _ := gin.CreateTestContext(httptest.NewRecorder())
	c.Request = httptest.NewRequest(http.MethodGet, "/records?model=gpt-test&api_key=key-1&provider=codex&session_id=s-1&request_id=r-1&failed=true&status_code=502&from=100&to=200&page=3&page_size=20", nil)

	query, page, pageSize, err := parseRequestDBQuery(c)
	if err != nil {
		t.Fatalf("parseRequestDBQuery() error = %v", err)
	}
	if page != 3 || pageSize != 20 {
		t.Fatalf("pagination = %d/%d, want 3/20", page, pageSize)
	}
	if query.Model != "gpt-test" || query.APIKey != "key-1" || query.Provider != "codex" {
		t.Fatalf("string filters mismatch: %+v", query)
	}
	if query.SessionID != "s-1" || query.RequestID != "r-1" {
		t.Fatalf("id filters mismatch: %+v", query)
	}
	if query.Failed == nil || !*query.Failed {
		t.Fatalf("failed filter = %v, want true", query.Failed)
	}
	if query.StatusCode != 502 || query.FromMS != 100 || query.ToMS != 200 {
		t.Fatalf("numeric filters mismatch: %+v", query)
	}
	if query.Limit != 20 || query.Offset != 40 {
		t.Fatalf("query paging = limit %d offset %d, want 20/40", query.Limit, query.Offset)
	}
}

func TestParseRequestDBQueryRejectsInvalidValues(t *testing.T) {
	gin.SetMode(gin.TestMode)
	cases := map[string]string{
		"page":        "page=0",
		"page_size":   "page_size=-1",
		"failed":      "failed=yes",
		"status_code": "status_code=-5",
		"from":        "from=abc",
		"to":          "to=xyz",
	}
	for name, queryString := range cases {
		c, _ := gin.CreateTestContext(httptest.NewRecorder())
		c.Request = httptest.NewRequest(http.MethodGet, "/records?"+queryString, nil)
		if _, _, _, err := parseRequestDBQuery(c); err == nil {
			t.Fatalf("%s: parseRequestDBQuery() accepted invalid value", name)
		}
	}
}

func TestParseRequestDBQueryClampsPageSize(t *testing.T) {
	gin.SetMode(gin.TestMode)
	c, _ := gin.CreateTestContext(httptest.NewRecorder())
	c.Request = httptest.NewRequest(http.MethodGet, "/records?page_size=100000", nil)

	_, page, pageSize, err := parseRequestDBQuery(c)
	if err != nil {
		t.Fatalf("parseRequestDBQuery() error = %v", err)
	}
	if pageSize != maxRequestDBPageSize {
		t.Fatalf("pageSize = %d, want clamped to %d", pageSize, maxRequestDBPageSize)
	}
	if page != 1 {
		t.Fatalf("page = %d, want 1", page)
	}
}

func TestGetRequestDBRecordsDisabledReturns503(t *testing.T) {
	gin.SetMode(gin.TestMode)
	handler := &Handler{}
	c, _ := gin.CreateTestContext(httptest.NewRecorder())
	c.Request = httptest.NewRequest(http.MethodGet, "/records", nil)

	handler.GetRequestDBRecords(c)
	if c.Writer.Status() != http.StatusServiceUnavailable {
		t.Fatalf("status = %d, want 503 when the request database is disabled", c.Writer.Status())
	}
}
