package telemetry

import (
	"context"
	"fmt"
	"math"
	"os"
	"runtime/metrics"
	"strconv"
	"strings"
	"sync"

	"go.opentelemetry.io/otel/metric"
)

// The same three per-process metrics the Node services emit. The OTLP names carry the unit, so Prometheus stores them as
// pharmacy_process_cpu_seconds_total, pharmacy_process_resident_memory_bytes and pharmacy_process_event_loop_lag_seconds.
const (
	cpuMetric      = "pharmacy.process.cpu"
	rssMetric      = "pharmacy.process.resident_memory"
	schedLagMetric = "pharmacy.process.event_loop_lag"
)

// registerProcessMetrics observes Go runtime CPU time, resident memory and, as the closest Go analogue of event loop lag,
// the p99 goroutine scheduling latency since the previous collection.
func registerProcessMetrics(meter metric.Meter) error {
	cpu, err := meter.Float64ObservableCounter(cpuMetric, metric.WithUnit("s"),
		metric.WithDescription("CPU time used by this process, busy time across user code and the Go runtime"))
	if err != nil {
		return fmt.Errorf("%s: %w", cpuMetric, err)
	}
	rss, err := meter.Int64ObservableGauge(rssMetric, metric.WithUnit("By"),
		metric.WithDescription("Resident set size of this process"))
	if err != nil {
		return fmt.Errorf("%s: %w", rssMetric, err)
	}
	lag, err := meter.Float64ObservableGauge(schedLagMetric, metric.WithUnit("s"),
		metric.WithDescription("p99 goroutine scheduling latency since the previous collection"))
	if err != nil {
		return fmt.Errorf("%s: %w", schedLagMetric, err)
	}

	sched := &schedulerLatency{}
	_, err = meter.RegisterCallback(func(_ context.Context, o metric.Observer) error {
		if busy, ok := busyCPUSeconds(); ok {
			o.ObserveFloat64(cpu, busy)
		}
		if bytes, ok := residentBytes(); ok {
			o.ObserveInt64(rss, bytes)
		}
		o.ObserveFloat64(lag, sched.p99Seconds())
		return nil
	}, cpu, rss, lag)
	if err != nil {
		return fmt.Errorf("register process callback: %w", err)
	}
	return nil
}

// busyCPUSeconds is total CPU time minus idle time, both from runtime/metrics, so it is portable across Windows and Linux.
func busyCPUSeconds() (float64, bool) {
	samples := []metrics.Sample{
		{Name: "/cpu/classes/total:cpu-seconds"},
		{Name: "/cpu/classes/idle:cpu-seconds"},
	}
	metrics.Read(samples)
	if samples[0].Value.Kind() != metrics.KindFloat64 || samples[1].Value.Kind() != metrics.KindFloat64 {
		return 0, false
	}
	return samples[0].Value.Float64() - samples[1].Value.Float64(), true
}

// residentBytes reads the resident pages from /proc/self/statm. Only Linux exposes it, so elsewhere nothing is observed.
func residentBytes() (int64, bool) {
	raw, err := os.ReadFile("/proc/self/statm")
	if err != nil {
		return 0, false
	}
	fields := strings.Fields(string(raw))
	if len(fields) < 2 {
		return 0, false
	}
	pages, err := strconv.ParseInt(fields[1], 10, 64)
	if err != nil {
		return 0, false
	}
	return pages * int64(os.Getpagesize()), true
}

// schedulerLatency turns the cumulative /sched/latencies:seconds histogram into a per-window p99.
type schedulerLatency struct {
	mu   sync.Mutex
	prev []uint64
}

func (s *schedulerLatency) p99Seconds() float64 {
	samples := []metrics.Sample{{Name: "/sched/latencies:seconds"}}
	metrics.Read(samples)
	if samples[0].Value.Kind() != metrics.KindFloat64Histogram {
		return 0
	}
	hist := samples[0].Value.Float64Histogram()

	s.mu.Lock()
	defer s.mu.Unlock()
	window := make([]uint64, len(hist.Counts))
	for i, count := range hist.Counts {
		var before uint64
		if i < len(s.prev) {
			before = s.prev[i]
		}
		window[i] = count - before // the histogram only grows, so this never underflows
	}
	s.prev = append(s.prev[:0], hist.Counts...)
	return percentileSeconds(window, hist.Buckets, 0.99)
}

// percentileSeconds returns the upper bound of the bucket holding quantile q of the counted samples. counts[i] covers
// [bounds[i], bounds[i+1]). An unbounded last bucket reports its finite lower bound. An empty window reports 0.
func percentileSeconds(counts []uint64, bounds []float64, q float64) float64 {
	var total uint64
	for _, c := range counts {
		total += c
	}
	if total == 0 {
		return 0
	}
	target := uint64(math.Ceil(q * float64(total)))
	var seen uint64
	for i, c := range counts {
		seen += c
		if seen >= target {
			if upper := bounds[i+1]; !math.IsInf(upper, 1) {
				return upper
			}
			return bounds[i]
		}
	}
	return 0 // unreachable: seen reaches total, which is at least target
}
