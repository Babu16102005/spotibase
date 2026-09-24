// Deprecated duplicate — canonical aiApi lives in ./client.ts.
// This re-export exists only so stale `import { aiApi } from "./aiApi"`
// references keep working without drifting (the old copy set a manual
// `multipart/form-data` Content-Type without boundary, causing HTTP 415).
export { aiApi } from "./client";
import { aiApi } from "./client";
export default aiApi;
