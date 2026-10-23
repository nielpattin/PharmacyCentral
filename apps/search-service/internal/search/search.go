// Package search decides how a product list query is answered: keyword-only for short queries, hybrid for longer ones
// when the embedder is configured, and keyword-only when the embedder fails. It mirrors catalog-service hybrid-search.ts.
package search

import (
	"context"
	"log/slog"
	"strings"

	"pharmacycentral/search-service/internal/cursor"
	"pharmacycentral/search-service/internal/embed"
	"pharmacycentral/search-service/internal/jsstring"
	"pharmacycentral/search-service/internal/query"
	"pharmacycentral/search-service/internal/typesense"
)

// SemanticMinWords is the word count from which a query is embedded (SEMANTIC_MIN_WORDS).
const SemanticMinWords = 3

// Answer is one serialised list page. NextCursor is empty on the last page.
type Answer struct {
	Body       []byte
	NextCursor string
}

type Service struct {
	index    *typesense.Client
	embedder *embed.Client
}

// NewService builds the service. A nil embedder means keyword-only search.
func NewService(index *typesense.Client, embedder *embed.Client) *Service {
	return &Service{index: index, embedder: embedder}
}

// Find answers one list query. An error means the index could not answer and the caller must fall back.
func (s *Service) Find(ctx context.Context, params query.Params) (Answer, error) {
	req := typesense.Request{
		Text:                 params.Search,
		Category:             params.Category,
		PrescriptionRequired: params.PrescriptionRequired,
		Limit:                params.Limit,
		Offset:               params.Offset,
	}
	if s.embedder != nil && params.Search != "" && wordCount(params.Search) >= SemanticMinWords {
		vector, err := s.embedder.Query(ctx, params.Search)
		if err != nil {
			slog.WarnContext(ctx, "product search degraded", "error", err)
		} else {
			req.Embedding = vector
			req.MaxDistance = s.embedder.MaxDistance()
		}
	}
	page, err := s.index.Search(ctx, req)
	if err != nil {
		return Answer{}, err
	}
	answer := Answer{Body: joinPayloads(page.Payloads)}
	if page.HasMore {
		answer.NextCursor = cursor.Encode(params.Offset + params.Limit)
	}
	return answer, nil
}

func wordCount(text string) int {
	return len(strings.FieldsFunc(text, jsstring.IsSpace))
}

// joinPayloads builds the JSON array from stored product JSON without decoding any product.
func joinPayloads(payloads []string) []byte {
	size := 2
	for _, p := range payloads {
		size += len(p) + 1
	}
	out := make([]byte, 0, size)
	out = append(out, '[')
	for i, p := range payloads {
		if i > 0 {
			out = append(out, ',')
		}
		out = append(out, p...)
	}
	return append(out, ']')
}
