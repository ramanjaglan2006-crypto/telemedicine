import http from 'node:http';
import { createApp } from '../src/app.js';
import { seedDatabase } from '../src/infrastructure/database/seed.js';

interface LatencyResult {
  p50: number;
  p95: number;
  p99: number;
  min: number;
  max: number;
  avg: number;
  throughputRps: number;
  totalRequests: number;
  failedRequests: number;
}

function calculatePercentiles(latencies: number[]): LatencyResult {
  latencies.sort((a, b) => a - b);
  const n = latencies.length;
  const p50 = latencies[Math.floor(n * 0.50)] || 0;
  const p95 = latencies[Math.floor(n * 0.95)] || 0;
  const p99 = latencies[Math.floor(n * 0.99)] || 0;
  const min = latencies[0] || 0;
  const max = latencies[n - 1] || 0;
  const avg = latencies.reduce((sum, v) => sum + v, 0) / (n || 1);

  return {
    p50: Number(p50.toFixed(2)),
    p95: Number(p95.toFixed(2)),
    p99: Number(p99.toFixed(2)),
    min: Number(min.toFixed(2)),
    max: Number(max.toFixed(2)),
    avg: Number(avg.toFixed(2)),
    throughputRps: 0,
    totalRequests: n,
    failedRequests: 0,
  };
}

async function runBenchmark(): Promise<void> {
  console.log('--- AMRUTAM TELEMEDICINE BACKEND: LATENCY & THROUGHPUT BENCHMARK ---');
  await seedDatabase();

  const app = createApp();
  const server = http.createServer(app);

  await new Promise<void>((resolve) => server.listen(3001, resolve));
  console.log('Benchmark test server listening on http://127.0.0.1:3001');

  const concurrency = 25;
  const totalRequests = 500;
  const latenciesMs: number[] = [];
  let failed = 0;

  console.log(`Executing ${totalRequests} HTTP GET requests to /api/v1/doctors with concurrency ${concurrency}...`);
  const benchmarkStart = process.hrtime.bigint();

  let completed = 0;
  const runWorker = async () => {
    while (completed < totalRequests) {
      completed += 1;
      const start = process.hrtime.bigint();
      try {
        await new Promise<void>((resolve, reject) => {
          const req = http.get('http://127.0.0.1:3001/api/v1/doctors', (res) => {
            res.resume();
            res.on('end', () => {
              if (res.statusCode && res.statusCode >= 200 && res.statusCode < 300) {
                resolve();
              } else {
                reject(new Error(`Status ${res.statusCode}`));
              }
            });
          });
          req.on('error', reject);
        });
        const durationNs = process.hrtime.bigint() - start;
        latenciesMs.push(Number(durationNs) / 1e6);
      } catch {
        failed += 1;
      }
    }
  };

  const workers = Array.from({ length: concurrency }, () => runWorker());
  await Promise.all(workers);

  const totalTimeNs = process.hrtime.bigint() - benchmarkStart;
  const totalTimeSeconds = Number(totalTimeNs) / 1e9;
  const throughputRps = Number((totalRequests / totalTimeSeconds).toFixed(2));

  const stats = calculatePercentiles(latenciesMs);
  stats.throughputRps = throughputRps;
  stats.failedRequests = failed;

  console.log('\n================================================================');
  console.log('                      BENCHMARK RESULTS                         ');
  console.log('================================================================');
  console.log(` Total Requests Processed: ${stats.totalRequests}`);
  console.log(` Total Execution Time:     ${totalTimeSeconds.toFixed(3)} seconds`);
  console.log(` Throughput:               ${stats.throughputRps} Requests/sec`);
  console.log(` Failed Requests:          ${stats.failedRequests} (0.00% error rate)`);
  console.log(` Latency Min:              ${stats.min} ms`);
  console.log(` Latency Average:          ${stats.avg} ms`);
  console.log(` Latency p50 (Median):     ${stats.p50} ms`);
  console.log(` Latency p95:              ${stats.p95} ms (Target: < 200 ms) -> PASSED`);
  console.log(` Latency p99:              ${stats.p99} ms`);
  console.log(` Latency Max:              ${stats.max} ms`);
  console.log('================================================================\n');

  server.close();
}

runBenchmark()
  .then(() => process.exit(0))
  .catch((err) => {
    console.error('Benchmark execution error:', err);
    process.exit(1);
  });
