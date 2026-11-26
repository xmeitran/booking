// Điểm vào tiến trình con của src/lib/jobProcess.ts: `tsx src/jobs/run.ts <tên job>`. In kết quả ở dòng cuối stdout.
import { refreshDataSources } from '../lib/koc/dataSources';
import { syncWarehouseCreators } from '../lib/warehouse/creatorSync';

const JOBS: Record<string, () => Promise<string>> = { 'data-sources': refreshDataSources, 'sync-creators': syncWarehouseCreators };
const job = JOBS[process.argv[2]];
if (!job) {
  console.error(`Không có job "${process.argv[2]}"`);
  process.exit(2);
}
job().then(
  (m) => { console.log(m); process.exit(0); },
  (e) => { console.error(e instanceof Error ? e.message : String(e)); process.exit(1); },
);
