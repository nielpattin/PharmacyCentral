package telemetry

import (
	"math"
	"testing"
)

func TestPercentileSeconds(t *testing.T) {
	inf := math.Inf(1)
	bounds := []float64{0, 0.001, 0.01, 0.1, inf}

	tests := []struct {
		name   string
		counts []uint64
		want   float64
	}{
		{name: "empty window", counts: []uint64{0, 0, 0, 0}, want: 0},
		{name: "p99 lands in the top bucket", counts: []uint64{90, 0, 0, 10}, want: 0.1},
		{name: "p99 stays in a low bucket", counts: []uint64{100, 0, 0, 0}, want: 0.001},
		{name: "unbounded bucket reports its lower bound", counts: []uint64{0, 0, 0, 5}, want: 0.1},
	}
	for _, tc := range tests {
		t.Run(tc.name, func(t *testing.T) {
			if got := percentileSeconds(tc.counts, bounds, 0.99); got != tc.want {
				t.Fatalf("percentileSeconds(%v) = %v, want %v", tc.counts, got, tc.want)
			}
		})
	}

}
